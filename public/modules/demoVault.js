import { shouldIgnoreEntry } from "./utils/ignore.js";
import { parentDirOf } from "./utils/path.js";

export const demoVaultStore = (() => {
    const KEY = "demoVaultV1";
    const SEP = "/";
    const WELCOME_PATH = "Welcome.md";
    const WELCOME_UPGRADE_MARKER = "# Browsidian — Demo Vault";

    function defaultWelcomeMd() {
        return `# Browsidian — Demo Vault

Welcome! This is a **safe, in-browser demo vault** that lets you try the UI without connecting a real folder.

## Why you might like this

- **Fast**: browse, search, create, and edit notes in seconds
- **Familiar**: Obsidian-style wikilinks like \`[[My note]]\`
- **Comfortable**: Markdown editor + preview + auto-save
- **Private**: in Demo mode, everything stays in your browser (stored in \`localStorage\`)

## Quick start (2 minutes)

1. Click **New file**
2. Type \`My first note\` (we’ll create \`My first note.md\`)
3. Write some Markdown, then click outside the editor to preview
4. Create a link: \`[[My first note]]\` or \`[[Another note]]\` and click it in preview

## Tips & shortcuts

- **Enter** confirms the create dialog (file/folder)
- **Ctrl+S / Cmd+S** saves immediately
- Auto-save triggers after ~1.2s of inactivity
- Click a **folder name** to select it (new files/folders will default there)
- Drag & drop a file onto a folder to move it

## Demo mode vs real vault

Demo mode is great for testing and automation, but it’s not meant for your real notes.

To work with your actual vault:

- Use **Choose local vault** (Chrome / Edge / Brave), or
- Run the local server with \`OBSIDIAN_VAULT=/path/to/vault npm start\`

---

Have fun exploring Browsidian.`;
    }

    function normalize(rel) {
        return (rel || "")
            .toString()
            .replaceAll("\\", "/")
            .replaceAll(/^\/+/g, "")
            .replaceAll(/\/+$/g, "");
    }

    function split(rel) {
        const s = normalize(rel);
        return s ? s.split(SEP).filter(Boolean) : [];
    }

    function basename(rel) {
        const parts = split(rel);
        return parts.length ? parts[parts.length - 1] : "";
    }

    function load() {
        try {
            const raw = localStorage.getItem(KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") return null;
            if (!parsed.files || typeof parsed.files !== "object") return null;
            if (!parsed.dirs || typeof parsed.dirs !== "object") return null;
            return parsed;
        } catch {
            return null;
        }
    }

    function save(data) {
        try {
            localStorage.setItem(KEY, JSON.stringify(data));
        } catch { }
    }

    function ensureSeed() {
        const existing = load();
        if (existing) {
            const files = existing.files || {};
            const currentWelcome = typeof files[WELCOME_PATH] === "string" ? files[WELCOME_PATH] : "";
            const isOldWelcome =
                currentWelcome && !currentWelcome.startsWith(WELCOME_UPGRADE_MARKER) && currentWelcome.startsWith("# Welcome");
            if (!currentWelcome || isOldWelcome) {
                existing.files[WELCOME_PATH] = defaultWelcomeMd();
                save(existing);
            }
            if (!existing.dirs || typeof existing.dirs !== "object") existing.dirs = { "": true };
            if (!existing.dirs[""]) existing.dirs[""] = true;
            return existing;
        }

        const seeded = { files: { [WELCOME_PATH]: defaultWelcomeMd() }, dirs: { "": true } };
        save(seeded);
        return seeded;
    }

    function mkdir(dirRel) {
        const data = ensureSeed();
        const p = normalize(dirRel);
        if (!p) return;
        const parts = split(p);
        let cur = "";
        for (const part of parts) {
            cur = cur ? `${cur}/${part}` : part;
            data.dirs[cur] = true;
        }
        save(data);
    }

    function listDir(dirRel) {
        const data = ensureSeed();
        const d = normalize(dirRel);
        const entries = [];

        const dirs = Object.keys(data.dirs || {});
        for (const p of dirs) {
            if (!p) continue;
            if (parentDirOf(p) !== d) continue;
            const name = basename(p);
            if (shouldIgnoreEntry(name, "dir")) continue;
            entries.push({ name, path: p, type: "dir" });
        }

        const files = Object.keys(data.files || {});
        for (const p of files) {
            if (parentDirOf(p) !== d) continue;
            const name = basename(p);
            if (shouldIgnoreEntry(name, "file")) continue;
            entries.push({ name, path: p, type: "file" });
        }

        entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
        return entries;
    }

    function readFile(fileRel) {
        const data = ensureSeed();
        const p = normalize(fileRel);
        if (!p) throw new Error("Invalid file path");
        const content = data.files[p];
        if (typeof content !== "string") throw new Error("File not found");
        return content;
    }

    function writeFile(fileRel, content) {
        const data = ensureSeed();
        const p = normalize(fileRel);
        if (!p) throw new Error("Invalid file path");
        mkdir(parentDirOf(p));
        data.files[p] = (content ?? "").toString();
        save(data);
    }

    function deleteFile(fileRel) {
        const data = ensureSeed();
        const p = normalize(fileRel);
        if (!p) throw new Error("Invalid file path");
        const isFile = Object.prototype.hasOwnProperty.call(data.files, p);
        const isDir = Object.prototype.hasOwnProperty.call(data.dirs, p);
        if (!isFile && !isDir) throw new Error("File not found");

        if (isFile) {
            delete data.files[p];
            save(data);
            return;
        }

        for (const filePath of Object.keys(data.files || {})) {
            if (filePath === p || filePath.startsWith(`${p}/`)) delete data.files[filePath];
        }
        for (const dirPath of Object.keys(data.dirs || {})) {
            if (dirPath === p || dirPath.startsWith(`${p}/`)) delete data.dirs[dirPath];
        }
        save(data);
    }

    function moveEntry(fromRel, toRel) {
        const data = ensureSeed();
        const from = normalize(fromRel);
        const to = normalize(toRel);
        if (!from || !to) throw new Error("Invalid path");
        if (from === to) return;

        const fromIsFile = Object.prototype.hasOwnProperty.call(data.files, from);
        const fromIsDir = Object.prototype.hasOwnProperty.call(data.dirs, from);

        if (!fromIsFile && !fromIsDir) throw new Error("File not found");
        if (to in data.files || to in data.dirs) throw new Error("Destination already exists");
        if (to.startsWith(`${from}/`)) throw new Error("Cannot move a folder into itself");

        mkdir(parentDirOf(to));

        if (fromIsFile) {
            data.files[to] = data.files[from];
            delete data.files[from];
            save(data);
            return;
        }

        const nextFiles = {};
        const nextDirs = {};
        for (const dirPath of Object.keys(data.dirs || {})) {
            if (dirPath === from || dirPath.startsWith(`${from}/`)) {
                const nextPath = dirPath === from ? to : `${to}${dirPath.slice(from.length)}`;
                nextDirs[nextPath] = true;
            } else {
                nextDirs[dirPath] = true;
            }
        }
        for (const filePath of Object.keys(data.files || {})) {
            if (filePath === from || filePath.startsWith(`${from}/`)) {
                const nextPath = filePath === from ? to : `${to}${filePath.slice(from.length)}`;
                nextFiles[nextPath] = data.files[filePath];
            } else {
                nextFiles[filePath] = data.files[filePath];
            }
        }
        data.files = nextFiles;
        data.dirs = nextDirs;
        save(data);
    }

    function clear() {
        try {
            localStorage.removeItem(KEY);
        } catch { }
    }

    return { listDir, readFile, writeFile, mkdir, deleteFile, moveEntry, moveFile: moveEntry, clear };
})();
