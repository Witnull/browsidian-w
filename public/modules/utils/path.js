export function normalizeDir(dir) {
    if (!dir || dir === "/") return "";
    return dir.replaceAll(/\/+$/g, "");
}

export function joinPath(a, b) {
    if (!a) return b;
    if (!b) return a;
    return `${a}/${b}`;
}

export function splitPath(relPath) {
    return (relPath || "")
        .replaceAll("\\", "/")
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean);
}

export function basenameOf(relPath) {
    const s = (relPath || "").replaceAll(/\/+$/g, "");
    const idx = s.lastIndexOf("/");
    return idx === -1 ? s : s.slice(idx + 1);
}

export function parentDirOf(pathStr) {
    const s = (pathStr || "").replaceAll(/\/+$/g, "");
    const idx = s.lastIndexOf("/");
    return idx === -1 ? "" : s.slice(0, idx);
}

export function stripMdExtension(pathStr) {
    const s = (pathStr || "").toString();
    return s.toLowerCase().endsWith(".md") ? s.slice(0, -3) : s;
}

export function hasExtension(pathStr) {
    const base = basenameOf(pathStr);
    return base.includes(".") && !base.startsWith(".");
}
