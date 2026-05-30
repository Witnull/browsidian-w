import {
    contextDeleteFileEl,
    contextMenuEl,
    contextRenameItemEl,
    editorEl,
    newFileBtn,
    newFolderBtn,
    previewEl,
    saveBtn,
    sourceModeBtn,
    toggleSidebarBtn,
    sidebarEl,
    searchEl,
    selectVaultBtn,
    themeToggleEl,
    treeEl,
    useServerBtn,
    vaultDialog,
    vaultChooseBtn,
    vaultDemoBtn,
} from "./modules/ui/dom.js";

import { apiGet, apiSend } from "./modules/core/api.js";
import { resolveAppVersion, setAppVersion } from "./modules/core/appVersion.js";

import { demoVaultStore } from "./modules/demoVault.js";

import { clearActiveFile, openFile, openWikiLinkTarget, saveCurrent, scheduleAutosave, selectFolder, showPreview, invalidateFileIndex, setSourceMode, setLineNumbers, setInlineEditLine, clearInlineEditLine, updateSourceLine, replaceSourceLines } from "./modules/ui/editor.js";

import { deleteFilePath, mkdir, moveFilePath, writeFile } from "./modules/ui/fileSystem.js";
import { showPrompt } from "./modules/core/prompts.js";

import { state } from "./modules/core/state.js";

import { ensureDirLoaded, getDropTargetDir, getMoveTargetPath, renderTree, toggleDir } from "./modules/ui/tree.js";
    import { apiGet, apiSend } from "./modules/core/api.js";
import { applyTheme, setActivePath, setDirty, setSaveStatus, setStatus, setVaultUiEnabled } from "./modules/core/ui.js";

import { setMode } from "./modules/ui/workspaceUi.js";

import {
    openDemoVault,
    restoreLocalVaultFromStorage,
    selectLocalVault,
    setVaultLabel,
    showVaultModal,
    switchToServerMode
} from "./modules/ui/vaults.js";

import { basenameOf, joinPath, normalizeDir, parentDirOf } from "./modules/utils/path.js";

function hideContextMenu() {
    if (!contextMenuEl) return;
    contextMenuEl.hidden = true;
    contextMenuEl.style.left = "0px";
    contextMenuEl.style.top = "0px";
    contextMenuEl.dataset.path = "";
    contextMenuEl.dataset.type = "";
}

function showContextMenu({ x, y, path, type }) {
    if (!contextMenuEl) return;
    contextMenuEl.hidden = false;
    contextMenuEl.dataset.path = path || "";
    import { authDialog, authForm, authTitle, authHelp, authAccount, authPassword, authRegisterToggle } from "./modules/ui/dom.js";
    contextMenuEl.dataset.type = type || "";

    const padding = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    contextMenuEl.style.left = "0px";
    contextMenuEl.style.top = "0px";
    const rect = contextMenuEl.getBoundingClientRect();
    const left = Math.min(Math.max(padding, x), vw - rect.width - padding);
    const top = Math.min(Math.max(padding, y), vh - rect.height - padding);
    contextMenuEl.style.left = `${left}px`;
    contextMenuEl.style.top = `${top}px`;
}

function splitBaseName(name) {
    const base = basenameOf(name);
    const dotIndex = base.lastIndexOf(".");
    if (dotIndex <= 0) return { stem: base, ext: "" };
    return { stem: base.slice(0, dotIndex), ext: base.slice(dotIndex) };
}

