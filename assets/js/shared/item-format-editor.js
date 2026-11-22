function setupCatalogPropertyRow(row, bar, open) {
    const get = key => row.querySelector(`[data-row-field="${key}"], [data-property-field="${key}"]`);
    const writing = row.querySelector('.catalog-property-writing');
    const tools = row.querySelector('.catalog-property-tools');
    const header = document.createElement('div');
    header.className = 'catalog-property-header';
    header.innerHTML = '<button type="button" data-property-toggle><span data-property-title></span><small data-property-traits></small></button>';
    const toggle = header.querySelector('button');
    bar.innerHTML = '<button type="button" data-property-move="up" aria-label="Sposta su" title="Sposta su">↑</button>'
        + '<button type="button" data-property-move="down" aria-label="Sposta giù" title="Sposta giù">↓</button>';
    header.append(bar);

    const body = document.createElement('div');
    body.className = 'catalog-property-fields';
    body.id = 'property-' + crypto.randomUUID();
    const settings = document.createElement('div');
    settings.className = 'catalog-property-settings';
    const options = document.createElement('button');
    options.type = 'button';
    options.className = 'catalog-property-options-toggle';
    options.textContent = 'Opzioni';
    tools.id = body.id + '-options';
    tools.setAttribute('role', 'group');
    tools.setAttribute('aria-label', 'Opzioni della proprietà');
    options.setAttribute('aria-controls', tools.id);
    options.setAttribute('aria-expanded', 'false');
    options.onclick = () => options.setAttribute('aria-expanded', String(options.getAttribute('aria-expanded') !== 'true'));
    settings.append(options, tools);
    body.append(writing, settings);
    const reading = document.createElement('div');
    reading.className = 'catalog-property-reading item-formatted-text';
    row.append(header, reading, body);
    const renderReading = () => {
        const charges = get('charges').value.trim();
        reading.innerHTML = renderCatalogItemText(get('description').value);
        if (charges) {
            const meta = document.createElement('p');
            meta.className = 'catalog-property-charges';
            meta.textContent = /^\d+$/.test(charges) ? charges + (Number(charges) === 1 ? ' carica' : ' cariche') : charges;
            reading.prepend(meta);
        }
    };
    const setOpen = editing => {
        toggle.setAttribute('aria-expanded', String(editing));
        body.hidden = !editing;
        reading.hidden = editing;
        if (!editing) renderReading();
    };
    const update = () => {
        header.querySelector('[data-property-title]').textContent = get('name').value.trim() || 'Nuova proprietà';
        const tone = get('negative').checked ? 'Negativa' : get('genial').checked ? 'Geniale' : '';
        header.querySelector('[data-property-traits]').textContent = [tone, get('hidden').checked ? 'Solo DM' : ''].filter(Boolean).join(' · ');
        if (body.hidden) renderReading();
    };
    toggle.setAttribute('aria-controls', body.id);
    toggle.onclick = () => setOpen(body.hidden);
    row.addEventListener('input', update);
    update();
    setOpen(open);
}

function refreshCatalogPropertyOrder(list, expanded) {
    const rows = [...(list?.querySelectorAll('[data-item-property-row], [data-property-index]') || [])];
    rows.forEach((row, index) => {
        const bar = row.querySelector('.item-property-order');
        if (!bar) return;
        if (!bar.children.length) setupCatalogPropertyRow(row, bar, expanded ? expanded.has(index) : index === 0);
        bar.firstElementChild.disabled = index === 0;
        bar.lastElementChild.disabled = index === rows.length - 1;
        if (row.hasAttribute('data-property-index')) row.dataset.propertyIndex = String(index);
    });
}

function moveCatalogProperty(button) {
    const row = button.closest('[data-item-property-row], [data-property-index]');
    const list = row.parentElement;
    const rows = [...list.querySelectorAll('[data-item-property-row], [data-property-index]')];
    const from = rows.indexOf(row);
    const to = from + (button.dataset.propertyMove === 'up' ? -1 : 1);
    if (!rows[to]) return null;
    if (to < from) rows[to].before(row);
    else rows[to].after(row);
    refreshCatalogPropertyOrder(list);
    (button.disabled ? row.querySelector('[data-property-move]:enabled') : button)?.focus();
    return {from, to};
}

