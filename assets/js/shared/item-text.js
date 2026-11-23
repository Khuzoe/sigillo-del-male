// Shared with the Foundry item description renderer. Only catalog formatting is expanded.
// Repair the opening tag written by the old name-based renderer. Keep the
// document's prose, rolls, and all unrelated markup byte-for-byte.
function repairLegacyCatalogPropertyTones(html, properties, escapeName) {
    if (typeof html !== "string" || !html.includes('cripta-catalog-property--negative" aria-label="Negativa"') || !Array.isArray(properties)) return html;
    const expected = new Map();
    for (const p of properties) {
        if (!p?.name || p.hidden === true) continue;
        const name = String(p.name).trim();
        if (!/maledizion|effetto negativo|malus|penalita|svantaggio/.test(name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase())) continue;
        const title = escapeName(name);
        if (!expected.has(title)) expected.set(title, []);
        expected.get(title).push(p.negative === true ? "negative" : p.genial === true ? "genial" : "normal");
    }
    if (!expected.size) return html;
    const tag = /<section class="cripta-catalog-property cripta-catalog-property--(normal|genial|negative)"(?: aria-label="(?:Negativa|Geniale)")?>(?=<h3><span>([^<]*)<\/span>)/g;
    const counts = new Map();
    for (const [, , name] of html.matchAll(tag)) counts.set(name, (counts.get(name) || 0) + 1);
    for (const [name, tones] of expected) if (tones.length !== counts.get(name)) expected.delete(name);
    return html.replace(tag, (opening, oldTone, name) => {
        const tones = expected.get(name);
        if (!tones) return opening;
        const tone = tones.shift();
        if (oldTone !== "negative" || tone === "negative") return opening;
        return '<section class="cripta-catalog-property cripta-catalog-property--' + tone + '"'
            + (tone === "genial" ? ' aria-label="Geniale"' : '') + '>';
    });
}

function renderCatalogItemText(source, { plain = false, inlineWhenSimple = false } = {}) {
    const text = String(source ?? "").replace(/\r\n?/g, "\n").trimEnd();
    if (!text.trim()) return "";
    const escape = value => plain ? value : value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    function inline(line) {
        const parts = [];
        const open = [];
        let cursor = 0;
        // Foundry rolls, document references and their labels are opaque to emphasis.
        for (const token of line.matchAll(/\[\[[^\n]*?\]\](?:\{[^}\n]*\})?|@[\w.]+\[[^\]\n]*\](?:\{[^}\n]*\})?|\\[\\*]|\*+/g)) {
            const run = token[0];
            parts.push(escape(line.slice(cursor, token.index)));
            cursor = token.index + run.length;
            if (!run.startsWith("*") || run.length > 3) {
                parts.push(escape(run.startsWith("\\") ? run.slice(1) : run));
                continue;
            }
            let left = run.length;
            const canClose = /\S/.test(line[token.index - 1] || "");
            const canOpen = /\S/.test(line[cursor] || "");
            while (canClose && open.length && open.at(-1).size <= left) {
                const {index, size, tag} = open.pop();
                parts[index] = plain ? "" : "<" + tag + ">";
                parts.push(plain ? "" : "</" + tag + ">");
                left -= size;
            }
            while (left > 0) {
                const size = Math.min(2, left);
                if (canOpen) open.push({index: parts.length, size, tag: size === 2 ? "strong" : "em"});
                parts.push("*".repeat(size));
                left -= size;
            }
        }
        return parts.join("") + escape(line.slice(cursor));
    }

    const out = [], paragraph = [], lists = [];
    function finishParagraph() {
        if (paragraph.length) out.push("<p>" + paragraph.splice(0).join("<br />") + "</p>");
    }
    function closeList() {
        out.push("</li></" + lists.pop().tag + ">");
    }
    for (const line of text.split("\n")) {
        const item = /^([ \t]*)(?:[-+*]|(\d{1,9})[.)])[ \t]+(.*)$/.exec(line);
        if (plain) {
            out.push(item ? item[1] + (item[2] ? item[2] + ". " : "• ") + inline(item[3]) : inline(line));
            continue;
        }
        if (!item) {
            while (lists.length) closeList();
            if (line.trim()) paragraph.push(inline(line));
            else finishParagraph();
            continue;
        }
        finishParagraph();
        const indent = item[1].replace(/\t/g, "    ").length;
        const tag = item[2] ? "ol" : "ul";
        while (lists.length && lists.at(-1).indent > indent) closeList();
        if (lists.at(-1)?.indent === indent && lists.at(-1).tag !== tag) closeList();
        if (lists.at(-1)?.indent === indent) {
            out.push("</li><li>");
        } else {
            const start = tag === "ol" && Number(item[2]) !== 1 ? ' start="' + Number(item[2]) + '"' : "";
            out.push("<" + tag + start + "><li>");
            lists.push({indent, tag});
        }
        out.push(inline(item[3]));
    }
    if (plain) return out.join("\n");
    while (lists.length) closeList();
    if (inlineWhenSimple && !out.length && paragraph.length === 1) return paragraph[0];
    finishParagraph();
    return out.join("");
}
