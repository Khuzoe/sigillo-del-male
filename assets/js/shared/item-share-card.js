// The Discord preview and its PNG use the same public content, markup and CSS.
(() => {
    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }

    function appendProse(parent, source) {
        if (!source) return;
        const prose = element("div", "item-formatted-text");
        prose.innerHTML = renderCatalogItemText(source);
        // Explicit markers can be painted into the PNG, including nested lists.
        for (const list of prose.querySelectorAll("ol, ul")) {
            let number = list.start;
            for (const li of list.children) {
                const mark = element("span", "discord-item-marker", list.tagName === "OL" ? number++ + "." : "•");
                mark.setAttribute("aria-hidden", "true");
                li.prepend(mark);
            }
        }
        parent.append(prose);
    }

    function create(entity, campaign, image) {
        const sheet = element("article", "discord-item-sheet");
        const head = element("header", "discord-item-heading");
        const identity = element("div");
        identity.append(element("div", "discord-item-campaign", campaign), element("h3", "discord-item-name", entity.name));
        const metadata = [entity.subtitle, ...entity.badges].filter((part, i, parts) => part && parts.indexOf(part) === i);
        if (metadata.length) identity.append(element("div", "discord-item-meta", metadata.join(" · ")));
        head.append(identity);
        if (image) {
            image.alt = "";
            head.append(image);
        }
        sheet.append(head);
        appendProse(sheet, entity.description);
        if (entity.facts.length) sheet.append(element("div", "discord-item-facts", entity.facts.join(" · ")));
        const sections = element("div", "cripta-catalog-properties");
        for (const section of entity.sections) {
            const tone = section.tone === "arcane" ? "genial" : section.tone === "negative" ? "negative" : "normal";
            const panel = section.tone === "note" ? element("aside", "discord-item-note")
                : element("section", "cripta-catalog-property cripta-catalog-property--" + tone);
            if (tone !== "normal") panel.append(element("div", "discord-item-legend", tone === "genial" ? "✦ Geniale" : "☾ Negativa"));
            if (section.title || section.meta) {
                const heading = element("h3");
                if (section.title) heading.append(element("span", "", section.title));
                if (section.meta) heading.append(element("small", "cripta-catalog-property-charges", section.meta));
                panel.append(heading);
            }
            appendProse(panel, section.description);
            sections.append(panel);
        }
        if (sections.childElementCount) sheet.append(sections);
        return sheet;
    }

    // Use browser line boxes so emphasis, list numbering and wrapping match the preview.
    function paintText(ctx, node, style, origin) {
        ctx.fillStyle = style.color;
        ctx.font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(" ");
        const metrics = ctx.measureText("Mg");
        const baseline = Number.isFinite(metrics.fontBoundingBoxAscent)
            ? (metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2
            : parseFloat(style.fontSize) * .3;
        const range = document.createRange();
        function draw(value, rect) {
            ctx.fillText(value, rect.left - origin.left, rect.top - origin.top + rect.height / 2 + baseline);
        }
        for (const match of node.data.matchAll(/\S+/gu)) {
            let offset = match.index;
            range.setStart(node, offset);
            range.setEnd(node, offset + match[0].length);
            const rects = range.getClientRects();
            if (rects.length === 1) {
                draw(match[0], rects[0]);
            } else {
                // A single long word can occupy multiple lines.
                for (const char of match[0]) {
                    range.setStart(node, offset);
                    offset += char.length;
                    range.setEnd(node, offset);
                    draw(char, range.getBoundingClientRect());
                }
            }
        }
    }

    function paintSheet(ctx, sheet, image) {
        const origin = sheet.getBoundingClientRect();
        function paint(node) {
            const rect = node.getBoundingClientRect();
            const x = rect.left - origin.left, y = rect.top - origin.top;
            const style = getComputedStyle(node);
            ctx.fillStyle = style.backgroundColor;
            ctx.fillRect(x, y, rect.width, rect.height);
            const edge = (color, left, top, w, h) => {
                ctx.fillStyle = color;
                ctx.fillRect(left, top, w, h);
            };
            edge(style.borderTopColor, x, y, rect.width, parseFloat(style.borderTopWidth));
            edge(style.borderBottomColor, x, y + rect.height - parseFloat(style.borderBottomWidth), rect.width, parseFloat(style.borderBottomWidth));
            edge(style.borderRightColor, x + rect.width - parseFloat(style.borderRightWidth), y, parseFloat(style.borderRightWidth), rect.height);
            const left = parseFloat(style.borderLeftWidth);
            if (style.borderLeftStyle === "double") {
                edge(style.borderLeftColor, x, y, left / 3, rect.height);
                edge(style.borderLeftColor, x + left * 2 / 3, y, left / 3, rect.height);
            } else edge(style.borderLeftColor, x, y, left, rect.height);
            if (node.tagName === "IMG" && image) {
                const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
                const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
                ctx.drawImage(image, x + (rect.width - w) / 2, y + (rect.height - h) / 2, w, h);
            }
            for (const child of node.childNodes) {
                if (child.nodeType === Node.ELEMENT_NODE) paint(child);
                else if (child.nodeType === Node.TEXT_NODE && child.data.trim()) paintText(ctx, child, style, origin);
            }
        }
        paint(sheet);
    }

    async function toPng(sheet, encodePng) {
        const host = element("div", "discord-item-export");
        host.inert = true;
        host.setAttribute("aria-hidden", "true");
        const copy = sheet.cloneNode(true);
        host.append(copy);
        document.body.append(host);
        try {
            const {width, height} = copy.getBoundingClientRect();
            return await encodePng(Math.ceil(width), Math.ceil(height), ctx => paintSheet(ctx, copy, sheet.querySelector("img")));
        } finally {
            host.remove();
        }
    }
    window.CriptaItemShareCard = Object.freeze({create, toPng});
})();
