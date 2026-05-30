import { escapeHtml, safeHref } from "../utils/html.js";
import { readFile } from "../core/fileSystemAPI.js";
import { state } from "../core/appState.js";
import { basenameOf, parentDirOf, joinPath, normalizeDir } from "../utils/path.js";

const CALL_OUT_TITLES = {
    abstract: "Abstract",
    bug: "Bug",
    danger: "Danger",
    example: "Example",
    info: "Info",
    important: "Important",
    note: "Note",
    question: "Question",
    quote: "Quote",
    success: "Success",
    tip: "Tip",
    todo: "Todo",
    warning: "Warning"
};

export function renderMarkdownBasic(md) {
    const lines = (md ?? "").toString().replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
    const html = renderBlocks(lines);
    if (!html.trim()) return `<div class="editor-banner muted">Empty document. Click to edit…</div>`;
    return html;
}

export function renderMarkdownLive(md, activeLine = null) {
    const lines = (md ?? "").toString().replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
    let i = 0;
    const htmlParts = [];

    const frontmatterEnd = findFrontmatterEnd(lines);
    if (frontmatterEnd != null) {
        htmlParts.push(renderFrontmatterLive(lines, frontmatterEnd, activeLine));
        i = frontmatterEnd + 1;
    }

    for (; i < lines.length; i += 1) {
        htmlParts.push(renderLiveLine(lines[i], i, activeLine));
    }

    if (!htmlParts.some((entry) => entry.trim())) return `<div class="editor-banner muted">Empty document. Click a line to edit…</div>`;
    return `<div class="live-preview">${htmlParts.join("")}</div>`;
}

function findFrontmatterEnd(lines) {
    if (!lines.length) return null;
    if ((lines[0] || "").trim() !== "---") return null;
    for (let i = 1; i < lines.length; i += 1) {
        if ((lines[i] || "").trim() === "---") return i;
    }
    return null;
}

function parseFrontmatterRows(lines) {
    const rows = [];
    let current = null;

    const pushCurrent = () => {
        if (current) rows.push(current);
        current = null;
    };

    for (const rawLine of lines) {
        const line = (rawLine || "").trimEnd();
        if (!line.trim()) continue;

        const keyMatch = line.match(/^([^:\n]+):\s*(.*)$/);
        if (keyMatch) {
            pushCurrent();
            current = {
                key: keyMatch[1].trim(),
                value: keyMatch[2].trim(),
                items: []
            };
            continue;
        }

        const listMatch = line.match(/^\s*-\s*(.*)$/);
        if (listMatch && current) {
            current.items.push(listMatch[1].trim());
            continue;
        }

        if (current) {
            if (!current.value) current.value = line.trim();
            else current.items.push(line.trim());
        }
    }

    pushCurrent();
    return rows;
}

function renderFrontmatterRowValue(value) {
    const text = (value || "").trim();
    if (!text) return `<span class="frontmatter-empty">—</span>`;
    if (/^(?:https?:\/\/|mailto:|www\.)/i.test(text)) {
        const href = text.startsWith("www.") ? `https://${text}` : text;
        const safe = normalizeLinkHref(href);
        if (!safe)
            return `<span class="frontmatter-value">${escapeHtml(text)}</span>`;
        return `<a class="frontmatter-link" href="${escapeHtml(safe)}" rel="noreferrer noopener" target="_blank">${escapeHtml(text)}</a>`;
    }
    return `<span class="frontmatter-value">${escapeHtml(text)}</span>`;
}

function renderFrontmatterBasic(lines, endIndex) {
    const rows = parseFrontmatterRows(lines.slice(1, endIndex));
    const body = rows.length
        ? rows.map((row) => {
            const items = row.items.length
                ? `<div class="frontmatter-items">${row.items.map((item) => `<span class="frontmatter-tag">${escapeHtml(item)}</span>`).join("")}</div>`
                : "";
            return `<div class="frontmatter-row"><div class="frontmatter-key">${escapeHtml(row.key)}</div><div class="frontmatter-cell">${renderFrontmatterRowValue(row.value)}${items}</div></div>`;
        }).join("")
        : `<div class="frontmatter-empty-state muted">No properties</div>`;

    return `<section class="frontmatter-box"><div class="frontmatter-header">Properties</div><div class="frontmatter-body">${body}</div></section>`;
}

