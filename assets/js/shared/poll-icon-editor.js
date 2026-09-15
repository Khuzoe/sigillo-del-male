(function () {
    const STATES = [{ id: 'yes', label: 'Sì' }, { id: 'maybe', label: 'Forse' }, { id: 'no', label: 'No' }];
    let activeDialog = null;

    async function open({ campaignId, campaignName, players, token, request, defaultIcon, resolveIcon, onSave }) {
        if (activeDialog?.isConnected) return;
        const escape = window.CriptaApp.utils.escapeHtml;
        const dialog = document.createElement('dialog');
        activeDialog = dialog;
        dialog.className = 'poll-icon-editor';
        dialog.setAttribute('aria-labelledby', 'poll-icon-editor-title');
        dialog.innerHTML = `
            <header class="poll-icon-editor__header">
                <div><p>${escape(campaignName || 'Campagna')}</p><h2 id="poll-icon-editor-title">Personalizza icone</h2></div>
                <button type="button" data-icon-action="close" aria-label="Chiudi personalizzazione icone">×</button>
            </header>
            <p class="poll-icon-editor__intro">Scegli le immagini di Sì, Forse e No per ogni partecipante. Saranno usate anche nei prossimi sondaggi di questa campagna.</p>
            <p class="poll-icon-editor__status" role="status">Caricamento icone…</p>
            <div class="poll-icon-editor__rows"></div>
            <footer class="poll-icon-editor__footer">
                <span>PNG, JPEG o WebP · massimo 5 MB per immagine</span>
                <div><button type="button" data-icon-action="close">Annulla</button><button type="button" data-icon-action="save" disabled>Salva icone</button></div>
            </footer>`;
        const pending = new Map();
        const objectUrls = new Set();
        const status = dialog.querySelector('[role="status"]');
        const saveButton = dialog.querySelector('[data-icon-action="save"]');
        const rows = dialog.querySelector('.poll-icon-editor__rows');
        let settings = null;
        let saving = false;
        let closed = false;
        let dropTarget = null;
        const keyFor = (playerId, state) => `${playerId}:${state}`;
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

        function updateSlot(slot) {
            const { playerId, state } = slot.dataset;
            const change = pending.get(keyFor(playerId, state));
            const saved = settings?.voteIcons?.[playerId]?.[state];
            const preview = change?.preview || (change?.path === null ? defaultIcon(playerId, state) : resolveIcon(saved || '') || defaultIcon(playerId, state));
            slot.querySelector('img').src = preview;
            slot.querySelector('[data-icon-note]').textContent = change ? (change.path === null ? 'Da ripristinare' : 'Da salvare') : (saved ? 'Personalizzata' : 'Predefinita');
            slot.querySelector('[data-icon-action="reset"]').disabled = saving || (!change && !saved);
            saveButton.disabled = saving || !settings || !pending.size;
        }

        function setBusy(value) {
            saving = value;
            if (value) setDropTarget(null);
            dialog.setAttribute('aria-busy', String(value));
            dialog.querySelectorAll('button, input').forEach((element) => { element.disabled = value; });
            rows.querySelectorAll('[data-player-id]').forEach(updateSlot);
            saveButton.textContent = value ? 'Salvataggio…' : 'Salva icone';
        }

        function discardPending(key) {
            const previous = pending.get(key);
            if (previous?.preview) {
                URL.revokeObjectURL(previous.preview);
                objectUrls.delete(previous.preview);
            }
            pending.delete(key);
        }

        function selectImage(slot, files) {
            if (!slot || saving || !settings) return;
            if (files.length > 1) {
                message('Scegli una sola immagine alla volta per questa casella.', true);
                return;
            }
            const file = files[0];
            if (!file) return;
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024 || file.size === 0) {
                message('Scegli un’immagine PNG, JPEG o WebP fino a 5 MB.', true);
                return;
            }
            const key = keyFor(slot.dataset.playerId, slot.dataset.state);
            discardPending(key);
            const preview = URL.createObjectURL(file);
            objectUrls.add(preview);
            pending.set(key, { file, preview });
            updateSlot(slot);
            message('Anteprima aggiornata. Premi Salva icone per applicare le modifiche.');
        }

        function setDropTarget(slot) {
            if (dropTarget === slot) return;
            dropTarget?.classList.remove('is-dragover');
            dropTarget = slot;
            dropTarget?.classList.add('is-dragover');
        }

        function isFileDrag(event) {
            return Array.from(event.dataTransfer?.types || []).includes('Files');
        }

        function getDropSlot(event) {
            const slot = event.target.closest?.('[data-player-id]');
            return settings && !saving && slot && rows.contains(slot) ? slot : null;
        }

        function onFileDrag(event) {
            if (!isFileDrag(event)) return;
            event.preventDefault();
            const slot = getDropSlot(event);
            event.dataTransfer.dropEffect = slot ? 'copy' : 'none';
            setDropTarget(slot);
        }

        function onFileDragLeave(event) {
            if (dropTarget && !dropTarget.contains(event.relatedTarget)) setDropTarget(null);
        }

        function onFileDrop(event) {
            if (!isFileDrag(event)) return;
            // Prevent a file dropped outside a slot from replacing the page in the browser.
            event.preventDefault();
            setDropTarget(null);
            if (saving || !settings) return;
            const slot = getDropSlot(event);
            if (!slot) {
                message('Trascina l’immagine sulla casella di Sì, Forse o No che vuoi cambiare.', true);
                return;
            }
            selectImage(slot, Array.from(event.dataTransfer.files || []));
        }

        dialog.addEventListener('change', (event) => {
            const input = event.target.closest('input[type="file"]');
            if (!input) return;
            const files = Array.from(input.files || []);
            input.value = '';
            selectImage(input.closest('[data-player-id]'), files);
        });

        dialog.addEventListener('click', async (event) => {
            const button = event.target.closest('[data-icon-action]');
            if (!button || saving) return;
            const action = button.dataset.iconAction;
            if (action === 'close') { close(); return; }
            if (!settings) return;
            if (action === 'reset') {
                const slot = button.closest('[data-player-id]');
                const { playerId, state } = slot.dataset;
                const key = keyFor(playerId, state);
                discardPending(key);
                if (settings.voteIcons?.[playerId]?.[state]) pending.set(key, { path: null });
                updateSlot(slot);
                message('Premi Salva icone per confermare il ripristino.');
                return;
            }
            if (action !== 'save' || !pending.size) return;
            setBusy(true);
            try {
                const changes = [];
                for (const [key, entry] of pending) {
                    if (closed) return;
                    const [playerId, state] = key.split(':');
                    if (entry.file && !entry.path) {
                        message(`Caricamento immagine ${changes.length + 1} di ${pending.size}…`);
                        const result = await window.CriptaMedia.uploadImageFile(entry.file, {
                            campaignId, token, folder: 'poll-icons',
                            fileName: `${state}-${crypto.randomUUID()}.webp`, quality: 0.94
                        });
                        entry.path = result.path;
                    }
                    changes.push({ playerId, state, path: entry.path });
                }
                if (closed) return;
                message('Salvataggio delle icone della campagna…');
                const result = await request('POST', { campaignId, version: settings.version, changes });
                if (closed) return;
                onSave(result);
                close();
            } catch (error) {
                if (!closed) message(error?.message || 'Impossibile salvare le icone. Le immagini in anteprima sono ancora disponibili per riprovare.', true);
            } finally {
                if (!closed) setBusy(false);
            }
        });

        try {
            settings = await request('GET');
            if (closed) return;
            if (settings?.campaignId !== campaignId || typeof settings.version !== 'string' || !settings.voteIcons) throw new Error('Impossibile leggere le icone di questa campagna.');
            rows.innerHTML = players.map((player) => {
                const playerId = String(player.id).trim().toLowerCase();
                return `<section class="poll-icon-editor__participant" aria-label="${escape(player.name)}">
                    <h3>${escape(player.name)}</h3><div class="poll-icon-editor__states">${STATES.map(({ id, label }) => `
                        <div class="poll-icon-editor__slot" data-player-id="${escape(playerId)}" data-state="${id}">
                            <span class="poll-icon-editor__state">${label}</span>
                            <img alt="Anteprima ${label} di ${escape(player.name)}" draggable="false">
                            <small data-icon-note></small>
                            <label class="poll-icon-editor__upload">Carica<input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Carica icona ${label} per ${escape(player.name)}"></label>
                            <button type="button" data-icon-action="reset" aria-label="Ripristina icona ${label} per ${escape(player.name)}">Ripristina</button>
                        </div>`).join('')}</div>
                </section>`;
            }).join('');
            rows.querySelectorAll('[data-player-id]').forEach(updateSlot);
            message('Trascina un’immagine su una casella o usa Carica. Le anteprime mostrano il ritaglio finale.');
        } catch (error) {
            settings = null;
            if (!closed) message(error?.message || 'Impossibile caricare le icone. Chiudi il pannello e riprova.', true);
        }
    }

    window.CriptaPollIconEditor = { open };
})();
