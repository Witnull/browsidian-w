import { createActionsEl, currentPathEl, dirtyEl, saveBtn, searchEl, statusEl, saveStatusEl, themeToggleEl } from "../ui/dom.js";
import { state } from "./state.js";

export function getColorAction(action){
    let color = ""
    switch (action){
        case "g":
            color = "🟢"
            break;
        case "y":
            color = "🟡"
            break;
        case "r":
            color = "🔴"
            break;
        case "n":
            color = "⚪"
            break;
        default:
            color = ""
    }   
    return color
}

export function setStatus(msg, action ="") {
    statusEl.textContent = `${getColorAction(action)}${msg}`;
}

export function setSaveStatus(msg, action="") {
    saveStatusEl.textContent = `${getColorAction(action)}${msg}`;
}



export function setDirty(isDirty) {
    state.dirty = isDirty;
    dirtyEl.hidden = !isDirty;
    saveBtn.disabled = !state.activeFile || !isDirty;
}

export function setActivePath(path) {

    currentPathEl.textContent = path || "—";
}

export function setVaultUiEnabled(enabled) {
    const on = Boolean(enabled);
    if (searchEl) searchEl.hidden = !on;
    if (createActionsEl) createActionsEl.hidden = !on;
}

export function applyTheme(theme) {
    const t = theme === "light" ? "light" : "dark";
    if (t === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    if (themeToggleEl) themeToggleEl.checked = t === "light";
    try {
        localStorage.setItem("theme", t);
    } catch { }
}
