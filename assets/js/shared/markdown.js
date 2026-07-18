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

    function canShowInlineSecrets(options = {}) {
        if (options.showInlineSecrets === true) return true;
        if (options.showInlineSpoilers === true) return true;
        try {
            return window.WikiSpoiler?.allowSpoilers?.() === true;
        } catch (_) {
            return false;
        }
    }

    function renderInlineSecret(text, options = {}, alreadyEscaped = false) {
        const visible = canShowInlineSecrets(options);
        if (visible) {
            const safeText = alreadyEscaped ? String(text || "") : escapeHtml(text);
            return `<span class="inline-secret inline-secret--dm">${safeText}</span>`;
        }
        return '<span class="inline-secret inline-secret--hidden" aria-label="Testo nascosto"></span>';
    }

    function normalizeInlineSecretSource(value) {
        let text = String(value || "").trim();
        let previous = "";
        while (text !== previous) {
            previous = text;
            text = text.replace(/^==([\s\S]*?)==$/g, "$1").trim();
        }
        return text;
    }

    function renderInline(text, options = {}) {
        const wikiLinks = [];
        const withWikiPlaceholders = String(text || "").replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target, label) => {
            const index = wikiLinks.length;
            wikiLinks.push({
                target: String(target || "").trim(),
                label: String(label || target || "").trim()
            });
            return `\u0000WIKI${index}\u0000`;
        });
        const secretSegments = [];
        const withSecretPlaceholders = withWikiPlaceholders.replace(/%%([^%]+)%%/g, (_match, secretText) => {
            const index = secretSegments.length;
            secretSegments.push(normalizeInlineSecretSource(secretText));
            return `\u0000SECRET${index}\u0000`;
        });

        function restoreWikiPlaceholders(html) {
            let restored = String(html || "");
            wikiLinks.forEach((link, index) => {
                const label = escapeHtml(link.label || link.target);
                const href = escapeAttr(buildWikiSearchUrl(link.target || link.label));
                const target = escapeAttr(link.target || link.label);
                restored = restored.replace(`\u0000WIKI${index}\u0000`, `<a class="wiki-term-link" href="${href}" data-wiki-target="${target}">${label}</a>`);
            });
            return restored;
        }

        function renderSecretSegment(secretText) {
            if (!canShowInlineSecrets(options)) return renderInlineSecret("", options);
            return renderInlineSecret(restoreWikiPlaceholders(escapeHtml(secretText)), options, true);
        }

        let escaped = escapeHtml(withSecretPlaceholders);
        escaped = escaped
            .replace(/==([^=]+)==/g, "<mark>$1</mark>")
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/\*(.+?)\*/g, "<em>$1</em>")
            .replace(/`(.+?)`/g, "<code>$1</code>");
        secretSegments.forEach((secretText, index) => {
            escaped = escaped.replace(`\u0000SECRET${index}\u0000`, renderSecretSegment(secretText));
        });
        escaped = escaped.replace(/<mark>\s*(<span class="inline-secret[^"]*"[^>]*>.*?<\/span>)\s*<\/mark>/g, "$1");
        return restoreWikiPlaceholders(escaped);
    }

    function render(markdown, options = {}) {
        const context = options.context || null;
        if (!markdown) return "";
        const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
        const out = [];
        let i = 0;

        while (i < lines.length) {
            if (/^\s*$/.test(lines[i])) {
                const start = i;
                while (i < lines.length && /^\s*$/.test(lines[i])) i++;
                if (options.preserveBlankLines === true) {
                    const explicitBlankLines = Math.max(0, (i - start) - 1);
                    for (let index = 0; index < explicitBlankLines; index++) out.push('<p class="doc-blank-line"><br></p>');
                }
                continue;
            }

            if (context === "image_box" && i === 0) {
                const subtitleMatch = lines[i].trim().match(/^\*(.+)\*$/);
                if (subtitleMatch) {
                    out.push(`<p class="doc-subtitle">${renderInline(subtitleMatch[1], options)}</p>`);
                    i++;
                    continue;
                }
            }

            if (/^###\s+/.test(lines[i])) {
                out.push(`<h4 class="doc-heading">${renderInline(lines[i].replace(/^###\s+/, ""), options)}</h4>`);
                i++;
                continue;
            }
            if (/^##\s+/.test(lines[i])) {
                out.push(`<h3 class="doc-heading">${renderInline(lines[i].replace(/^##\s+/, ""), options)}</h3>`);
                i++;
                continue;
            }
            if (/^#\s+/.test(lines[i])) {
                out.push(`<h2 class="doc-heading">${renderInline(lines[i].replace(/^#\s+/, ""), options)}</h2>`);
                i++;
                continue;
            }

            if (/^>\s?/.test(lines[i])) {
                const quote = [];
                while (i < lines.length && /^>\s?/.test(lines[i])) {
                    quote.push(lines[i].replace(/^>\s?/, ""));
                    i++;
                }
                const quoteText = renderInline(quote.join("\n").trim(), options).replace(/\n/g, "<br>");
                out.push(`<div class="document-quote"><i class="fas fa-feather-alt"></i><span>${quoteText}</span></div>`);
                continue;
            }

            if (/^- /.test(lines[i])) {
                const items = [];
                while (i < lines.length && /^- /.test(lines[i])) {
                    items.push(lines[i].replace(/^- /, ""));
                    i++;
                }
                out.push(`<ul class="doc-list">${items.map(item => `<li>${renderInline(item, options)}</li>`).join("")}</ul>`);
                continue;
            }

            if (/^\d+[.)]\s+/.test(lines[i])) {
                const items = [];
                while (i < lines.length && /^\d+[.)]\s+/.test(lines[i])) {
                    items.push(lines[i].replace(/^\d+[.)]\s+/, ""));
                    i++;
                }
                out.push(`<ol class="doc-list">${items.map(item => `<li>${renderInline(item, options)}</li>`).join("")}</ol>`);
                continue;
            }
            const paragraph = [];
            while (i < lines.length && !/^\s*$/.test(lines[i])) {
                paragraph.push(lines[i]);
                i++;
            }
            const paraClass = context === "image_box" ? " class=\"doc-paragraph\"" : "";
            const paragraphText = paragraph.join(options.preserveLineBreaks === true ? "\n" : " ");
            const paragraphHtml = renderInline(paragraphText, options);
            out.push(`<p${paraClass}>${options.preserveLineBreaks === true ? paragraphHtml.replace(/\n/g, "<br>") : paragraphHtml}</p>`);
        }

        return out.join("\n");
    }

    function containsMarkdownSyntax(value) {
        return /(^|\n)\s{0,3}(#{1,6}\s|[-*]\s|>\s)|\*\*[^*]+\*\*|==[^=]+==|%%[^%]+%%|`[^`]+`|\*[^*\n]+\*/.test(String(value || ""));
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

    function renderInsideHtml(html, options = {}) {
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
            fragment.innerHTML = renderInline(text, options);
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
        renderInlineSecret,
        renderInsideHtml
    };
})();
