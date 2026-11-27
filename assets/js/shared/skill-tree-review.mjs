import {mountIconReferences} from './icon-reference-picker.mjs?v=20261120-icon-refs';
import {skillNodePreviewKey, skillNodePreviewScope} from './skill-node-preview-key.mjs?v=20261125-tree-previews';

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

export async function openSkillTreeReview({tree, entries, treeKey, accountId, campaignId, token, snapshot, avatar, sharedCharacter, resolveIcon, apply}) {
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
        <p data-history-status role="status" hidden></p>
        <button type="button" class="player-skill-action-button" data-history-retry hidden>Ricarica le icone precedenti</button>
        <button type="button" class="player-skill-action-button" data-download>Scarica pacchetto icone</button>
        <small data-download-status role="status" hidden></small>
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
    const iconTargets = new Map(await Promise.all(entries.map(async entry => [entry.key, {
        slot:await skillNodePreviewKey(skillNodePreviewScope({id:entry.nodeId, level:entry.level, mode:'icon'}, sharedCharacter)),
        legacy:await skillNodePreviewKey([entry.name.trim(), entry.description.trim()])
    }])));
    const legacyCounts = new Map();
    for (const {legacy} of iconTargets.values()) legacyCounts.set(legacy, (legacyCounts.get(legacy) || 0) + 1);
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
    const history = new Map(), historyController = new AbortController();
    const showIcons = () => !draft || draft.icons;
    function iconProposal(key) {
        const row = draft?.results[key];
        return row?.imageId ? row : showIcons() ? history.get(key) : null;
    }
    function proposals() {
        return entries.map(({key}) => ({key, text:draft?.results[key], icon:iconProposal(key)}))
            .filter(({text, icon}) => text?.description || icon);
    }
    const selected = () => proposals().map(({key, text, icon}) => ({
        key, text:text?.acceptText ? text.description : '', imageId:icon?.acceptIcon ? icon.imageId : ''
    })).filter(change => change.text || change.imageId);
    let running = false, stopping = false, applying = false, closed = false, uploadingReferences = false, polling, runPromise;
    let loadingHistory = true, downloading = false;
    const latestImageId = key => draft?.results[key]?.imageId || history.get(key)?.imageId;
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
        el('download').disabled = locked || loadingHistory || downloading || !entries.some(entry => entry.icon || latestImageId(entry.key));
        const accepted = selected(), rows = proposals();
        el('apply').hidden = !rows.length;
        const total = rows.reduce((sum, r) => sum + Number(Boolean(r.text?.description)) + Number(Boolean(r.icon)), 0);
        const count = accepted.reduce((sum, r) => sum + Number(Boolean(r.text)) + Number(Boolean(r.imageId)), 0);
        el('toggle-all').hidden = total < 2; el('toggle-all').disabled = locked;
        el('toggle-all').textContent = count === total ? 'Deseleziona tutte le proposte' : 'Seleziona tutte le proposte';
        el('apply').textContent = 'Conferma nella bozza (' + count + ')';
        el('apply').disabled = locked || !accepted.length || Boolean(next?.sent && !next.failed) ||
            accepted.some(row => row.imageId && !readyImages.has(row.imageId));
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
        if (!previews.has(id)) previews.set(id, request('/' + id + '/preview', undefined, historyController.signal).then(r => r.blob()).then(blob => {
            if (closed) throw new Error('Finestra chiusa.');
            const url = URL.createObjectURL(blob); urls.add(url); return {blob, url};
        }).catch(error => { previews.delete(id); throw error; }));
        return previews.get(id);
    }
    async function loadIconHistory() {
        loadingHistory = true; controls();
        const note = el('history-status');
        note.hidden = false; note.textContent = 'Caricamento delle icone già generate…';
        el('history-retry').hidden = true;
        try {
            const targets = [...iconTargets];
            for (let i = 0; i < targets.length; i += 32) {
                const batch = targets.slice(i, i + 32);
                const slots = batch.map(([, {slot, legacy}]) => legacyCounts.get(legacy) === 1 ? slot + '.' + legacy : slot);
                let result;
                do {
                    result = await (await request('?icons=' + slots.join(','), undefined, historyController.signal)).json();
                } while (result.scanning);
                for (const [key, {slot}] of batch) {
                    const image = result.previews[slot];
                    if (image && !history.has(key)) history.set(key, {imageId:image.id, acceptIcon:false});
                }
            }
            note.hidden = true;
        } catch {
            if (closed) return;
            note.textContent = 'Impossibile caricare le anteprime precedenti.';
            el('history-retry').hidden = false;
        }
        loadingHistory = false;
        if (!closed) renderResults();
    }
    el('history-retry').onclick = loadIconHistory;
    el('download').onclick = async () => {
        if (el('download').disabled) return;
        downloading = true; controls();
        const note = el('download-status'), signal = historyController.signal;
        note.hidden = false; note.textContent = 'Preparazione del pacchetto…';
        try {
            const {buildSkillTreeIconPack, iconFileStem} = await import('./skill-tree-icon-pack.mjs?v=20261125-icon-pack');
            const files = [];
            for (const entry of entries) {
                const stem = entry.key + '-' + iconFileStem(entry.label);
                if (entry.icon) files.push({path:'attuali/' + stem, label:entry.label + ' (attuale)', load:async () => {
                    const response = await fetch(resolveIcon(entry.icon), {signal:AbortSignal.any([signal, AbortSignal.timeout(30000)])});
                    if (!response.ok) throw new Error('Icona non disponibile.');
                    return response.blob();
                }});
                const id = latestImageId(entry.key);
                if (id) files.push({path:'proposte-ai/' + stem, label:entry.label + ' (proposta AI)', load:async () => (await preview(id)).blob});
            }
            const {blob, count, skipped} = await buildSkillTreeIconPack(files, signal, label => {
                note.textContent = 'Preparazione del pacchetto · ' + label;
            });
            if (blob) {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob); link.download = 'icone-' + iconFileStem(tree.name || treeKey) + '.zip';
                dialog.append(link); link.click(); link.remove();
                setTimeout(() => URL.revokeObjectURL(link.href), 60000);
            }
            note.textContent = (count ? 'Download avviato · ' + count + (count === 1 ? ' icona.' : ' icone.') : 'Nessuna icona scaricabile.')
                + (skipped.length ? ' Impossibile includere ' + skipped.join(', ') + '.' : '');
        } catch (error) { if (!closed) note.textContent = error.message || 'Impossibile preparare il pacchetto.'; }
        finally { downloading = false; if (!closed) controls(); }
    };
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
            const icon = iconProposal(entry.key);
            if (!showIcons() && !row?.description && !icon) continue;
            const card = element('section'); card.className = 'skill-tree-review__row'; card.append(element('h4', entry.label));
            if (row?.description) {
                card.append(toggle(row, 'acceptText', entry.template ? 'Applica testo condiviso dei gradi' : 'Applica testo'));
                const comparison = element('div'); comparison.className = 'skill-node-ai__preview';
                for (const [title, content] of [['Attuale', entry.original], ['Proposta', row.description]]) {
                    const part = element('div'); part.append(element('strong', title), element('p', content)); comparison.append(part);
                }
                card.append(comparison);
                if (entry.template) for (const field of entry.template.variables) card.append(element('small', field.marker + ' ' + field.label + ' · ' + field.values.join(' / ')));
            }
            if (showIcons() || icon) {
                if (icon) card.append(toggle(icon, 'acceptIcon', 'Applica icona'));
                const images = element('div'); images.className = 'skill-node-ai__preview';
                for (const proposed of icon ? [false, true] : [false]) {
                    const title = proposed ? (icon === row ? 'Icona proposta' : 'Ultima icona generata')
                        : entry.inheritedIcon ? 'Icona del grado base' : 'Icona attuale';
                    const part = element('div'), img = element('img'); img.alt = title + ' · ' + entry.label;
                    part.append(element('strong', title));
                    if (proposed) {
                        part.append(img);
                        const retry = element('button', 'Ricarica anteprima'); retry.type = 'button'; retry.className = 'player-skill-action-button'; retry.hidden = true;
                        const failed = () => { if (closed || !img.isConnected) return; readyImages.delete(icon.imageId); retry.hidden = false; controls(); };
                        img.onload = () => { if (!closed && img.isConnected && !readyImages.has(icon.imageId)) { readyImages.add(icon.imageId); controls(); } };
                        img.onerror = failed;
                        const show = () => { preview(icon.imageId).then(({url}) => { img.src = url; }).catch(failed); };
                        retry.onclick = () => {
                            previews.delete(icon.imageId); retry.hidden = true; show();
                        };
                        part.append(retry); show();
                    } else if (entry.icon || entry.inheritedIcon) { img.loading = 'lazy'; img.src = resolveIcon(entry.icon || entry.inheritedIcon); part.append(img); }
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
            previewSlot:iconTargets.get(step.key).slot,
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
            history.set(step.key, {imageId:job.id, acceptIcon:false});
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
        persist(); running = true; polling = new AbortController(); renderResults();
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
            const changes = await Promise.all(selected().map(async ({key, text, imageId}) => ({key, text,
                ...(imageId ? {imageId, image:(await preview(imageId)).blob} : {})})));
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
        const rows = proposals();
        const accept = rows.some(({text, icon}) => (text?.description && !text.acceptText) || (icon && !icon.acceptIcon));
        for (const {text, icon} of rows) {
            if (text?.description) text.acceptText = accept;
            if (icon) icon.acceptIcon = accept;
        }
        persist(); renderResults();
    };
    for (const field of ['texts','icons']) el(field).onchange = controls;
    el('close').onclick = () => dialog.close();
    dialog.oncancel = e => { if (applying || stopping) e.preventDefault(); };
    dialog.addEventListener('close', () => { closed = true; polling?.abort(); historyController.abort(); referencePicker.close(); urls.forEach(url => URL.revokeObjectURL(url)); dialog.remove(); }, {once: true});
    document.body.append(dialog); dialog.showModal(); renderResults();
    loadIconHistory();
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
