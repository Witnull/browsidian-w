import { editorEl, previewEl, sourceModeBtn, lineNumbersBtn } from "./dom.js";
import { state } from "../core/appState.js";
import { AUTOSAVE_DELAY_MS } from "../core/config.js"
import { listDir, readFile, writeFile } from "../core/fileSystemAPI.js";
import { renderMarkdownBasic, renderMarkdownLive, processEmbeddedAssets } from "./markdown.js";
import { setActivePath, setDirty, setStatus, setSaveStatus } from "./uiState.js";
import { joinPath, normalizeDir, parentDirOf, stripMdExtension, hasExtension } from "../utils/path.js";
import { renderTree, setSelectedDir } from "./dirTree.js";
import { createIconButton } from "../utils/html.js";

export function clearAutosaveTimer() {
    if (state.autosaveTimer) window.clearTimeout(state.autosaveTimer);
    state.autosaveTimer = null;
}

export async function ensureFileIndex() {
    if (state.fileIndex) return state.fileIndex;
    if (state.fileIndexPromise) return await state.fileIndexPromise;

    state.fileIndexPromise = (async () => {
        const index = new Map();
        const walk = async (dir) => {
            const entries = await listDir(dir);
            for (const entry of entries) {
                if (entry.type === "dir") {
                    await walk(entry.path);
                    continue;
                }
                if (entry.type !== "file") continue;
                const lower = entry.name.toLowerCase();
                if (!lower.endsWith(".md")) continue;
                const key = stripMdExtension(entry.name).toLowerCase();
                const existing = index.get(key);
                if (existing) existing.push(entry.path);
                else index.set(key, [entry.path]);
            }
        };
        await walk("");
        state.fileIndex = index;
        state.fileIndexPromise = null;
        return index;
    })();

    return await state.fileIndexPromise;
}

export function invalidateFileIndex() {
    state.fileIndex = null;
    state.fileIndexPromise = null;
}

function syncSourceModeUi() {
    if (!sourceModeBtn) return;
    // sourceModeBtn.textContent = state.sourceMode ? "Preview" : "Source";
    sourceModeBtn.innerHTML = state.sourceMode ? createIconButton('i-preview', "Preview") : createIconButton('i-code', "Source") // icons in icon.html
    sourceModeBtn.title = state.sourceMode ? "Leave source mode" : "Show source mode";
    sourceModeBtn.setAttribute("aria-pressed", state.sourceMode ? "true" : "false");
}

function syncLineNumbersUi() {
    if (!lineNumbersBtn) return;
    // lineNumbersBtn.textContent = state.lineNumbers ? "Hide numbers" : "Line numbers";
    lineNumbersBtn.innerHTML = state.lineNumbers ? createIconButton('i-hide-line-numbers', "Hide numbers") : createIconButton('i-line-numbers', "Line numbers") // icons in icon.html
    lineNumbersBtn.title = state.lineNumbers ? "Hide line numbers" : "Show line numbers";
    lineNumbersBtn.setAttribute("aria-pressed", state.lineNumbers ? "true" : "false");
}

function syncEditorView({ focus = false } = {}) {
    if (!state.activeFile) return;
    if (state.sourceMode) {
        previewEl.hidden = true;
        editorEl.hidden = false;
        if (focus) editorEl.focus();
        return;
    }
    editorEl.hidden = true;
    previewEl.hidden = false;
}

function getSourceLines() {
    return editorEl.value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
}

function setEditorSourceText(nextText) {
    const normalized = (nextText ?? "").toString().replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    editorEl.value = normalized;
    setDirty(normalized !== state.activeFileContent);
}

