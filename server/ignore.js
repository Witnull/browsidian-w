const IGNORED_DIRS = new Set([".obsidian", ".git", "node_modules", ".trash", ".DS_Store", ".stfolder", ".copilot", ".stversions"]);
const IGNORED_FILES = new Set([".gitignore", ".waccount"]);

module.exports = {
    IGNORED_DIRS,
    IGNORED_FILES
}