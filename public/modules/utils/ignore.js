const IGNORED_DIRS = new Set([".obsidian", ".git", "node_modules", ".trash", ".DS_Store", ".stfolder", ".copilot", ".stversions"]);
const IGNORED_FILES = new Set([".gitignore", ".waccount"]);

export function shouldIgnoreEntry(name, kind = "file") {
    if (!name) return true;
    if (kind === "dir") return IGNORED_DIRS.has(name);
    if (IGNORED_DIRS.has(name)) return true;
    if (IGNORED_FILES.has(name)) return true;
    return name.toLowerCase().endsWith(".base");
}

export function shouldIgnoreName(name) {
    return shouldIgnoreEntry(name, "file");
}
