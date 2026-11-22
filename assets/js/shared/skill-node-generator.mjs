import {catalogReviewImage, readCatalogImage, catalogProposal, showCatalogEdits} from './catalog-item-review.mjs?v=20261122-aggiunte';

// Pass all content through the editor's plain-text formatter before adding markup.
export function formatSkillNodeDescription(text, formatText) {
    return text.split(/(^## [^\n]+$|(?:^> [^\n]*(?:\n|$))+)/gm).map(part => {
        if (part.startsWith('## ')) return '<h4>' + formatText(part.slice(3)).replace(/^<p>|<\/p>$/g, '') + '</h4>';
        if (part.startsWith('> ')) return '<blockquote>' + formatText(part.replace(/^> /gm, '')) + '</blockquote>';
        return formatText(part);
    }).join('');
}

export function skillNodeAvatarReference(character) {
    const actor = character?.managedActor;
    if (actor?.worldId && actor.actorId) {
        return actor.media?.avatar?.path ? {worldId: actor.worldId, actorId: actor.actorId} : null;
    }
    // Older dossiers already carry the campaign media paths and portrait fallbacks.
    const images = character?.images || {};
    const paths = [...new Set(character?.avatarCandidates || [images.avatar, character?.avatar, images.portrait, images.avatarFallback, images.portraitFallback])]
        .filter(path => typeof path === 'string' && /^(?:https?:\/\/[^/]+\/)?\/?(?:media\/|campaigns\/)/i.test(path));
    return paths.length ? {paths} : null;
}

