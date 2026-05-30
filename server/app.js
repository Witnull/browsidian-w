const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { URL } = require("url");
const crypto = require('crypto');

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

    

    const server = http.createServer(async (req, res) => {
        try {
            if (!req.url) return text(res, 400, "Bad Request");
            const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

            function getClientIp(request) {
                const forwarded = (request.headers["x-forwarded-for"] || request.headers["x-real-ip"] || "").toString().split(",")[0].trim();
                if (forwarded) return forwarded;
                return request.socket.remoteAddress || "";
            }

            const remoteAddr = getClientIp(req);
            const isLocalReq = remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1" || remoteAddr === "localhost";
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
                return crypto.createHash('sha256').update(`${password}:${account}:this_is_just_a_s4ty_m34sur3`).digest('hex');
            }

            function parseCookies(req) {
                const raw = req.headers.cookie || "";
                return raw.split(';').map(s=>s.trim()).filter(Boolean).reduce((acc, cur)=>{const idx=cur.indexOf('='); if(idx===-1) return acc; acc[cur.slice(0,idx)]=cur.slice(idx+1); return acc;}, {});
            }
        
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

                if (req.method === "GET" && reqUrl.pathname === '/api/islocallogged'){
                    if (isLocalReq){
                        console.log("ok")
                        return json(res, 200, {ok: true});
                    }
                    return json(res, 400, {ok: false});
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