// Show auth dialog for login/register. Returns { action: 'submit'|'cancel', register: boolean, account, password }
function showAuthDialog({ title = 'Login', help = '', registerMode = false } = {}) {
    return new Promise((resolve) => {
        if (!authDialog) return resolve(null);
        authTitle.textContent = title;
        authHelp.textContent = help || '';
        authAccount.value = '';
        authPassword.value = '';
        authRegisterToggle.checked = Boolean(registerMode);
        authRegisterToggle.disabled = Boolean(registerMode);

        function cleanup() {
            authForm.removeEventListener('submit', onSubmit);
            authDialog.removeEventListener('close', onClose);
        }

        function onSubmit(e) {
            e.preventDefault();
            const account = authAccount.value?.toString?.() || '';
            const password = authPassword.value?.toString?.() || '';
            const register = Boolean(authRegisterToggle.checked);
            cleanup();
            try { authDialog.close(); } catch {};
            resolve({ action: 'submit', register, account, password });
        }

        function onClose() {
            cleanup();
            resolve({ action: 'cancel' });
        }

        authForm.addEventListener('submit', onSubmit);
        authDialog.addEventListener('close', onClose, { once: true });
        try { authDialog.showModal(); } catch { authDialog.open = true; }
        authAccount.focus();
    });
}

async function refreshAfterMove({ from, to, isDir }) {
    invalidateFileIndex();
    const fromPrefix = `${from}/`;

    if (isDir) {
        const remapPath = (value) => {
            if (value === from) return to;
            if (value.startsWith(fromPrefix)) return `${to}${value.slice(from.length)}`;
            return value;
        };

        state.expandedDirs = new Set(Array.from(state.expandedDirs, remapPath));
        if (state.selectedDir && (state.selectedDir === from || state.selectedDir.startsWith(fromPrefix))) {
            state.selectedDir = remapPath(state.selectedDir);
        }
        if (state.activeFile && (state.activeFile === from || state.activeFile.startsWith(fromPrefix))) {
            state.activeFile = remapPath(state.activeFile);
            setActivePath(state.activeFile);
        }

        state.childrenByDir = new Map();
        await ensureDirLoaded("");
        for (const dir of Array.from(state.expandedDirs)) {
            if (!dir) continue;
            try {
                await ensureDirLoaded(dir);
            } catch { }
        }
    } else {
        const fromParent = parentDirOf(from);
        const toParent = parentDirOf(to);
        state.childrenByDir.delete(fromParent);
        state.childrenByDir.delete(toParent);
        await ensureDirLoaded(fromParent);
        if (toParent !== fromParent) await ensureDirLoaded(toParent);
        state.expandedDirs.add(toParent);

        if (state.activeFile === from) {
            state.activeFile = to;
            setActivePath(to);
        }
    }

    renderTree();
    if (state.activeFile) await showPreview();
}

async function renameTreeItem(path, type) {
    const isDir = type === "dir";
    const currentName = basenameOf(path);
    const { stem, ext } = splitBaseName(currentName);
    const nextName = await showPrompt({
        title: isDir ? "Rename folder" : "Rename file",
        label: isDir ? "New folder name" : "New file name",
        help: isDir ? "Example: Archive" : "Example: note or note.md",
        placeholder: isDir ? currentName : stem,
        value: isDir ? currentName : stem
    });
    if (!nextName) return;
    const trimmed = nextName.trim();
    if (!trimmed) return;
    if (trimmed.includes("/") || trimmed.includes("\\")) {
        alert("Use a name only, not a path.");
        return;
    }

    let finalName = trimmed;
    if (!isDir) {
        const { stem: nextStem, ext: nextExt } = splitBaseName(trimmed);
        if (!nextExt && ext) finalName = `${nextStem}${ext}`;
    }

    const to = joinPath(parentDirOf(path), finalName);
    if (to === path) {
        setStatus("No rename.","r");
        return;
    }

    try {
        state.movingPath = path;
        state.moveInProgress = true;
        renderTree();
        setStatus("Renaming…","y");
        await moveFilePath(path, to);
        await refreshAfterMove({ from: path, to, isDir });
        setStatus("Renamed.","g");
    } catch (err) {
        setStatus(`Error: ${err.message}`,"r");
    } finally {
        state.movingPath = null;
        state.moveInProgress = false;
        renderTree();
    }
}

