
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");

const BACKEND_PORT_DEFAULT = 24173;

const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const STATIC_DIR = fs.existsSync(path.join(DIST_DIR, "index.html")) ? DIST_DIR : PUBLIC_DIR;

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i += 1) {
        const item = argv[i];
        if (item === "--vault") args.vault = argv[++i];
        else if (item === "--port") args.port = Number(argv[++i]);
        else if (item === "--host") args.host = argv[++i];
    }
    return args;
}

module.exports = {
    ROOT_DIR,
    BACKEND_PORT_DEFAULT,
    PUBLIC_DIR,
    DIST_DIR,
    STATIC_DIR,
    parseArgs
};