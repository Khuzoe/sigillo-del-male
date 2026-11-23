const mainFields = [
    ['summary', 'Descrizione identificata'],
    ['unidentifiedDescription', 'Descrizione non identificata'],
    ['notes', 'Note della campagna']
];

export function captureCatalogReview(form) {
    const field = key => form.querySelector(`[data-item-field="${key}"], [data-field="${key}"]`);
    const classification = key => form.querySelector(`[data-item-classification="${key}"]`)?.value;
    const source = {
        name: field('name')?.value || '',
        unidentifiedName: field('unidentifiedName')?.value || '',
        type: classification('family') || field('type')?.value || '',
        subtype: classification('subtype') || field('subtype')?.value || '',
        rarity: field('rarity')?.value || '',
        attunement: field('attunement')?.checked === true,
        properties: []
    };
    const fields = [];
    function include(key, label, input) {
        if (!input) throw new Error('Campo della scheda non disponibile. Riapri l’editor.');
        fields.push({key, label, input, original: input.value});
    }
    for (const [key, label] of mainFields) {
        const input = field(key);
        include(key, label, input);
        source[key] = input.value;
    }
    for (const [i, row] of [...form.querySelectorAll('[data-item-property-row], [data-property-index]')].entries()) {
        const prop = key => row.querySelector(`[data-row-field="${key}"], [data-property-field="${key}"]`);
        const property = {name: prop('name').value, charges: prop('charges').value, description: prop('description').value,
            hidden: prop('hidden').checked, genial: prop('genial').checked, negative: prop('negative').checked};
        source.properties.push(property);
        const badges = [property.negative ? 'Negativa' : property.genial ? 'Geniale' : '', property.hidden ? 'Solo DM' : ''];
        include('property-' + i, [property.name || 'Proprietà ' + (i + 1), ...badges].filter(Boolean).join(' · '), prop('description'));
    }
    return {source, fields};
}

export function orderedCatalogEdits(fields, edits) {
    if (!Array.isArray(edits) || edits.length !== fields.length) throw new Error('La proposta non contiene tutti i testi della scheda.');
    const byKey = new Map(edits.map(row => [row?.key, row?.text]));
    return fields.map(({key}) => {
        const text = byKey.get(key);
        if (typeof text !== 'string') throw new Error('La proposta contiene campi mancanti o duplicati.');
        return {key, text};
    });
}

export function catalogProposal(fields, result, canAdd) {
    const appendOnly = result?.appendOnly === true;
    const additions = result?.additions === undefined ? [] : result.additions;
    if (!Array.isArray(additions) || (!canAdd && additions.length) || (appendOnly && !additions.length)) {
        throw new Error('Elenco delle nuove proprietà non valido.');
    }
    for (const property of additions) {
        if (!property || typeof property.name !== 'string' || !property.name.trim() || property.name.length > 500
            || typeof property.description !== 'string' || !property.description.trim() || property.description.length > 24000
            || typeof property.charges !== 'string' || property.charges.length > 1000) {
            throw new Error('Ogni nuova proprietà richiede un nome e una descrizione validi.');
        }
    }
    return {edits: orderedCatalogEdits(appendOnly ? [] : fields, result?.edits), appendOnly, additions};
}