async function createFolder() {
    const base = normalizeDir((state.selectedDir ?? (state.activeFile ? parentDirOf(state.activeFile) : "")) || "");
    const rel = await showPrompt({
        title: "New folder",
        label: "Path (relative to the vault)",
        help: "Example: Notes/Projects",
        placeholder: base ? `${base}/New folder` : "New folder",
        value: base ? `${base}/` : ""
    });
    if (!rel) return;
    setStatus("Creating folder…","y");
    await mkdir(rel);
    invalidateFileIndex();
    const parent = parentDirOf(rel);
    state.childrenByDir.delete(parent);
    await ensureDirLoaded(parent);
    state.expandedDirs.add(parent);
    setStatus("Folder created.","g");
    renderTree();
}

async function createFile() {
    const base = normalizeDir((state.selectedDir ?? (state.activeFile ? parentDirOf(state.activeFile) : "")) || "");
    const rel = await showPrompt({
        title: "New file",
        label: "Path (relative to the vault)",
        help: "Example: Notes/my-note.md",
        placeholder: base ? `${base}/new.md` : "new.md",
        value: base ? `${base}/` : ""
    });
    if (!rel) return;
    const trimmed = rel.trim();
    const baseName = basenameOf(trimmed);
    const lower = trimmed.toLowerCase();
    let finalPath = trimmed;

    if (!lower.endsWith(".md")) {
        if (baseName.includes(".")) {
            alert("Only .md files are allowed.");
            setStatus("Error: only .md files are allowed.","r");
            return;
        }
        finalPath = `${trimmed}.md`;
    }

    setStatus("Creating file…","y");
    await writeFile(finalPath, "");
    invalidateFileIndex();
    const parent = parentDirOf(finalPath);
    state.childrenByDir.delete(parent);
    await ensureDirLoaded(parent);
    state.expandedDirs.add(parent);
    setStatus("File created.","g");
    renderTree();
    await openFile(finalPath);
}

function clearDropTargets() {
    treeEl.querySelectorAll(".tree-item.drop-target").forEach((el) => el.classList.remove("drop-target"));
}




async function bootstrap() { // initialize app
    setStatus("")
    setSaveStatus("")// flush


    setStatus("Connecting to server…","y");
    const cfg = await apiGet("/api/config").catch(() => null);
    state.vaultLabel = cfg?.vault ? cfg.vault : "";
    // Warn when vault exists but is not yet registered
    if (cfg && cfg.vault && cfg.accountConfigured === false) {
        setStatus("Vault is not registered. Registration required.", "r");
        // If running in browser on the server host, offer in-app registration modal
        const hostIsLocal = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
        if (hostIsLocal) {
            // show auth dialog in register mode
            const result = await showAuthDialog({ title: 'Register vault account', help: 'Registration is allowed only from the server host. Registering creates a single account for this vault.' , registerMode: true });
            if (result && result.action === 'submit' && result.register) {
                try {
                    const r = await apiSend("POST", "/api/register", { account: result.account, password: result.password });
                    if (r && r.ok) {
                        setStatus("Registration successful. Reloading…", "y");
                        location.reload();
                        return;
                    }
                } catch (e) {
                    setStatus(`Registration failed: ${e.message}`, "r");
                }
            }
        }
    }
    setVaultLabel(state.vaultLabel);
    state.appVersion = await resolveAppVersion()
    setAppVersion(state.appVersion);
    setMode("server");


    const restored = await restoreLocalVaultFromStorage().catch(() => false);
    if (restored) return;

    if (!cfg?.vault) {
        setVaultUiEnabled(false);
        treeEl.innerHTML = "";
        setStatus("Choose a local vault, or start the server with OBSIDIAN_VAULT/--vault.","r");
        showVaultModal();
        return;
    }
    setVaultUiEnabled(true);
    try {
        await ensureDirLoaded("");
        renderTree();
        setStatus("Ready.","g");
    } catch (err) {
        // If this is an authentication/registration issue, prompt the user to login.
        const msg = (err && err.message) ? err.message.toLowerCase() : "";
        if (msg.includes("authentication") || msg.includes("registration") || msg.includes("required")) {
            setStatus("Login required to access this vault.", "r");
            const result = await showAuthDialog({ title: 'Login', help: 'Enter your vault account and password to unlock vault access.', registerMode: false });
            if (result && result.action === 'submit' && !result.register) {
                try {
                    const r = await apiSend("POST", "/api/login", { account: result.account, password: result.password });
                    if (r && r.ok) {
                        setStatus("Login successful. Loading…", "y");
                        await ensureDirLoaded("");
                        renderTree();
                        setStatus("Ready.", "g");
                    } else {
                        setStatus("Login failed.", "r");
                    }
                } catch (e) {
                    setStatus(`Login failed: ${e.message}`, "r");
                }
            }
        } else {
            setStatus(`Error: ${err.message}`,"r");
        }
    }
}

