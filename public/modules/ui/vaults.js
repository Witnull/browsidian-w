import { treeEl, vaultChooseBtn, vaultDialog, vaultNameEl } from "./dom.js";
import { state } from "../core/appState.js";
import { apiGet } from "../core/api.js";
import { setStatus, setVaultUiEnabled } from "./uiState.js";
import { ensureDirLoaded, renderTree } from "./dirTree.js";
import { openFile } from "./editor.js";
import { resetUiState, setMode } from "./resetUIStateOnMode.js";

export function setVaultLabel(label) {
    vaultNameEl.textContent = label ? `🟢${label}` : "🔴<none>";
    vaultNameEl.ariaLabel = label ? `Vault: ${label}` : "Not a vault"
}

async function activateVaultSession({ mode, label, rootHandle = null, openPath = null, closeDialog = false }) {
    state.rootHandle = rootHandle;
    state.vaultLabel = label;
    setMode(mode);
    setVaultLabel(label);
    setVaultUiEnabled(true);
    resetUiState();
    await ensureDirLoaded("");
    renderTree();
    if (openPath) {
        await openFile(openPath).catch(() => { });
    }
    setStatus("Ready.", "g");
    if (closeDialog && vaultDialog?.open) vaultDialog.close();
}

export function showVaultModal() {
    if (!vaultDialog) return;
    if (vaultDialog.open) return;
    const supported = "showDirectoryPicker" in window;
    if (vaultChooseBtn) {
        vaultChooseBtn.disabled = !supported;
        vaultChooseBtn.textContent = supported ? "Choose local vault" : "Choose local vault (Chrome/Edge/Brave)";
    }
    vaultDialog.showModal();
}

export async function openDemoVault() {
    if (state.dirty) {
        const ok = confirm("You have unsaved changes. Continue without saving?");
        if (!ok) return;
    }
    setStatus("Opening demo vault…", "y");
    await activateVaultSession({
        mode: "demo",
        label: "Demo (local)",
        openPath: "Welcome.md",
        closeDialog: true
    });
}

export async function selectLocalVault() { // this will probably not work/ be used
    if (!("showDirectoryPicker" in window)) {
        alert("Your browser does not support folder selection (File System Access API). Try Chrome/Edge/Brave.");
        return;
    }
    if (state.dirty) {
        const ok = confirm("You have unsaved changes. Continue without saving?");
        if (!ok) return;
    }
    setStatus("Selecting folder…", "y");
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await vaultHandleStore.set(handle).catch(() => { });
    await activateVaultSession({
        mode: "browser",
        label: handle?.name ? `${handle.name} (local)` : "Local",
        rootHandle: handle
    });
}

export async function switchToServerMode() { // main mode
    if (state.dirty) {
        const ok = confirm("You have unsaved changes. Continue without saving?");
        if (!ok) return;
    }
    setStatus("Disconnecting…", "y");
    state.rootHandle = null;
    await vaultHandleStore.clear().catch(() => { });
    setMode("server");
    resetUiState();
    const cfg = await apiGet("/api/config").catch(() => null);
    setVaultLabel(cfg?.vault ? cfg.vault : "");
    if (!cfg?.vault) {
        setVaultUiEnabled(false);
        treeEl.innerHTML = "";
        setStatus("Choose a local vault, or start the server with OBSIDIAN_VAULT/--vault.", "r");
        showVaultModal();
        return;
    }
    setVaultUiEnabled(true);
    await ensureDirLoaded("");
    renderTree();
    setStatus("Ready.", "g");
}

export async function restoreLocalVaultFromStorage() {
    if (!("showDirectoryPicker" in window)) return false;
    console.log("Reused handle")
    const handle = await vaultHandleStore.get().catch(() => null);
    if (!handle) return false;

    const opts = { mode: "readwrite" };
    let perm = "prompt";
    if (typeof handle.queryPermission === "function") perm = await handle.queryPermission(opts);
    if (perm !== "granted" && typeof handle.requestPermission === "function") perm = await handle.requestPermission(opts);
    if (perm !== "granted") return false;

    state.rootHandle = handle;
    state.vaultLabel = handle?.name ? `${handle.name} (local)` : "Local";
    setMode("browser");
    setVaultLabel(state.vaultLabel);
    setVaultUiEnabled(true);
    resetUiState();
    await ensureDirLoaded("");
    renderTree();
    setStatus("Ready.", "g");
    if (vaultDialog?.open) vaultDialog.close();
    return true;
}

export const vaultHandleStore = (() => {
    const DB_NAME = "obsidian-web";
    const STORE = "vault";
    const KEY = "rootHandle";

    function openDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function get() {
        const db = await openDb();
        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, "readonly");
                const store = tx.objectStore(STORE);
                const req = store.get(KEY);
                req.onsuccess = () => resolve(req.result ?? null);
                req.onerror = () => reject(req.error);
            });
        } finally {
            db.close();
        }
    }

    async function set(handle) {
        const db = await openDb();
        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, "readwrite");
                const store = tx.objectStore(STORE);
                const req = store.put(handle, KEY);
                req.onsuccess = () => resolve(true);
                req.onerror = () => reject(req.error);
            });
        } finally {
            db.close();
        }
    }

    async function clear() {
        const db = await openDb();
        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, "readwrite");
                const store = tx.objectStore(STORE);
                const req = store.delete(KEY);
                req.onsuccess = () => resolve(true);
                req.onerror = () => reject(req.error);
            });
        } finally {
            db.close();
        }
    }

    return { get, set, clear };
})();