function resizeInlineEditor(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(24, el.scrollHeight)}px`;
}

export function setInlineEditLine(lineNumber, { selectionStart = null, selectionEnd = null } = {}) {
    state.activeInlineLine = Number.isFinite(lineNumber) ? lineNumber : null;
    state.activeInlineSelectionStart = Number.isFinite(selectionStart) ? selectionStart : null;
    state.activeInlineSelectionEnd = Number.isFinite(selectionEnd) ? selectionEnd : null;
}

export function clearInlineEditLine() {
    state.activeInlineLine = null;
    state.activeInlineSelectionStart = null;
    state.activeInlineSelectionEnd = null;
}

export function updateSourceLine(lineNumber, nextLine) {
    const lines = getSourceLines();
    if (lineNumber < 0 || lineNumber >= lines.length) return;
    lines[lineNumber] = nextLine;
    setEditorSourceText(lines.join("\n"));
}

export function replaceSourceLines(lines, { activeLine = null, selectionStart = null, selectionEnd = null } = {}) {
    setEditorSourceText(lines.join("\n"));
    if (Number.isFinite(activeLine)) setInlineEditLine(activeLine, { selectionStart, selectionEnd });
    else clearInlineEditLine();
}

export function setLineNumbers(enabled, { refresh = true } = {}) {
    state.lineNumbers = Boolean(enabled);
    syncLineNumbersUi();
    if (refresh) void showPreview();
}

export function setSourceMode(enabled, { focus = true } = {}) {
    state.sourceMode = Boolean(enabled);
    state.activeInlineLine = null;
    state.activeInlineSelectionStart = null;
    state.activeInlineSelectionEnd = null;
    syncSourceModeUi();
    syncEditorView({ focus });
}

export async function openWikiLinkTarget(target) {
    if (!state.activeFile) return;
    let t = (target || "").toString().trim();
    if (!t) return;
    t = t.replaceAll("\\", "/").replaceAll(/^\/+/g, "");
    t = t.split("#")[0].trim();
    if (!t) return;

    if (!hasExtension(t)) t += ".md";

    const currentDir = parentDirOf(state.activeFile);
    if (!t.includes("/")) {
        const sameDirCandidate = joinPath(normalizeDir(currentDir), t);
        try {
            await openFile(sameDirCandidate);
            return;
        } catch { }

        setStatus("Recherche du lien…", "y");
        const index = await ensureFileIndex();
        const key = stripMdExtension(t).toLowerCase();
        const matches = index.get(key);
        if (matches && matches.length) {
            await openFile(matches[0]);
            return;
        }
        setStatus(`Link not found: [[${target}]]`, "r");
        return;
    }

    await openFile(normalizeDir(t));
}

export async function showPreview() {
    const content = state.activeFile ? editorEl.value : "";
    const isMd = state.activeFile ? state.activeFile.toLowerCase().endsWith(".md") : false;
    previewEl.innerHTML = state.activeFile
        ? isMd
            ? state.sourceMode
                ? renderMarkdownBasic(content)
                : renderMarkdownLive(content, state.activeInlineLine)
            : `<div class="editor-banner muted">File not supported</div>`
        : `<div class="editor-banner muted">Select a file on the left…</div>`;
    // Process any embedded assets (e.g. ![[file.base]], ![[video.webm]])
    try {
        await processEmbeddedAssets(previewEl);
    } catch { }
    syncSourceModeUi();
    syncEditorView({ focus: false });

    if (!state.sourceMode && state.activeInlineLine != null) {
        const inlineEditor = previewEl.querySelector(`.live-line-editor[data-line="${state.activeInlineLine}"]`);
        if (inlineEditor) {
            inlineEditor.focus();
            resizeInlineEditor(inlineEditor);
            try {
                const start = Number.isFinite(state.activeInlineSelectionStart) ? state.activeInlineSelectionStart : inlineEditor.value.length;
                const end = Number.isFinite(state.activeInlineSelectionEnd) ? state.activeInlineSelectionEnd : start;
                inlineEditor.setSelectionRange(start, end);
            } catch { }
        }
    }
}

export function showEditor({ focus } = { focus: true }) {
    if (!state.activeFile) return;
    if (!state.activeFile.toLowerCase().endsWith(".md")) return;
    setSourceMode(true, { focus });
}

export async function openFile(filePath) {
    if (!filePath) return;
    if (state.dirty) {
        const ok = confirm("You have unsaved changes. Continue without saving?");
        if (!ok) return;
    }
    clearAutosaveTimer();
    setStatus(`Opening: ${filePath}`, "y");
    const content = await readFile(filePath);
    state.activeFile = filePath;
    state.selectedDir = parentDirOf(filePath);
    state.activeFileContent = content;
    editorEl.value = content;
    setActivePath(filePath);
    setDirty(false);
    state.activeInlineLine = null;
    syncSourceModeUi();
    showPreview();
    setStatus("Ready.", "g");
    renderTree();
}

export async function saveCurrent() {
    if (!state.activeFile) return;
    setSaveStatus("Saving…", "y");
    await writeFile(state.activeFile, editorEl.value);
    state.activeFileContent = editorEl.value;
    setDirty(false);
    setSaveStatus("Saved.", "g");
    const keepInlineEdit = !state.sourceMode && state.activeInlineLine != null;
    if (keepInlineEdit) state.inlineEditSkipBlur = true;
    try {
        await showPreview();
    } finally {
        if (keepInlineEdit) queueMicrotask(() => { state.inlineEditSkipBlur = false; });
    }
}

export function scheduleAutosave() {
    if (!state.activeFile) return;
    if (!state.dirty) return;
    clearAutosaveTimer();
    setSaveStatus("Not saved", 'n')
    state.autosaveTimer = window.setTimeout(() => {
        state.autosaveTimer = null;
        void autosaveNow();
    }, AUTOSAVE_DELAY_MS);
}

export async function autosaveNow() {
    if (!state.activeFile) return;
    if (!state.dirty) return;
    if (state.autosaveInFlight) {
        state.autosaveQueued = true;
        return;
    }
    state.autosaveInFlight = true;
    try {
        setSaveStatus("Auto-saving…", "y");
        await writeFile(state.activeFile, editorEl.value);
        state.activeFileContent = editorEl.value;
        setDirty(false);
        setSaveStatus("Auto-saved.", "g");
        if (document.activeElement !== editorEl) {
            const keepInlineEdit = !state.sourceMode && state.activeInlineLine != null;
            if (keepInlineEdit) state.inlineEditSkipBlur = true;
            try {
                await showPreview();
            } finally {
                if (keepInlineEdit) queueMicrotask(() => { state.inlineEditSkipBlur = false; });
            }
        }
    } catch (err) {
        setSaveStatus(`Auto-save error: ${err.message}`, "r");
    } finally {
        state.autosaveInFlight = false;
        if (state.autosaveQueued) {
            state.autosaveQueued = false;
            scheduleAutosave();
        }
    }
}

export function clearActiveFile() {
    clearAutosaveTimer();
    state.activeFile = null;
    state.activeFileContent = "";
    state.sourceMode = false;
    state.activeInlineLine = null;
    state.activeInlineSelectionStart = null;
    state.activeInlineSelectionEnd = null;
    state.inlineEditSkipBlur = false;
    state.inlineEditSkipBlur = false;
    editorEl.value = "";
    setActivePath("");
    setDirty(false);
    syncSourceModeUi();
    syncLineNumbersUi();
    showPreview();
}

export async function selectFolder(dirRel) {
    if (state.dirty) {
        const ok = confirm("You have unsaved changes. Continue without saving?");
        if (!ok) return;
    }
    if (state.activeFile) clearActiveFile();
    setSelectedDir(dirRel);
    setStatus("Ready.", "g");
}
