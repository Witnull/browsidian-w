import { appVersionEl } from "../ui/dom.js";
import { state } from "./appState.js";
import { apiGet, tryGetPackageJsonVersion } from "./api.js";

export function setAppVersion(version) {
    if (!appVersionEl) return;
    const v = (version || "").toString().trim();
    if (!v) {
        appVersionEl.textContent = "v—";
        return;
    }
    appVersionEl.textContent = v.startsWith("v") ? v : `v${v}`;
}

export async function resolveAppVersion() {
    // Prefer server-provided version when available.
    const cfg = await apiGet("/api/config").catch(() => null);
    const fromCfg = (cfg?.version || "").toString().trim();
    if (fromCfg) {
        state.appVersion = fromCfg;
        return fromCfg;
    }

    const fromPkg = await tryGetPackageJsonVersion();
    if (fromPkg) {
        state.appVersion = fromPkg;
        return fromPkg;
    }
    return (!state.appVersion ? "4.0.4" : state.appVersion);
}
