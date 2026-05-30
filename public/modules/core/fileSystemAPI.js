import { state } from "./appState.js";
import { apiGet, apiSend } from "./api.js";
import { demoVaultStore } from "../demoVault.js";
import { joinPath, normalizeDir, splitPath } from "../utils/path.js";
import { shouldIgnoreEntry } from "../utils/ignore.js";

async function getDirHandleByPath(dirRel, { create } = { create: false }) {
    if (!state.rootHandle) throw new Error("No local vault selected");
    let current = state.rootHandle;
    for (const part of splitPath(dirRel)) {
        current = await current.getDirectoryHandle(part, { create: Boolean(create) });
    }
    return current;
}

async function getFileHandleByPath(fileRel, { create } = { create: false }) {
    const parts = splitPath(fileRel);
    const filename = parts.pop();
    if (!filename) throw new Error("Chemin de fichier invalide");
    const parentDir = parts.length ? parts.join("/") : "";
    const dirHandle = await getDirHandleByPath(parentDir, { create: Boolean(create) });
    return await dirHandle.getFileHandle(filename, { create: Boolean(create) });
}

async function listDirBrowser(dirRel) {
    const dirHandle = await getDirHandleByPath(dirRel, { create: false });
    const entries = [];
    for await (const [name, handle] of dirHandle.entries()) {
        const relPath = joinPath(normalizeDir(dirRel), name);
        if (handle.kind === "directory") {
            if (shouldIgnoreEntry(name, "dir")) continue;
            entries.push({ name, path: relPath, type: "dir" });
        } else {
            if (shouldIgnoreEntry(name, "file")) continue;
            entries.push({ name, path: relPath, type: "file" });
        }
    }
    entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
    return entries;
}


async function readFileBrowser(fileRel) {
    const handle = await getFileHandleByPath(fileRel, { create: false });
    const file = await handle.getFile();
    return await file.text();
}

async function writeFileBrowser(fileRel, content) {
    const handle = await getFileHandleByPath(fileRel, { create: true });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
}

async function mkdirBrowser(dirRel) {
    await getDirHandleByPath(dirRel, { create: true });
}

export async function listDir(dirRel) {
    const d = normalizeDir(dirRel);
    if (state.mode === "demo") return demoVaultStore.listDir(d);
    if (state.mode === "browser") return await listDirBrowser(d);
    const data = await apiGet(`/api/list?dir=${encodeURIComponent(d)}`);
    return data.entries;
}

export async function readFile(rel) {
    if (state.mode === "demo") return demoVaultStore.readFile(rel);
    if (state.mode === "browser") return await readFileBrowser(rel);
    const data = await apiGet(`/api/read?path=${encodeURIComponent(rel)}`);
    return data.content;
}

export async function writeFile(rel, content) {
    if (state.mode === "demo") return demoVaultStore.writeFile(rel, content);
    if (state.mode === "browser") return await writeFileBrowser(rel, content);
    await apiSend("PUT", "/api/write", { path: rel, content });
}

export async function mkdir(rel) {
    if (state.mode === "demo") return demoVaultStore.mkdir(rel);
    if (state.mode === "browser") return await mkdirBrowser(rel);
    await apiSend("POST", "/api/mkdir", { path: rel });
}

async function pathExistsBrowser(relPath) {
    try {
        const parts = splitPath(relPath);
        if (parts.length === 0) return true;
        const name = parts.pop();
        const parent = parts.length ? parts.join("/") : "";
        const dir = await getDirHandleByPath(parent, { create: false });
        // Try directory first, then file.
        try {
            await dir.getDirectoryHandle(name, { create: false });
            return true;
        } catch { }
        try {
            await dir.getFileHandle(name, { create: false });
            return true;
        } catch { }
        return false;
    } catch {
        return false;
    }
}

async function pathKindBrowser(relPath) {
    try {
        const parts = splitPath(relPath);
        if (parts.length === 0) return "dir";
        const name = parts.pop();
        const parent = parts.length ? parts.join("/") : "";
        const dir = await getDirHandleByPath(parent, { create: false });
        try {
            await dir.getDirectoryHandle(name, { create: false });
            return "dir";
        } catch { }
        try {
            await dir.getFileHandle(name, { create: false });
            return "file";
        } catch { }
        return null;
    } catch {
        return null;
    }
}

async function deleteFileBrowser(fileRel) {
    const parts = splitPath(fileRel);
    const name = parts.pop();
    if (!name) throw new Error("Invalid file path");
    const parent = parts.length ? parts.join("/") : "";
    const dir = await getDirHandleByPath(parent, { create: false });
    await dir.removeEntry(name);
}

async function deleteDirBrowser(dirRel) {
    const parts = splitPath(dirRel);
    const name = parts.pop();
    if (!name) throw new Error("Invalid directory path");
    const parent = parts.length ? parts.join("/") : "";
    const dir = await getDirHandleByPath(parent, { create: false });
    await dir.removeEntry(name, { recursive: true });
}

async function copyDirBrowser(fromRel, toRel) {
    const fromHandle = await getDirHandleByPath(fromRel, { create: false });
    const toHandle = await getDirHandleByPath(toRel, { create: true });
    for await (const [name, handle] of fromHandle.entries()) {
        if (handle.kind === "directory") {
            const childFrom = joinPath(normalizeDir(fromRel), name);
            const childTo = joinPath(normalizeDir(toRel), name);
            await copyDirBrowser(childFrom, childTo);
            continue;
        }
        const file = await handle.getFile();
        const writable = await (await toHandle.getFileHandle(name, { create: true })).createWritable();
        await writable.write(await file.text());
        await writable.close();
    }
}

function isDescendantPath(parent, child) {
    const p = normalizeDir(parent);
    const c = normalizeDir(child);
    return Boolean(p) && (c === p || c.startsWith(`${p}/`));
}

export async function deleteFilePath(fileRel) {
    if (state.mode === "demo") {
        demoVaultStore.deleteFile(fileRel);
        return;
    }
    if (state.mode === "browser") {
        const kind = await pathKindBrowser(fileRel);
        if (!kind) throw new Error("Source not found");
        if (kind === "dir") {
            await deleteDirBrowser(fileRel);
            return;
        }
        await deleteFileBrowser(fileRel);
        return;
    }
    await apiSend("POST", "/api/delete", { path: fileRel });
}

export async function moveFilePath(fromRel, toRel) {
    if (fromRel === toRel) return;
    if (state.mode === "demo") {
        demoVaultStore.moveEntry(fromRel, toRel);
        return;
    }
    if (state.mode === "browser") {
        const kind = await pathKindBrowser(fromRel);
        if (!kind) throw new Error("Source not found");
        if (isDescendantPath(fromRel, toRel)) throw new Error("Cannot move a folder into itself");
        const exists = await pathExistsBrowser(toRel);
        if (exists) throw new Error("Destination already exists");
        if (kind === "file") {
            const content = await readFileBrowser(fromRel);
            await writeFileBrowser(toRel, content);
            await deleteFileBrowser(fromRel);
            return;
        }
        await copyDirBrowser(fromRel, toRel);
        await deleteDirBrowser(fromRel);
        return;
    }
    await apiSend("POST", "/api/move", { from: fromRel, to: toRel });
}
