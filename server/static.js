const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const { ROOT_DIR, STATIC_DIR } = require("./config");

async function getAppVersion() {
    try {
        const pkg = JSON.parse(await fsp.readFile(path.join(ROOT_DIR, "package.json"), "utf8"));
        return pkg && typeof pkg.version === "string" ? pkg.version : "0.0.0";
    } catch {
        return "0.0.0";
    }
}

function guessContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".html") return "text/html; charset=utf-8";
    if (ext === ".js") return "application/javascript; charset=utf-8";
    if (ext === ".css") return "text/css; charset=utf-8";
    if (ext === ".svg") return "image/svg+xml";
    if (ext === ".png") return "image/png";
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".ico") return "image/x-icon";
    return "application/octet-stream";
}

async function serveStatic(reqUrl, res) {
    let pathname = reqUrl.pathname;
    if (pathname === "/") pathname = "/index.html";
    const abs = path.resolve(STATIC_DIR, "." + pathname);
    const staticPrefix = STATIC_DIR.endsWith(path.sep) ? STATIC_DIR : STATIC_DIR + path.sep;
    if (!abs.startsWith(staticPrefix)) return false;
    try {
        const st = await fsp.stat(abs);
        if (!st.isFile()) return false;
        if (pathname === "/index.html") {
            const version = await getAppVersion();
            const raw = await fsp.readFile(abs, "utf8");
            let body = raw.replaceAll("__APP_VERSION__", version);
            body = body.replace(
                /<meta\s+name="app-version"\s+content="[^"]*"\s*\/?>/i,
                `<meta name="app-version" content="${version}" />`
            );
            body = body.replace(
                /<span\s+id="appVersion"([^>]*)>[^<]*<\/span>/i,
                `<span id="appVersion"$1>v${version}</span>`
            );
            res.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
                "Content-Length": Buffer.byteLength(body),
                "Cache-Control": "no-store"
            });
            res.end(body);
            return true;
        }

        res.writeHead(200, {
            "Content-Type": guessContentType(abs),
            "Content-Length": st.size,
            "Cache-Control": "no-store"
        });
        fs.createReadStream(abs).pipe(res);
        return true;
    } catch {
        return false;
    }
}

module.exports = {
    getAppVersion,
    guessContentType,
    serveStatic
};