function normalizeText(text) {
    return (text ?? "").toString().replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function getLinesFromText(text) {
    return normalizeText(text).split("\n");
}

function commitInlineLineChange({ lineNumber, nextText, activeLine, selectionStart, selectionEnd }) {
    const lines = getLinesFromText(editorEl.value);
    if (lineNumber < 0 || lineNumber >= lines.length) return;
    lines[lineNumber] = nextText;
    replaceSourceLines(lines, { activeLine, selectionStart, selectionEnd });
    if (state.dirty) scheduleAutosave();
}

function syncInlineSelection(editor) {
    if (!editor) return;
    const selectionStart = Number.isFinite(editor.selectionStart) ? editor.selectionStart : 0;
    const selectionEnd = Number.isFinite(editor.selectionEnd) ? editor.selectionEnd : selectionStart;
    state.activeInlineSelectionStart = selectionStart;
    state.activeInlineSelectionEnd = selectionEnd;
}

try {
    const saved = localStorage.getItem("theme");
    applyTheme(saved === "light" ? "light" : "dark");
} catch {
    applyTheme("dark");
}

if (themeToggleEl) {
    themeToggleEl.addEventListener("change", () => applyTheme(themeToggleEl.checked ? "light" : "dark"));
}

if (vaultChooseBtn) {
    vaultChooseBtn.addEventListener("click", async () => {
        try {
            await selectLocalVault();
            if (vaultDialog?.open) vaultDialog.close();
        } catch (err) {
            setStatus(`Error: ${err.message}`,"r");
        }
    });
}

if (vaultDemoBtn) {
    vaultDemoBtn.addEventListener("click", async () => {
        try {
            await openDemoVault();
        } catch (err) {
            setStatus(`Error: ${err.message}`,"r");
        }
    });
}

// Dropbox button removed.

selectVaultBtn.addEventListener("click", async () => {
    try {
        if (state.mode === "demo") {
            demoVaultStore.clear();
            await openDemoVault();
            return;
        }
        // Dropbox mode removed; fall back to local selection.
        await selectLocalVault();
    } catch (err) {
        setStatus(`Error: ${err.message}`,"r");
    }
});

useServerBtn.addEventListener("click", async () => {
    try {
        await switchToServerMode();
    } catch (err) {
        setStatus(`Error: ${err.message}`,"r");
    }
});

treeEl.addEventListener("click", async (e) => {
    const row = e.target.closest(".tree-item");
    if (!row) return;
    const type = row.dataset.type;
    const p = row.dataset.path;
    const clickedIcon = Boolean(e.target.closest(".icon"));
    try {
        if (type === "dir") {
            if (clickedIcon) await toggleDir(p);
            else await selectFolder(p);
            return;
        }
        await openFile(p);
    } catch (err) {
        setStatus(`Error: ${err.message}`,"r");
    }
});

treeEl.addEventListener("dragstart", (e) => {
    const row = e.target.closest(".tree-item");
    if (!row) return;
    if (row.dataset.type !== "file" && row.dataset.type !== "dir") return;
    if (state.moveInProgress || state.movingPath) return;
    state.draggingPath = row.dataset.path;
    state.draggingType = row.dataset.type;
    const dt = e.dataTransfer;
    if (!dt) return;
    dt.effectAllowed = "move";
    try {
        dt.setData("text/plain", row.dataset.path);
    } catch { }
    try {
        dt.setData("text", row.dataset.path);
    } catch { }
    try {
        dt.setData("application/x-obsidian-web-path", row.dataset.path);
    } catch { }
});

treeEl.addEventListener("dragend", () => {
    state.draggingPath = null;
    state.draggingType = null;
    clearDropTargets();
});

treeEl.addEventListener("dragenter", (e) => {
    if (!state.draggingPath) return;
    e.preventDefault();
});

treeEl.addEventListener("dragover", (e) => {
    const draggingPath = state.draggingPath;
    if (!draggingPath) return;
    const row = e.target.closest(".tree-item");
    if (row) {
        const targetType = row.dataset.type;
        if (targetType !== "dir" && targetType !== "file") return;
        clearDropTargets();
        row.classList.add("drop-target");
        treeEl.classList.remove("root-drop-target");
    } else {
        clearDropTargets();
        treeEl.classList.add("root-drop-target");
    }
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
});

treeEl.addEventListener("dragleave", (e) => {
    const row = e.target.closest(".tree-item");
    if (row) row.classList.remove("drop-target");
    if (e.target === treeEl) treeEl.classList.remove("root-drop-target");
});

treeEl.addEventListener("drop", async (e) => {
    const row = e.target.closest(".tree-item");
    e.preventDefault();
    clearDropTargets();
    treeEl.classList.remove("root-drop-target");
    const from = state.draggingPath;
    if (!from) return;

    const targetDir = row ? getDropTargetDir({ row }) : "";
    const to = getMoveTargetPath({ from, targetDir });
    const isDirMove = state.draggingType === "dir";
    const fromPrefix = `${from}/`;
    if (isDirMove && (to === from || to.startsWith(fromPrefix))) {
        setStatus("Cannot move a folder into itself.","r");
        state.draggingPath = null;
        state.draggingType = null;
        return;
    }
    if (to === from) {
        setStatus("No move.","r");
        return;
    }

    try {
        const ok = confirm(`Move\n\n${from}\n\n→ ${to}\n\nConfirm?`);
        if (!ok) return;
        state.movingPath = from;
        state.moveInProgress = true;
        renderTree();
        setStatus("Moving…","y");
        await moveFilePath(from, to);
        await refreshAfterMove({ from, to, isDir: isDirMove });
        setStatus("Moved.","g");
    } catch (err) {
        setStatus(`Error: ${err.message}`,"r");
    } finally {
        state.draggingPath = null;
        state.draggingType = null;
        state.movingPath = null;
        state.moveInProgress = false;
        treeEl.classList.remove("root-drop-target");
        renderTree();
    }
});

editorEl.addEventListener("input", () => {
    if (!state.activeFile) return;
    setDirty(editorEl.value !== state.activeFileContent);
    if (state.dirty) scheduleAutosave();
});

editorEl.addEventListener("blur", () => {
    if (!state.activeFile) return;
    if (state.dirty) scheduleAutosave();
    showPreview();
});

previewEl.addEventListener("click", async (e) => {
    const a = e.target.closest("a");
    if (a) {
        const wl = a.dataset.wikilink;
        if (wl) {
            e.preventDefault();
            try {
                await openWikiLinkTarget(decodeURIComponent(wl));
            } catch (err) {
                setStatus(`Error: ${err.message}`,"r");
            }
        }
        return;
    }

    if (state.sourceMode) return;

    const lineEditor = e.target.closest(".live-line-editor[data-line]");
    if (lineEditor) return;

    const lineEl = e.target.closest(".live-line[data-line]");
    if (!lineEl) {
        clearInlineEditLine();
        showPreview();
        return;
    }

    const lineNumber = Number.parseInt(lineEl.dataset.line || "", 10);
    if (!Number.isFinite(lineNumber)) return;
    state.inlineEditSkipBlur = true;
    setInlineEditLine(lineNumber);
    showPreview();
    queueMicrotask(() => { state.inlineEditSkipBlur = false; });
});

previewEl.addEventListener("input", (e) => {
    const editor = e.target.closest(".live-line-editor[data-line]");
    if (!editor) return;
    const lineNumber = Number.parseInt(editor.dataset.line || "", 10);
    if (!Number.isFinite(lineNumber)) return;
    syncInlineSelection(editor);
    updateSourceLine(lineNumber, editor.value.replaceAll("\r\n", "\n").replaceAll("\r", ""));
    editor.style.height = "auto";
    editor.style.height = `${Math.max(24, editor.scrollHeight)}px`;
    if (state.dirty) scheduleAutosave();
});

previewEl.addEventListener("keyup", (e) => {
    const editor = e.target.closest(".live-line-editor[data-line]");
    if (!editor) return;
    syncInlineSelection(editor);
});

previewEl.addEventListener("mouseup", (e) => {
    const editor = e.target.closest(".live-line-editor[data-line]");
    if (!editor) return;
    syncInlineSelection(editor);
});

previewEl.addEventListener("keydown", (e) => {
    const editor = e.target.closest(".live-line-editor[data-line]");
    if (!editor) return;
    const lineNumber = Number.parseInt(editor.dataset.line || "", 10);
    if (!Number.isFinite(lineNumber)) return;
    const value = editor.value;
    const selectionStart = editor.selectionStart ?? 0;
    const selectionEnd = editor.selectionEnd ?? selectionStart;
    const lines = getLinesFromText(editorEl.value);

    const focusLine = (targetLine, { start = 0, end = start } = {}) => {
        state.inlineEditSkipBlur = true;
        setInlineEditLine(targetLine, { selectionStart: start, selectionEnd: end });
        void showPreview();
        queueMicrotask(() => { state.inlineEditSkipBlur = false; });
    };

    const commitLineLines = (nextLines, targetLine, start = 0, end = start) => {
        state.inlineEditSkipBlur = true;
        replaceSourceLines(nextLines, { activeLine: targetLine, selectionStart: start, selectionEnd: end });
        if (state.dirty) scheduleAutosave();
        void showPreview();
        queueMicrotask(() => { state.inlineEditSkipBlur = false; });
    };

    if (e.key === "Enter") {
        e.preventDefault();
        const before = value.slice(0, selectionStart);
        const after = value.slice(selectionEnd);
        lines[lineNumber] = before;
        lines.splice(lineNumber + 1, 0, after);
        commitLineLines(lines, lineNumber + 1, 0, 0);
        return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "enter") {
        e.preventDefault();
        const before = value.slice(0, selectionStart);
        const after = value.slice(selectionEnd);
        lines[lineNumber] = before;
        lines.splice(lineNumber + 1, 0, after);
        commitLineLines(lines, lineNumber + 1, 0, 0);
        return;
    }

    if (e.key === "Tab") {
        e.preventDefault();
        const insertText = e.shiftKey ? "" : "  ";
        const before = value.slice(0, selectionStart);
        const after = value.slice(selectionEnd);
        const nextValue = e.shiftKey && before.endsWith("  ") ? before.slice(0, -2) + after : before + insertText + after;
        const nextCaret = e.shiftKey && before.endsWith("  ") ? Math.max(0, selectionStart - 2) : selectionStart + insertText.length;
        updateSourceLine(lineNumber, nextValue);
        focusLine(lineNumber, { start: nextCaret, end: nextCaret });
        return;
    }

    if (e.key === "ArrowUp" && selectionStart === 0 && selectionEnd === 0) {
        e.preventDefault();
        const prevLine = lineNumber > 0 ? lineNumber - 1 : 0;
        const prevText = lines[prevLine] ?? "";
        state.inlineEditSkipBlur = true;
        setInlineEditLine(prevLine, { selectionStart: prevText.length, selectionEnd: prevText.length });
        void showPreview();
        queueMicrotask(() => { state.inlineEditSkipBlur = false; });
        return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        lines.splice(lineNumber + 1, 0, value);
        commitLineLines(lines, lineNumber + 1, 0, 0);
        return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === "Backspace" || e.key === "Delete")) {
        e.preventDefault();
        if (lines.length <= 1) {
            lines[0] = "";
            commitLineLines(lines, 0, 0, 0);
            return;
        }
        const nextLines = [...lines.slice(0, lineNumber), ...lines.slice(lineNumber + 1)];
        const nextActive = Math.max(0, Math.min(lineNumber - 1, nextLines.length - 1));
        const nextText = nextLines[nextActive] ?? "";
        commitLineLines(nextLines, nextActive, nextText.length, nextText.length);
        return;
    }

    if (e.key === "Backspace" && selectionStart === 0 && selectionEnd === 0 && value.length === 0) {
        e.preventDefault();
        if (lines.length <= 1) {
            lines[0] = "";
            commitLineLines(lines, 0, 0, 0);
            return;
        }

        lines.splice(lineNumber, 1);
        const nextActive = Math.max(0, Math.min(lineNumber - 1, lines.length - 1));
        const nextText = lines[nextActive] ?? "";
        commitLineLines(lines, nextActive, nextText.length, nextText.length);
        return;
    }

    if (e.key === "Backspace" && selectionStart === 0 && selectionEnd === 0) {
        e.preventDefault();
        if (lineNumber === 0) {
            return;
        }

        const prevText = lines[lineNumber - 1] ?? "";
        const mergedText = `${prevText}${value}`;
        lines.splice(lineNumber - 1, 2, mergedText);
        commitLineLines(lines, lineNumber - 1, prevText.length, prevText.length);
        return;
    }

    if (e.altKey && e.key === "ArrowUp") {
        e.preventDefault();
        if (lineNumber <= 0) return;
        const nextLines = [...lines];
        const [moved] = nextLines.splice(lineNumber, 1);
        nextLines.splice(lineNumber - 1, 0, moved);
        commitLineLines(nextLines, lineNumber - 1, selectionStart, selectionEnd);
        return;
    }

    if (e.altKey && e.key === "ArrowDown") {
        e.preventDefault();
        if (lineNumber >= lines.length - 1) return;
        const nextLines = [...lines];
        const [moved] = nextLines.splice(lineNumber, 1);
        nextLines.splice(lineNumber + 1, 0, moved);
        commitLineLines(nextLines, lineNumber + 1, selectionStart, selectionEnd);
        return;
    }

    if (e.key === "ArrowDown" && selectionStart === value.length && selectionEnd === value.length) {
        e.preventDefault();
        const nextLine = lineNumber + 1;
        if (nextLine < lines.length) {
            const nextText = lines[nextLine] ?? "";
            state.inlineEditSkipBlur = true;
            setInlineEditLine(nextLine, { selectionStart: 0, selectionEnd: 0 });
            void showPreview();
            queueMicrotask(() => { state.inlineEditSkipBlur = false; });
            return;
        }
        lines.push("");
        state.inlineEditSkipBlur = true;
        replaceSourceLines(lines, { activeLine: lines.length - 1, selectionStart: 0, selectionEnd: 0 });
        void showPreview();
        queueMicrotask(() => { state.inlineEditSkipBlur = false; });
        return;
    }

    if (e.key === "Escape") {
        e.preventDefault();
        clearInlineEditLine();
        void showPreview();
    }
});

