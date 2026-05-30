const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { URL } = require("url");

const { BACKEND_PORT_DEFAULT, parseArgs } = require("./config");
const { json, text, readBody } = require("./http");
const { deleteFile, listDir, mkdirp, moveFile, readFileUtf8, writeFileUtf8, ensureInsideVault } = require("./vault");
    const { getAppVersion, serveStatic, guessContentType } = require("./static");

async function main() {
    const args = parseArgs(process.argv);
    const vault = args.vault ?? process.env.OBSIDIAN_VAULT;
    const vaultReal = vault ? await fsp.realpath(vault) : null;
    const port = Number.isFinite(args.port) ? args.port : Number(process.env.PORT || BACKEND_PORT_DEFAULT);
    const host = args.host ?? process.env.HOST ?? "127.0.0.1";

    const crypto = require('crypto');

    const server = http.createServer(async (req, res) => {
        try {
            if (!req.url) return text(res, 400, "Bad Request");
            const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

            const remoteAddr = req.socket.remoteAddress || "";
            const isLocalReq = remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1";
            // Allow registration when the request comes from localhost
            const allowRegister = isLocalReq;

            async function readAccountHash() {
                try {
                    if (!vaultReal) return null;
                    const txt = await readFileUtf8(vaultReal, ".waccount");
                    return (txt || "").toString().trim() || null;
                } catch { return null; }
            }

            async function writeAccountHash(hash) {
                if (!vaultReal) throw new Error("No vault configured");
                await writeFileUtf8(vaultReal, ".waccount", hash);
            }

            function hashAccount(account, password) {
                return crypto.createHash('sha256').update(`${account}:${password}`).digest('hex');
            }

            function parseCookies(req) {
                const raw = req.headers.cookie || "";
                return raw.split(';').map(s=>s.trim()).filter(Boolean).reduce((acc, cur)=>{const idx=cur.indexOf('='); if(idx===-1) return acc; acc[cur.slice(0,idx)]=cur.slice(idx+1); return acc;}, {});
            }

            async function serveLoginHtml(message = "Please login") {
                                const vaultName = vaultReal ? path.basename(vaultReal) : '(none)';
                                const html = `<!doctype html>
<html>
    <head>
        <meta charset="utf-8">
        <title>Vault login</title>
        <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:24px;color:#111}h1{margin:0 0 12px}p{margin:0 0 12px;color:#333}form input{display:block;margin:6px 0;padding:8px;width:280px;max-width:90%}button{padding:8px 12px}</style>
    </head>
    <body>
        <h1>Vault Login</h1>
        <p><strong>Vault:</strong> ${escapeHtml(vaultName)}</p>
        <p>${escapeHtml(message)} — this vault requires authentication before any vault data is shown. If you are the server operator, enter the account and password to continue.</p>
        <form id="f">
            <input id="acct" placeholder="Account" required>
            <input id="pwd" type="password" placeholder="Password" required>
            <button type="submit">Login</button>
        </form>
        <script>
            document.getElementById('f').addEventListener('submit', async (e)=>{
                e.preventDefault();
                const a=document.getElementById('acct').value;
                const p=document.getElementById('pwd').value;
                const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:a,password:p})});
                if(r.ok) location.reload(); else {const j=await r.json(); alert(j.error||'Login failed');}
            })
        </script>
    </body>
</html>`;
                                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                                res.end(html);
            }

                        async function serveRegisterHtml(message = "Register vault account") {
                                const vaultName = vaultReal ? path.basename(vaultReal) : '(none)';
                                const html = `<!doctype html>
<html>
    <head>
        <meta charset="utf-8">
        <title>Register Vault Account</title>
        <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:24px;color:#111}h1{margin:0 0 12px}p{margin:0 0 12px;color:#333}form input{display:block;margin:6px 0;padding:8px;width:320px;max-width:95%}button{padding:8px 12px}</style>
    </head>
    <body>
        <h1>Register Vault Account</h1>
        <p><strong>Vault:</strong> ${escapeHtml(vaultName)}</p>
        <p>${escapeHtml(message)} — registration is only allowed from the server host (localhost). Registering creates a single account for this vault; remote clients will be required to login afterward.</p>
        <form id="f">
            <input id="acct" placeholder="Account" required>
            <input id="pwd" type="password" placeholder="Password" required>
            <button type="submit">Register</button>
        </form>
        <script>
            document.getElementById('f').addEventListener('submit', async (e)=>{
                e.preventDefault();
                const a=document.getElementById('acct').value;
                const p=document.getElementById('pwd').value;
                const r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:a,password:p})});
                if(r.ok) location.reload(); else {const j=await r.json(); alert(j.error||'Register failed');}
            })
        </script>
    </body>
</html>`;
                                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                                res.end(html);
                        }

            function escapeHtml(s){ return (s||'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;"); }

            // Authentication guard for vault access
            const acctHash = await readAccountHash();
            const cookies = parseCookies(req);
            const provided = cookies['wacct'] || null;

            const isApiRequest = reqUrl.pathname.startsWith('/api/');
            // If no account configured, block vault API access until registration completes,
            // but allow the application shell (static files) to load on the local host so
            // the "Choose local vault" flow can run in-browser.
            if (!acctHash) {
                if (isApiRequest) {
                    // Allow GET /api/config and /api/health so the frontend can bootstrap
                    // even when no account is configured. Allow POST /api/register only
                    // from local requests. All other API calls are blocked until
                    // registration completes.
                    const isPublicGet = req.method === 'GET' && (reqUrl.pathname === '/api/config' || reqUrl.pathname === '/api/health');
                    const isRegisterPost = req.method === 'POST' && reqUrl.pathname === '/api/register';
                    if (isPublicGet) {
                        // allow through to handlers below
                    } else if (isRegisterPost) {
                        if (!allowRegister) return json(res, 403, { error: 'Registration disabled' });
                        // allow through to registration handler below
                    } else {
                        return json(res, 401, { error: 'Registration required on server host' });
                    }
                } else {
                    // Non-API (static/app) requests: allow loading the app shell on local host
                    // so the client can run "Choose local vault". For remote clients, show
                    // the login/register notice.
                    if (!isLocalReq) return serveLoginHtml('No account configured. Register on server host');
                    // otherwise continue to serve static files (app shell)
                }
            }

            // At this point an account may exist. Enforce login for remote requests.
            // Allow some public API endpoints so the frontend can bootstrap and so
            // remote clients can POST /api/login to authenticate.
            if (!isLocalReq) {
                if (acctHash) {
                    const isLoginApi = isApiRequest && req.method === 'POST' && reqUrl.pathname === '/api/login';
                    const isPublicGet = isApiRequest && req.method === 'GET' && (reqUrl.pathname === '/api/config' || reqUrl.pathname === '/api/health');
                    if (provided !== acctHash) {
                        if (isLoginApi || isPublicGet) {
                            // allow through to handlers below
                        } else {
                            if (isApiRequest) return json(res, 401, { error: 'Authentication required' });
                            return serveLoginHtml('Login required');
                        }
                    }
                }
            }

            if (reqUrl.pathname.startsWith("/api/")) {
                if (req.method === "GET" && reqUrl.pathname === "/api/health") {
                    return json(res, 200, { ok: true });
                }

                if (req.method === "GET" && reqUrl.pathname === "/api/config") {
                    const version = await getAppVersion();
                    return json(res, 200, { vault: vaultReal ? path.basename(vaultReal) : null, version, accountConfigured: Boolean(acctHash) });
                }

                // Registration (only when server bound to localhost) and login
                if (req.method === 'POST' && reqUrl.pathname === '/api/register') {
                    // allow only when server host is local
                    if (!allowRegister) return json(res, 403, { error: 'Registration disabled' });
                    const bodyBuf = await readBody(req, 1024 * 1024);
                    let payload;
                    try { payload = JSON.parse(bodyBuf.toString('utf8') || '{}'); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
                    const acc = payload?.account?.toString()?.trim();
                    const pwd = payload?.password?.toString() ?? '';
                    if (!acc || !pwd) return json(res, 400, { error: 'Expected { account, password }' });
                    const existing = await (async () => { try { return await readFileUtf8(vaultReal, '.waccount'); } catch { return null; } })();
                    if (existing) return json(res, 409, { error: 'Account already exists' });
                    const h = hashAccount(acc, pwd);
                    await writeAccountHash(h);
                    return json(res, 200, { ok: true });
                }

                if (req.method === 'POST' && reqUrl.pathname === '/api/login') {
                    const bodyBuf = await readBody(req, 1024 * 1024);
                    let payload;
                    try { payload = JSON.parse(bodyBuf.toString('utf8') || '{}'); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
                    const acc = payload?.account?.toString()?.trim();
                    const pwd = payload?.password?.toString() ?? '';
                    if (!acc || !pwd) return json(res, 400, { error: 'Expected { account, password }' });
                    const stored = await readAccountHash();
                    if (!stored) return json(res, 400, { error: 'No account configured' });
                    const h = hashAccount(acc, pwd);
                    if (h !== stored) return json(res, 401, { error: 'Invalid credentials' });
                    // set cookie
                    res.setHeader('Set-Cookie', `wacct=${h}; Path=/; HttpOnly; SameSite=Strict`);
                    return json(res, 200, { ok: true });
                }

                if (!vaultReal) {
                    return json(res, 400, {
                        error:
                            "No vault configured. Start the server with --vault /path/to/vault, or use 'Choose local vault' in the UI."
                    });
                }

                if (req.method === "GET" && reqUrl.pathname === "/api/list") {
                    const dir = reqUrl.searchParams.get("dir") || "";
                    const entries = await listDir(vaultReal, dir);
                    return json(res, 200, { dir, entries });
                }

                if (req.method === "GET" && reqUrl.pathname === "/api/read") {
                    const filePath = reqUrl.searchParams.get("path");
                    if (!filePath) return json(res, 400, { error: "Missing path" });
                    const content = await readFileUtf8(vaultReal, filePath);
                    return json(res, 200, { path: filePath, content });
                }

                if (req.method === "GET" && reqUrl.pathname === "/api/raw") {
                    const filePath = reqUrl.searchParams.get("path");
                    console.log(`[api/raw] request path=${filePath}`);
                    if (!filePath) {
                        console.log(`[api/raw] missing path`);
                        return json(res, 400, { error: "Missing path" });
                    }
                    let abs;
                    try {
                        abs = ensureInsideVault(vaultReal, filePath);
                    } catch (err) {
                        console.log(`[api/raw] ensureInsideVault failed for path=${filePath}: ${err.message}`);
                        return json(res, 404, { error: "Not found" });
                    }
                    try {
                        const st = await fsp.stat(abs);
                        if (!st.isFile()) {
                            console.log(`[api/raw] not a file: ${abs}`);
                            return json(res, 404, { error: "Not found" });
                        }
                        console.log(`[api/raw] serving ${abs} (${st.size} bytes)`);
                        res.writeHead(200, {
                            "Content-Type": guessContentType(abs),
                            "Content-Length": st.size,
                            "Cache-Control": "no-store"
                        });
                        fs.createReadStream(abs).pipe(res);
                        return;
                    } catch (err) {
                        console.log(`[api/raw] stat/error for ${abs}: ${err && err.message}`);
                        return json(res, 404, { error: "Not found" });
                    }
                }

                if (req.method === "GET" && reqUrl.pathname === "/api/exists") {
                    const filePath = reqUrl.searchParams.get("path");
                    console.log(`[api/exists] check path=${filePath}`);
                    if (!filePath) return json(res, 400, { error: "Missing path" });
                    try {
                        const abs = ensureInsideVault(vaultReal, filePath);
                        const st = await fsp.stat(abs);
                        const exists = Boolean(st && st.isFile());
                        console.log(`[api/exists] ${filePath} -> ${abs} exists=${exists}`);
                        return json(res, 200, { exists });
                    } catch (err) {
                        console.log(`[api/exists] ${filePath} not found: ${err && err.message}`);
                        return json(res, 200, { exists: false });
                    }
                }

                if (req.method === "PUT" && reqUrl.pathname === "/api/write") {
                    const bodyBuf = await readBody(req);
                    let payload;
                    try {
                        payload = JSON.parse(bodyBuf.toString("utf8") || "{}");
                    } catch {
                        return json(res, 400, { error: "Invalid JSON" });
                    }
                    if (!payload || typeof payload.path !== "string" || typeof payload.content !== "string") {
                        return json(res, 400, { error: "Expected { path, content }" });
                    }
                    await writeFileUtf8(vaultReal, payload.path, payload.content);
                    return json(res, 200, { ok: true });
                }

                if (req.method === "POST" && reqUrl.pathname === "/api/move") {
                    const bodyBuf = await readBody(req, 1024 * 1024);
                    let payload;
                    try {
                        payload = JSON.parse(bodyBuf.toString("utf8") || "{}");
                    } catch {
                        return json(res, 400, { error: "Invalid JSON" });
                    }
                    if (!payload || typeof payload.from !== "string" || typeof payload.to !== "string") {
                        return json(res, 400, { error: "Expected { from, to }" });
                    }
                    await moveFile(vaultReal, payload.from, payload.to);
                    return json(res, 200, { ok: true });
                }

                if (req.method === "POST" && reqUrl.pathname === "/api/delete") {
                    const bodyBuf = await readBody(req, 1024 * 1024);
                    let payload;
                    try {
                        payload = JSON.parse(bodyBuf.toString("utf8") || "{}");
                    } catch {
                        return json(res, 400, { error: "Invalid JSON" });
                    }
                    if (!payload || typeof payload.path !== "string") {
                        return json(res, 400, { error: "Expected { path }" });
                    }
                    await deleteFile(vaultReal, payload.path);
                    return json(res, 200, { ok: true });
                }

                if (req.method === "POST" && reqUrl.pathname === "/api/mkdir") {
                    const bodyBuf = await readBody(req, 1024 * 1024);
                    let payload;
                    try {
                        payload = JSON.parse(bodyBuf.toString("utf8") || "{}");
                    } catch {
                        return json(res, 400, { error: "Invalid JSON" });
                    }
                    if (!payload || typeof payload.path !== "string") return json(res, 400, { error: "Expected { path }" });
                    await mkdirp(vaultReal, payload.path);
                    return json(res, 200, { ok: true });
                }

                return json(res, 404, { error: "Not found" });
            }

            if (req.method === "GET" && reqUrl.pathname === "/package.json") {
                const version = await getAppVersion();
                return json(res, 200, { version });
            }

            const served = await serveStatic(reqUrl, res);
            if (!served) text(res, 404, "Not Found");
        } catch (err) {
            const statusCode = err && typeof err.statusCode === "number" ? err.statusCode : 500;
            const message = err && err.message ? err.message : "Internal Server Error";
            json(res, statusCode, { error: message });
        }
    });

    server.listen(port, host, () => {
        console.log(`Vault: ${vaultReal ?? "(none)"}`);
        console.log(`Server: http://${host}:${port}`);
    });
}

module.exports = {
    main
};