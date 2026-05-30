const fsp = require("fs/promises");
const path = require("path");

const { IGNORED_DIRS, IGNORED_FILES } = require("./ignore");

function safeRelPath(input) {
    const rel = (input ?? "").toString();
    if (rel.includes("\0")) throw Object.assign(new Error("Invalid path"), { statusCode: 400 });
    return rel.replaceAll("\\", "/");
}

function ensureInsideVault(vaultReal, relPath) {
    const rel = safeRelPath(relPath);
    const abs = path.resolve(vaultReal, rel);
    const vaultPrefix = vaultReal.endsWith(path.sep) ? vaultReal : vaultReal + path.sep;
    if (abs === vaultReal) return abs;
    if (!abs.startsWith(vaultPrefix)) throw Object.assign(new Error("Path escapes vault"), { statusCode: 400 });
    return abs;
}

function shouldIgnoreName(name, kind = "file") {
    if (!name) return true;
    if (kind === "dir") return IGNORED_DIRS.has(name);
    if (IGNORED_DIRS.has(name)) return true;
    if (IGNORED_FILES.has(name)) return true;
    return name.toLowerCase().endsWith(".base");
}

async function listDir(vaultReal, dirRel) {
    const absDir = ensureInsideVault(vaultReal, dirRel);
    const entries = await fsp.readdir(absDir, { withFileTypes: true });
    const mapped = [];
    for (const ent of entries) {
        const entRel = path.posix.join(safeRelPath(dirRel || "").replaceAll(/\/+$/g, ""), ent.name);
        if (ent.isDirectory()) {
            if (shouldIgnoreName(ent.name, "dir")) continue;
            mapped.push({ name: ent.name, path: entRel, type: "dir" });
            continue;
        }
        if (ent.isFile()) {
            if (shouldIgnoreName(ent.name, "file")) continue;
            mapped.push({ name: ent.name, path: entRel, type: "file" });
        }
    }
    mapped.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
    return mapped;
}

async function readFileUtf8(vaultReal, fileRel) {
    const abs = ensureInsideVault(vaultReal, fileRel);
    const st = await fsp.stat(abs);
    if (!st.isFile()) throw Object.assign(new Error("Not a file"), { statusCode: 400 });
    return await fsp.readFile(abs, "utf8");
}

async function writeFileUtf8(vaultReal, fileRel, content) {
    const abs = ensureInsideVault(vaultReal, fileRel);
    const dir = path.dirname(abs);
    const dirSt = await fsp.stat(dir);
    if (!dirSt.isDirectory()) throw Object.assign(new Error("Parent is not a directory"), { statusCode: 400 });
    await fsp.writeFile(abs, content, "utf8");
}

async function moveFile(vaultReal, fromRel, toRel) {
    const fromAbs = ensureInsideVault(vaultReal, fromRel);
    const toAbs = ensureInsideVault(vaultReal, toRel);
    const fromSt = await fsp.stat(fromAbs);
    if (fromAbs === toAbs) return;
    const toDir = path.dirname(toAbs);
    const toDirSt = await fsp.stat(toDir).catch(() => null);
    if (!toDirSt || !toDirSt.isDirectory()) throw Object.assign(new Error("Destination directory not found"), { statusCode: 400 });
    const existing = await fsp.stat(toAbs).catch(() => null);
    if (existing) throw Object.assign(new Error("Destination already exists"), { statusCode: 409 });
    if (fromSt.isDirectory()) {
        const rel = path.relative(fromAbs, toAbs);
        if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) throw Object.assign(new Error("Cannot move a folder into itself"), { statusCode: 400 });
    }
    await fsp.rename(fromAbs, toAbs);
}

async function deleteFile(vaultReal, fileRel) {
    if (!fileRel) throw Object.assign(new Error("Invalid path"), { statusCode: 400 });
    const abs = ensureInsideVault(vaultReal, fileRel);
    const st = await fsp.stat(abs);
    if (st.isFile()) {
        await fsp.unlink(abs);
        return;
    }
    if (st.isDirectory()) {
        await fsp.rm(abs, { recursive: true, force: false });
        return;
    }
    throw Object.assign(new Error("Unsupported path type"), { statusCode: 400 });
}

async function mkdirp(vaultReal, dirRel) {
    const abs = ensureInsideVault(vaultReal, dirRel);
    await fsp.mkdir(abs, { recursive: true });
}

module.exports = {
    safeRelPath,
    ensureInsideVault,
    shouldIgnoreName,
    listDir,
    readFileUtf8,
    writeFileUtf8,
    moveFile,
    deleteFile,
    mkdirp
};