export function showCatalogEdits(container, fields, draft, persist) {
    const entries = (draft.additions || []).map((property, i) => ({
        key: 'new-' + i, label: 'Nuova proprietà · ' + property.name, property
    }));
    if (!draft.appendOnly) entries.push(...fields);
    container.innerHTML = `<div class="catalog-review-nav">
        <label>Proposta da rivedere<select data-review-select></select></label>
        <div class="catalog-review-paging"><button type="button" data-prev aria-label="Testo precedente">‹</button>
        <span data-position></span><button type="button" data-next aria-label="Testo successivo">›</button></div></div>
        <section class="catalog-review-pane" aria-live="off"></section>`;
    const nav = container.querySelector('.catalog-review-nav');
    const select = nav.querySelector('select');
    for (const {key, label} of entries) select.add(new Option(label, key));
    const previous = nav.querySelector('[data-prev]');
    const next = nav.querySelector('[data-next]');
    const pane = container.querySelector('section');
    function display(index) {
        const {key, label, original, property} = entries[index];
        select.selectedIndex = index;
        draft.activeField = key;
        nav.hidden = entries.length === 1;
        nav.querySelector('[data-position]').textContent = (index + 1) + ' / ' + entries.length;
        previous.disabled = index === 0;
        next.disabled = index === entries.length - 1;
        const edit = property || draft.edits.find(entry => entry.key === key);
        if (property) {
            pane.innerHTML = `<div class="catalog-review-new"><strong>Nuova proprietà</strong>
                <label>Nome<input data-new-name maxlength="500"></label>
                <label>Cariche o condizione<input data-new-charges maxlength="1000"></label>
                <div class="catalog-review-property-options"><label>Stile della proprietà<select data-new-tone>
                    <option value="normal">Standard</option><option value="genial">Geniale</option><option value="negative">Negativa</option>
                </select></label><label class="catalog-review-visibility"><input type="checkbox" data-new-hidden>Solo DM</label></div>
                <label>Descrizione<textarea data-item-proposal rows="5" maxlength="24000"></textarea></label>
                <p data-clarification></p></div>`;
            const tone = pane.querySelector('[data-new-tone]');
            tone.value = property.negative ? 'negative' : property.genial ? 'genial' : 'normal';
            tone.onchange = () => {
                property.genial = tone.value === 'genial';
                property.negative = tone.value === 'negative';
                persist();
            };
            const visibility = pane.querySelector('[data-new-hidden]');
            visibility.checked = property.hidden === true;
            visibility.onchange = () => { property.hidden = visibility.checked; persist(); };
            const question = pane.querySelector('[data-clarification]');
            question.hidden = !property.clarification;
            question.textContent = property.clarification ? 'Da chiarire — ' + property.clarification : '';
            for (const part of ['name', 'charges']) {
                const input = pane.querySelector('[data-new-' + part + ']');
                input.value = property[part];
                input.oninput = () => {
                    property[part] = input.value;
                    if (part === 'name') select.options[index].textContent = 'Nuova proprietà · ' + input.value;
                    persist();
                };
            }
        } else {
            pane.innerHTML = `<div class="catalog-review-original"><strong>Originale</strong><div class="item-formatted-text"></div></div>
                <label>Proposta modificabile<textarea data-item-proposal rows="6" maxlength="24000"></textarea></label>`;
            pane.querySelector('.item-formatted-text').innerHTML = renderCatalogItemText(original) || 'Campo vuoto';
        }
        const input = pane.querySelector('textarea');
        input.dataset.reviewKey = key;
        input.setAttribute('aria-label', 'Proposta per ' + label);
        const textField = property ? 'description' : 'text';
        input.value = edit[textField];
        input.addEventListener('input', () => {
            edit[textField] = input.value;
            persist();
        });
        enhanceCatalogTextFields(pane);
        persist();
    }
    select.onchange = () => display(select.selectedIndex);
    previous.onclick = () => display(select.selectedIndex - 1);
    next.onclick = () => display(select.selectedIndex + 1);
    display(Math.max(0, entries.findIndex(entry => entry.key === draft.activeField)));
}

// Use the actual pixels from the catalog, including the current unsaved image selection.
export function catalogReviewImage(container, src, signal) {
    const image = container.querySelector('img');
    const input = container.querySelector('input');
    const note = container.querySelector('[data-visual-note]');
    let selected = null, url = '';
    const refresh = () => {
        const hasImage = Boolean(selected || src);
        image.hidden = !hasImage;
        if (hasImage) image.src = url || src;
        note.textContent = hasImage ? 'L’AI userà questa immagine per le descrizioni mancanti.' : 'Nessuna immagine nella scheda. Puoi allegarne una o usare i testi disponibili.';
    };
    const revoke = () => { if (url) URL.revokeObjectURL(url); };
    input.addEventListener('change', () => {
        const file = input.files[0];
        input.value = '';
        if (!file) return;
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
            note.textContent = 'Scegli un PNG, JPEG o WebP di massimo 12 MB.';
            return;
        }
        revoke();
        selected = file;
        url = URL.createObjectURL(file);
        refresh();
    });
    container.querySelector('button').onclick = () => input.click();
    signal.addEventListener('abort', revoke, {once: true});
    refresh();
    return () => readCatalogImage(src, signal, selected);
}

export async function readCatalogImage(src, signal, file) {
    if (!src && !file) return null;
    try {
        if (!file) {
            const response = await fetch(src, {signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]), credentials: 'omit', referrerPolicy: 'no-referrer'});
            if (!response.ok) throw new Error();
            file = await response.blob();
        }
        return await window.CriptaMedia.convertImageFileToWebpBlob(file, {maxEdge: 1536, quality: .93});
    } catch {
        throw new Error('Immagine illeggibile. Verifica l’immagine di partenza o scegli un file PNG, JPEG o WebP.');
    }
}
