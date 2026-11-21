import {mountIconReferences} from './icon-reference-picker.mjs?v=20261120-icon-refs';

// Every editorial request sees the same full tree. Split only the requested
// output so a long tree does not exhaust the model's response budget.
export function treeReviewSteps(entries, texts, icons) {
    const steps = [], images = [];
    let targets = [], size = 0;
    const flush = () => {
        if (targets.length) steps.push({kind: 'review', targets});
        targets = []; size = 0;
    };
    for (const entry of entries) {
        const text = texts && Boolean(entry.original), icon = icons && entry.generateIcon;
        if (!text && !icon) continue;
        const length = (text ? entry.original.length : 0) + (icon ? 650 : 0) + 120;
        if (size + length > 16000 || targets.length >= 24) flush();
        targets.push({key: entry.key, text, icon}); size += length;
        if (icon) images.push({kind: 'icon', key: entry.key});
    }
    flush();
    return steps.concat(images);
}

export async function openSkillTreeReview({tree, entries, treeKey, accountId, campaignId, token, snapshot, avatar, resolveIcon, apply}) {
    if (!token) throw new Error('Accedi per rivedere l’albero.');
    if (document.querySelector('[data-tree-review]')) return;
    const dialog = document.createElement('dialog');
    dialog.className = 'player-skill-choice-dialog skill-node-ai skill-tree-review';
    dialog.dataset.treeReview = '';
    dialog.setAttribute('aria-labelledby', 'skill-tree-review-title');
    dialog.innerHTML = `<div class="player-skill-choice-dialog-card">
        <header><span data-name></span><h3 id="skill-tree-review-title">Revisione AI dell’albero</h3></header>
        <fieldset class="skill-tree-review__options"><legend>Contenuti da rivedere</legend>
            <label class="skill-node-ai__avatar"><input type="checkbox" data-texts checked>Testi delle abilità</label>
            <label class="skill-node-ai__avatar"><input type="checkbox" data-icons>Icone delle abilità</label>
            <label class="skill-node-ai__avatar" data-avatar-option hidden><input type="checkbox" data-avatar checked>Usa l’avatar del personaggio</label>
        </fieldset>
        <div data-icon-references hidden></div>
        <label>Indicazioni per l’intero albero (facoltative)<textarea rows="2" maxlength="1500" data-direction></textarea></label>
        <p data-count></p><p data-status role="status" aria-live="polite"></p>
        <button type="button" class="player-skill-action-button" data-toggle-all hidden>Deseleziona tutte le proposte</button>
        <div data-results></div>
        <footer class="player-skill-choice-dialog-actions">
            <button type="button" class="player-skill-action-button" data-close>Chiudi</button>
            <button type="button" class="player-skill-action-button" data-reset hidden>Nuova revisione</button>
            <button type="button" class="player-skill-action-button" data-stop hidden>Interrompi attesa</button>
            <button type="button" class="player-skill-action-button" data-run>Prepara proposte</button>
            <button type="button" class="player-skill-action-button is-primary" data-apply hidden>Conferma nella bozza</button>
        </footer></div>`;
    const el = name => dialog.querySelector('[data-' + name + ']');
    const byKey = new Map(entries.map(entry => [entry.key, entry]));
    const referenceScope = JSON.stringify(avatar || null);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot + referenceScope));
    const signature = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const storageKey = JSON.stringify(['skill-tree-review-v1', campaignId, accountId, treeKey]);
    if (document.querySelector('[data-tree-review]')) return;
    let draft = null;
    try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey));
        if (saved?.signature === signature) draft = saved;
    } catch { /* Session storage is optional. */ }
    const persist = () => {
        try {
            if (draft) sessionStorage.setItem(storageKey, JSON.stringify(draft));
            else sessionStorage.removeItem(storageKey);
        } catch { /* The open dialog retains the review. */ }
    };
    el('name').textContent = tree.name || 'Albero abilità';
    if (draft) {
        el('texts').checked = draft.texts; el('icons').checked = draft.icons;
        el('avatar').checked = draft.useAvatar; el('direction').value = draft.direction;
    }
    const status = message => { el('status').textContent = message; };
    const selected = () => Object.entries(draft?.results || {}).filter(([, row]) =>
        (row.description && row.acceptText) || (row.imageId && row.acceptIcon));
    let running = false, stopping = false, applying = false, closed = false, uploadingReferences = false, polling, runPromise;
    const previews = new Map(), urls = new Set(), readyImages = new Set();
    const endpoint = new URL(window.CriptaApp.urls.api('api/skill-trees/generate-node/concepts'));
    endpoint.searchParams.set('tree', treeKey); endpoint.searchParams.set('campaign', campaignId);
    const referencePicker = mountIconReferences(el('icon-references'), {endpoint, token, initial: draft ? draft.references || [] : undefined,
        storageKey: JSON.stringify([storageKey, 'references']), onBusy: value => { uploadingReferences = value; controls(); }});
    function controls() {
        const locked = running || applying || stopping;
        const steps = draft?.steps || treeReviewSteps(entries, el('texts').checked, el('icons').checked);
        const reviews = steps.filter(step => step.kind === 'review').length;
        const images = steps.length - reviews, next = steps.find(step => !step.done);
        el('count').textContent = tree.nodes.length + ' nodi nel contesto · ' + reviews + (reviews === 1 ? ' chiamata di revisione' : ' chiamate di revisione') + ' · ' + images + (images === 1 ? ' immagine' : ' immagini') + ' da generare.';
        for (const field of ['texts','icons','avatar','direction']) el(field).disabled = locked || Boolean(draft);
        el('avatar-option').hidden = !avatar || !el('icons').checked;
        el('icon-references').hidden = !el('icons').checked;
        referencePicker.setLocked(locked || Boolean(draft));
        el('run').hidden = Boolean(draft && !next);
        el('run').disabled = locked || uploadingReferences || !steps.length;
        el('run').textContent = !draft ? 'Prepara proposte' : next?.failed ? 'Riprova generazione' : 'Riprendi revisione';
        el('stop').hidden = !running && !(next?.sent && !next.failed);
        el('stop').disabled = stopping || applying;
        el('reset').hidden = !draft || running || Boolean(next?.sent && !next.failed);
        el('reset').disabled = locked;
        el('apply').hidden = !Object.keys(draft?.results || {}).length;
        const accepted = selected(), rows = Object.values(draft?.results || {});
        const total = rows.reduce((sum, r) => sum + Number(Boolean(r.description)) + Number(Boolean(r.imageId)), 0);
        const count = accepted.reduce((sum, [,r]) => sum + Number(Boolean(r.description && r.acceptText)) + Number(Boolean(r.imageId && r.acceptIcon)), 0);
        el('toggle-all').hidden = total < 2; el('toggle-all').disabled = locked;
        el('toggle-all').textContent = count === total ? 'Deseleziona tutte le proposte' : 'Seleziona tutte le proposte';
        el('apply').textContent = 'Conferma nella bozza (' + count + ')';
        el('apply').disabled = locked || !accepted.length || Boolean(next?.sent && !next.failed) ||
            accepted.some(([, row]) => row.acceptIcon && !readyImages.has(row.imageId));
        el('close').disabled = applying || stopping;
        for (const input of el('results').querySelectorAll('input')) input.disabled = locked;
    }
    async function request(suffix, body, signal) {
        const url = new URL(window.CriptaApp.urls.api('api/skill-trees/generate-node' + suffix));
        url.searchParams.set('tree', treeKey); url.searchParams.set('campaign', campaignId);
        const timeout = AbortSignal.timeout(30000);
        const response = await fetch(url, {method: body ? 'POST' : 'GET', cache: 'no-store', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
            headers: {Authorization: 'Bearer ' + token, ...(body && {'Content-Type': 'application/json'})},
            ...(body && {body: JSON.stringify(body)})});
        if (!response.ok) throw Object.assign(new Error((await response.json().catch(() => ({}))).error || 'Generatore non disponibile.'), {status: response.status});
        return response;
    }
    function preview(id) {
        if (!previews.has(id)) previews.set(id, request('/' + id + '/preview').then(r => r.blob()).then(blob => {
            if (closed) throw new Error('Finestra chiusa.');
            const url = URL.createObjectURL(blob); urls.add(url); return {blob, url};
        }).catch(error => { previews.delete(id); throw error; }));
        return previews.get(id);
    }
    function element(tag, text) { const item = document.createElement(tag); if (text) item.textContent = text; return item; }
    function toggle(row, field, labelText) {
        const label = element('label'), input = element('input'); label.className = 'skill-node-ai__avatar';
        input.type = 'checkbox'; input.checked = row[field]; input.onchange = () => { row[field] = input.checked; persist(); controls(); };
        label.append(input, labelText); return label;
    }
    function renderResults() {
        const list = el('results'); list.replaceChildren();
        for (const entry of entries) {
            const row = draft?.results[entry.key];
            if (!row || (!row.description && !row.imageId)) continue;
            const card = element('section'); card.className = 'skill-tree-review__row'; card.append(element('h4', entry.label));
            if (row.description) {
                card.append(toggle(row, 'acceptText', entry.template ? 'Applica testo condiviso dei gradi' : 'Applica testo'));
                const comparison = element('div'); comparison.className = 'skill-node-ai__preview';
                for (const [title, content] of [['Attuale', entry.original], ['Proposta', row.description]]) {
                    const part = element('div'); part.append(element('strong', title), element('p', content)); comparison.append(part);
                }
                card.append(comparison);
                if (entry.template) for (const field of entry.template.variables) card.append(element('small', field.marker + ' ' + field.label + ' · ' + field.values.join(' / ')));
            }
            if (row.imageId) {
                card.append(toggle(row, 'acceptIcon', 'Applica icona'));
                const images = element('div'); images.className = 'skill-node-ai__preview';
                for (const proposed of [false, true]) {
                    const part = element('div'), img = element('img'); img.alt = (proposed ? 'Icona proposta' : 'Icona attuale') + ' · ' + entry.name;
                    part.append(element('strong', proposed ? 'Proposta' : 'Attuale'));
                    if (proposed) {
                        part.append(img);
                        const retry = element('button', 'Ricarica anteprima'); retry.type = 'button'; retry.className = 'player-skill-action-button'; retry.hidden = true;
                        const failed = () => { if (closed || !img.isConnected) return; readyImages.delete(row.imageId); retry.hidden = false; controls(); };
                        img.onload = () => { if (!closed && img.isConnected && !readyImages.has(row.imageId)) { readyImages.add(row.imageId); controls(); } };
                        img.onerror = failed;
                        const show = () => { preview(row.imageId).then(({url}) => { img.src = url; }).catch(failed); };
                        retry.onclick = () => {
                            previews.delete(row.imageId); retry.hidden = true; show();
                        };
                        part.append(retry); show();
                    } else if (entry.icon) { img.src = resolveIcon(entry.icon); part.append(img); }
                    else part.append(element('small', 'Nessuna icona'));
                    images.append(part);
                }
                card.append(images);
            }
            list.append(card);
        }
        controls();
    }
    function bodyFor(step) {
        if (step.kind === 'review') {
            const previousMotifs = Object.entries(draft.results).filter(([,r]) => r.visual).map(([key, r]) => ({key, visual: r.visual}));
            return {mode: draft.references?.length ? 'tree-review-references' : 'tree-review', requestId: step.id, tree, targets: step.targets, previousMotifs, visualStyle: draft.visualStyle || '', direction: draft.direction,
                ...(draft.references?.length && {referenceNotes: draft.references.map(ref => ref.note)})};
        }
        const entry = byKey.get(step.key), result = draft.results[step.key];
        return {mode: draft.references?.length ? 'icon-references' : 'icon', requestId: step.id, name: entry.name, description: entry.description, direction: result.visual, treeStyle: draft.visualStyle,
            ...(draft.references?.length && {references: draft.references.map(({uploadId,note}) => ({uploadId,note}))}),
            ...(draft.useAvatar && avatar ? {avatar} : {})};
    }
    function complete(step, job) {
        if (job?.id !== step.id) throw new Error('Risposta associata a una generazione diversa.');
        if (job.status !== 'ready' || job.error || job.iconError) {
            step.failed = true; persist();
            throw new Error(job.error || job.iconError || 'Generazione incompleta. Le proposte pronte sono disponibili.');
        }
        if (step.kind === 'review') {
            const proposals = job.draft?.proposals;
            if (!Array.isArray(proposals) || step.targets.some(t => !proposals.some(p => p.key === t.key))) throw new Error('Revisione incompleta.');
            if (job.draft.visualStyle) draft.visualStyle = job.draft.visualStyle;
            for (const row of proposals) {
                const current = byKey.get(row.key);
                const description = row.description !== current.original ? row.description : '';
                draft.results[row.key] = {description, visual: row.visual, acceptText: Boolean(description)};
            }
        } else {
            if (!job.iconId) throw new Error('Anteprima dell’icona mancante.');
            Object.assign(draft.results[step.key], {imageId: job.id, acceptIcon: true});
        }
        step.done = true; persist(); renderResults();
    }
    async function generate(signal) {
        for (const [index, step] of draft.steps.entries()) {
            if (step.done) continue;
            signal.throwIfAborted();
            status('Passaggio ' + (index + 1) + ' di ' + draft.steps.length + ' · ' + (step.kind === 'review' ? 'Revisione dell’albero' : 'Icona di ' + byKey.get(step.key).label));
            let job;
            if (step.sent) {
                try { ({job} = await (await request('/' + step.id, undefined, signal)).json()); }
                catch (error) { if (error.status !== 404) throw error; }
            }
            if (!job) {
                signal.throwIfAborted();
                step.sent = true; persist(); controls();
                try { ({job} = await (await request('', bodyFor(step))).json()); }
                catch (error) {
                    if ([400, 401, 403, 405, 409, 413, 503].includes(error.status)) { step.sent = false; persist(); }
                    throw error;
                }
            }
            while (['pending','running','icon-pending','icon-running'].includes(job?.status)) {
                await pollDelay(signal);
                ({job} = await (await request('/' + step.id, undefined, signal)).json());
            }
            signal.throwIfAborted(); complete(step, job);
        }
        status(selected().length ? 'Controlla le proposte e conferma quelle da applicare alla bozza.' : 'Revisione completata. Nessuna modifica da applicare.');
    }
    el('run').onclick = async () => {
        if (running || stopping || applying || uploadingReferences) return;
        if (!draft) {
            const texts = el('texts').checked, icons = el('icons').checked;
            draft = {signature, texts, icons, direction: el('direction').value.trim(), useAvatar: Boolean(avatar && el('avatar').checked),
                references: icons ? referencePicker.values() : [],
                steps: treeReviewSteps(entries, texts, icons).map(step => ({...step, id: crypto.randomUUID()})), results: {}};
        }
        const next = draft.steps.find(step => !step.done);
        if (next?.failed) { next.id = crypto.randomUUID(); next.failed = false; next.sent = false; }
        persist(); running = true; polling = new AbortController(); controls();
        runPromise = generate(polling.signal);
        try { await runPromise; }
        catch (error) { if (!closed && !stopping) status(error.message); }
        finally { running = false; if (!closed) controls(); }
    };
    el('stop').onclick = async () => {
        if (stopping || applying) return;
        stopping = true; polling?.abort(); controls(); status('Interruzione in corso.');
        try {
            await runPromise?.catch(() => {});
            const step = draft.steps.find(s => !s.done);
            if (step?.sent && !step.failed) {
                try {
                    const {job} = await (await request('/' + step.id + '/stop', {})).json();
                    if (job.status === 'ready' && !job.iconError && !job.error) complete(step, job);
                    else step.failed = true;
                } catch (error) { if (error.status !== 404) throw error; step.sent = false; }
            }
            persist(); status('Attesa interrotta. Puoi confermare le proposte pronte o riprendere la revisione.');
        } catch (error) { status(error.message); }
        finally { stopping = false; controls(); }
    };
    el('apply').onclick = async () => {
        if (el('apply').disabled) return;
        applying = true; controls();
        try {
            const changes = await Promise.all(selected().map(async ([key, row]) => ({key, text: row.acceptText ? row.description : '',
                ...(row.acceptIcon ? {imageId: row.imageId, image: (await preview(row.imageId)).blob} : {})})));
            await apply(changes);
            draft = null; persist(); dialog.close();
        } catch (error) { status(error.message); }
        finally { applying = false; if (!closed) controls(); }
    };
    el('reset').onclick = () => {
        if (!window.confirm('Scartare queste proposte e iniziare una nuova revisione?')) return;
        draft = null; persist(); renderResults(); status('');
    };
    el('toggle-all').onclick = () => {
        const rows = Object.values(draft.results);
        const accept = rows.some(r => (r.description && !r.acceptText) || (r.imageId && !r.acceptIcon));
        for (const row of rows) { row.acceptText = Boolean(row.description) && accept; row.acceptIcon = Boolean(row.imageId) && accept; }
        persist(); renderResults();
    };
    for (const field of ['texts','icons']) el(field).onchange = controls;
    el('close').onclick = () => dialog.close();
    dialog.oncancel = e => { if (applying || stopping) e.preventDefault(); };
    dialog.addEventListener('close', () => { closed = true; polling?.abort(); referencePicker.close(); urls.forEach(url => URL.revokeObjectURL(url)); dialog.remove(); }, {once: true});
    document.body.append(dialog); dialog.showModal(); renderResults();
    status(draft ? 'Revisione recuperata. Puoi controllare le proposte già pronte.' : 'L’AI leggerà tutti i nodi e i loro legami. Le modifiche confermate entrano nella bozza dell’editor.');
}

function pollDelay(signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const stop = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, 1600);
        signal.addEventListener('abort', stop, {once: true});
    });
}
