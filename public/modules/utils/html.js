export function escapeHtml(s) {
    return (s ?? "")
        .toString()
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

export function safeHref(href) {
    const raw = (href || "").trim();
    if (!raw) return "";
    const lower = raw.toLowerCase();
    if (lower.startsWith("javascript:")) return "";
    if (lower.startsWith("data:")) return "";
    if (lower.startsWith("vbscript:")) return "";
    return raw;
}