previewEl.addEventListener("blur", (e) => {
    if (!e.target.closest(".live-line-editor[data-line]")) return;
    if (state.inlineEditSkipBlur) return;
    clearInlineEditLine();
    showPreview();
}, true);

if (sourceModeBtn) {
    sourceModeBtn.addEventListener("click", () => {
        setSourceMode(!state.sourceMode, { focus: true });
    });
}

if (lineNumbersBtn) {
    lineNumbersBtn.addEventListener("click", () => {
        setLineNumbers(!state.lineNumbers);
    });
}

saveBtn.addEventListener("click", async () => {
    try {
        await saveCurrent();
    } catch (err) {
        setStatus(`Error: ${err.message}`,"r");
    }
});

document.addEventListener("keydown", async (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        try {
            await saveCurrent();
        } catch (err) {
            setStatus(`Error: ${err.message}`,"r");
        }
    }
});

searchEl.addEventListener("input", () => {
    state.filter = searchEl.value;
    renderTree();
});

newFolderBtn.addEventListener("click", async () => {
    try {
        await createFolder();
    } catch (err) {
        setStatus(`Error: ${err.message}`,"r");
    }
});

newFileBtn.addEventListener("click", async () => {
    try {
        await createFile();
    } catch (err) {
        setStatus(`Error: ${err.message}`,"r");
    }
});