function renderFrontmatterBoundaryLine(line, index, activeLine) {
    const raw = (line ?? "---").toString();
    const escapedValue = escapeHtml(raw);
    const isActive = activeLine === index;
    const numberHtml = `<span class="live-line-number${state.lineNumbers ? "" : " live-line-number-hidden"}">${index + 1}</span>`;
    const bodyStart = `<div class="live-line-body">`;
    const bodyEnd = `</div>`;

    if (isActive) {
        return `<div class="live-line live-line-active live-frontmatter-boundary" data-line="${index}">${numberHtml}${bodyStart}<textarea class="live-line-editor" data-line="${index}" rows="1" spellcheck="false">${escapedValue}</textarea>${bodyEnd}</div>`;
    }

    return `<div class="live-line live-frontmatter-boundary" data-line="${index}">${numberHtml}${bodyStart}<span class="frontmatter-delimiter">${escapedValue}</span>${bodyEnd}</div>`;
}

function renderFrontmatterLive(lines, endIndex, activeLine) {
    const rows = [];
    rows.push(renderFrontmatterBoundaryLine(lines[0], 0, activeLine));
    for (let i = 1; i < endIndex; i += 1) {
        rows.push(renderLiveLine(lines[i], i, activeLine));
    }
    rows.push(renderFrontmatterBoundaryLine(lines[endIndex], endIndex, activeLine));
    return `<section class="frontmatter-box live-frontmatter-box"><div class="frontmatter-header">Properties</div><div class="frontmatter-body">${rows.join("")}</div></section>`;
}