// The editor receives the proposal only after explicit acceptance.
export function openSkillNodeGenerator({treeKey, treeName, accountId, campaignId, token, examples, target, character, isSharedTree, catalogItem = false, review = null, addNode, onApply = addNode}) {
    if (document.querySelector('dialog[data-skill-node-ai]')) return;
    const refining = Boolean(review) || target?.mode === 'refine';
    const iconOnly = target?.mode === 'icon';
    const scope = [catalogItem ? 'catalog-item-generator' : 'skill-node-generator', campaignId, accountId, treeKey];
    if (target) scope.push(target.id, target.level, target.mode);
    if (!refining && isSharedTree && character) scope.push(character.managedActor?.worldId, character.managedActor?.actorId || character.id);
    const key = JSON.stringify(scope);
    let draft = {};
    try { draft = JSON.parse(sessionStorage.getItem(key)) || {}; } catch { /* Storage is optional. */ }
    if (target && draft.source !== target.source) draft = {source: target.source};
    const persist = () => { try { sessionStorage.setItem(key, JSON.stringify(draft)); } catch { /* In-memory draft remains usable. */ } };
    const dialog = document.createElement('dialog');
    dialog.className = 'player-skill-choice-dialog skill-node-ai';
    dialog.dataset.skillNodeAi = '';
    dialog.setAttribute('aria-labelledby', 'skill-node-ai-title');
    const noun = catalogItem ? 'immagine' : 'icona';
    const imageAction = existing => (existing ? 'Rigenera ' : 'Genera ') + noun;
    const acceptImage = catalogItem ? 'Usa questa immagine' : 'Usa questa icona';
    const title = review ? 'Rivedi intero oggetto con AI' : refining ? (catalogItem ? 'Migliora testo con AI' : 'Migliora testo') : iconOnly ? imageAction(target.icon) : 'Genera nodo';
    if (catalogItem) dialog.className = 'catalog-item-ai';
    const reference = skillNodeAvatarReference(character);
    const avatarControl = reference
        ? '<label class="skill-node-ai__avatar"><input type="checkbox" data-use-avatar checked><span data-avatar-label></span></label>'
        : catalogItem ? '' : '<small>Avatar del personaggio non disponibile.</small>';
    const directions = `${avatarControl}<label>Indicazioni per l'${noun} (facoltative)<textarea data-field="direction" rows="2" maxlength="1500" placeholder="Un simbolo, un colore o un effetto visivo"></textarea></label>`;
    const conceptControl = `<fieldset class="skill-node-ai__concept">
        <legend>${catalogItem && target.icon ? 'Riferimento aggiuntivo (facoltativo)' : 'Riferimento visivo facoltativo'}</legend>
        <label>Nome del riferimento<input data-field="conceptName" maxlength="180" placeholder="Ad esempio, Emblema del corvo"></label>
        <div class="skill-node-ai__file">
            <button type="button" class="player-skill-action-button" data-concept-pick>Allega immagine</button>
            <input type="file" data-concept-file hidden aria-label="Immagine di riferimento" accept="image/png,image/jpeg,image/webp">
        </div>
        <small>PNG, JPEG o WebP, fino a 12 MB.</small>
        <div data-concept-view hidden><img data-concept-preview alt="Anteprima del riferimento visivo">
            <button type="button" class="player-skill-action-button" data-concept-remove>Rimuovi immagine</button></div>
        <small data-concept-status role="status"></small></fieldset>`;
    const iconButton = '<button type="button" class="player-skill-action-button" data-icon>Genera icona</button>';
    const image = '<img data-preview alt="Anteprima della proposta" hidden>';
    const proposal = `<label>${refining ? 'Testo proposto' : 'Descrizione'}<textarea data-field="description" ${catalogItem ? 'data-item-proposal' : ''} rows="7" maxlength="12000"></textarea></label>
        <div data-questions hidden><strong>Da chiarire</strong><ul></ul></div>`;
    const rewriteButton = `<button type="button" class="player-skill-action-button" data-rewrite>${refining ? 'Proponi revisione' : 'Riscrivi in stile D&amp;D 5e'}</button>`;
    let content;
    if (review) {
        const descriptionCount = review.fields.filter(entry => ['summary', 'unidentifiedDescription'].includes(entry.key) && !entry.original.trim()).length;
        const scopeText = review.field ? '' : `<p class="catalog-review-scope">Entrambe le descrizioni, le note e ${review.source.properties.length === 1 ? 'una proprietà' : review.source.properties.length + ' proprietà'}.</p>`;
        content = `<section data-review-setup>${scopeText}
            ${review.canAdd ? '<label>Operazione<select data-field="propertyMode"><option value="auto">Segui le indicazioni del DM</option><option value="add">Solo nuove proprietà</option></select></label>' : ''}
            ${review.canAdd || review.field?.startsWith('property-') ? '<label>Indicazioni del DM<textarea data-field="notes" rows="3" maxlength="6000" placeholder="Descrivi gli effetti che vuoi ottenere."></textarea></label>' : ''}
            ${review.needsImage ? `<div class="catalog-review-image" data-review-image>
                <img alt="Riferimento visivo dell’oggetto" hidden><div><strong>${descriptionCount === 1 ? 'Una descrizione da creare' : 'Due descrizioni da creare'}</strong>
                <p data-visual-note></p><button type="button">Scegli immagine</button>
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden></div></div>` : ''}
            ${review.field?.startsWith('property-') ? '' : `<details class="catalog-review-options"><summary>${review.canAdd ? 'Aspetto dell’oggetto' : 'Indicazioni facoltative'}</summary>
            ${review.canAdd || review.field === 'unidentifiedDescription' ? '' : '<label>Stile e contenuto<textarea data-field="notes" rows="2" maxlength="6000" placeholder="Ad esempio, rendi più chiara la condizione di attivazione."></textarea></label>'}
            <label>Aspetto visibile<textarea data-field="appearance" rows="2" maxlength="3000" placeholder="Ad esempio, velluto viola e cuciture argentate."></textarea></label></details>`}
            </section>${rewriteButton}<div data-proposal data-review-fields hidden></div>`;
    } else if (refining) {
        content = `<div class="skill-node-ai__preview"><label>Testo attuale<textarea data-original rows="7" readonly></textarea></label>
            <div data-proposal hidden>${proposal}</div></div>
            <label>Indicazioni per la revisione (facoltative)<textarea data-field="notes" rows="2" maxlength="6000" autofocus placeholder="Ad esempio, chiarisci quando si attiva la reazione."></textarea></label>${rewriteButton}`;
    } else if (iconOnly) {
        content = `<div class="skill-node-ai__preview"><div><strong>${catalogItem ? 'Immagine di partenza' : 'Icona attuale'}</strong>
            ${target.icon ? '<img data-original-icon alt="Immagine attuale">' : '<span>Assente</span>'}</div>
            <div><strong>${catalogItem ? 'Illustrazione proposta' : 'Icona proposta'}</strong><span data-image-empty>${catalogItem ? 'Oggetto su fondo bianco con una macchia ad acquerello.' : 'In attesa della generazione'}</span>${image}<small data-preview-note role="status" hidden></small></div></div>
            ${directions}${catalogItem && target.icon
                ? `<details class="catalog-review-options" ${draft.conceptId ? 'open' : ''}><summary>Aggiungi un riferimento visivo</summary>${conceptControl}</details>`
                : conceptControl}${iconButton}`;
    } else {
        content = `<label>Appunti del DM<textarea data-field="notes" rows="3" maxlength="6000" autofocus placeholder="Descrivi cosa fa l’abilità, quando si attiva e quali limiti ha."></textarea></label>
            ${rewriteButton}<div class="skill-node-ai__preview" data-proposal hidden>
            <div><label>Nome del nodo<input data-field="name" maxlength="120"></label>${proposal}</div>
            <div>${directions}${image}${iconButton}<button type="button" class="player-skill-action-button" data-remove hidden>Rimuovi icona</button></div></div>`;
    }
    dialog.innerHTML = `<div class="player-skill-choice-dialog-card">
        <header><span data-tree></span><h3 id="skill-node-ai-title">${title}</h3></header>
        ${content}
        <p data-status role="status" aria-live="polite"></p>
        <footer class="player-skill-choice-dialog-actions">
            <button type="button" class="player-skill-action-button" data-stop hidden>Interrompi attesa</button>
            <button type="button" class="player-skill-action-button" data-resume hidden>Recupera risultato</button>
            <button type="button" class="player-skill-action-button" data-close>Chiudi</button>
            <button type="button" class="player-skill-action-button is-primary" data-add>${review ? 'Applica alla bozza' : refining ? 'Applica testo' : iconOnly ? acceptImage : "Aggiungi all'albero"}</button>
        </footer></div>`;
    const el = selector => dialog.querySelector(selector);
    if (catalogItem) {
        const card = el('.player-skill-choice-dialog-card');
        const header = card.querySelector('header'), footer = card.querySelector('footer');
        const heading = header.querySelector('h3');
        if (review) heading.textContent = review.field ? review.fields[0].label : 'Revisione dell’oggetto';
        const close = el('[data-close]');
        close.textContent = '×';
        close.setAttribute('aria-label', 'Chiudi');
        header.append(close);
        const body = document.createElement('div');
        body.className = 'catalog-ai-body';
        const action = el('[data-rewrite], [data-icon]');
        footer.insertBefore(action, el('[data-add]'));
        footer.prepend(el('[data-status]'));
        for (const child of [...card.children]) if (child !== header && child !== footer) body.append(child);
        card.insertBefore(body, footer);
    }
    const avatarInput = el('[data-use-avatar]');
    if (avatarInput) {
        el('[data-avatar-label]').textContent = 'Usa l’avatar di ' + (character.name || 'questo personaggio') + ' come riferimento';
        avatarInput.checked = draft.useAvatar !== false;
        avatarInput.addEventListener('change', () => { draft.useAvatar = avatarInput.checked; persist(); controls(); });
    }
    el('[data-tree]').textContent = catalogItem ? treeName : target ? [treeName, target.name, 'Livello ' + (target.level + 1)].join(' · ') : treeName;
    if (refining && !review) el('[data-original]').value = target.description;
    if (iconOnly && target.icon) el('[data-original-icon]').src = target.icon;
    const controller = new AbortController();
    const readVisual = review?.needsImage ? catalogReviewImage(el('[data-review-image]'), target.icon, controller.signal)
        : catalogItem && iconOnly && target.icon ? () => readCatalogImage(target.icon, controller.signal) : null;
    let busy = false, adding = false, stopping = false, inFlight, timer, imageBlob = null, imageUrl = '';
    let uploadingConcept = false, conceptUrl = '', conceptBlob = null;
    const fileInput = el('[data-concept-file]');
    function showConcept(blob) {
        if (conceptUrl) URL.revokeObjectURL(conceptUrl);
        conceptBlob = blob;
        conceptUrl = blob ? URL.createObjectURL(blob) : '';
        const img = el('[data-concept-preview]');
        if (conceptUrl) img.src = conceptUrl;
        else img.removeAttribute('src');
    }
    if (fileInput) {
        const note = el('[data-concept-status]');
        el('[data-concept-pick]').onclick = () => fileInput.click();
        fileInput.addEventListener('change', () => {
            const file = fileInput.files[0];
            fileInput.value = '';
            if (file) uploadConcept(file);
        });
        async function uploadConcept(file) {
            if (!file) return;
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 12 * 1024 * 1024) {
                note.textContent = 'Scegli un PNG, JPEG o WebP di massimo 12 MB.';
                return;
            }
            const previousImage = conceptBlob;
            uploadingConcept = true;
            showConcept(file);
            controls();
            note.textContent = 'Caricamento immagine…';
            try {
                const {uploadId} = await (await request('/concepts', file)).json();
                if (controller.signal.aborted) return;
                if (!uploadId) throw new Error('Immagine non caricata.');
                draft.conceptId = uploadId;
                persist();
                note.textContent = 'Immagine allegata.';
            } catch (error) {
                if (controller.signal.aborted) return;
                showConcept(previousImage);
                note.textContent = error.message;
            } finally {
                uploadingConcept = false;
                controls();
            }
        }
        el('[data-concept-remove]').onclick = () => {
            delete draft.conceptId;
            showConcept(null);
            note.textContent = '';
            persist();
            controls();
        };
        if (draft.conceptId) {
            const id = draft.conceptId;
            request('/concepts/' + id).then(response => response.blob()).then(blob => {
                if (!controller.signal.aborted && draft.conceptId === id && !uploadingConcept) showConcept(blob);
            }).catch(error => {
                if (!controller.signal.aborted && draft.conceptId === id && !uploadingConcept) note.textContent = error.message;
            });
        }
    }
    const status = message => { el('[data-status]').textContent = message; };
    for (const input of dialog.querySelectorAll('[data-field]')) {
        input.value = draft[input.dataset.field] || (input.dataset.field === 'propertyMode' ? 'auto' : '');
        input.addEventListener('input', () => { draft[input.dataset.field] = input.value; persist(); controls(); });
    }
    function controls() {
        const working = Boolean(busy || stopping || draft.pending || adding || uploadingConcept);
        if (fileInput) {
            fileInput.disabled = working;
            el('[data-concept-pick]').disabled = working;
            el('[data-concept-pick]').textContent = draft.conceptId ? 'Cambia immagine' : 'Allega immagine';
            el('[data-concept-view]').hidden = !draft.conceptId && !uploadingConcept;
            el('[data-concept-remove]').disabled = working;
        }
        if (avatarInput) avatarInput.disabled = working;
        const hasText = review ? Boolean(draft.edits && (draft.propertyMode !== 'add' || draft.appendOnly))
            : Boolean(draft.description?.trim() && (refining || draft.name?.trim()));
        if (catalogItem) {
            const ready = iconOnly ? Boolean(imageBlob) : Boolean(draft.hasProposal);
            const action = el('[data-rewrite], [data-icon]');
            el('[data-add]').hidden = !ready;
            action.classList.toggle('is-primary', !ready);
            if (refining) action.textContent = ready ? 'Nuova proposta' : draft.propertyMode === 'add' ? 'Proponi proprietà' : review?.field && !review.fields[0].original.trim() ? 'Genera descrizione' : 'Proponi revisione';
            if (review) {
                const onlyNew = draft.propertyMode === 'add';
                for (const node of dialog.querySelectorAll('[data-review-image], .catalog-review-options, .catalog-review-scope')) node.hidden = onlyNew;
                const picker = el('[data-review-image] button');
                if (picker) picker.disabled = working;
                el('[data-review-fields]').inert = working;
                el('[data-review-setup]').hidden = ready && !draft.adjusting;
                let settings = el('[data-review-settings]');
                if (!settings) {
                    settings = document.createElement('button');
                    settings.type = 'button';
                    settings.dataset.reviewSettings = '';
                    settings.onclick = () => {
                        draft.adjusting = !draft.adjusting;
                        controls();
                        if (draft.adjusting) {
                            const options = el('.catalog-review-options');
                            if (options) options.open = true;
                            el('[data-review-setup]').scrollIntoView({block: 'nearest'});
                        }
                    };
                    el('header').append(settings);
                }
                settings.hidden = !ready;
                settings.textContent = draft.adjusting ? 'Nascondi opzioni' : 'Opzioni';
                settings.setAttribute('aria-expanded', String(Boolean(draft.adjusting)));
                settings.disabled = working;
            }
        }
        if (!iconOnly) {
            el('[data-rewrite]').disabled = working || (review && draft.propertyMode === 'add' && !draft.notes?.trim()) || (!review && !(refining ? target.description : draft.notes?.trim()));
            el('[data-proposal]').hidden = !draft.hasProposal;
        }
        if (!refining) {
            el('[data-icon]').disabled = working || (!iconOnly && !hasText);
            el('[data-icon]').textContent = imageAction(draft.imageId || target?.icon);
        }
        if (iconOnly) {
            el('[data-image-empty]').hidden = Boolean(imageBlob);
            const note = el('[data-preview-note]');
            const previous = Boolean(imageBlob) && draft.imageInputs !== JSON.stringify(iconOptions());
            note.hidden = !previous;
            note.textContent = previous
                ? (draft.imageInputs ? 'I riferimenti o le indicazioni sono cambiati. Rigenera per aggiornare la proposta.' : 'Proposta salvata. Rigenera per usare i riferimenti mostrati.')
                : '';
            el('[data-add]').textContent = previous ? 'Usa la proposta precedente' : acceptImage;
        }
        if (!target) {
            el('[data-remove]').hidden = !draft.imageId;
            el('[data-remove]').disabled = working;
        }
        el('[data-close]').disabled = adding;
        el('[data-stop]').hidden = draft.pending?.mode !== 'icon';
        el('[data-stop]').disabled = stopping;
        el('[data-resume]').hidden = busy || stopping || adding || !draft.pending;
        el('[data-add]').disabled = working || (iconOnly ? !imageBlob : !draft.hasProposal || !hasText || Boolean(draft.imageId && !imageBlob));
        for (const field of dialog.querySelectorAll('[data-field], [data-review-key]')) {
            field.disabled = adding || Boolean(draft.pending && (target || (draft.pending.mode === 'text' && field.dataset.field !== 'direction')));
        }
    }
    function displayReview() {
        showCatalogEdits(el('[data-review-fields]'), review.fields, draft, persist);
    }
    function questions() {
        const container = el('[data-questions]');
        if (!container) return;
        const list = (draft.questions || []).map(question => {
            const item = document.createElement('li'); item.textContent = question; return item;
        });
        container.querySelector('ul').replaceChildren(...list);
        container.hidden = !list.length;
    }
    function clearPreview() {
        if (imageUrl) URL.revokeObjectURL(imageUrl);
        imageUrl = ''; imageBlob = null;
        const img = el('[data-preview]');
        if (img) { img.removeAttribute('src'); img.hidden = true; }
    }
    async function request(suffix = '', body) {
        const url = new URL(window.CriptaApp.urls.api((catalogItem ? 'api/items/generate' : 'api/skill-trees/generate-node') + suffix));
        url.searchParams.set(catalogItem ? 'item' : 'tree', treeKey); url.searchParams.set('campaign', campaignId);
        const timeout = AbortSignal.timeout(body instanceof Blob ? 120000 : 20000);
        const response = await fetch(url, {method: body ? 'POST' : 'GET', cache: 'no-store',
            signal: body && (!suffix || suffix.endsWith('/stop')) ? timeout : AbortSignal.any([controller.signal, timeout]),
            headers: {Authorization: `Bearer ${token}`, ...(body ? {'Content-Type': body instanceof Blob ? body.type : 'application/json'} : {})},
            ...(body ? {body: body instanceof Blob ? body : JSON.stringify(body)} : {})});
        if (!response.ok) {
            const error = new Error((await response.json().catch(() => ({}))).error || 'Generatore non disponibile. Riprova.');
            error.status = response.status; throw error;
        }
        return response;
    }
    async function preview(id) {
        const blob = await (await request('/' + id + '/preview')).blob();
        if (controller.signal.aborted || draft.imageId !== id) return;
        clearPreview(); imageBlob = blob; imageUrl = URL.createObjectURL(blob);
        el('[data-preview]').src = imageUrl; el('[data-preview]').hidden = false;
    }
    function update(body) {
        if (!stopping && !busy && draft.pending) inFlight = readUpdate(body);
        return inFlight;
    }
    async function readUpdate(body) {
        const pending = draft.pending;
        busy = true; controls();
        status(pending.mode === 'icon' ? 'Generazione in corso…' : 'Revisione del testo in corso…');
        try {
            const {job} = await (await request(body ? '' : '/' + pending.id, body)).json();
            if (controller.signal.aborted) return;
            if (!job || job.id !== pending.id) throw new Error('Risposta del generatore non valida.');
            if (['pending','running','icon-pending','icon-running'].includes(job.status)) {
                timer = setTimeout(() => { busy = false; update(); }, 2000);
                return;
            }
            if (job.status !== 'ready' || job.iconError || job.error) {
                delete draft.pending; throw new Error(job.iconError || job.error || 'Generazione non completata.');
            }
            if (pending.mode !== 'icon') {
                if (review) {
                    delete draft.pending;
                    const proposal = catalogProposal(review.fields, job.draft, review.canAdd);
                    if (pending.propertyMode === 'add' && !proposal.appendOnly) throw new Error('Il generatore non ha restituito una proposta di sole nuove proprietà.');
                    Object.assign(draft, proposal);
                    if (proposal.additions.length) draft.activeField = 'new-0';
                    draft.adjusting = false;
                    displayReview();
                    draft.hasProposal = true;
                } else Object.assign(draft, job.draft, {hasProposal: true});
                for (const field of dialog.querySelectorAll('[data-field="name"], [data-field="description"]')) field.value = draft[field.dataset.field];
                if (catalogItem && !review) enhanceCatalogTextFields(dialog);
                questions(); status(review && draft.additions?.length
                    ? (draft.additions.length === 1 ? 'Una nuova proprietà da rivedere.' : draft.additions.length + ' nuove proprietà da rivedere.')
                    : 'Proposta pronta da rivedere.');
            } else {
                draft.imageId = job.id;
                draft.imageInputs = pending.imageInputs;
                clearPreview();
                await preview(job.id); status('Anteprima pronta.');
            }
            delete draft.pending;
        } catch (error) {
            if (controller.signal.aborted) return;
            // A lost response can be recovered by ID without another paid request.
            if (error.status === 404 || (body && [400, 401, 403, 405, 409, 413, 503].includes(error.status))) delete draft.pending;
            status(error.message);
        }
        if (!controller.signal.aborted) { busy = false; persist(); controls(); }
    }
    function iconOptions() {
        return {
            direction: draft.direction?.trim() || '',
            ...(avatarInput?.checked ? {avatar: reference} : {}),
            ...(iconOnly && draft.conceptName?.trim() ? {conceptName: draft.conceptName.trim()} : {}),
            ...(iconOnly && draft.conceptId ? {concept: draft.conceptId} : {})
        };
    }
    async function start(mode) {
        if (busy || draft.pending || uploadingConcept) return;
        let concept;
        const propertyMode = review?.canAdd ? draft.propertyMode || 'auto' : undefined;
        if (readVisual && propertyMode !== 'add') {
            uploadingConcept = true; controls(); status('Preparazione del riferimento visivo…');
            try {
                const blob = await readVisual();
                if (blob) {
                    const result = await (await request('/concepts', blob)).json();
                    if (!result.uploadId) throw new Error('Caricamento dell’immagine non riuscito.');
                    concept = result.uploadId;
                }
            } catch (error) {
                if (!controller.signal.aborted) status(error.message);
                return;
            } finally { uploadingConcept = false; controls(); }
            if (controller.signal.aborted) return;
        }
        const requestId = crypto.randomUUID();
        const options = mode === 'icon' ? iconOptions() : null;
        draft.pending = {id: requestId, mode, propertyMode, ...(iconOnly ? {imageInputs: JSON.stringify(options)} : {})};
        persist();
        const payload = review ? {source: review.source, field: review.field, propertyMode, concept, notes: draft.notes || '', appearance: draft.appearance || ''}
            : mode === 'icon'
            ? {name: target?.name ?? draft.name, description: target?.description ?? draft.description, ...options, ...(concept ? {itemImage: concept} : {})}
            : {notes: draft.notes || '', examples, ...(refining ? {source: {name: target.name, description: target.description}} : {})};
        update({requestId, mode, ...payload});
    }
    el('[data-rewrite]')?.addEventListener('click', () => start(review ? 'item-review' : refining ? 'refine' : 'text'));
    el('[data-icon]')?.addEventListener('click', () => start('icon'));
    el('[data-resume]').onclick = () => update();
    el('[data-stop]').onclick = async () => {
        const pending = draft.pending;
        if (stopping || pending?.mode !== 'icon') return;
        stopping = true; clearTimeout(timer); controls(); status('Interruzione in corso.');
        let completed = false;
        try {
            // If creation is still being submitted, stop the acknowledged job.
            await inFlight;
            clearTimeout(timer);
            if (draft.pending !== pending) return;
            const {job} = await (await request('/' + pending.id + '/stop', {})).json();
            if (controller.signal.aborted) return;
            if (job?.id !== pending.id) throw new Error('Risposta del generatore non valida.');
            completed = job.status === 'ready' && Boolean(job.iconId) && !job.iconError;
            if (!completed) {
                delete draft.pending;
                persist();
                status('Attesa interrotta. Una chiamata già avviata potrebbe avere un costo.');
            }
        } catch (error) {
            if (!controller.signal.aborted) status(error.message);
        } finally {
            if (!controller.signal.aborted) {
                stopping = false; busy = false; controls();
                if (completed) update();
            }
        }
    };
    el('[data-remove]')?.addEventListener('click', () => { delete draft.imageId; clearPreview(); persist(); controls(); status(''); });
    el('[data-add]').onclick = async () => {
        if (el('[data-add]').disabled) return;
        adding = true; controls(); status(catalogItem ? 'Aggiornamento della bozza…' : 'Aggiornamento della bozza dell’albero…');
        try {
            await onApply(review ? catalogProposal(review.fields, draft, review.canAdd) : {title: draft.name?.trim(), description: draft.description?.trim(), image: imageBlob, imageId: draft.imageId});
            draft = {}; persist(); dialog.close();
        } catch (error) { status(error.message); adding = false; controls(); }
    };
    el('[data-close]').onclick = () => dialog.close();
    dialog.addEventListener('cancel', event => { if (adding) event.preventDefault(); });
    dialog.addEventListener('close', () => {
        controller.abort(); clearTimeout(timer); clearPreview();
        if (conceptUrl) URL.revokeObjectURL(conceptUrl);
        dialog.remove();
    }, {once: true});
    document.body.append(dialog); dialog.showModal(); questions(); controls();
    if (review && draft.hasProposal) displayReview();
    if (catalogItem && refining && !review) enhanceCatalogTextFields(dialog);
    if (refining && !review && !target.description) status('Inserisci un testo prima di richiedere una revisione.');
    if (draft.imageId) preview(draft.imageId).catch(error => { if (!controller.signal.aborted) status(error.message); }).finally(controls);
    if (draft.pending) update();
}
