(function () {
    const STATES = [{ id: 'yes', label: 'Sì' }, { id: 'maybe', label: 'Forse' }, { id: 'no', label: 'No' }];
    let activeDialog = null;

    async function open({ campaignId, campaignName, players, token, request, defaultIcon, defaultIconFallback, resolveIcon, onSave }) {
        if (activeDialog?.isConnected) return;
        const composer = window.CriptaPollIconComposer;
        const render = composer.createRenderer();
        const escape = window.CriptaApp.utils.escapeHtml;
        const dialog = document.createElement('dialog');
        activeDialog = dialog;
        dialog.className = 'poll-icon-editor';
        dialog.setAttribute('aria-labelledby', 'poll-icon-editor-title');
        dialog.innerHTML = `
            <header class="poll-icon-editor__header"><div><p>${escape(campaignName || 'Campagna')}</p><h2 id="poll-icon-editor-title">Personalizza icone</h2></div><button type="button" data-icon-action="close" aria-label="Chiudi personalizzazione icone">×</button></header>
            <p class="poll-icon-editor__intro">Le nuove basi mantengono sempre leggibile la risposta. Sposta il personaggio nell’anteprima o regola posizione e zoom.</p>
            <p class="poll-icon-editor__status" role="status">Caricamento icone…</p>
            <div class="poll-icon-editor__toolbar" hidden><label>Partecipante<select data-icon-player aria-label="Partecipante da personalizzare"></select></label><button type="button" data-icon-action="prepare">Prepara le 3 icone</button></div>
            <div class="poll-icon-editor__rows"></div>
            <footer class="poll-icon-editor__footer"><span>Originali conservati · PNG, JPEG o WebP fino a 5 MB.<br>Le modifiche vengono applicate con Salva icone.</span><div><button type="button" data-icon-action="close">Annulla</button><button type="button" data-icon-action="save" disabled>Salva icone</button></div></footer>`;
        const drafts = new Map();
        const pending = new Map();
        const objectUrls = new Set();
        const status = dialog.querySelector('[role="status"]');
        const saveButton = dialog.querySelector('[data-icon-action="save"]');
        const rows = dialog.querySelector('.poll-icon-editor__rows');
        const playerSelect = dialog.querySelector('[data-icon-player]');
        let settings = null, saving = false, closed = false, dropTarget = null, drag = null;
        const keyFor = (slot) => `${slot.dataset.playerId}:${slot.dataset.state}`;
        const close = () => dialog.close();
        const onNavigation = () => close();

        dialog.addEventListener('close', () => {
            closed = true;
            objectUrls.forEach((url) => URL.revokeObjectURL(url));
            document.removeEventListener('cripta:spa-ready', onNavigation);
            document.removeEventListener('dragenter', onFileDrag);
            document.removeEventListener('dragover', onFileDrag);
            document.removeEventListener('dragleave', onFileDragLeave);
            document.removeEventListener('drop', onFileDrop);
            dialog.remove();
            if (activeDialog === dialog) activeDialog = null;
        }, { once: true });
        dialog.addEventListener('cancel', (event) => { if (saving) event.preventDefault(); });
        document.addEventListener('cripta:spa-ready', onNavigation);
        document.addEventListener('dragenter', onFileDrag);
        document.addEventListener('dragover', onFileDrag);
        document.addEventListener('dragleave', onFileDragLeave);
        document.addEventListener('drop', onFileDrop);
        document.body.appendChild(dialog);
        dialog.showModal();

        function message(text, isError = false) {
            status.textContent = text;
            status.classList.toggle('is-error', isError);
        }
        function defaultDraft(slot, useSaved = true) {
            const { playerId, state } = slot.dataset;
            const composition = useSaved && settings.compositions?.[playerId]?.[state];
            const sourcePath = composition ? composition.sourcePath : useSaved ? settings.voteIcons?.[playerId]?.[state] || null : null;
            return { ...composer.placement(composition || {}), sourcePath,
                url: sourcePath ? resolveIcon(sourcePath) : defaultIcon(playerId, state),
                fallback: sourcePath ? '' : defaultIconFallback?.(playerId, state) || '' };
        }
        function updateSlot(slot) {
            const key = keyFor(slot), draft = drafts.get(key);
            const preview = slot.querySelector('[data-icon-preview]');
            // Preserve loaded image nodes while moving a slider or dragging.
            if (preview.dataset.source !== draft.url) {
                preview.innerHTML = composer.markup({ state: slot.dataset.state, source: draft.url, fallback: draft.fallback, position: draft });
                preview.dataset.source = draft.url;
            }
            preview.querySelector('.poll-icon-art__source').style.transform = composer.transform(draft);
            slot.querySelectorAll('[data-icon-field]').forEach((input) => { input.value = draft[input.dataset.iconField]; });
            slot.querySelector('[data-icon-note]').textContent = pending.has(key) ? draft.reset ? 'Da ripristinare' : 'Da salvare'
                : settings.compositions?.[slot.dataset.playerId]?.[slot.dataset.state] ? 'Composizione salvata' : 'Anteprima sulla nuova base';
            slot.querySelector('[data-icon-action="reset"]').disabled = saving || (!pending.has(key) && !settings.voteIcons?.[slot.dataset.playerId]?.[slot.dataset.state]);
            saveButton.disabled = saving || !settings || !pending.size;
            if (!saving) saveButton.textContent = pending.size ? `Salva icone (${pending.size})` : 'Salva icone';
        }
        function setBusy(value) {
            saving = value; drag = null;
            if (value) setDropTarget(null);
            dialog.setAttribute('aria-busy', String(value));
            dialog.querySelectorAll('button, input, select').forEach((element) => { element.disabled = value; });
            rows.querySelectorAll('[data-player-id]').forEach(updateSlot);
            if (value) saveButton.textContent = 'Salvataggio…';
        }
        function changed(slot, patch = {}) {
            const key = keyFor(slot), draft = drafts.get(key);
            Object.assign(draft, composer.placement({ ...draft, ...patch }));
            delete draft.path; delete draft.finalFile;
            draft.reset = false;
            pending.set(key, draft);
            updateSlot(slot);
        }
        function selectImage(slot, files) {
            if (!slot || saving || !settings) return;
            if (files.length > 1) { message('Scegli una sola immagine per questa risposta.', true); return; }
            const file = files[0];
            if (!file) return;
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024 || !file.size) {
                message('Scegli un’immagine PNG, JPEG o WebP fino a 5 MB.', true); return;
            }
            const key = keyFor(slot), previous = drafts.get(key);
            if (objectUrls.has(previous.url)) { URL.revokeObjectURL(previous.url); objectUrls.delete(previous.url); }
            const url = URL.createObjectURL(file);
            objectUrls.add(url);
            drafts.set(key, { ...composer.placement(), sourcePath: null, file, url, fallback: '' });
            changed(slot);
            message('Immagine pronta. Regola l’inquadratura, poi salva le icone.');
        }
        function setDropTarget(slot) {
            if (dropTarget === slot) return;
            dropTarget?.classList.remove('is-dragover'); dropTarget = slot; dropTarget?.classList.add('is-dragover');
        }
        function isFileDrag(event) { return Array.from(event.dataTransfer?.types || []).includes('Files'); }
        function getDropSlot(event) {
            const slot = event.target.closest?.('[data-player-id]');
            return settings && !saving && slot && rows.contains(slot) ? slot : null;
        }
        function onFileDrag(event) {
            if (!isFileDrag(event)) return;
            event.preventDefault();
            const slot = getDropSlot(event);
            event.dataTransfer.dropEffect = slot ? 'copy' : 'none'; setDropTarget(slot);
        }
        function onFileDragLeave(event) { if (dropTarget && !dropTarget.contains(event.relatedTarget)) setDropTarget(null); }
        function onFileDrop(event) {
            if (!isFileDrag(event)) return;
            event.preventDefault(); setDropTarget(null);
            if (saving || !settings) return;
            const slot = getDropSlot(event);
            if (!slot) { message('Trascina l’immagine sulla risposta che vuoi cambiare.', true); return; }
            selectImage(slot, Array.from(event.dataTransfer.files || []));
        }
        dialog.addEventListener('input', (event) => {
            const input = event.target.closest('[data-icon-field]');
            if (!input || saving || !settings || input.value === '') return;
            if (input.type === 'number' && !input.validity.valid) return;
            changed(input.closest('[data-player-id]'), { [input.dataset.iconField]: Number(input.value) });
        });
        dialog.addEventListener('change', (event) => {
            if (event.target === playerSelect) {
                rows.querySelectorAll('[data-participant]').forEach((section) => { section.hidden = section.dataset.participant !== playerSelect.value; });
                return;
            }
            const number = event.target.closest('input[type="number"][data-icon-field]');
            if (number && settings && !saving) {
                const slot = number.closest('[data-player-id]');
                if (number.value === '') updateSlot(slot);
                else changed(slot, { [number.dataset.iconField]: Number(number.value) });
                return;
            }
            const input = event.target.closest('input[type="file"]');
            if (!input) return;
            const files = Array.from(input.files || []); input.value = '';
            selectImage(input.closest('[data-player-id]'), files);
        });
        dialog.addEventListener('pointerdown', (event) => {
            const preview = event.target.closest('[data-icon-preview]');
            if (!preview || saving || !settings || event.button !== 0) return;
            const slot = preview.closest('[data-player-id]'), draft = drafts.get(keyFor(slot));
            drag = { slot, id: event.pointerId, startX: event.clientX, startY: event.clientY, x: draft.x, y: draft.y, size: preview.getBoundingClientRect().width };
            preview.setPointerCapture(event.pointerId); event.preventDefault();
        });
        dialog.addEventListener('pointermove', (event) => {
            if (!drag || event.pointerId !== drag.id || saving) return;
            changed(drag.slot, {
                x: Math.round(drag.x + (event.clientX - drag.startX) / (drag.size * composer.PORTRAIT.width / composer.SIZE) * 100),
                y: Math.round(drag.y + (event.clientY - drag.startY) / (drag.size * composer.PORTRAIT.height / composer.SIZE) * 100)
            });
        });
        for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) dialog.addEventListener(event, () => { drag = null; });

        dialog.addEventListener('click', async (event) => {
            const button = event.target.closest('[data-icon-action]');
            if (!button || saving) return;
            const action = button.dataset.iconAction;
            if (action === 'close') { close(); return; }
            if (!settings) return;
            const slot = button.closest('[data-player-id]');
            if (action === 'center') { changed(slot, { x: 0, y: 0, scale: 100 }); return; }
            if (action === 'prepare') {
                rows.querySelectorAll('[data-participant]:not([hidden]) [data-player-id]').forEach((entry) => changed(entry));
                message('Le tre immagini sono pronte. Premi Salva icone per applicarle.'); return;
            }
            if (action === 'reset') {
                const key = keyFor(slot), draft = defaultDraft(slot, false);
                drafts.set(key, draft); pending.delete(key);
                if (settings.voteIcons?.[slot.dataset.playerId]?.[slot.dataset.state]) { draft.reset = true; pending.set(key, draft); }
                updateSlot(slot); message('Premi Salva icone per confermare il ripristino.'); return;
            }
            if (action !== 'save' || !pending.size) return;
            setBusy(true);
            try {
                const changes = [];
                for (const [key, draft] of pending) {
                    if (closed) return;
                    const [playerId, state] = key.split(':');
                    if (draft.reset) { changes.push({ playerId, state, path: null }); continue; }
                    message(`Preparazione immagine ${changes.length + 1} di ${pending.size}…`);
                    if (!draft.finalFile) draft.finalFile = await render({ state, source: draft.url, fallback: draft.fallback, position: draft });
                    if (closed) return;
                    if (draft.file && !draft.sourcePath) {
                        const original = await window.CriptaMedia.uploadImageFile(draft.file, {
                            campaignId, token, folder: 'poll-icons', fileName: `source-${crypto.randomUUID()}.webp`, quality: 0.98
                        });
                        draft.sourcePath = original.path;
                    }
                    if (closed) return;
                    if (!draft.path) {
                        const result = await window.CriptaMedia.uploadImageFile(draft.finalFile, {
                            campaignId, token, folder: 'poll-icons', fileName: `${state}-${crypto.randomUUID()}.webp`, quality: 0.94
                        });
                        draft.path = result.path;
                    }
                    changes.push({ playerId, state, path: draft.path, composition: { version: composer.VERSION, sourcePath: draft.sourcePath, ...composer.placement(draft) } });
                }
                if (closed) return;
                message('Salvataggio delle icone della campagna…');
                const result = await request('POST', { campaignId, version: settings.version, changes });
                if (closed) return;
                onSave(result); close();
            } catch (error) {
                if (!closed) message(error?.message || 'Impossibile salvare. Le modifiche sono ancora disponibili per riprovare.', true);
            } finally { if (!closed) setBusy(false); }
        });

        try {
            settings = await request('GET');
            if (closed) return;
            if (settings?.campaignId !== campaignId || typeof settings.version !== 'string' || !settings.voteIcons) throw new Error('Impossibile leggere le icone di questa campagna.');
            if (settings.compositionVersion !== composer.VERSION) throw new Error('La composizione delle icone non è ancora disponibile. Aggiorna il servizio del sito e riapri il pannello.');
            const participants = [...new Map(players.map((player) => [String(player.id).trim().toLowerCase(), player])).entries()];
            playerSelect.innerHTML = participants.map(([id, player]) => `<option value="${escape(id)}">${escape(player.name)}</option>`).join('');
            rows.innerHTML = participants.map(([playerId, player], index) => `<section class="poll-icon-editor__participant" data-participant="${escape(playerId)}" aria-label="${escape(player.name)}" ${index ? 'hidden' : ''}><div class="poll-icon-editor__states">${STATES.map(({ id, label }) => `
                <div class="poll-icon-editor__slot" data-player-id="${escape(playerId)}" data-state="${id}">
                    <h3>${label}</h3><div class="poll-icon-editor__preview" data-icon-preview role="img" aria-label="Anteprima ${label} di ${escape(player.name)}"></div><small data-icon-note></small>
                    <div class="poll-icon-editor__position">${[['x','Orizzontale (X)',-100,100],['y','Verticale (Y)',-100,100],['scale','Zoom',20,300]].map(([field, name, min, max]) => `<label><span>${name}</span><input type="range" min="${min}" max="${max}" step="1" data-icon-field="${field}" aria-label="${name} ${label} di ${escape(player.name)}"><input type="number" min="${min}" max="${max}" step="1" data-icon-field="${field}" aria-label="${name} preciso ${label} di ${escape(player.name)}"><span>%</span></label>`).join('')}</div>
                    <div class="poll-icon-editor__slot-actions"><label class="poll-icon-editor__upload">Cambia immagine<input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Carica icona ${label} per ${escape(player.name)}"></label><button type="button" data-icon-action="center" aria-label="Centra ${label} di ${escape(player.name)}">Centra</button><button type="button" data-icon-action="reset" aria-label="Ripristina icona ${label} per ${escape(player.name)}">Ripristina</button></div>
                </div>`).join('')}</div></section>`).join('');
            rows.querySelectorAll('[data-player-id]').forEach((slot) => { drafts.set(keyFor(slot), defaultDraft(slot)); updateSlot(slot); });
            dialog.querySelector('.poll-icon-editor__toolbar').hidden = !participants.length;
            message('Immagini pronte. Le regolazioni restano in bozza fino al salvataggio.');
        } catch (error) {
            settings = null;
            if (!closed) message(error?.message || 'Impossibile caricare le icone. Chiudi il pannello e riprova.', true);
        }
    }
    window.CriptaPollIconEditor = { open };
})();
