import { treeEl } from "./dom.js";
import { state } from "../core/appState.js";
import { listDir } from "../core/fileSystemAPI.js";
import { setStatus } from "./uiState.js";
import { basenameOf, joinPath, normalizeDir, parentDirOf } from "../utils/path.js";
import { shouldIgnoreEntry } from "../utils/ignore.js";
import { createIconButton } from "../utils/html.js";

export function iconFor(entry) {
    if (entry.type === "dir") return state.expandedDirs.has(entry.path) ? "i-chevron-down" : "i-chevron-right";
    return "i-file-text";
}

export async function ensureDirLoaded(dir) {
    const d = normalizeDir(dir);
    if (state.childrenByDir.has(d)) return;
    const entries = await listDir(d);
    state.childrenByDir.set(d, entries);
}

function passesFilter(entry) {
    const q = state.filter.trim().toLowerCase();
    if (!q) return true;
    return entry.path.toLowerCase().includes(q);
}

export function hasAnyChildMatching(dir) {
    const entries = state.childrenByDir.get(dir);
    if (!entries) return false;
    const q = state.filter.trim().toLowerCase();
    if (!q) return true;
    for (const entry of entries) {
        if (shouldIgnoreEntry(entry.name, entry.type)) continue;
        if (entry.path.toLowerCase().includes(q)) return true;
        if (entry.type === "dir" && hasAnyChildMatching(entry.path)) return true;
    }
    return false;
}

export function renderTree() {
    treeEl.innerHTML = "";
    const frag = document.createDocumentFragment();

    const selectedDir = normalizeDir(state.selectedDir || "");
    const movingPath = normalizeDir(state.movingPath || "");
    const isMovingEntry = (entryPath) => {
        if (!movingPath) return false;
        return entryPath === movingPath || entryPath.startsWith(`${movingPath}/`);
    };

    const renderDirChildren = (dir, container) => {
        const entries = state.childrenByDir.get(dir) || [];
        for (const entry of entries) {
            if (shouldIgnoreEntry(entry.name, entry.type)) continue;
            if (!passesFilter(entry)) {
                if (entry.type === "dir" && hasAnyChildMatching(entry.path)) {
                    // keep
                } else {
                    continue;
                }
            }

            const row = document.createElement("div");
            row.className = "tree-item";
            row.setAttribute("role", "treeitem");
            row.dataset.path = entry.path;
            row.dataset.type = entry.type;
            const moving = isMovingEntry(entry.path);
            if (entry.type === "file" || entry.type === "dir") {
                row.draggable = !moving;
                row.setAttribute("draggable", moving ? "false" : "true");
            }
            if (moving) {
                row.classList.add("moving");
                row.setAttribute("aria-disabled", "true");
            }

            if (entry.type === "file" && entry.path === state.activeFile) row.classList.add("active");
            if (entry.type === "dir" && entry.path === selectedDir) row.classList.add("selected");

            // const icon = document.createElement("div");
            // icon.className = "icon";
            // const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            // svg.setAttribute("class", "icon-svg");
            // svg.setAttribute("aria-hidden", "true");
            // const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
            // use.setAttribute("href", `#${iconFor(entry)}`);
            // svg.appendChild(use);
            // icon.appendChild(svg);
            row.innerHTML = createIconButton(iconFor(entry), entry.name)

            // const name = document.createElement("div");
            // name.className = "name";
            // name.textContent = entry.name;

            // // row.appendChild(icon)
            // row.appendChild(name);
            container.appendChild(row);

            if (entry.type === "dir") {
                const childrenWrap = document.createElement("div");
                childrenWrap.className = "tree-children";
                childrenWrap.hidden = !state.expandedDirs.has(entry.path);
                container.appendChild(childrenWrap);
                if (state.expandedDirs.has(entry.path)) renderDirChildren(entry.path, childrenWrap);
            }
        }
    };

    renderDirChildren("", frag);
    treeEl.appendChild(frag);
}

export async function toggleDir(dir) {
    const d = normalizeDir(dir);
    if (state.expandedDirs.has(d)) {
        state.expandedDirs.delete(d);
        renderTree();
        return;
    }
    setStatus(`Loading: ${d || "/"}`, "y");
    await ensureDirLoaded(d);
    state.expandedDirs.add(d);
    setStatus("Ready.", "g");
    renderTree();
}

export function setSelectedDir(dirRel) {
    state.selectedDir = normalizeDir(dirRel);
    renderTree();
}

export function getDropTargetDir({ row }) {
    if (row) {
        if (row.dataset.type !== "dir" && row.dataset.type !== "file") return "";
        return row.dataset.type === "dir" ? row.dataset.path : parentDirOf(row.dataset.path);
    }
    return state.selectedDir || "";
}

export function getMoveTargetPath({ from, targetDir }) {
    return joinPath(normalizeDir(targetDir), from ? basenameOf(from) : "");
}
