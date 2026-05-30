export async function apiGet(url) {
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

export async function apiSend(method, url, payload) {
    const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

export async function tryGetPackageJsonVersion() {
    try {
        const res = await fetch("/package.json", { headers: { "Accept": "application/json" }, cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return null;
        const v = (data?.version || "").toString().trim();
        return v || null;
    } catch {
        return null;
    }
}
