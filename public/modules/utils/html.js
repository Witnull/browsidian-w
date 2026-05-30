export function escapeHtml(s) {
    return (s ?? "")
        .toString()
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

export function cleanInput(input) {
    return input
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, "") // invalid chars
        .replace(/[. ]+$/g, "")                // trailing dots/spaces
        .trim();
}
//console.log(cleanInput("<xss contenteditable onbeforeinput=alert(1)>test"))

export function safeHref(href) {
    const raw = (href || "").trim();
    if (!raw) return "";
    const lower = raw.toLowerCase();
    if (lower.startsWith("javascript:")) return "";
    if (lower.startsWith("data:")) return "";
    if (lower.startsWith("vbscript:")) return "";
    return raw;
}

export function createIconButton(symbol, name = ""){
    return (`
        <div class="icon">
        <svg class="icon-svg" aria-hidden="true">
            <use href="#${symbol}"></use>
        </svg>
        </div>
        <div class="name">${cleanInput(name)}</div>
        `)
}
