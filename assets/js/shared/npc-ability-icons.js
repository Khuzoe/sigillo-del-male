(function () {
    'use strict';
    window.CriptaAbilityIcons = {open};
    const referencePickerUrl = new URL('icon-reference-picker.mjs?v=20261120-icon-refs', document.currentScript.src).href;
    function selectableAbilityIconIds(data) {
        return (data?.items || []).filter(item => !item.blocked && !['icon-pending', 'icon-running', 'confirming'].includes(data.jobs?.find(job => job.itemId === item.id)?.status)).map(item => item.id);
    }
    const abilityIconType = (item, actor) => item.type || actor?.definition?.items?.find(entry => entry.itemId === item.id)?.type || 'feat';
    function visibleAbilityIconItems(data, selected, {type = 'all', onlySelected = false} = {}, actor) {
        return (data?.items || []).filter(item => (type === 'all' || (abilityIconType(item, actor) === 'spell' ? type === 'spells' : type === 'abilities')) && (!onlySelected || selected.has(item.id)));
    }
    function restoreIconDirections(directions, jobs) {
        for (const job of jobs) {
            if (job.status === 'accepted') {
                // An explicit new draft can be written while this is still the latest job.
                if (directions.get(job.itemId)?.afterAcceptedJob !== job.id) directions.delete(job.itemId);
            } else if (!directions.has(job.itemId) && typeof job.details === 'string') {
                directions.set(job.itemId, {text: job.details});
            }
        }
    }
    async function open({actor, token, onQueued}) {
        if (document.querySelector('[data-ability-icons]')) return;
        const app = window.CriptaApp, focus = document.activeElement;
        const base = `api/managed-actors/${encodeURIComponent(actor.worldId)}/${encodeURIComponent(actor.actorId)}/ability-icons`;
        const storageKey = `ability-icons:${app.campaigns.currentId()}:${actor.worldId}:${actor.actorId}`;
        let attempts = {}; try { attempts = JSON.parse(sessionStorage.getItem(storageKey)) || {}; } catch (_) { /* Optional storage. */ }
        const saveAttempts = () => { try { sessionStorage.setItem(storageKey, JSON.stringify(attempts)); } catch (_) { /* Optional storage. */ } };
        let data = null, closed = false, busy = false, batch = null, timer, renderRevision = 0;
        let referencePicker, uploadingReferences = false;
        const filters = {type: 'all', onlySelected: false}, selected = new Set(), previews = new Map(), previewLoads = new Map(), controller = new AbortController();
        const directions = new Map();
        try {
            const view = JSON.parse(sessionStorage.getItem(`${storageKey}:view`));
            if (['all', 'abilities', 'spells'].includes(view?.type)) filters.type = view.type;
            filters.onlySelected = view?.onlySelected === true;
            for (const id of Array.isArray(view?.selected) ? view.selected : []) if (typeof id === 'string') selected.add(id);
            for (const [id, value] of Object.entries(view?.directions || {})) {
                const draft = typeof value === 'string' ? {text: value} : value;
                if (typeof draft?.text === 'string') directions.set(id, {text: draft.text.slice(0, 1500), afterAcceptedJob: draft.afterAcceptedJob});
            }
            // Keep an older shared draft on the icons it was selected for.
            if (typeof view?.direction === 'string') for (const id of selected) if (!directions.has(id)) directions.set(id, {text: view.direction.slice(0, 1500)});
        } catch (_) { /* Optional storage. */ }
        const saveView = () => { try { sessionStorage.setItem(`${storageKey}:view`, JSON.stringify({...filters, selected: [...selected], directions: Object.fromEntries(directions)})); } catch (_) { /* Optional storage. */ } };
        const dialog = document.createElement('dialog');
        dialog.className = 'npc-avatar-generator npc-ability-icons'; dialog.dataset.abilityIcons = '';
        dialog.setAttribute('aria-labelledby', 'npc-ability-icons-title');
        dialog.innerHTML = `<header><div><small>ICONE DELLE CAPACITÀ</small><h2 id="npc-ability-icons-title">Genera icone abilità</h2></div><button type="button" data-close aria-label="Chiudi">×</button></header>
            <div class="npc-avatar-generator__body"><p data-name></p><p>Sunburst 2.6 · qualità media. L’avatar salvato è il riferimento; nome e descrizione di ciascuna capacità guidano l’immagine.</p>
            <p data-status class="npc-avatar-generator__status" role="status" aria-live="polite">Caricamento…</p>
            <div class="npc-ability-icons__selection" role="group" aria-label="Selezione abilità"><span data-selection-status role="status" aria-live="polite"></span><div><button type="button" data-select-all disabled>Seleziona tutto</button><button type="button" data-select-none disabled>Deseleziona tutto</button></div></div>
            <div data-icon-references hidden></div><div data-list class="npc-ability-icons__list"></div></div>
            <footer><span>Una chiamata immagini per capacità selezionata. Le icone cambiano solo premendo «Usa icona». Chiudere conserva le anteprime; le generazioni successive non ancora avviate si fermano.</span><div><button type="button" data-refresh>Aggiorna</button><button type="button" data-stop hidden>Interrompi attesa</button><button type="button" data-generate disabled>Genera selezionate</button></div></footer>`;
        document.body.append(dialog);
        const el = selector => dialog.querySelector(selector);
        const extras = document.createElement('div'); extras.className = 'npc-ability-icons__options';
        extras.innerHTML = `
            <div class="npc-ability-icons__filters"><div role="group" aria-label="Tipo di abilità"><button type="button" data-type="all" aria-pressed="true">Tutte</button><button type="button" data-type="abilities" aria-pressed="false">Capacità</button><button type="button" data-type="spells" aria-pressed="false">Incantesimi</button></div><label><input type="checkbox" data-only-selected>Solo selezionati</label></div>`;
        el('[data-status]').before(extras);
        el('[data-name]').textContent = actor.name || 'NPC';
        const status = (text, error = false) => { el('[data-status]').textContent = text; el('[data-status]').classList.toggle('is-error', error); };
        const request = async (suffix = '', body, itemId) => {
            const url = new URL(app.urls.api(base + suffix)); if (itemId) url.searchParams.set('item', itemId);
            const timeout = AbortSignal.timeout(20000);
            const response = await fetch(url, {method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
                signal: body && (!suffix || suffix.endsWith('/stop')) ? timeout : AbortSignal.any([controller.signal, timeout]),
                headers: {Authorization: `Bearer ${token}`, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
                ...(body === undefined ? {} : {body: JSON.stringify(body)})});
            if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || 'Impossibile contattare il generatore.'); }
            return response;
        };
        const running = job => ['icon-pending', 'icon-running'].includes(job?.status);
        const jobFor = id => data?.jobs?.find(job => job.itemId === id);
        const visibleItems = () => visibleAbilityIconItems(data, selected, filters, actor);
        const selectedAvailableIds = () => selectableAbilityIconIds(data).filter(id => selected.has(id));
        const controls = () => {
            const active = data?.jobs?.find(running);
            referencePicker?.setLocked(busy || Boolean(active) || data?.optionalIconReferences !== 1);
            const visibleIds = new Set(visibleItems().map(item => item.id));
            const eligible = selectableAbilityIconIds(data).filter(id => visibleIds.has(id));
            el('[data-select-all]').disabled = busy || !eligible.length || eligible.every(id => selected.has(id));
            el('[data-select-none]').disabled = busy || !selected.size;
            el('[data-generate]').textContent = `Genera selezionate (${selectedAvailableIds().length})`;
            el('[data-generate]').disabled = busy || uploadingReferences || !data?.enabled || !data?.canSync || !data?.hasAvatar || !!active || !selectedAvailableIds().length;
            el('[data-refresh]').disabled = busy;
            el('[data-stop]').hidden = !batch && !active;
            el('[data-stop]').disabled = batch ? batch.stopped : busy;
            el('[data-select-all]').textContent = 'Seleziona visibili';
            el('[data-selection-status]').textContent = `${selected.size} selezionate · ${visibleItems().length}/${data?.items.length || 0} visibili`;
            for (const input of dialog.querySelectorAll('[data-direction]')) input.disabled = busy || running(jobFor(input.dataset.direction)) || jobFor(input.dataset.direction)?.status === 'confirming';
            el('[data-only-selected]').checked = filters.onlySelected;
            for (const option of dialog.querySelectorAll('[data-type]')) {
                option.setAttribute('aria-pressed', String(option.dataset.type === filters.type));
                const count = visibleAbilityIconItems(data, selected, {type: option.dataset.type}, actor).length;
                option.textContent = `${{all: 'Tutte', abilities: 'Capacità', spells: 'Incantesimi'}[option.dataset.type]} (${count})`;
            }
        };
        function button(label, action, disabled = false) {
            const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.disabled = disabled; b.addEventListener('click', action); return b;
        }
        async function preview(job) {
            const key = `${job.id}:${job.iconId}`;
            if (previews.has(key)) return previews.get(key);
            if (!previewLoads.has(key)) previewLoads.set(key, (async () => {
                try {
                    const blob = await (await request(`/${job.id}/preview`, undefined, job.itemId)).blob();
                    if (closed) return '';
                    const url = URL.createObjectURL(blob); previews.set(key, url); return url;
                } finally { previewLoads.delete(key); }
            })());
            return previewLoads.get(key);
        }
        function render() {
            if (!data || closed) return;
            const revision = ++renderRevision;
            const list = el('[data-list]'); list.replaceChildren();
            const eligible = new Set(selectableAbilityIconIds(data));
            // A running job stays selected and visible until the user changes
            // the selection; availability only controls new paid requests.
            for (const id of selected) if (!data.items.some(item => item.id === id)) selected.delete(id);
            saveView();
            for (const item of visibleItems()) {
                const job = jobFor(item.id), row = document.createElement('article'); row.className = 'npc-ability-icons__row';
                row.dataset.iconItem = item.id;
                const label = document.createElement('label'), check = document.createElement('input'), name = document.createElement('strong');
                check.type = 'checkbox'; check.dataset.itemId = item.id; check.checked = selected.has(item.id); check.disabled = busy || !eligible.has(item.id);
                check.setAttribute('aria-label', `Seleziona ${item.name}`); check.addEventListener('change', () => { if (check.checked) selected.add(item.id); else selected.delete(item.id); saveView(); if (filters.onlySelected) render(); else controls(); });
                name.textContent = item.name; label.append(check, name);
                const type = document.createElement('span'); type.className = 'npc-ability-icons__type';
                type.textContent = {spell: 'Incantesimo', weapon: 'Attacco'}[abilityIconType(item, actor)] || 'Capacità';
                const images = document.createElement('div'); images.className = 'npc-ability-icons__images';
                const imageSlot = (caption, alt, url) => {
                    const figure = document.createElement('figure'), text = document.createElement('figcaption'), img = document.createElement('img');
                    text.textContent = caption; img.alt = alt; if (url) img.src = url;
                    figure.append(text, img); images.append(figure); return img;
                };
                if (item.img) imageSlot('Attuale', `Icona attuale di ${item.name}`, app.utils.resolveImageUrl(item.img));
                if (job?.iconId) {
                    const img = imageSlot('Proposta', `Nuova icona di ${item.name}`);
                    preview(job).then(url => { if (!closed && revision === renderRevision) img.src = url; }).catch(error => { if (!closed && revision === renderRevision) status(error.message, true); });
                }
                const message = document.createElement('p'); message.setAttribute('role', 'status');
                const directionField = document.createElement('label'), directionLabel = document.createElement('span'), directionInput = document.createElement('textarea');
                directionField.className = 'npc-ability-icons__direction';
                directionLabel.textContent = 'Indicazioni aggiuntive (facoltative)';
                directionInput.dataset.direction = item.id; directionInput.rows = 3; directionInput.maxLength = 1500;
                directionInput.setAttribute('aria-label', `Indicazioni per ${item.name}`);
                directionInput.placeholder = 'Es. una runa di ghiaccio luminosa, senza mostrare il volto';
                directionInput.value = directions.get(item.id)?.text || '';
                directionInput.disabled = busy || running(job) || job?.status === 'confirming';
                directionInput.addEventListener('input', () => {
                    directions.set(item.id, {text: directionInput.value, afterAcceptedJob: job?.status === 'accepted' ? job.id : undefined});
                    saveView();
                });
                directionField.append(directionLabel, directionInput);
                message.textContent = running(job) ? 'Generazione in corso…' : job?.status === 'accepted' ? 'Icona inviata a Foundry.' : job?.status === 'confirming' ? 'Invio da completare: usa lo stesso pulsante per riprendere.' : item.blocked ? 'Modifiche in attesa di Foundry.' : job?.iconError || job?.error || (job?.iconId ? 'Anteprima pronta.' : 'Nessuna anteprima generata.');
                const actions = document.createElement('div'); actions.className = 'npc-ability-icons__actions';
                const locked = busy || uploadingReferences || !!data.jobs.find(running) || item.blocked || !data.enabled || !data.canSync || !data.hasAvatar;
                actions.append(button(job?.iconId ? 'Rigenera icona' : 'Genera icona', () => generate([item.id]), locked || job?.status === 'confirming'));
                if (job?.iconId && job.status !== 'accepted') actions.append(button(job.status === 'confirming' ? 'Completa invio' : 'Usa icona', () => apply(item.id), busy || running(job) || item.blocked && job.status !== 'confirming'));
                row.append(label, type, images, message, directionField, actions); list.append(row);
            }
            if (!data.items.length) list.textContent = data.canSync ? 'Nessun attacco o capacità disponibile.' : 'Sincronizza la scheda completa da Foundry per generare le icone.';
            if (data.items.length && !visibleItems().length) list.textContent = filters.onlySelected ? 'Nessuna abilità selezionata per questo filtro. Disattiva “Solo selezionati” per scegliere altre abilità.' : 'Nessuna abilità disponibile per questo filtro.';
            controls();
        }
        async function load() {
            const firstLoad = data === null;
            data = await (await request()).json();
            if (!closed && !referencePicker && data.optionalIconReferences === 1 && data.referenceOwner) {
                const {mountIconReferences} = await import(referencePickerUrl);
                if (closed) return;
                if (!referencePicker) {
                    const root = el('[data-icon-references]'); root.hidden = false;
                    referencePicker = mountIconReferences(root, {endpoint: app.urls.api(base + '/concepts'), token,
                        storageKey: JSON.stringify([storageKey, 'references', data.referenceOwner]),
                        onBusy: value => { uploadingReferences = value; render(); }});
                }
            }
            if (!closed) {
                restoreIconDirections(directions, data.jobs);
                if (firstLoad && data.jobs.some(running)) {
                    for (const job of data.jobs.filter(running)) selected.add(job.itemId);
                    filters.onlySelected = true; filters.type = 'all';
                }
                if (el('[data-status]').textContent === 'Caricamento…') status(data.enabled && data.canSync && data.hasAvatar ? 'Seleziona le capacità per cui generare un’icona.' : !data.enabled ? 'Generazione immagini non attiva.' : !data.canSync ? 'Sincronizza la scheda completa da Foundry.' : 'Carica e salva un avatar prima di generare le icone.');
                await render();
            }
        }
        async function refresh() {
            clearTimeout(timer);
            try {
                await load();
                if (!closed && !busy && data.jobs.some(running)) timer = setTimeout(refresh, 5000);
            } catch (error) { if (!closed) { status(error.message, true); timer = setTimeout(refresh, 10000); } }
        }
        async function generate(ids) {
            if (busy || closed || uploadingReferences) return;
            const eligible = new Set(selectableAbilityIconIds(data)); ids = [...new Set(ids)].filter(id => eligible.has(id));
            if (!ids.length) return;
            const detailsByItem = new Map(ids.map(id => [id, (directions.get(id)?.text || '').trim()]));
            const references = (referencePicker?.values() || []).map(({uploadId,note}) => ({uploadId,note}));
            if (references.length && data?.optionalIconReferences !== 1) { status('Aggiorna il Worker per usare i riferimenti visivi.', true); return; }
            if ([...detailsByItem.values()].some(Boolean) && data?.iconDirections !== 1) { status('Aggiorna il Worker per usare le indicazioni aggiuntive. Nessuna generazione avviata.', true); return; }
            for (const id of ids) selected.add(id);
            filters.onlySelected = true; filters.type = 'all'; saveView();
            // Freeze each icon's own direction before the batch starts.
            batch = {stopped: false, wake: null};
            busy = true; clearTimeout(timer); await render();
            let currentJob;
            try {
                for (let index = 0; index < ids.length && !closed && !batch.stopped; index++) {
                    const id = ids[index]; attempts[id] ||= crypto.randomUUID(); saveAttempts();
                    currentJob = {id: attempts[id], itemId: id};
                    status(`Generazione ${index + 1} di ${ids.length}. Puoi chiudere e ritrovare l’anteprima qui.`);
                    const result = await (await request('', {requestId: attempts[id], details: detailsByItem.get(id), ...(references.length && {references})}, id)).json();
                    currentJob = {...result.job, itemId: id};
                    delete attempts[id]; saveAttempts();
                    if (closed || batch.stopped) break;
                    await load();
                    while (!closed && !batch.stopped && running(jobFor(id))) {
                        await new Promise(resolve => {
                            const delay = setTimeout(resolve, 5000);
                            batch.wake = () => { clearTimeout(delay); resolve(); };
                        });
                        batch.wake = null;
                        if (!closed && !batch.stopped) await load();
                    }
                    if (closed || batch.stopped) break;
                    const completed = jobFor(id);
                    if (completed?.id !== result.job.id || !completed?.iconId || completed.iconError) throw new Error(completed?.iconError || 'Generazione interrotta. Le altre icone non sono state avviate.');
                    currentJob = null;
                }
                if (!closed && !batch.stopped) status('Anteprime pronte. Premi «Usa icona» per applicare quelle che preferisci.');
            } catch (error) { if (!closed) status(error.message, true); }
            finally {
                if (batch.stopped && currentJob) await stopIcon(currentJob);
                else if (batch.stopped && !closed) status('Serie interrotta. Le anteprime pronte sono disponibili.');
                batch = null; busy = false;
                if (!closed) { await render(); if (data?.jobs.some(running)) timer = setTimeout(refresh, 5000); }
            }
        }
        async function apply(id) {
            if (busy) return;
            busy = true; clearTimeout(timer); const job = jobFor(id); await render();
            try {
                let icon = '';
                if (job.status !== 'confirming') {
                    const img = new Image(); img.src = await preview(job); await img.decode();
                    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512; canvas.getContext('2d').drawImage(img, 0, 0, 512, 512);
                    const encoded = canvas.toDataURL('image/webp', .9);
                    if (!encoded.startsWith('data:image/webp;base64,')) throw new Error('Questo browser non può salvare l’icona WebP.');
                    icon = encoded.split(',')[1];
                }
                const result = await (await request(`/${job.id}/confirm`, {icon, iconId: job.iconId}, id)).json();
                job.status = 'accepted';
                directions.delete(id);
                saveView();
                render();
                await onQueued?.(result.command); status('Icona inviata. Foundry la applicherà alla prossima sincronizzazione.');
            } catch (error) { if (!closed) status(error.message, true); }
            finally { busy = false; if (!closed) await refresh(); }
        }
        const close = () => { closed = true; batch?.wake?.(); clearTimeout(timer); controller.abort(); referencePicker?.close(); previews.forEach(url => URL.revokeObjectURL(url)); dialog.close(); dialog.remove(); focus?.focus(); };
        el('[data-close]').addEventListener('click', close);
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        el('[data-refresh]').addEventListener('click', refresh);
        const selectAll = value => {
            if (busy) return;
            if (!value) selected.clear();
            else {
                const visibleIds = new Set(visibleItems().map(item => item.id));
                for (const id of selectableAbilityIconIds(data)) if (visibleIds.has(id)) selected.add(id);
            }
            saveView(); render();
        };
        el('[data-select-all]').addEventListener('click', () => selectAll(true));
        el('[data-select-none]').addEventListener('click', () => selectAll(false));
        el('[data-generate]').addEventListener('click', () => generate(selectedAvailableIds()));
        for (const option of dialog.querySelectorAll('[data-type]')) option.addEventListener('click', () => { filters.type = option.dataset.type; saveView(); render(); });
        el('[data-only-selected]').addEventListener('change', () => { filters.onlySelected = el('[data-only-selected]').checked; saveView(); render(); });
        async function stopIcon(job) {
            let stopped;
            try {
                stopped = await (await request(`/${job.id}/stop`, {attemptId: job.iconAttempt || job.id}, job.itemId)).json();
                if (attempts[job.itemId] === job.id) { delete attempts[job.itemId]; saveAttempts(); }
                if (closed) return;
                const index = data.jobs.findIndex(item => item.itemId === job.itemId && item.id === job.id);
                if (index >= 0 && stopped.job) data.jobs[index] = stopped.job;
                await load();
                status('Attesa interrotta. Le anteprime pronte sono disponibili. Una chiamata già avviata potrebbe avere un costo.');
            } catch (error) {
                if (!closed && !stopped) await load().catch(() => {});
                if (!closed) status(error.message, true);
            }
        }
        el('[data-stop]').addEventListener('click', async () => {
            if (batch) {
                batch.stopped = true; batch.wake?.(); controls(); status('Interruzione in corso.');
                return;
            }
            const job = data?.jobs.find(running); if (!job || busy) return;
            busy = true; clearTimeout(timer); controls();
            try { await stopIcon(job); }
            finally { busy = false; if (!closed) { render(); if (data.jobs.some(running)) timer = setTimeout(refresh, 5000); } }
        });
        dialog.showModal(); await refresh();
    }
})();