window.addEventListener("beforeunload", (e) => {
    if (!state.dirty) return;
    e.preventDefault();
    e.returnValue = "";
});

document.addEventListener("click", () => hideContextMenu());
window.addEventListener("blur", () => hideContextMenu());
window.addEventListener("scroll", () => hideContextMenu(), true);

treeEl.addEventListener("contextmenu", (e) => {
    const row = e.target.closest(".tree-item");
    if (!row) return;
    e.preventDefault();
    showContextMenu({ x: e.clientX, y: e.clientY, path: row.dataset.path, type: row.dataset.type });
});

if (contextRenameItemEl) {
    contextRenameItemEl.addEventListener("click", async (e) => {
        e.preventDefault();
        const p = contextMenuEl?.dataset?.path;
        const type = contextMenuEl?.dataset?.type || "";
        hideContextMenu();
        if (!p || (type !== "file" && type !== "dir")) return;
        await renameTreeItem(p, type);
    });
}

if (contextDeleteFileEl) {
    contextDeleteFileEl.addEventListener("click", async (e) => {
        e.preventDefault();
        const p = contextMenuEl?.dataset?.path;
        hideContextMenu();
        if (!p) return;
        const ok = confirm(`Delete\n\n${p}\n\nThis cannot be undone. Continue?`);
        if (!ok) return;
        try {
            setStatus("Deleting…","y");
            await deleteFilePath(p);
            invalidateFileIndex();
            const parent = parentDirOf(p);
            state.childrenByDir.delete(parent);
            await ensureDirLoaded(parent);

            if (state.activeFile === p) {
                clearActiveFile();
            }

            renderTree();
            setStatus("Deleted.","g");
        } catch (err) {
            setStatus(`Error: ${err.message}`,"r");
        }
    });
}

; (function setupSidebarControls() {
    const appEl = document.querySelector('.app');
    if (!sidebarEl || !toggleSidebarBtn || !appEl) return;

    let hidden = false;
    toggleSidebarBtn.addEventListener('click', () => {
        hidden = !hidden;
        if (hidden) {
            appEl.classList.add('sidebar-hidden');
            toggleSidebarBtn.setAttribute('aria-pressed', 'true');
        } else {
            appEl.classList.remove('sidebar-hidden');
            toggleSidebarBtn.setAttribute('aria-pressed', 'false');
        }
    });
})();
bootstrap().catch((err) => setStatus(`Error: ${err.message}`,"r"));