function enhanceCatalogTextFields(root) {
    const fields = root.querySelectorAll([
        'textarea:is([data-item-field="summary"], [data-item-field="notes"], [data-item-field="unidentifiedDescription"], [data-field="summary"], [data-field="notes"], [data-field="unidentifiedDescription"])',
        '[data-item-property-row] textarea[data-row-field="description"]',
        'textarea[data-property-field="description"], textarea[data-item-proposal]'
    ].join(","));
    for (const field of fields) {
        const existing = field.closest(".item-format-field");
        if (existing) {
            syncCatalogTextMeasure(field);
            const preview = existing.querySelector(".item-format-preview");
            if (!preview.hidden) preview.innerHTML = renderCatalogItemText(field.value);
            continue;
        }
        const wrapper = document.createElement("div");
        wrapper.className = "item-format-field";
        const anchor = field.closest("label") || field;
        if (anchor.classList.contains("item-inline-editor-field--wide")) wrapper.classList.add("item-inline-editor-field--wide");
        anchor.before(wrapper);
        const bar = document.createElement("div");
        bar.className = "item-format-bar";
        bar.setAttribute("role", "group");
        bar.setAttribute("aria-label", "Formato del testo");
        const preview = document.createElement("div");
        preview.className = "item-format-preview";
        preview.hidden = true;
        wrapper.append(anchor, bar, preview);
        field.classList.add('catalog-prose-input');
        // Older browsers measure a noninteractive copy on the same grid cell.
        // It reflows with the field even when a tab or disclosure starts hidden.
        if (!CSS.supports('field-sizing', 'content')) {
            const box = document.createElement('div');
            box.className = 'catalog-text-sizing';
            const measure = document.createElement('span');
            measure.className = 'catalog-prose-input catalog-text-measure';
            measure.setAttribute('aria-hidden', 'true');
            field.before(box);
            box.append(field, measure);
            syncCatalogTextMeasure(field);
            field.addEventListener('input', () => syncCatalogTextMeasure(field));
        }
        const refresh = () => { if (!preview.hidden) preview.innerHTML = renderCatalogItemText(field.value); };
        field.addEventListener("input", refresh);
        for (const [action, label, glyph] of [
            ["bold", "Grassetto", "G"], ["italic", "Corsivo", "C"],
            ["ul", "Elenco puntato", "• ≡"], ["ol", "Elenco numerato", "1. ≡"],
            ["preview", "Anteprima", "Anteprima"]
        ]) {
            const button = document.createElement("button");
            button.type = "button";
            button.title = label;
            button.setAttribute("aria-label", label);
            button.dataset.itemFormat = action;
            button.textContent = glyph;
            if (action === "preview") {
                button.setAttribute("aria-pressed", "false");
            }
            button.addEventListener("mousedown", event => event.preventDefault());
            button.addEventListener("click", () => {
                if (field.disabled || field.readOnly) return;
                if (action === "preview") {
                    preview.hidden = !preview.hidden;
                    button.setAttribute("aria-pressed", String(!preview.hidden));
                    refresh();
                } else formatCatalogSelection(field, action);
            });
            bar.append(button);
        }
        field.addEventListener("keydown", event => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
            const action = {b: "bold", i: "italic"}[event.key.toLowerCase()];
            if (action) { event.preventDefault(); formatCatalogSelection(field, action); }
        });
    }
}

function syncCatalogTextMeasure(field) {
    const measure = field.nextElementSibling;
    if (measure?.classList.contains('catalog-text-measure')) measure.textContent = field.value + ' ';
}

function formatCatalogSelection(field, action) {
    const value = field.value;
    let start = field.selectionStart, end = field.selectionEnd;
    let replacement, selectionStart, selectionEnd;
    if (action === "ul" || action === "ol") {
        // A selection ending at the start of the next line excludes that line.
        const caret = start === end ? start : null;
        const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
        start = value.slice(0, start).lastIndexOf("\n") + 1;
        const next = value.indexOf("\n", last);
        end = next < 0 ? value.length : next;
        const lines = value.slice(start, end).split("\n");
        const marker = /^([ \t]*)(?:([-+*])|(\d{1,9})[.)])[ \t]+/;
        const marked = lines.filter(line => line.trim());
        const remove = marked.length && marked.every(line => marker.exec(line)?.[action === "ul" ? 2 : 3]);
        let number = 0;
        replacement = lines.map(line => {
            if (!line.trim() && lines.length > 1) return line;
            const bare = line.replace(marker, "$1");
            if (remove) return bare;
            return bare.replace(/^([ \t]*)/, (_, indent) => indent + (action === "ul" ? "- " : (++number) + ". "));
        }).join("\n");
        selectionEnd = caret === null ? start + replacement.length : Math.max(start, caret + replacement.length - (end - start));
        selectionStart = caret === null ? start : selectionEnd;
    } else {
        const mark = action === "bold" ? "**" : "*";
        const selected = value.slice(start, end);
        if (selected && !selected.trim()) return;
        start += selected.length - selected.trimStart().length;
        end -= selected.length - selected.trimEnd().length;
        const body = value.slice(start, end) || "testo";
        const surrounding = Math.min(value.slice(0, start).match(/\**$/)[0].length, value.slice(end).match(/^\**/)[0].length, 3);
        const hasStyle = count => action === "bold" ? count >= 2 : count % 2 === 1;
        if (surrounding && !body.includes("\n") && hasStyle(surrounding)) {
            start -= mark.length;
            end += mark.length;
            replacement = body;
        } else {
            // Keep list markers outside the emphasis when formatting complete lines.
            replacement = body.split("\n").map(line => line.replace(/^(\s*(?:(?:[-+*]|\d+[.)])\s+)?)(\S(?:.*\S)?)(\s*)$/, (_, prefix, content, tail) => {
                const count = Math.min(content.match(/^\**/)[0].length, content.match(/\**$/)[0].length, 3);
                if (count && hasStyle(count)) return prefix + content.slice(mark.length, -mark.length) + tail;
                return prefix + mark + content + mark + tail;
            })).join("\n");
        }
        const added = !body.includes("\n") && replacement === mark + body + mark ? mark.length : 0;
        selectionStart = start + added;
        selectionEnd = start + replacement.length - added;
    }
    field.focus();
    field.setSelectionRange(start, end);
    // Native insertion keeps the change in the textarea's undo history.
    if (!document.execCommand("insertText", false, replacement)) {
        field.setRangeText(replacement, start, end, "end");
        field.dispatchEvent(new Event("input", {bubbles: true}));
    }
    field.setSelectionRange(selectionStart, selectionEnd);
}
