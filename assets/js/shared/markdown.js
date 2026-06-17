(function () {
    function escapeHtml(value) {
        if (typeof window.CriptaApp?.utils?.escapeHtml === "function") {
            return window.CriptaApp.utils.escapeHtml(value);
        }
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "\"": "&quot;",
            "'": "&#039;"
        })[char]);
    }

    function escapeAttr(value) {
        return escapeHtml(value).replace(/"/g, "&quot;");
    }

    function buildWikiSearchUrl(query) {
        const base = window.CriptaApp?.urls?.site?.("pages/cerca.html") || new URL("cerca.html", window.location.href).toString();
        const url = new URL(base, window.location.href);
        url.searchParams.set("q", String(query || "").trim());
        const campaignId = window.CriptaApp?.campaigns?.currentId?.() || new URLSearchParams(window.location.search).get("campaign") || "";
        if (campaignId && campaignId !== window.CriptaApp?.campaigns?.defaultId) {
            url.searchParams.set("campaign", campaignId);
        }
        return url.toString();
    }

    function renderInline(text) {
        const wikiLinks = [];
        const withWikiPlaceholders = String(text || "").replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target, label) => {
            const index = wikiLinks.length;
            wikiLinks.push({
                target: String(target || "").trim(),
                label: String(label || target || "").trim()
            });
            return `\u0000WIKI${index}\u0000`;
        });

        let escaped = escapeHtml(withWikiPlaceholders);
        escaped = escaped
            .replace(/==([^=]+)==/g, "<mark>$1</mark>")
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/\*(.+?)\*/g, "<em>$1</em>")
            .replace(/`(.+?)`/g, "<code>$1</code>");

        wikiLinks.forEach((link, index) => {
            const label = escapeHtml(link.label || link.target);
            const href = escapeAttr(buildWikiSearchUrl(link.target || link.label));
            escaped = escaped.replace(`\u0000WIKI${index}\u0000`, `<a class="wiki-term-link" href="${href}">${label}</a>`);
        });
        return escaped;
    }

    function render(markdown, options = {}) {
        const context = options.context || null;
        if (!markdown) return "";
        const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
        const out = [];
        let i = 0;

        while (i < lines.length) {
            if (/^\s*$/.test(lines[i])) { i++; continue; }

            if (context === "image_box" && i === 0) {
                const subtitleMatch = lines[i].trim().match(/^\*(.+)\*$/);
                if (subtitleMatch) {
                    out.push(`<p class="doc-subtitle">${renderInline(subtitleMatch[1])}</p>`);
                    i++;
                    continue;
                }
            }

            if (/^###\s+/.test(lines[i])) {
                out.push(`<h4 class="doc-heading">${renderInline(lines[i].replace(/^###\s+/, ""))}</h4>`);
                i++;
                continue;
            }
            if (/^##\s+/.test(lines[i])) {
                out.push(`<h3 class="doc-heading">${renderInline(lines[i].replace(/^##\s+/, ""))}</h3>`);
                i++;
                continue;
            }
            if (/^#\s+/.test(lines[i])) {
                out.push(`<h2 class="doc-heading">${renderInline(lines[i].replace(/^#\s+/, ""))}</h2>`);
                i++;
                continue;
            }

            if (/^>\s?/.test(lines[i])) {
                const quote = [];
                while (i < lines.length && /^>\s?/.test(lines[i])) {
                    quote.push(lines[i].replace(/^>\s?/, ""));
                    i++;
                }
                const quoteText = renderInline(quote.join("\n").trim()).replace(/\n/g, "<br>");
                out.push(`<div class="document-quote"><i class="fas fa-feather-alt"></i><span>${quoteText}</span></div>`);
                continue;
            }

            if (/^- /.test(lines[i])) {
                const items = [];
                while (i < lines.length && /^- /.test(lines[i])) {
                    items.push(lines[i].replace(/^- /, ""));
                    i++;
                }
                out.push(`<ul class="doc-list">${items.map(item => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
                continue;
            }

            const paragraph = [];
            while (i < lines.length && !/^\s*$/.test(lines[i])) {
                paragraph.push(lines[i]);
                i++;
            }
            const paraClass = context === "image_box" ? " class=\"doc-paragraph\"" : "";
            out.push(`<p${paraClass}>${renderInline(paragraph.join(" "))}</p>`);
        }

        return out.join("\n");
    }

    function containsMarkdownSyntax(value) {
        return /(^|\n)\s{0,3}(#{1,6}\s|[-*]\s|>\s)|\*\*[^*]+\*\*|==[^=]+==|`[^`]+`|\*[^*\n]+\*/.test(String(value || ""));
    }

    function looksLikeHtml(value) {
        return /<\/?[a-z][\s\S]*>/i.test(String(value || ""));
    }

    function looksLikeRawMarkdown(value) {
        const text = String(value || "");
        if (!text.trim()) return false;
        if (looksLikeHtml(text)) return false;
        return containsMarkdownSyntax(text);
    }

    function renderInsideHtml(html) {
        if (!containsMarkdownSyntax(html)) return String(html || "");
        const template = document.createElement("template");
        template.innerHTML = String(html || "");
        const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);
        textNodes.forEach((node) => {
            const text = node.textContent || "";
            if (!looksLikeRawMarkdown(text)) return;
            const fragment = document.createElement("template");
            fragment.innerHTML = renderInline(text);
            node.replaceWith(fragment.content);
        });
        return template.innerHTML;
    }

    window.CriptaMarkdown = {
        buildWikiSearchUrl,
        containsMarkdownSyntax,
        escapeAttr,
        escapeHtml,
        looksLikeHtml,
        looksLikeRawMarkdown,
        render,
        renderInline,
        renderInsideHtml
    };
})();
