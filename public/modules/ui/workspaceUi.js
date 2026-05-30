import { editorEl, previewEl, searchEl, selectVaultBtn, sourceModeBtn, treeEl, useServerBtn } from "./dom.js";
import { state } from "../core/state.js";
import { clearAutosaveTimer, invalidateFileIndex, setLineNumbers } from "./editor.js";
import { setActivePath, setDirty } from "../core/ui.js";

export function setMode(nextMode) {
    state.mode = nextMode;
    selectVaultBtn.disabled = false;
    const setIconBtn = (btn, { label, title }) => {
        if (!btn) return;
        const labelEl = btn.querySelector(".icon-btn-label");
        if (labelEl) labelEl.textContent = label;
        else btn.textContent = label;
        if (typeof title === "string") {
            btn.title = title;
            btn.setAttribute("aria-label", title);
        }
    };

    if (nextMode === "browser") setIconBtn(selectVaultBtn, { label: "Change", title: "Change local vault" });
    else if (nextMode === "demo") setIconBtn(selectVaultBtn, { label: "Reset", title: "Reset demo vault" });
    else setIconBtn(selectVaultBtn, { label: "Choose", title: "Choose local vault" });

    useServerBtn.hidden = nextMode === "server";
    if (nextMode === "demo") setIconBtn(useServerBtn, { label: "Exit", title: "Exit demo" });
    else setIconBtn(useServerBtn, { label: "Disconnect", title: "Disconnect" });
}

export function resetUiState() {
    clearAutosaveTimer();
    invalidateFileIndex();
    state.expandedDirs = new Set([""]);
    state.childrenByDir = new Map();
    state.activeFile = null;
    state.activeFileContent = "";
    state.sourceMode = false;
    state.activeInlineSelectionStart = null;
    state.activeInlineSelectionEnd = null;
    state.inlineEditSkipBlur = false;
    setLineNumbers(false, { refresh: false });
    state.dirty = false;
    state.selectedDir = null;
    state.filter = searchEl.value || "";
    editorEl.value = "";
    previewEl.innerHTML = `<div class="muted">Select a file on the left…</div>`;
    previewEl.hidden = false;
    editorEl.hidden = true;
    if (sourceModeBtn) {
        sourceModeBtn.textContent = "Source";
        sourceModeBtn.title = "Show source mode";
        sourceModeBtn.setAttribute("aria-pressed", "false");
    }
    setActivePath("");
    setDirty(false);
}
