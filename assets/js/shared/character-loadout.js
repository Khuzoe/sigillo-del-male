(function () {
    let loadoutRuntime = {};
    let currentPlayerSkillTrees = null;
    let currentSkillTreeModule = null;
    let currentTransformationsModule = null;

    function applyLoadoutRuntime(context = {}) {
        loadoutRuntime = context || {};
        currentPlayerSkillTrees = loadoutRuntime.currentPlayerSkillTrees || null;
        currentSkillTreeModule = loadoutRuntime.currentSkillTreeModule || null;
        currentTransformationsModule = loadoutRuntime.currentTransformationsModule || null;
    }

    function normalizeText(value) {
        if (typeof loadoutRuntime.normalizeText === 'function') return loadoutRuntime.normalizeText(value);
        return window.CriptaApp?.utils?.normalizeKey?.(value) || String(value ?? '').trim().toLowerCase();
    }

    async function pickInlineImageFile() {
        if (typeof loadoutRuntime.pickInlineImageFile !== 'function') return null;
        return loadoutRuntime.pickInlineImageFile();
    }

    async function cropAbilityIconFileToWebpBlob(file) {
        if (typeof loadoutRuntime.cropAbilityIconFileToWebpBlob !== 'function') throw new Error('Crop icona non disponibile.');
        return loadoutRuntime.cropAbilityIconFileToWebpBlob(file);
    }

    async function uploadAbilityOverrideFile(blob, identity) {
        if (typeof loadoutRuntime.uploadAbilityOverrideFile !== 'function') throw new Error('Upload icona abilita non disponibile.');
        return loadoutRuntime.uploadAbilityOverrideFile(blob, identity);
    }

    async function uploadItemOverrideFile(blob, identity) {
        if (typeof loadoutRuntime.uploadItemOverrideFile !== 'function') throw new Error('Upload icona oggetto non disponibile.');
        return loadoutRuntime.uploadItemOverrideFile(blob, identity);
    }

    async function saveAbilityOverride(identity, patch) {
        if (typeof loadoutRuntime.saveAbilityOverride !== 'function') throw new Error('Salvataggio abilita non disponibile.');
        return loadoutRuntime.saveAbilityOverride(identity, patch);
    }

    async function saveItemOverride(identity, patch) {
        if (typeof loadoutRuntime.saveItemOverride !== 'function') throw new Error('Salvataggio oggetto non disponibile.');
        return loadoutRuntime.saveItemOverride(identity, patch);
    }

    function getTransferableItemKey(input) {
        return typeof loadoutRuntime.getTransferableItemKey === 'function'
            ? loadoutRuntime.getTransferableItemKey(input)
            : '';
    }

    function collectItemProgressEditorDraft(editor) {
        return typeof loadoutRuntime.collectItemProgressEditorDraft === 'function'
            ? loadoutRuntime.collectItemProgressEditorDraft(editor)
            : null;
    }

    function normalizeInventoryProgressMaterials(materials) {
        return typeof loadoutRuntime.normalizeInventoryProgressMaterials === 'function'
            ? loadoutRuntime.normalizeInventoryProgressMaterials(materials)
            : [];
    }

    async function loadInventoryData() { return loadoutRuntime.loadInventoryData?.() || {}; }
    async function loadWikiItemsData() { return loadoutRuntime.loadWikiItemsData?.() || []; }
    async function loadAbilityOverrides() { return loadoutRuntime.loadAbilityOverrides?.() || []; }
    async function loadItemOverrides() { return loadoutRuntime.loadItemOverrides?.() || []; }
    async function loadMediaOverrides() { return loadoutRuntime.loadMediaOverrides?.() || []; }

    function buildPlayerLoadoutHtml(character, payload, wikiItems, abilityOverrides, itemOverrides) {
        return loadoutRuntime.buildPlayerLoadoutHtml?.(character, payload, wikiItems, abilityOverrides, itemOverrides) || '';
    }

    function initializeLoadoutTabs(cardElement) { loadoutRuntime.initializeLoadoutTabs?.(cardElement); }
    function initializeLoadoutCopyButtons(root) { loadoutRuntime.initializeLoadoutCopyButtons?.(root); }

    function buildCompanionsHtml(character, payload, wikiItems, mediaOverrides, options) {
        return loadoutRuntime.buildCompanionsHtml?.(character, payload, wikiItems, mediaOverrides, options) || '';
    }

    function canEditCurrentPlayerTransformations(character) {
        return Boolean(loadoutRuntime.canEditCurrentPlayerTransformations?.(character));
    }

    function mountCompanionSkillTrees(...args) { loadoutRuntime.mountCompanionSkillTrees?.(...args); }
    function getSkillTreeRuntimeContext() { return loadoutRuntime.getSkillTreeRuntimeContext?.() || {}; }
    function getTransformationRuntimeContext() { return loadoutRuntime.getTransformationRuntimeContext?.() || {}; }
    function hydratePlayerRightOverview(character, payload) { loadoutRuntime.hydratePlayerRightOverview?.(character, payload); }
    function renderPlayerXpSidebarError(message) { loadoutRuntime.renderPlayerXpSidebarError?.(message); }

    function getLoadoutEntryRestoreKey(entry) {
        if (!entry) return '';
        if (entry.dataset.inventoryItemKey) return `inventory:${entry.dataset.inventoryItemKey}`;
        if (entry.dataset.abilityEntryKey) return `ability:${entry.dataset.abilityEntryKey}`;
        const panel = entry.closest('.loadout-panel')?.dataset?.panel || '';
        const title = entry.querySelector('.loadout-entry-title span:last-child')?.textContent?.trim() || '';
        return title ? `${panel}:title:${normalizeText(title)}` : '';
    }

    function captureLoadoutRefreshState(trigger = null) {
        const loadoutCard = document.getElementById('player-loadout-card');
        if (!loadoutCard) return null;
        return {
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            activePanel: loadoutCard.querySelector('.loadout-tab.is-active')?.dataset?.panelTarget || 'inventory',
            openEntryKeys: Array.from(loadoutCard.querySelectorAll('.loadout-entry[open]'))
                .map(getLoadoutEntryRestoreKey)
                .filter(Boolean),
            triggerEntryKey: getLoadoutEntryRestoreKey(trigger?.closest?.('.loadout-entry'))
        };
    }

    function restoreLoadoutRefreshState(state) {
        if (!state) return;
        const loadoutCard = document.getElementById('player-loadout-card');
        if (!loadoutCard) return;

        const activePanel = state.activePanel || 'inventory';
        loadoutCard.querySelector(`.loadout-tab[data-panel-target="${CSS.escape(activePanel)}"]`)?.click();

        const keysToOpen = new Set([...(state.openEntryKeys || []), state.triggerEntryKey].filter(Boolean));
        if (keysToOpen.size) {
            loadoutCard.querySelectorAll('.loadout-entry').forEach((entry) => {
                if (keysToOpen.has(getLoadoutEntryRestoreKey(entry))) entry.setAttribute('open', '');
            });
        }

        window.requestAnimationFrame(() => {
            window.scrollTo({ left: state.scrollX || 0, top: state.scrollY || 0, behavior: 'auto' });
        });
    }

    async function hydratePlayerLoadoutPreservingState(character, trigger = null) {
        const state = captureLoadoutRefreshState(trigger);
        await hydratePlayerLoadout(character);
        restoreLoadoutRefreshState(state);
    }

    function initializeAbilityOverrideUploads(cardElement, character) {
        const getIdentityFromButton = (button) => ({
            key: button.dataset.abilityKey || '',
            characterId: button.dataset.characterId || '',
            characterName: button.dataset.characterName || '',
            actorId: button.dataset.actorId || '',
            actorName: button.dataset.actorName || '',
            abilityId: button.dataset.abilityId || '',
            abilityName: button.dataset.abilityName || ''
        });

        const iconButtons = Array.from(cardElement.querySelectorAll('[data-ability-icon-upload]'));
        iconButtons.forEach((button) => {
            button.addEventListener('click', async () => {
                const identity = getIdentityFromButton(button);
                if (!identity.key) return;

                const file = await pickInlineImageFile();
                if (!file) return;
                let iconBlob = null;
                try {
                    iconBlob = await cropAbilityIconFileToWebpBlob(file);
                } catch (error) {
                    console.error('Preparazione icona abilita fallita:', error);
                    alert(`Preparazione icona fallita: ${error?.message || error}`);
                    return;
                }
                if (!iconBlob) return;

                button.disabled = true;
                button.setAttribute('aria-busy', 'true');
                try {
                    const imagePath = await uploadAbilityOverrideFile(iconBlob, identity);
                    if (!imagePath) return;
                    await saveAbilityOverride(identity, { image: imagePath });
                    await hydratePlayerLoadoutPreservingState(character, button);
                } catch (error) {
                    console.error('Salvataggio icona abilità fallito:', error);
                    alert(`Salvataggio icona abilità fallito: ${error?.message || error}`);
                } finally {
                    button.disabled = false;
                    button.removeAttribute('aria-busy');
                }
            });
        });

        const descriptionButtons = Array.from(cardElement.querySelectorAll('[data-ability-description-edit]'));
        descriptionButtons.forEach((button) => {
            button.addEventListener('click', async () => {
                const identity = getIdentityFromButton(button);
                if (!identity.key) return;

                const currentText = button
                    .closest('.loadout-entry')
                    ?.querySelector('.loadout-entry-description')
                    ?.innerText
                    ?.trim() || '';
                const nextDescription = window.prompt(`Descrizione per ${identity.abilityName || 'abilità'}`, currentText);
                if (nextDescription === null) return;

                button.disabled = true;
                button.setAttribute('aria-busy', 'true');
                try {
                    await saveAbilityOverride(identity, { description: nextDescription.trim() });
                    await hydratePlayerLoadoutPreservingState(character, button);
                } catch (error) {
                    console.error('Salvataggio testo abilità fallito:', error);
                    alert(`Salvataggio testo abilità fallito: ${error?.message || error}`);
                } finally {
                    button.disabled = false;
                    button.removeAttribute('aria-busy');
                }
            });
        });
    }

    function initializeItemOverrideUploads(cardElement, character) {
        const getIdentityFromButton = (button) => {
            const identity = {
                key: button.dataset.itemKey || '',
                characterId: button.dataset.characterId || '',
                characterName: button.dataset.characterName || '',
                actorId: button.dataset.actorId || '',
                actorName: button.dataset.actorName || '',
                itemUuid: button.dataset.itemUuid || '',
                transferId: button.dataset.transferId || '',
                sourceId: button.dataset.sourceId || '',
                transferKey: button.dataset.transferKey || '',
                itemId: button.dataset.itemId || '',
                itemName: button.dataset.itemName || '',
                itemType: button.dataset.itemType || ''
            };
            identity.transferKey = getTransferableItemKey({ ...identity, existingTransferKey: identity.transferKey });
            return identity;
        };

        const iconButtons = Array.from(cardElement.querySelectorAll('[data-item-icon-upload]'));
        iconButtons.forEach((button) => {
            button.addEventListener('click', async () => {
                const identity = getIdentityFromButton(button);
                if (!identity.key) return;

                const file = await pickInlineImageFile();
                if (!file) return;
                let iconBlob = null;
                try {
                    iconBlob = await cropAbilityIconFileToWebpBlob(file);
                } catch (error) {
                    console.error('Preparazione icona inventario fallita:', error);
                    alert(`Preparazione icona fallita: ${error?.message || error}`);
                    return;
                }
                if (!iconBlob) return;

                button.disabled = true;
                button.setAttribute('aria-busy', 'true');
                try {
                    const imagePath = await uploadItemOverrideFile(iconBlob, identity);
                    if (!imagePath) return;
                    await saveItemOverride(identity, { image: imagePath, imageSource: 'site' });
                    await hydratePlayerLoadout(character);
                } catch (error) {
                    console.error('Salvataggio icona inventario fallito:', error);
                    alert(`Salvataggio icona inventario fallito: ${error?.message || error}`);
                } finally {
                    button.disabled = false;
                    button.removeAttribute('aria-busy');
                }
            });
        });

        const descriptionButtons = Array.from(cardElement.querySelectorAll('[data-item-description-edit]'));
        descriptionButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const identity = getIdentityFromButton(button);
                if (!identity.key) return;

                const entry = button.closest('.loadout-entry');
                const editor = entry?.querySelector('[data-item-description-editor]');
                const textarea = editor?.querySelector('[data-item-description-text]');
                if (!editor || !textarea) return;
                textarea.value = button.dataset.currentDescription || textarea.value || '';
                editor.hidden = false;
                textarea.focus();
                textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            });
        });

        const cancelButtons = Array.from(cardElement.querySelectorAll('[data-item-description-cancel]'));
        cancelButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const editor = button.closest('[data-item-description-editor]');
                const entry = button.closest('.loadout-entry');
                const editButton = entry?.querySelector('[data-item-description-edit]');
                const textarea = editor?.querySelector('[data-item-description-text]');
                if (textarea && editButton) textarea.value = editButton.dataset.currentDescription || '';
                if (editor) editor.hidden = true;
            });
        });

        const saveButtons = Array.from(cardElement.querySelectorAll('[data-item-description-save]'));
        saveButtons.forEach((button) => {
            button.addEventListener('click', async () => {
                const entry = button.closest('.loadout-entry');
                const editButton = entry?.querySelector('[data-item-description-edit]');
                const editor = button.closest('[data-item-description-editor]');
                const textarea = editor?.querySelector('[data-item-description-text]');
                if (!editButton || !textarea) return;
                const identity = getIdentityFromButton(editButton);
                if (!identity.key) return;

                button.disabled = true;
                button.setAttribute('aria-busy', 'true');
                try {
                    await saveItemOverride(identity, { description: textarea.value.trim() });
                    await hydratePlayerLoadout(character);
                } catch (error) {
                    console.error('Salvataggio testo inventario fallito:', error);
                    alert(`Salvataggio testo inventario fallito: ${error?.message || error}`);
                } finally {
                    button.disabled = false;
                    button.removeAttribute('aria-busy');
                }
            });
        });

        const progressButtons = Array.from(cardElement.querySelectorAll('[data-item-progress-edit]'));
        progressButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const identity = getIdentityFromButton(button);
                if (!identity.key) return;
                const editor = button.closest('.loadout-entry')?.querySelector('[data-item-progress-editor]');
                if (!editor) return;
                editor.hidden = false;
                editor.querySelector('[data-item-progress-field="done"]')?.focus();
            });
        });

        const progressCancelButtons = Array.from(cardElement.querySelectorAll('[data-item-progress-cancel]'));
        progressCancelButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const editor = button.closest('[data-item-progress-editor]');
                if (editor) editor.hidden = true;
            });
        });

        const progressSaveButtons = Array.from(cardElement.querySelectorAll('[data-item-progress-save]'));
        progressSaveButtons.forEach((button) => {
            button.addEventListener('click', async () => {
                const entry = button.closest('.loadout-entry');
                const editButton = entry?.querySelector('[data-item-progress-edit]');
                const editor = button.closest('[data-item-progress-editor]');
                if (!editButton || !editor) return;
                const identity = getIdentityFromButton(editButton);
                if (!identity.key) return;
                const progress = collectItemProgressEditorDraft(editor);
                if (!progress) {
                    alert('Imposta almeno un totale maggiore di zero.');
                    return;
                }

                button.disabled = true;
                button.setAttribute('aria-busy', 'true');
                try {
                    await saveItemOverride(identity, { progress });
                    await hydratePlayerLoadout(character);
                } catch (error) {
                    console.error('Salvataggio progresso inventario fallito:', error);
                    alert(`Salvataggio progresso fallito: ${error?.message || error}`);
                } finally {
                    button.disabled = false;
                    button.removeAttribute('aria-busy');
                }
            });
        });

        const progressClearButtons = Array.from(cardElement.querySelectorAll('[data-item-progress-clear]'));
        progressClearButtons.forEach((button) => {
            button.addEventListener('click', async () => {
                const entry = button.closest('.loadout-entry');
                const editButton = entry?.querySelector('[data-item-progress-edit]');
                if (!editButton) return;
                const identity = getIdentityFromButton(editButton);
                if (!identity.key) return;
                if (!window.confirm('Rimuovere il progresso wiki da questo oggetto?')) return;

                button.disabled = true;
                button.setAttribute('aria-busy', 'true');
                try {
                    await saveItemOverride(identity, { progress: null });
                    await hydratePlayerLoadout(character);
                } catch (error) {
                    console.error('Rimozione progresso inventario fallita:', error);
                    alert(`Rimozione progresso fallita: ${error?.message || error}`);
                } finally {
                    button.disabled = false;
                    button.removeAttribute('aria-busy');
                }
            });
        });

        const progressJumpButtons = Array.from(cardElement.querySelectorAll('[data-progress-jump-key]'));
        progressJumpButtons.forEach((button) => {
            button.addEventListener('click', () => {
                jumpToInventoryProgressItem(cardElement, button.dataset.progressJumpKey || '');
            });
        });

        const progressIncrementForms = Array.from(cardElement.querySelectorAll('[data-progress-increment-form]'));
        progressIncrementForms.forEach((form) => {
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                const submitButton = form.querySelector('[data-progress-increment-submit]');
                const input = form.querySelector('[data-progress-increment-value]');
                const delta = Number(input?.value || 0);
                if (!submitButton || !Number.isFinite(delta) || delta <= 0) {
                    alert('Inserisci un valore positivo da aggiungere.');
                    return;
                }
                const identity = getIdentityFromButton(submitButton);
                if (!identity.key) return;
                const progress = parseProgressIncrementDraft(form);
                if (!progress) return;
                progress.done = Math.max(0, Number(progress.done || 0) + delta);

                submitButton.disabled = true;
                submitButton.setAttribute('aria-busy', 'true');
                try {
                    await saveItemOverride(identity, { progress });
                    await hydratePlayerLoadout(character);
                } catch (error) {
                    console.error('Incremento progresso inventario fallito:', error);
                    alert(`Incremento progresso fallito: ${error?.message || error}`);
                } finally {
                    submitButton.disabled = false;
                    submitButton.removeAttribute('aria-busy');
                }
            });
        });
    }

    function parseProgressIncrementDraft(form) {
        try {
            const progress = JSON.parse(form?.dataset?.progressJson || '{}');
            if (!progress || typeof progress !== 'object') return null;
            const total = Number(progress.total || 0);
            if (!Number.isFinite(total) || total <= 0) return null;
            return {
                label: String(progress.label || 'Progresso').trim() || 'Progresso',
                done: Number.isFinite(Number(progress.done)) ? Math.max(0, Number(progress.done)) : 0,
                total: Math.max(1, total),
                unit: String(progress.unit || '').trim(),
                crafting: Boolean(progress.crafting || (Array.isArray(progress.materials) && progress.materials.length)),
                materials: normalizeInventoryProgressMaterials(progress.materials)
            };
        } catch (_) {
            return null;
        }
    }

    function jumpToInventoryProgressItem(cardElement, key) {
        const safeKey = String(key || '').trim();
        if (!safeKey || !cardElement) return;
        cardElement.querySelector('[data-panel-target="inventory"]')?.click();
        const target = cardElement.querySelector(`.loadout-entry[data-inventory-item-key="${CSS.escape(safeKey)}"]`);
        if (!target) return;
        target.closest('[data-inventory-group]')?.setAttribute('open', '');
        target.setAttribute('open', '');
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('is-jump-highlight');
        window.setTimeout(() => target.classList.remove('is-jump-highlight'), 1400);
    }

    async function hydratePlayerLoadout(character) {
        const loadoutCard = document.getElementById('player-loadout-card');
        const companionsCard = document.getElementById('player-companions-card');
        if (!loadoutCard) return;

        try {
            const [inventoryPayload, wikiItems, abilityOverrides, itemOverrides, mediaOverrides] = await Promise.all([
                loadInventoryData(),
                loadWikiItemsData().catch((error) => {
                    console.warn('Impossibile caricare items.json per collegare gli oggetti:', error);
                    return [];
                }),
                loadAbilityOverrides(),
                loadItemOverrides(),
                loadMediaOverrides()
            ]);
            loadoutCard.innerHTML = buildPlayerLoadoutHtml(character, inventoryPayload, wikiItems, abilityOverrides, itemOverrides);
            initializeLoadoutTabs(loadoutCard);
            initializeLoadoutCopyButtons(loadoutCard);
            initializeItemOverrideUploads(loadoutCard, character);
            initializeAbilityOverrideUploads(loadoutCard, character);
            if (companionsCard) {
                const companionsHtml = buildCompanionsHtml(character, inventoryPayload, wikiItems, mediaOverrides, {
                    canEdit: canEditCurrentPlayerTransformations(character)
                });
                companionsCard.hidden = !companionsHtml;
                companionsCard.innerHTML = companionsHtml;
                if (companionsHtml) initializeLoadoutCopyButtons(companionsCard);
                if (companionsHtml) mountCompanionSkillTrees(
                    companionsCard,
                    character,
                    inventoryPayload,
                    mediaOverrides,
                    currentPlayerSkillTrees,
                    currentSkillTreeModule,
                    getSkillTreeRuntimeContext()
                );
                if (companionsHtml) currentTransformationsModule?.mountCompanions(
                    companionsCard,
                    character,
                    inventoryPayload,
                    mediaOverrides,
                    getTransformationRuntimeContext()
                );
            }
            hydratePlayerRightOverview(character, inventoryPayload);
        } catch (error) {
            console.error('Errore nel caricamento inventario API:', error);
            loadoutCard.innerHTML = `
                        <h3><i class="fas fa-box-open"></i> Inventario e Incantesimi</h3>
                        <div class="loadout-state is-error">
                            <i class="fas fa-triangle-exclamation"></i>
                            <span>Impossibile sincronizzare l'inventario dal server.</span>
                        </div>
                    `;
            if (companionsCard) {
                companionsCard.hidden = true;
                companionsCard.innerHTML = '';
            }
            renderPlayerXpSidebarError("Impossibile sincronizzare l'XP dal server.");
        }
    }

    async function hydrate(character, context = {}) {
        applyLoadoutRuntime(context);
        return hydratePlayerLoadout(character);
    }

    async function hydratePreservingState(character, trigger = null, context = {}) {
        applyLoadoutRuntime(context);
        return hydratePlayerLoadoutPreservingState(character, trigger);
    }

    window.CriptaCharacterLoadout = Object.freeze({
        hydrate,
        hydratePreservingState
    });
})();