function renderBlocks(lines) {
    let i = 0;
    let html = "";
    const paragraph = [];
    const listStack = [];

    const inline = (text) => renderInline(text);

    const flushParagraph = () => {
        if (!paragraph.length) return;
        html += `<p>${paragraph.map((l) => inline(l)).join("<br />")}</p>`;
        paragraph.length = 0;
    };

    const closeListLevel = () => {
        const level = listStack.pop();
        if (!level) return;
        if (level.itemOpen) html += "</li>";
        html += `</${level.type}>`;
    };

    const closeListsToIndent = (indent) => {
        while (listStack.length && listStack[listStack.length - 1].indent > indent) closeListLevel();
    };

    const closeAllLists = () => {
        while (listStack.length) closeListLevel();
    };

    const ensureListContainer = (type, indent) => {
        const top = listStack[listStack.length - 1];
        if (!top) {
            html += `<${type}>`;
            listStack.push({ type, indent, itemOpen: false });
            return;
        }
        if (indent > top.indent) {
            html += `<${type}>`;
            listStack.push({ type, indent, itemOpen: false });
            return;
        }
        if (indent < top.indent) {
            closeListsToIndent(indent);
            ensureListContainer(type, indent);
            return;
        }
        if (top.type !== type) {
            closeListLevel();
            ensureListContainer(type, indent);
        }
    };

    const renderListItem = (item) => {
        flushParagraph();
        ensureListContainer(item.type, item.indent);
        const top = listStack[listStack.length - 1];
        if (!top || top.indent !== item.indent || top.type !== item.type) return;
        if (top.itemOpen) html += "</li>";
        top.itemOpen = true;

        const classNames = ["list-item"];
        if (item.task) classNames.push("task-list-item");
        html += `<li class="${classNames.join(" ")}">`;

        if (item.task) {
            html += `<label class="task-list-label"><input type="checkbox" disabled${item.checked ? " checked" : ""} /><span>${inline(item.text)}</span></label>`;
            return;
        }

        html += inline(item.text);
    };

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        if (i === 0 && trimmed === "---") {
            const frontmatterEnd = findFrontmatterEnd(lines);
            if (frontmatterEnd != null) {
                flushParagraph();
                closeAllLists();
                html += renderFrontmatterBasic(lines, frontmatterEnd);
                i = frontmatterEnd + 1;
                continue;
            }
        }

        if (/^\s*$/.test(line)) {
            flushParagraph();
            closeAllLists();
            i += 1;
            continue;
        }

        const fenceMatch = line.match(/^```\s*([^`]*)$/);
        if (fenceMatch) {
            flushParagraph();
            closeAllLists();
            const fenceInfo = fenceMatch[1].trim();
            const lang = fenceInfo ? fenceInfo.split(/\s+/)[0] : "";
            const codeLines = [];
            i += 1;
            while (i < lines.length && !/^```\s*$/.test(lines[i])) {
                codeLines.push(lines[i]);
                i += 1;
            }
            if (i < lines.length) i += 1;
            const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : "";
            html += `<pre><code${langClass}>${escapeHtml(codeLines.join("\n"))}${codeLines.length ? "\n" : ""}</code></pre>`;
            continue;
        }

        if (/^---\s*$/.test(trimmed) || /^\*\*\*\s*$/.test(trimmed) || /^___\s*$/.test(trimmed)) {
            flushParagraph();
            closeAllLists();
            html += "<hr />";
            i += 1;
            continue;
        }

        const quoteMatch = line.match(/^\s*>\s?(.*)$/);
        if (quoteMatch) {
            flushParagraph();
            closeAllLists();

            const quoteLines = [];
            let cursor = i;
            while (cursor < lines.length) {
                const current = lines[cursor];
                const currentQuote = current.match(/^\s*>\s?(.*)$/);
                if (currentQuote) {
                    quoteLines.push(currentQuote[1]);
                    cursor += 1;
                    continue;
                }
                if (quoteLines.length && /^\s*$/.test(current)) {
                    quoteLines.push("");
                    cursor += 1;
                    continue;
                }
                break;
            }
            i = cursor;

            const firstContentIndex = quoteLines.findIndex((entry) => !/^\s*$/.test(entry));
            const firstContentLine = firstContentIndex >= 0 ? quoteLines[firstContentIndex] : "";
            const callout = parseCalloutHeader(firstContentLine);
            if (callout) {
                const title = callout.title || CALL_OUT_TITLES[callout.type] || prettifyCalloutType(callout.type);
                const contentLines = quoteLines.slice(firstContentIndex + 1);
                html += `<aside class="callout" data-callout="${escapeHtml(callout.type)}"><div class="callout-title">${escapeHtml(title)}</div><div class="callout-content">${renderBlocks(contentLines)}</div></aside>`;
            } else {
                html += `<blockquote>${renderBlocks(quoteLines)}</blockquote>`;
            }
            continue;
        }

        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            flushParagraph();
            closeAllLists();
            const level = heading[1].length;
            const content = heading[2].trim();
            const id = slugify(stripFormattingMarkers(content));
            const anchor = id ? ` id="${escapeHtml(id)}"` : "";
            html += `<h${level}${anchor}>${inline(content)}${id ? `<a class="heading-anchor" href="#${escapeHtml(id)}" aria-hidden="true">#</a>` : ""}</h${level}>`;
            i += 1;
            continue;
        }

        if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
            flushParagraph();
            closeAllLists();

            const headerCells = parseTableRow(line);
            const sepCells = parseTableRow(lines[i + 1]);
            const alignments = parseTableAlignments(sepCells);
            const colCount = Math.max(headerCells.length, sepCells.length);
            const header = Array.from({ length: colCount }, (_, idx) => headerCells[idx] ?? "");

            html += "<table><thead><tr>";
            for (let col = 0; col < colCount; col += 1) {
                const align = alignments[col] ? ` style="text-align:${alignments[col]}"` : "";
                html += `<th${align}>${inline(header[col])}</th>`;
            }
            html += "</tr></thead><tbody>";

            i += 2;
            while (i < lines.length) {
                const rowLine = lines[i];
                if (/^\s*$/.test(rowLine)) break;
                if (!rowLine.includes("|")) break;
                if (isTableSeparator(rowLine)) break;
                const rowCells = parseTableRow(rowLine);
                html += "<tr>";
                for (let col = 0; col < colCount; col += 1) {
                    const align = alignments[col] ? ` style="text-align:${alignments[col]}"` : "";
                    html += `<td${align}>${inline(rowCells[col] ?? "")}</td>`;
                }
                html += "</tr>";
                i += 1;
            }

            html += "</tbody></table>";
            continue;
        }

        const listItem = parseListItem(line);
        if (listItem) {
            renderListItem(listItem);
            i += 1;
            continue;
        }

        closeAllLists();
        paragraph.push(trimmed);
        i += 1;
    }

    flushParagraph();
    closeAllLists();
    return html;
}

function renderInline(text) {
    const tokens = [];
    const tokenFor = (htmlFragment) => {
        const id = `\u0000T${tokens.length}\u0000`;
        tokens.push({ id, html: htmlFragment });
        return id;
    };

    let s = (text ?? "").toString();

    s = s.replaceAll(/`([^`]+)`/g, (_m, code) => tokenFor(`<code>${escapeHtml(code)}</code>`));

    s = s.replaceAll(/\[\[([^\]]+)\]\]/g, (_m, inner) => {
        const [left, ...rest] = (inner || "").split("|");
        const targetRaw = (left || "").trim();
        const labelRaw = (rest.length ? rest.join("|") : left || "").trim();
        const targetParts = targetRaw.split("#");
        const fileTarget = (targetParts[0] || "").trim();
        if (!fileTarget) return escapeHtml(labelRaw || targetRaw || "");
        const data = encodeURIComponent(fileTarget);
        const labelHtml = renderInline(labelRaw || targetRaw);
        return tokenFor(`<a href="#" data-wikilink="${escapeHtml(data)}">${labelHtml}</a>`);
    });

    // Obsidian-style embed: ![[file.png]] (image/video or .base)
    s = s.replaceAll(/!\[\[([^\]]+)\]\]/g, (_m, inner) => {
        const [left, ...rest] = (inner || "").split("|");
        const targetRaw = (left || "").trim();
        const fileTarget = (targetRaw.split("#")[0] || "").trim();
        if (!fileTarget) return "";
        const data = encodeURIComponent(fileTarget);
        // placeholder span; will be processed after preview is rendered
        return tokenFor(`<span class="embedded-file" data-embed-path="${escapeHtml(data)}">${escapeHtml(rest.join("|") || fileTarget)}</span>`);
    });

    s = s.replaceAll(/(^|[^A-Za-z0-9_\\/])#([A-Za-z0-9][A-Za-z0-9_\\/-]*)/g, (_m, prefix, tag) => {
        const t = (tag || "").trim();
        if (!t) return `${prefix}#`;
        const tagEsc = escapeHtml(t);
        return `${prefix}${tokenFor(`<span class="tag" data-tag="${tagEsc}">#${tagEsc}</span>`)}`;
    });

    s = s.replaceAll(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, rawHref) => {
        const { href } = parseHrefAndTitle(rawHref);
        const safe = normalizeLinkHref(href);
        if (!safe) return "";
        const lower = safe.toLowerCase();
        const isRemote = /^(?:https?:\/\/|data:|mailto:)/i.test(safe);
        if (isRemote) {
            const src = safe;
            if (lower.endsWith(".webm")) return tokenFor(`<video controls src="${escapeHtml(src)}">${escapeHtml((alt || "").toString())}</video>`);
            return tokenFor(`<img src="${escapeHtml(src)}" alt="${escapeHtml((alt || "").toString())}" loading="lazy" />`);
        }
        const currentDir = state.activeFile ? parentDirOf(state.activeFile) : "";
        const normCurrent = normalizeDir(currentDir || "");
        const imageName = basenameOf(safe.replace(/^\/+/, ""));
        if (!imageName) return "";
        const imagePath = joinPath(joinPath(normCurrent, "Attachments"), imageName);
        return tokenFor(`<img src="/api/raw?path=${encodeURIComponent(imagePath)}" alt="${escapeHtml((alt || "").toString())}" loading="lazy" />`);
    });

    s = s.replaceAll(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, rawHref) => {
        const { href } = parseHrefAndTitle(rawHref);
        const safe = normalizeLinkHref(href);
        if (!safe) return renderInline(label);
        const isRemote = /^(?:https?:\/\/|data:|mailto:)/i.test(safe);
        let hrefTarget = safe;
        if (!isRemote) hrefTarget = `/api/raw?path=${encodeURIComponent(safe.replace(/^\/+/, ""))}`;
        const hrefEsc = escapeHtml(hrefTarget);
        const rel = hrefEsc.startsWith("#") ? "" : ' rel="noreferrer noopener" target="_blank"';
        return tokenFor(`<a href="${hrefEsc}"${rel}>${renderInline(label)}</a>`);
    });

    s = s.replaceAll(/<((?:https?|mailto):[^>\s]+)>/g, (_m, href) => {
        const safe = normalizeLinkHref(href);
        if (!safe) return "";
        return tokenFor(`<a href="${escapeHtml(safe)}" rel="noreferrer noopener" target="_blank">${escapeHtml(href)}</a>`);
    });

    s = escapeHtml(s);
    s = s.replaceAll(/==([^=\n]+)==/g, "<mark>$1</mark>");
    s = s.replaceAll(/~~([^~\n]+)~~/g, "<del>$1</del>");
    s = s.replaceAll(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replaceAll(/__([^_\n]+)__/g, "<strong>$1</strong>");
    s = s.replaceAll(/(^|[^\w>])\*([^*\n]+)\*(?!\*)/g, (_m, prefix, body) => `${prefix}<em>${body}</em>`);
    s = s.replaceAll(/(^|[^\w>])_([^_\n]+)_(?!_)/g, (_m, prefix, body) => `${prefix}<em>${body}</em>`);
    s = s.replaceAll(/(^|[\s(>])((?:https?:\/\/|ftp:\/\/|www\.)[^\s<]+[^<.,:;"')\]\s])/g, (_m, prefix, rawUrl) => {
        const href = rawUrl.startsWith("www.") ? `https://${rawUrl}` : rawUrl;
        const safe = normalizeLinkHref(href);
        if (!safe) return `${prefix}${escapeHtml(rawUrl)}`;
        const isRemote = /^(?:https?:\/\/|data:|mailto:)/i.test(safe);
        const hrefTarget = isRemote ? safe : `/api/raw?path=${encodeURIComponent(safe.replace(/^\/+/, ""))}`;
        return `${prefix}${tokenFor(`<a href="${escapeHtml(hrefTarget)}" rel="noreferrer noopener" target="_blank">${escapeHtml(rawUrl)}</a>`)}`;
    });

    for (const token of tokens) s = s.replaceAll(token.id, token.html);
    return s;
}

function parseHrefAndTitle(rawHref) {
    const raw = (rawHref || "").trim();
    const match = raw.match(/^(<[^>]+>|[^\s]+)(?:\s+"([^"]*)")?$/);
    if (!match) return { href: raw, title: "" };
    const href = match[1].startsWith("<") ? match[1].slice(1, -1) : match[1];
    return { href, title: match[2] || "" };
}

function normalizeLinkHref(href) {
    const safe = safeHref(href);
    if (!safe) return "";
    if (safe.startsWith("www.")) return `https://${safe}`;
    return safe;
}

function parseCalloutHeader(text) {
    const match = (text || "").match(/^\s*\[!([A-Za-z0-9_-]+)\](?:\s+(.*))?$/);
    if (!match) return null;
    return {
        title: (match[2] || "").trim(),
        type: match[1].toLowerCase()
    };
}

function prettifyCalloutType(type) {
    if (!type) return "Callout";
    return type.charAt(0).toUpperCase() + type.slice(1);
}

function stripFormattingMarkers(text) {
    return (text || "")
        .toString()
        .replaceAll(/`([^`]+)`/g, "$1")
        .replaceAll(/\[\[([^\]]+)\]\]/g, (_m, inner) => {
            const [left] = (inner || "").split("|");
            return (left || "").split("#")[0] || "";
        })
        .replaceAll(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
        .replaceAll(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
        .replaceAll(/<[^>]+>/g, "");
}

function slugify(text) {
    return (text || "")
        .toString()
        .toLowerCase()
        .normalize("NFKD")
        .replaceAll(/[\u0300-\u036f]/g, "")
        .replaceAll(/[^a-z0-9\s-]/g, "")
        .trim()
        .replaceAll(/[\s_-]+/g, "-")
        .replaceAll(/^-+|-+$/g, "");
}

function parseListItem(line) {
    const expanded = (line ?? "").replaceAll("\t", "    ");
    const match = expanded.match(/^(\s*)([-*+]|(\d+)\.)\s+(\[(?: |x|X)\]\s*)?(.*)$/);
    if (!match) return null;
    return {
        checked: Boolean(match[4]),
        indent: match[1].length,
        task: Boolean(match[4]),
        text: match[5] || "",
        type: match[2].endsWith(".") ? "ol" : "ul"
    };
}

function isTableSeparator(line) {
    const cells = parseTableRow(line);
    if (cells.length < 2) return false;
    return cells.every((cell) => /^:?-{3,}:?$/.test(cell.replaceAll(/\s+/g, "")));
}

function parseTableAlignments(cells) {
    return cells.map((cell) => {
        const normalized = cell.replaceAll(/\s+/g, "");
        const left = normalized.startsWith(":");
        const right = normalized.endsWith(":");
        if (left && right) return "center";
        if (right) return "right";
        if (left) return "left";
        return "";
    });
}

function parseTableRow(line) {
    let s = (line || "").trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s.split("|").map((c) => c.trim());
}

function renderLiveLine(line, index, activeLine) {
    const raw = (line ?? "").toString();
    const escapedValue = escapeHtml(raw);
    const isActive = activeLine === index;
    const numberHtml = `<span class="live-line-number${state.lineNumbers ? "" : " live-line-number-hidden"}">${index + 1}</span>`;
    const bodyStart = `<div class="live-line-body">`;
    const bodyEnd = `</div>`;
    if (isActive) {
        return `<div class="live-line live-line-active" data-line="${index}">${numberHtml}${bodyStart}<textarea class="live-line-editor" data-line="${index}" rows="1" spellcheck="false">${escapedValue}</textarea>${bodyEnd}</div>`;
    }

    if (/^\s*$/.test(raw)) {
        return `<div class="live-line live-empty" data-line="${index}">${numberHtml}${bodyStart}&nbsp;${bodyEnd}</div>`;
    }

    const trimmed = raw.trim();
    const heading = raw.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
        const level = heading[1].length;
        return `<div class="live-line live-block live-heading" data-line="${index}">${numberHtml}${bodyStart}<h${level}>${renderInline(heading[2].trim())}</h${level}>${bodyEnd}</div>`;
    }

    if (/^---\s*$/.test(trimmed) || /^\*\*\*\s*$/.test(trimmed) || /^___\s*$/.test(trimmed)) {
        return `<div class="live-line live-block live-hr" data-line="${index}">${numberHtml}${bodyStart}<hr />${bodyEnd}</div>`;
    }

    const quoteMatch = raw.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
        return `<div class="live-line live-block live-quote" data-line="${index}">${numberHtml}${bodyStart}<blockquote>${renderInline(quoteMatch[1])}</blockquote>${bodyEnd}</div>`;
    }

    const listItem = parseListItem(raw);
    if (listItem) {
        const classNames = ["live-line", "live-block", "live-list-item"];
        if (listItem.task) classNames.push("task-list-item");
        const bullet = listItem.type === "ol" ? `${/^(\s*)(\d+)\./.exec(raw)?.[2] || "1"}.` : "•";
        const content = listItem.task
            ? `<label class="task-list-label"><input type="checkbox" disabled${listItem.checked ? " checked" : ""} /><span>${renderInline(listItem.text)}</span></label>`
            : renderInline(listItem.text);
        return `<div class="${classNames.join(" ")}" data-line="${index}" data-indent="${listItem.indent}">${numberHtml}${bodyStart}<span class="live-bullet">${escapeHtml(bullet)}</span><span class="live-line-content">${content}</span>${bodyEnd}</div>`;
    }

    if (/^```\s*[^`]*$/.test(raw)) {
        return `<div class="live-line live-block live-code-fence" data-line="${index}">${numberHtml}${bodyStart}<code>${escapedValue}</code>${bodyEnd}</div>`;
    }

    return `<div class="live-line live-block live-paragraph" data-line="${index}">${numberHtml}${bodyStart}${renderInline(raw)}${bodyEnd}</div>`;
}

export async function processEmbeddedAssets(rootEl) {
    if (!rootEl || typeof rootEl.querySelectorAll !== "function") return;
    const els = Array.from(rootEl.querySelectorAll(".embedded-file"));
    for (const el of els) {
        try {
            const raw = el.dataset.embedPath || "";
            if (!raw) continue;
            const origPath = decodeURIComponent(raw).trim().replace(/^\/+/, "");
            if (!origPath) continue;

            const currentDir = state.activeFile ? parentDirOf(state.activeFile) : "";
            const normCurrent = normalizeDir(currentDir || "");
            const baseName = basenameOf(origPath);
            const candidates = [origPath];
            if (baseName) {
                candidates.push(joinPath(normCurrent, "Attachments", baseName));
            }

            let found = "";
            for (const candidate of candidates) {
                try {
                    const response = await fetch(`/api/exists?path=${encodeURIComponent(candidate)}`);
                    if (!response.ok) continue;
                    const data = await response.json();
                    if (data && data.exists) {
                        found = candidate;
                        break;
                    }
                } catch { }
            }

            if (!found) continue;

            const lower = found.toLowerCase();
            if (lower.endsWith(".base")) {
                const parts = found.split(".");
                let mime = "application/octet-stream";
                if (parts.length >= 3) {
                    const ext = parts[parts.length - 2].toLowerCase();
                    if (ext === "png") mime = "image/png";
                    else if (ext === "jpg" || ext === "jpeg") mime = "image/jpeg";
                    else if (ext === "webm") mime = "video/webm";
                    else if (ext === "gif") mime = "image/gif";
                    else if (ext === "webp") mime = "image/webp";
                }
                const content = await readFile(found);
                if (!content) {
                    el.textContent = "(empty)";
                    continue;
                }
                if (mime.startsWith("video/")) {
                    const video = document.createElement("video");
                    video.controls = true;
                    video.src = `data:${mime};base64,${content.trim()}`;
                    el.replaceWith(video);
                } else {
                    const img = document.createElement("img");
                    img.loading = "lazy";
                    img.alt = el.dataset.embedAlt || el.textContent || "";
                    img.src = `data:${mime};base64,${content.trim()}`;
                    el.replaceWith(img);
                }
                continue;
            }

            const candidateUrls = [`/api/raw?path=${encodeURIComponent(found)}`];
            const altText = el.dataset.embedAlt || el.textContent || "";

            if (lower.endsWith(".webm")) {
                const video = document.createElement("video");
                video.controls = true;
                video.preload = "metadata";
                video.src = candidateUrls[0];
                let urlIndex = 0;
                video.addEventListener("error", () => {
                    urlIndex += 1;
                    if (urlIndex < candidateUrls.length) video.src = candidateUrls[urlIndex];
                });
                el.replaceWith(video);
                continue;
            }
            if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".gif") || lower.endsWith(".webp")) {
                const img = document.createElement("img");
                img.loading = "lazy";
                img.alt = altText;
                img.src = candidateUrls[0];
                let urlIndex = 0;
                img.addEventListener("error", () => {
                    urlIndex += 1;
                    if (urlIndex < candidateUrls.length) img.src = candidateUrls[urlIndex];
                });
                el.replaceWith(img);
                continue;
            }

            continue;
        } catch (err) {
            try { el.textContent = `🔴 Error: ${err.message}`; } catch { }
        }
    }
}
