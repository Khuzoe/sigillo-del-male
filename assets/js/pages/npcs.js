function parseYamlLite(yamlText) {
            const text = yamlText.replace(/^\uFEFF/, '');
            const lines = text.split(/\r?\n/);

            const firstNonEmpty = lines.find(l => {
                const t = l.trim();
                return t !== '' && !t.startsWith('#');
            });
            const isArrayRoot = firstNonEmpty ? firstNonEmpty.trim().startsWith('- ') : true;

            const root = isArrayRoot ? [] : {};
            const stack = [{ type: isArrayRoot ? 'array' : 'object', value: root, indent: -1 }];

            const parseScalar = (v) => {
                const val = v.trim();
                if (val === '[]') return [];
                if (val === '{}') return {};
                if (val === 'null') return null;
                if (val === 'true' || val === 'false') return val === 'true';
                if (/^-?\d+(\.\d+)?$/.test(val)) return Number(val);
                if (val.startsWith('"') && val.endsWith('"')) {
                    try { return JSON.parse(val); } catch (_) { return val.slice(1, -1); }
                }
                if (val.startsWith('\'') && val.endsWith('\'')) return val.slice(1, -1);
                if (val.startsWith('- ')) return [parseScalar(val.slice(2))];
                return val;
            };

            const nextNonEmpty = (idx) => {
                for (let i = idx + 1; i < lines.length; i++) {
                    const raw = lines[i];
                    const trimmed = raw.trim();
                    if (trimmed === '' || trimmed.startsWith('#')) continue;
                    const indent = raw.match(/^ */)[0].length;
                    return { indent, trimmed };
                }
                return null;
            };

            lines.forEach((raw, idx) => {
                const trimmed = raw.trim();
                if (trimmed === '' || trimmed.startsWith('#')) return;
                const indent = raw.match(/^ */)[0].length;
                while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
                    stack.pop();
                }
                const parent = stack[stack.length - 1];

                if (trimmed.startsWith('- ')) {
                    if (parent.type !== 'array') throw new Error('YAML: elemento lista fuori contesto');
                    const entryText = trimmed.slice(2).trim();
                    let item;
                    let pushItem = false;

                    if (entryText === '') {
                        item = {};
                        pushItem = true;
                    } else {
                        const m = entryText.match(/^([^:]+):\s*(.*)$/);
                        if (m) {
                            const key = m[1].trim();
                            const valStr = m[2];
                            item = {};
                            if (valStr === '') {
                                const next = nextNonEmpty(idx);
                                const container = next && next.indent > indent && next.trimmed.startsWith('-') ? [] : {};
                                item[key] = container;
                                pushItem = true;
                                stack.push({ type: Array.isArray(container) ? 'array' : 'object', value: container, indent });
                            } else {
                                item[key] = parseScalar(valStr);
                                pushItem = true;
                            }
                        } else {
                            item = parseScalar(entryText);
                        }
                    }
                    parent.value.push(item);
                    if (pushItem && typeof item === 'object' && item !== null && !Array.isArray(item)) {
                        stack.push({ type: 'object', value: item, indent });
                    }
                    return;
                }

                if (parent.type !== 'object') throw new Error('YAML: chiave fuori contesto');
                const match = trimmed.match(/^([^:]+):\s*(.*)$/);
                if (!match) throw new Error('YAML: riga non valida');
                const key = match[1].trim();
                const valStr = match[2];

                if (valStr === '') {
                    const next = nextNonEmpty(idx);
                    const container = next && next.indent > indent && next.trimmed.startsWith('-') ? [] : {};
                    parent.value[key] = container;
                    stack.push({ type: Array.isArray(container) ? 'array' : 'object', value: container, indent });
                } else {
                    const value = parseScalar(valStr);
                    parent.value[key] = value;
                    if (typeof value === 'object' && value !== null) {
                        stack.push({ type: Array.isArray(value) ? 'array' : 'object', value, indent });
                    }
                }
            });

            return root;
        }

        function buildImageStyle(kind, adjust, counterpartAdjust) {
            return window.CriptaCharacterNormalize.buildNpcImageStyle(kind, adjust, counterpartAdjust);
        }

        function getCurrentCampaignId() {
            return window.CriptaApp?.campaigns?.currentId?.() || 'cripta-di-sangue';
        }

        function managedActorDirectoryKind(actor = {}, profile = {}) {
            const actorLink = actor?.actorLink;
            if (typeof actorLink === 'boolean') return actorLink ? 'person' : 'creature';
            const kindSource = String(profile?.kindSource || 'automatic').trim().toLowerCase();
            const profileKind = String(profile?.kind || '').trim().toLowerCase();
            if (kindSource === 'manual') return profileKind === 'creature' ? 'creature' : 'person';
            if (String(actor?.runtimePolicy || '').trim().toLowerCase() === 'per-instance') return 'creature';
            const entityKind = String(actor?.entityKind || '').trim().toLowerCase();
            return entityKind === 'creature' || profileKind === 'creature' ? 'creature' : 'person';
        }

        function getSyncedNpcImagePath(npc, variant) {
            return window.CriptaCharacterNormalize.getSyncedNpcImagePath(npc, variant);
        }

        window.CriptaApp.onPageReady("npcs", async function () {
            const base_path = '../assets/'; // Path from npcs.html to assets folder
            const npcListContainer = document.querySelector('.npc-list');
            if (!npcListContainer) return;
            syncNpcAdminLinks();

            try {
                const currentUserIsDm = await resolveNpcListUserIsDm(base_path);
                const [managedState, recencyData] = await Promise.all([
                    loadManagedNpcEntries([]).catch((error) => {
                        console.warn('Directory NPC gestita non caricata:', error);
                        return { managedLegacyCharacterIds: [], npcCategories: [], worldIds: [], pendingCreates: [], npcs: [] };
                    }),
                    loadNpcRecencyData(base_path)
                ]);
                let legacyNpcs = [];
                if (!(managedState?.npcs || []).length && !(managedState?.pendingCreates || []).length) {
                    const fallbackSource = window.NPC_DATA?.length ? window.NPC_DATA : await loadNpcData(base_path);
                    const normalizedFallback = normalizeCharactersCollection(fallbackSource);
                    legacyNpcs = currentUserIsDm
                        ? normalizedFallback
                        : (window.WikiSpoiler ? window.WikiSpoiler.filterVisible(normalizedFallback) : normalizedFallback.filter((npc) => !npc.hidden));
                }
                const categoryRegistry = window.CriptaNpcCategories.normalizeRegistry({ categories: managedState?.npcCategories || [] });
                const unifiedNpcs = [...legacyNpcs, ...(managedState?.npcs || []), ...(managedState?.pendingCreates || [])]
                    .map((npc) => ({ ...applyNpcCategoryMetadata(npc, categoryRegistry), rosterKind: 'npc' }));
                const sortedNpcs = sortNpcsByRecency(unifiedNpcs, recencyData);
                const rosterEntries = sortedNpcs;

                let refreshRosterFilters = () => {};
                const rosterState = {
                    npcs: rosterEntries,
                    categoryRegistry,
                    basePath: base_path,
                    canEdit: false,
                    selectedNpcKeys: new Set(),
                    sortMode: readNpcRosterSortMode(),
                    render: null
                };
                const renderRoster = () => {
                    closeNpcRosterPicker();
                    renderNpcDirectory(npcListContainer, rosterState.npcs, rosterState.basePath, rosterState.canEdit, rosterState.sortMode);
                    window.CriptaRosterMedia?.init(npcListContainer);
                    initNpcRosterQuickActions(npcListContainer, rosterState);
                    refreshRosterFilters();
                    rosterState.syncBulkSelection?.();
                };
                rosterState.render = renderRoster;
                if (currentUserIsDm) initNpcRosterBulkActions(npcListContainer, rosterState);
                renderRoster();
                window.CriptaNpcCategoryManager?.init?.({
                    isEditor: currentUserIsDm,
                    onSaved: () => window.location.reload()
                });
                refreshRosterFilters = initNpcRosterControls(npcListContainer, {
                    entries: rosterState.npcs,
                    canEdit: currentUserIsDm,
                    sortMode: rosterState.sortMode,
                    onEditModeChange: (editing) => {
                        rosterState.canEdit = editing;
                        if (!editing) {
                            rosterState.selectedNpcKeys.clear();
                            rosterState.bulkMessage = '';
                        }
                        rosterState.render?.();
                    },
                    onFiltersApplied: () => rosterState.syncBulkSelection?.(),
                    onSortModeChange: (sortMode) => {
                        rosterState.sortMode = sortMode;
                        rosterState.render?.();
                    }
                }) || (() => {});
                refreshRosterFilters();
                if (currentUserIsDm) setupManagedNpcCreateWizard({ managedState, categoryRegistry, rosterState });
            } catch (error) {
                console.error("Errore nel caricamento degli NPC:", error);
                npcListContainer.innerHTML = '<p style="color: var(--red);">Impossibile caricare la lista degli NPC.</p>';
            }
        });

        async function loadManagedNpcEntries(visibleLegacyNpcs = []) {
            if (typeof window.CriptaApp?.api?.get !== 'function') return { managedLegacyCharacterIds: [], npcCategories: [], npcs: [] };
            const token = String(window.CriptaDiscordAuth?.getToken?.() || '').trim();
            const payload = await window.CriptaApp.api.get('api/managed-actors?view=directory', {
                cache: false,
                ...(token ? { token } : {})
            });
            const managedLegacyCharacterIds = Array.isArray(payload?.managedLegacyCharacterIds)
                ? payload.managedLegacyCharacterIds
                : [];
            const legacyById = new Map((Array.isArray(visibleLegacyNpcs) ? visibleLegacyNpcs : [])
                .map((npc) => [String(npc?.id || '').trim().toLowerCase(), npc])
                .filter(([id]) => id));
            const actors = (Array.isArray(payload?.data) ? payload.data : [])
                .filter((actor) => String(actor?.actorType || '').toLowerCase() === 'npc');
            return {
                managedLegacyCharacterIds,
                npcCategories: Array.isArray(payload?.npcCategories) ? payload.npcCategories : [],
                worldIds: Array.isArray(payload?.worldIds) ? payload.worldIds : [],
                pendingCreates: (Array.isArray(payload?.pendingCreates) ? payload.pendingCreates : []).map(managedCreateRequestToNpcListEntry),
                npcs: actors.map((actor) => {
                    const legacyId = String(actor?.profile?.legacyCharacterId || '').trim().toLowerCase();
                    return managedActorToNpcListEntry(actor, legacyById.get(legacyId) || null);
                })
            };
        }

        function managedActorToNpcListEntry(actor, legacyNpc = null) {
            const profile = actor?.profile || {};
            const media = actor?.media || {};
            const legacyImages = legacyNpc?.images || {};
            const avatarPath = media.avatar?.path || legacyImages.avatar || '';
            const tokenPath = media.token?.path || legacyImages.token || avatarPath;
            const dedicatedIdlePath = media.idle?.path || legacyImages.idle || '';
            const dedicatedHoverPath = media.hover?.path || legacyImages.hover || '';
            const idlePath = dedicatedIdlePath || tokenPath || avatarPath || '';
            const hoverPath = dedicatedHoverPath || tokenPath || idlePath || avatarPath || '';
            const legacyId = String(profile.legacyCharacterId || legacyNpc?.id || '').trim();
            const statsVisibility = String(actor?.visibility?.state || 'dm').toLowerCase();
            const profileVisibility = String(profile?.visibility?.state || 'dm').toLowerCase();
            const hiddenFromPlayers = statsVisibility === 'dm' && profileVisibility === 'dm';
            const effectiveKind = managedActorDirectoryKind(actor, profile);
            return {
                ...(legacyNpc || {}),
                id: legacyId || `managed-${actor.worldId || 'world'}-${actor.actorId || 'actor'}`,
                name: actor.name || legacyNpc?.name || 'NPC',
                role: profile.role || legacyNpc?.role || 'NPC',
                quote: profile.quote || legacyNpc?.quote || '',
                lifeState: normalizeManagedNpcLifeState(profile.lifeState, profile.status || legacyNpc?.status),
                status: normalizeManagedNpcStatus(profile.lifeState, profile.status || legacyNpc?.status),
                statusNote: String(profile.status || legacyNpc?.statusNote || ''),
                kind: String(effectiveKind || '').toLowerCase() === 'creature' ? 'creature' : 'person',
                tags: Array.from(new Set([...(Array.isArray(profile.tags) ? profile.tags : []), ...(Array.isArray(actor?.capabilities) ? actor.capabilities : [])])),
                archived: profile.lifecycle?.state === 'archived',
                sync: actor?.sync || null,
                hidden: hiddenFromPlayers,
                categoryId: Object.prototype.hasOwnProperty.call(profile, 'categoryId')
                    ? profile.categoryId
                    : (legacyNpc?.categoryId || ''),
                category: Object.prototype.hasOwnProperty.call(profile, 'category')
                    ? profile.category
                    : (legacyNpc?.category || ''),
                categoryPriority: profile.categoryOrder ?? legacyNpc?.categoryPriority ?? null,
                categoryColor: profile.categoryColor || legacyNpc?.categoryColor || '',
                categoryIcon: profile.categoryIcon || legacyNpc?.categoryIcon || '',
                categoryRosterSection: profile.categoryRosterSection || legacyNpc?.categoryRosterSection || 'npc',
                images: {
                    ...legacyImages,
                    avatar: avatarPath,
                    token: tokenPath,
                    idle: idlePath,
                    hover: hoverPath,
                    idleAdjust: managedPresentationToNpcAdjust(media.idle || media.token || media.avatar, legacyImages.idleAdjust || legacyImages.avatarAdjust),
                    hasDedicatedIdle: Boolean(dedicatedIdlePath),
                    hasDedicatedHover: Boolean(dedicatedHoverPath),
                    hoverAdjust: managedPresentationToNpcAdjust(media.hover || media.idle || media.token || media.avatar, legacyImages.hoverAdjust),
                    idleFallback: tokenPath || avatarPath || legacyImages.idleFallback || '',
                    idleFrameCircle: managedPresentationToFrameCircle(media.idle || media.token || media.avatar, legacyImages.idleFrameCircle || legacyImages.tokenFrameCircle),
                    hoverFrameCircle: managedPresentationToFrameCircle(media.hover || media.idle || media.token || media.avatar, legacyImages.hoverFrameCircle),
                    hoverFallback: tokenPath || idlePath || avatarPath || legacyImages.hoverFallback || '',
                    avatarFallback: tokenPath || idlePath || legacyImages.avatarFallback || ''
                },
                updatedAt: actor.updatedAt || legacyNpc?.updatedAt || '',
                managedActorWorldId: String(actor?.worldId || '').trim(),
                managedProfileRevision: Math.max(0, Number(profile.revision || 0)),
                managedProfileCanEdit: actor?.permissions?.isEditor === true,
                managedProfileVisibility: profileVisibility === 'public' ? 'public' : 'dm',
                managedStatsVisibility: statsVisibility,
                managedActorId: String(actor?.actorId || '').trim(),
                managedActorUrl: buildManagedActorDetailUrl(actor)
            };
        }
        function managedCreateRequestToNpcListEntry(request) {
            const profile = request?.profile || {};
            const document = request?.document || {};
            const media = document?.media || {};
            return {
                id: `pending-${request?.id || request?.clientId || 'npc'}`,
                name: document.name || profile.name || 'Nuovo NPC',
                role: profile.role || 'Creazione in attesa',
                quote: request?.error || (request?.status === 'pending' ? 'Foundry completera automaticamente la creazione appena il mondo sara disponibile.' : 'La creazione richiede attenzione.'),
                status: 'ignoto',
                lifeState: profile.lifeState || 'unknown',
                statusNote: request?.status || 'pending',
                kind: profile.kind === 'creature' ? 'creature' : 'person',
                tags: Array.from(new Set([...(Array.isArray(profile.tags) ? profile.tags : []), ...(Array.isArray(actor?.capabilities) ? actor.capabilities : [])])),
                archived: false,
                pendingCreate: true,
                createStatus: request?.status || 'pending',
                sync: { pending: request?.status === 'pending' ? 1 : 0, conflicts: request?.status === 'conflict' ? 1 : 0, failed: request?.status === 'failed' ? 1 : 0 },
                categoryId: profile.categoryId || '',
                category: profile.category || 'In attesa di Foundry',
                categoryRosterSection: profile.categoryRosterSection || 'npc',
                images: { avatar: media.avatar || '', token: media.token || media.avatar || '', idle: media.token || media.avatar || '', hover: media.token || media.avatar || '' },
                managedActorWorldId: request?.targetWorldId || '',
                managedActorId: '',
                managedProfileCanEdit: true
            };
        }

        function managedPresentationToNpcAdjust(descriptor, fallback = null) {
            const presentation = descriptor?.presentation;
            if (!presentation || typeof presentation !== 'object') return fallback || null;
            const finiteOr = (value, defaultValue) => Number.isFinite(Number(value)) ? Number(value) : defaultValue;
            const x = Math.min(100, Math.max(0, finiteOr(presentation.x, 50)));
            const y = Math.min(100, Math.max(0, finiteOr(presentation.y, 50)));
            const size = Math.min(3, Math.max(.5, finiteOr(presentation.scale, 1)));
            return {
                x: Math.round((x - 50) * 2),
                y: Math.round((y - 50) * 2),
                size
            };
        }

        function managedPresentationToFrameCircle(descriptor, fallback = null) {
            return window.CriptaImageAdjust?.normalizeFrameCircle?.(descriptor?.presentation?.frameCircle) || fallback || null;
        }



        function normalizeManagedNpcLifeState(value, fallback = '') {
            const state = String(value || '').trim().toLowerCase();
            if (state === 'none' || state === 'nessuno' || state === 'nessuna') return 'none';
            if (state === 'alive' || state.includes('viv')) return 'alive';
            if (state === 'dead' || state.includes('mort')) return 'dead';
            if (state === 'unknown' || state.includes('ignot') || state.includes('sconosciut')) return 'unknown';
            const legacy = String(fallback || '').trim().toLowerCase();
            if (legacy === 'none' || legacy === 'nessuno' || legacy === 'nessuna') return 'none';
            if (legacy === 'alive' || legacy.includes('viv')) return 'alive';
            if (legacy === 'dead' || legacy.includes('mort')) return 'dead';
            return 'unknown';
        }

        function normalizeManagedNpcStatus(value, fallback) {
            const state = normalizeManagedNpcLifeState(value, fallback);
            if (state === 'none') return '';
            if (state === 'alive') return 'vivo';
            if (state === 'dead') return 'morto';
            return 'ignoto';
        }

        function buildManagedActorDetailUrl(actor) {
            const target = new URL('./characters/managed-actor.html', window.location.href);
            target.searchParams.set('world', actor?.worldId || '');
            target.searchParams.set('actor', actor?.actorId || '');
            const campaignId = getCurrentCampaignId();
            if (campaignId && campaignId !== 'cripta-di-sangue') target.searchParams.set('campaign', campaignId);
            const permissions = actor?.permissions || {};
            if (permissions.canReadStats === false && permissions.canReadProfile === true) target.searchParams.set('profile', '1');
            return `${target.pathname}${target.search}`;
        }
        function resolveImageUrl(path, base_path = '../assets/') {
            return window.CriptaApp.utils.resolveImageUrl(path);
        }

        function buildNpcDetailUrl(params = {}) {
            const url = new URL('./characters/character.html', window.location.href);
            Object.entries(params).forEach(([key, value]) => {
                if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
            });
            const campaignId = getCurrentCampaignId();
            if (campaignId && campaignId !== 'cripta-di-sangue') url.searchParams.set('campaign', campaignId);
            return `${url.pathname}${url.search}`;
        }

        function syncNpcAdminLinks() {
            document.querySelectorAll('[data-npc-create-link]').forEach((button) => button.removeAttribute('href'));
        }

        function setupManagedNpcCreateWizard({ managedState = {}, categoryRegistry = {} } = {}) {
            const trigger = document.querySelector('[data-npc-create-link]');
            if (!trigger || trigger.dataset.managedCreateReady === 'true') return;
            trigger.dataset.managedCreateReady = 'true';
            trigger.addEventListener('click', () => openManagedNpcCreateWizard({ managedState, categoryRegistry }));
        }

        function openManagedNpcCreateWizard({ managedState = {}, categoryRegistry = {} } = {}) {
            document.querySelector('[data-managed-npc-create-modal]')?.remove();
            const worlds = Array.from(new Set((managedState.worldIds || []).map((value) => String(value || '').trim()).filter(Boolean)));
            const categories = selectableNpcCategories(categoryRegistry);
            const selectedDirectoryKind = document.querySelector('[data-roster-type].is-active')?.dataset.rosterType;
            const initialKind = selectedDirectoryKind === 'creature' ? 'creature' : 'person';
            const createLabel = initialKind === 'creature' ? 'una creatura' : 'un NPC';
            const overlay = document.createElement('div');
            overlay.className = 'managed-npc-create-overlay';
            overlay.dataset.managedNpcCreateModal = 'true';
            overlay.innerHTML = `<section class="managed-npc-create-dialog" role="dialog" aria-modal="true" aria-labelledby="managed-npc-create-title">
                <header><div><span>Nuovo flusso</span><h2 id="managed-npc-create-title"><i class="fas fa-wand-magic-sparkles"></i>Crea ${createLabel}</h2><p>Prepara il dossier ora; Foundry costruira automaticamente l'Actor con statistiche di base.</p></div><button type="button" data-create-close aria-label="Chiudi"><i class="fas fa-xmark"></i></button></header>
                <form data-managed-npc-create-form>
                    <div class="managed-npc-create-grid">
                        <label class="is-wide"><span>Nome <b>*</b></span><input name="name" required maxlength="180" autocomplete="off" placeholder="Nome del personaggio o della creatura"></label>
                        <label><span>Tipo</span><select name="kind"><option value="person" ${initialKind === 'person' ? 'selected' : ''}>NPC collegato</option><option value="creature" ${initialKind === 'creature' ? 'selected' : ''}>Creatura del Bestiario</option></select></label>
                        <label><span>Mondo Foundry <b>*</b></span>${worlds.length ? `<select name="targetWorldId" required>${worlds.map((world) => `<option value="${escapeNpcAttribute(world)}">${escapeNpcAttribute(world)}</option>`).join('')}</select>` : '<input name="targetWorldId" required placeholder="ID del mondo Foundry">'}</label>
                        <label><span>Ruolo o soprannome</span><input name="role" maxlength="240" placeholder="Es. Custode del teatro"></label>
                        <label><span>Categoria / sottocategoria</span><select name="categoryId"><option value="">Senza categoria</option>${categories.map((category) => `<option value="${escapeNpcAttribute(category.id)}">${category.parentId ? '↳ ' : ''}${escapeNpcAttribute(category.parentName ? `${category.parentName} / ${category.name}` : category.name)}</option>`).join('')}</select></label>
                        <label data-create-life-state><span>Stato</span><select name="lifeState"><option value="none">Nessuno</option><option value="alive">Vivo</option><option value="dead">Morto</option><option value="unknown">Ignoto</option></select></label>
                        <label><span>Visibilita dossier</span><select name="visibility"><option value="dm">Solo DM</option><option value="public">Pubblico</option></select></label>
                        <label class="is-wide managed-npc-create-quote"><span>Citazione o nota breve</span><div><i class="fas fa-quote-left" aria-hidden="true"></i><textarea name="quote" rows="3" maxlength="1000" placeholder="Una frase rappresentativa"></textarea></div></label>
                    </div>
                    <fieldset class="managed-npc-create-capabilities"><legend>Capacita</legend><label><input type="checkbox" name="tags" value="mercante"><span><i class="fas fa-store"></i>Mercante</span></label><label><input type="checkbox" name="tags" value="boss"><span><i class="fas fa-crown"></i>Boss</span></label><label><input type="checkbox" name="tags" value="missioni"><span><i class="fas fa-scroll"></i>Missioni</span></label></fieldset>
                    <div class="managed-npc-create-media"><label data-create-file-card><span>Avatar</span><input type="file" name="avatar" accept="image/*"><div><i class="fas fa-image"></i><strong>Immagine grande</strong><small>Trascina o scegli il file</small></div></label><label data-create-file-card><span>Token</span><input type="file" name="token" accept="image/*"><div><i class="fas fa-circle-user"></i><strong>Token della mappa</strong><small>Se manca, usa l'avatar</small></div></label></div>
                    <details class="managed-npc-create-stats"><summary><span><i class="fas fa-dice-d20"></i>Statistiche iniziali</span><small>Facoltative</small><i class="fas fa-chevron-down"></i></summary><div><label><span>PF massimi</span><input type="number" name="hpMax" min="1" max="999999" value="1"></label><label><span>CA</span><input type="number" name="ac" min="0" max="99" value="10"></label><label><span>Velocita</span><input type="number" name="speed" min="0" max="9999" value="30"></label><label><span>CR</span><input name="cr" value="0"></label><label><span>Taglia</span><select name="size"><option value="tiny">Minuscola</option><option value="sm">Piccola</option><option value="med" selected>Media</option><option value="lg">Grande</option><option value="huge">Enorme</option><option value="grg">Mastodontica</option></select></label></div></details>
                    <footer><span data-create-status></span><button type="button" data-create-close>Annulla</button><button type="submit"><i class="fas fa-cloud-arrow-up"></i>Crea e sincronizza</button></footer>
                </form>
            </section>`;
            document.body.appendChild(overlay);
            document.body.classList.add('has-managed-dialog');
            const close = () => { overlay.remove(); document.body.classList.remove('has-managed-dialog'); };
            overlay.querySelectorAll('[data-create-close]').forEach((button) => button.addEventListener('click', close));
            overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
            const kindControl = overlay.querySelector('select[name="kind"]');
            const syncKindControls = () => {
                const isCreature = kindControl?.value === 'creature';
                const lifeState = overlay.querySelector('[data-create-life-state]');
                if (lifeState) lifeState.hidden = isCreature;
                if (isCreature) overlay.querySelector('select[name="lifeState"]').value = 'none';
                const title = overlay.querySelector('#managed-npc-create-title');
                if (title) title.innerHTML = `<i class="fas fa-wand-magic-sparkles"></i>Crea ${isCreature ? 'una creatura' : 'un NPC'}`;
            };
            kindControl?.addEventListener('change', syncKindControls);
            syncKindControls();
            overlay.querySelectorAll('[data-create-file-card] input[type="file"]').forEach((input) => input.addEventListener('change', () => {
                const file = input.files?.[0];
                const card = input.closest('[data-create-file-card]');
                card.querySelector('img')?.remove();
                if (!file) return;
                const image = document.createElement('img');
                image.src = URL.createObjectURL(file);
                image.alt = '';
                image.onload = () => URL.revokeObjectURL(image.src);
                card.querySelector('div')?.prepend(image);
                card.classList.add('has-file');
            }));
            overlay.querySelector('input[name="name"]')?.focus();
            overlay.querySelector('[data-managed-npc-create-form]')?.addEventListener('submit', async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const submit = form.querySelector('button[type="submit"]');
                const status = form.querySelector('[data-create-status]');
                const data = new FormData(form);
                const token = String(window.CriptaDiscordAuth?.getToken?.() || '').trim();
                const clientId = `site-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
                submit.disabled = true;
                status.textContent = 'Preparo immagini e richiesta...';
                try {
                    const upload = async (field, fileName) => {
                        const file = data.get(field);
                        if (!(file instanceof File) || !file.size) return '';
                        const result = await window.CriptaMedia.uploadImageFile(file, { campaignId: getCurrentCampaignId(), token, folder: `managed-actors/site-pending/${clientId}/base`, fileName });
                        return result.path;
                    };
                    const [avatar, tokenPath] = await Promise.all([upload('avatar', 'avatar.webp'), upload('token', 'token.webp')]);
                    const categoryId = String(data.get('categoryId') || '');
                    const category = categories.find((entry) => entry.id === categoryId)?.name || '';
                    await window.CriptaApp.api.post('api/managed-actor-create-requests', {
                        campaignId: getCurrentCampaignId(),
                        clientId,
                        targetWorldId: String(data.get('targetWorldId') || ''),
                        document: { name: String(data.get('name') || ''), media: { avatar, token: tokenPath || avatar }, hpMax: Number(data.get('hpMax') || 1), ac: Number(data.get('ac') || 10), speed: Number(data.get('speed') || 30), cr: String(data.get('cr') || '0'), size: String(data.get('size') || 'med') },
                        profile: { name: String(data.get('name') || ''), kind: String(data.get('kind') || 'person'), role: String(data.get('role') || ''), quote: String(data.get('quote') || ''), lifeState: String(data.get('lifeState') || 'unknown'), visibility: { state: String(data.get('visibility') || 'dm') }, categoryId, category, tags: data.getAll('tags') }
                    }, { token });
                    status.textContent = 'Richiesta inviata. Foundry la ricevera automaticamente.';
                    showNpcRosterFeedback('NPC creato e messo in coda per Foundry.', 'success');
                    window.setTimeout(() => window.location.reload(), 650);
                } catch (error) {
                    status.textContent = error?.message || 'Creazione non riuscita.';
                    submit.disabled = false;
                }
            });
        }
        async function resolveNpcListUserIsDm(base_path) {
            try {
                return await window.CriptaDiscordAuth?.isCurrentUserDm?.(base_path) === true;
            } catch (_) {
                return false;
            }
        }

        function appendAssetVersion(url, version) {
            return window.CriptaApp.utils.appendAssetVersion(url, version);
        }

        function resolveNpcImageUrl(npc, path, base_path = '../assets/') {
            return appendAssetVersion(resolveImageUrl(path, base_path), npc?.updatedAt);
        }

        async function loadNpcRecencyData(base_path) {
            try {
                const payload = typeof window.CriptaApp?.data?.json === 'function'
                    ? await window.CriptaApp.data.json('npc-recency.json')
                    : await window.CriptaApp.fetchJson(window.CriptaApp?.urls?.data?.('npc-recency.json') || base_path + 'data/npc-recency.json', { clone: true });
                const byId = {};
                (payload.items || []).forEach(item => {
                    if (item && item.id) byId[item.id] = item;
                });
                return { byId };
            } catch (error) {
                console.warn('Impossibile caricare npc-recency.json:', error);
                return { byId: {} };
            }
        }

        function sortNpcsByRecency(npcs, recencyData) {
            const byId = (recencyData && recencyData.byId) ? recencyData.byId : {};
            const parseOrderSlot = (value) => {
                if (value === null || value === undefined || value === '') return null;
                const slot = Number(value);
                return Number.isInteger(slot) && slot > 0 ? slot : null;
            };
            const recencySort = (aMeta, bMeta) => {
                if (aMeta.lastMentionSessionId !== bMeta.lastMentionSessionId) {
                    return bMeta.lastMentionSessionId - aMeta.lastMentionSessionId;
                }
                if (aMeta.mentions !== bMeta.mentions) {
                    return bMeta.mentions - aMeta.mentions;
                }
                return String(aMeta.npc.name || aMeta.npc.id).localeCompare(String(bMeta.npc.name || bMeta.npc.id), 'it');
            };

            const metas = [...npcs].map((npc) => {
                const recency = byId[npc.id] || {};
                return {
                    npc,
                    slot: parseOrderSlot(recency.order_slot) ?? parseOrderSlot(npc.order_slot),
                    lastMentionSessionId: Number.isFinite(Number(recency.lastMentionSessionId)) ? Number(recency.lastMentionSessionId) : -1,
                    mentions: Number.isFinite(Number(recency.mentions)) ? Number(recency.mentions) : 0,
                };
            });

            const unpinned = metas.filter((meta) => meta.slot === null).sort(recencySort);
            const pinned = metas.filter((meta) => meta.slot !== null).sort((a, b) => {
                if (a.slot !== b.slot) return a.slot - b.slot;
                return recencySort(a, b);
            });

            const ordered = unpinned.map((meta) => meta.npc);
            pinned.forEach((meta) => {
                const insertIndex = Math.max(0, Math.min(meta.slot - 1, ordered.length));
                ordered.splice(insertIndex, 0, meta.npc);
            });

            return ordered;
        }

        function normalizeNpcRosterSortMode(value) {
            return value === 'updated' ? 'updated' : 'categories';
        }

        function npcRosterSortStorageKey() {
            const campaignId = window.CriptaApp?.campaigns?.currentId?.() || 'cripta-di-sangue';
            return `npc-roster-sort:${campaignId}`;
        }

        function readNpcRosterSortMode() {
            try {
                return normalizeNpcRosterSortMode(window.localStorage.getItem(npcRosterSortStorageKey()));
            } catch (_) {
                return 'categories';
            }
        }

        function writeNpcRosterSortMode(value) {
            const normalized = normalizeNpcRosterSortMode(value);
            try {
                window.localStorage.setItem(npcRosterSortStorageKey(), normalized);
            } catch (_) {
                // La selezione resta valida per la pagina corrente anche senza storage.
            }
            return normalized;
        }

        function npcUpdatedAtTimestamp(value) {
            const timestamp = Date.parse(String(value || ''));
            return Number.isFinite(timestamp) ? timestamp : 0;
        }

        function sortNpcsByUpdatedAt(npcs) {
            return [...(Array.isArray(npcs) ? npcs : [])].sort((left, right) => {
                const updatedDifference = npcUpdatedAtTimestamp(right?.updatedAt) - npcUpdatedAtTimestamp(left?.updatedAt);
                if (updatedDifference) return updatedDifference;
                return String(left?.name || left?.id || '').localeCompare(String(right?.name || right?.id || ''), 'it');
            });
        }

        function formatNpcUpdatedAt(value) {
            const timestamp = npcUpdatedAtTimestamp(value);
            if (!timestamp) return '';
            const date = new Date(timestamp);
            const currentYear = new Date().getFullYear();
            return new Intl.DateTimeFormat('it-IT', {
                day: '2-digit',
                month: 'short',
                ...(date.getFullYear() === currentYear ? {} : { year: 'numeric' }),
                hour: '2-digit',
                minute: '2-digit'
            }).format(date);
        }

        async function loadNpcData(base_path) {
            const liveCharacters = await loadCharactersCollection();
            if (Array.isArray(liveCharacters)) {
                return liveCharacters.filter(entry => (entry.type || 'npc') === 'npc');
            }

            const manifest = await loadCharactersManifest(base_path);
            const npcEntries = manifest.filter(entry => (entry.type || 'npc') === 'npc');
            const characters = [];
            for (const entry of npcEntries) {
                const char = await loadCharacterYaml(entry, base_path);
                if (char) characters.push(char);
            }
            return characters;
        }

        async function loadCharactersCollection() {
            try {
                if (typeof window.CriptaApp?.api?.get === 'function') {
                    const payload = await window.CriptaApp.api.get('api/data/characters');
                    if (Array.isArray(payload?.data)) return normalizeCharactersCollection(payload.data);
                } else {
                    const response = await fetch(window.CriptaApp?.urls?.api?.('api/data/characters') || 'https://sigillo-api.khuzoe.workers.dev/api/data/characters');
                    if (response.ok) {
                        const payload = await response.json();
                        if (Array.isArray(payload?.data)) return normalizeCharactersCollection(payload.data);
                    }
                }
            } catch (error) {
                console.warn('KV characters non disponibile, provo JSON statico.', error);
            }

            try {
                const payload = typeof window.CriptaApp?.data?.json === 'function'
                    ? await window.CriptaApp.data.json('characters.json')
                    : await window.CriptaApp.fetchJson(window.CriptaApp?.urls?.data?.('characters.json') || '../assets/data/characters.json', { clone: true });
                const data = Array.isArray(payload) ? payload : payload?.data;
                if (Array.isArray(data)) return normalizeCharactersCollection(data);
            } catch (error) {
                console.warn('characters.json non disponibile, provo YAML statico.', error);
            }

            return null;
        }

        function normalizeCharactersCollection(characters) {
            return window.CriptaCharacterNormalize.normalizeCharactersCollection(characters, {
                normalizeBlocks: normalizeCharacterBlocks
            });
        }

        function applyNpcCategoryMetadata(npc, registry) {
            const resolved = window.CriptaNpcCategories?.resolve?.(registry, npc?.categoryId, npc?.category);
            if (window.CriptaNpcCategories?.isUncategorized?.(resolved || { id: npc?.categoryId, name: npc?.category })) {
                return {
                    ...npc, categoryId: '', category: '', categoryPriority: null, categoryColor: '', categoryIcon: '',
                    categoryParentId: '', categoryParent: '', categoryGroupId: '', categoryGroupName: '',
                    categoryGroupPriority: null, categoryGroupColor: '', categoryGroupIcon: '',
                    categorySubcategoryId: '', categorySubcategory: ''
                };
            }
            if (!resolved) return npc;
            const parent = resolved.parentId
                ? window.CriptaNpcCategories?.resolve?.(registry, resolved.parentId, "")
                : null;
            const uncategorizedParent = window.CriptaNpcCategories?.isUncategorized?.(parent || {});
            return {
                ...npc,
                categoryId: resolved.id,
                category: resolved.name,
                categoryPriority: resolved.order,
                categoryColor: resolved.color,
                categoryIcon: resolved.icon,
                categoryRosterSection: resolved.rosterSection,
                categoryParentId: parent?.id || "",
                categoryParent: uncategorizedParent ? 'Senza categoria' : parent?.name || "",
                categoryGroupId: uncategorizedParent ? '' : parent?.id || resolved.id,
                categoryGroupName: uncategorizedParent ? '' : parent?.name || resolved.name,
                categoryGroupPriority: parent?.order ?? resolved.order,
                categoryGroupColor: parent?.color || resolved.color,
                categoryGroupIcon: parent?.icon || resolved.icon,
                categorySubcategoryId: parent ? resolved.id : "",
                categorySubcategory: parent ? resolved.name : ""
            };
        }

        function orderedNpcCategories(categories) {
            const items = Array.isArray(categories) ? categories : [];
            const byId = new Map(items.map((category) => [category.id, category]));
            const sort = (values) => [...values].sort((left, right) => Number(left.order || 0) - Number(right.order || 0) || String(left.name || '').localeCompare(String(right.name || ''), 'it'));
            const roots = sort(items.filter((category) => !category.parentId || !byId.has(category.parentId)));
            const ordered = [];
            const visited = new Set();
            roots.forEach((root) => {
                ordered.push({ ...root, parentName: '' });
                visited.add(root.id);
                sort(items.filter((category) => category.parentId === root.id)).forEach((child) => {
                    ordered.push({ ...child, parentName: root.name });
                    visited.add(child.id);
                });
            });
            sort(items.filter((category) => !visited.has(category.id))).forEach((category) => {
                ordered.push({ ...category, parentName: byId.get(category.parentId)?.name || '' });
            });
            return ordered;
        }

        function selectableNpcCategories(registry) {
            const categories = (registry?.categories || []).map((category, index) => window.CriptaNpcCategories.normalizeCategory(category, index))
                .filter((category) => category && !category.archived && !category.mergedInto);
            return orderedNpcCategories(categories).filter((category) => !window.CriptaNpcCategories.isUncategorized(category));
        }

        function renderNpcDirectory(container, npcs, base_path, canEdit = false, sortMode = 'categories') {
            const normalizedSortMode = normalizeNpcRosterSortMode(sortMode);
            container.dataset.npcSortMode = normalizedSortMode;
            const index = container.parentElement.querySelector('[data-npc-atlas-index]');
            if (index) {
                index.replaceChildren();
                index.parentElement.hidden = true;
            }
            if (normalizedSortMode === 'updated') {
                renderNpcUpdatedList(container, npcs, base_path, canEdit);
                return;
            }
            renderNpcGroups(container, npcs, base_path, canEdit);
        }

        function renderNpcUpdatedList(container, npcs, base_path, canEdit = false) {
            container.innerHTML = '';
            const cards = document.createElement('div');
            cards.className = 'npc-updated-list';
            sortNpcsByUpdatedAt(npcs).forEach((npc) => {
                cards.appendChild(createNpcCard(npc, base_path, canEdit, { showUpdatedAt: true }));
            });
            container.appendChild(cards);
            window.CriptaImageAdjust?.initFrameCircleImages?.(container);
        }

        function renderNpcGroups(container, npcs, base_path, canEdit = false) {
            container.innerHTML = '';
            const groups = groupNpcsByCategory(npcs);
            const index = container.parentElement.querySelector('[data-npc-atlas-index]');
            groups.forEach((group, groupIndex) => {
                const section = document.createElement('section');
                section.className = 'npc-category-group';
                section.id = `npc-atlas-chapter-${groupIndex + 1}`;
                section.dataset.npcCategory = group.id || group.category || '';
                if (group.color) section.style.setProperty('--npc-category-accent', group.color);

                const header = document.createElement('header');
                header.className = 'npc-category-header';
                const title = document.createElement('h2');
                title.className = 'npc-category-title';
                if (group.icon) {
                    const icon = document.createElement('i');
                    icon.className = `fas ${group.icon}`;
                    title.appendChild(icon);
                }
                const chapterName = group.category || 'Senza categoria';
                title.appendChild(document.createTextNode(chapterName));
                title.tabIndex = -1;
                const count = document.createElement('span');
                count.className = 'npc-category-count';
                count.textContent = String(group.items.length);
                header.append(title, count);
                section.appendChild(header);
                if (index) {
                    const chapter = document.createElement('button');
                    chapter.type = 'button';
                    chapter.setAttribute('aria-controls', section.id);
                    const emblem = title.querySelector('i')?.cloneNode(false) || document.createElement('i');
                    if (!emblem.className) emblem.className = 'fas fa-bookmark';
                    emblem.setAttribute('aria-hidden', 'true');
                    chapter.append(emblem, document.createTextNode(chapterName));
                    chapter.addEventListener('click', () => {
                        index.querySelector('[aria-current]')?.removeAttribute('aria-current');
                        chapter.setAttribute('aria-current', 'location');
                        title.focus({ preventScroll: true });
                        section.scrollIntoView({ block: 'start' });
                    });
                    section._npcAtlasChapter = chapter;
                    index.appendChild(chapter);
                }

                const hasSubcategories = group.subgroups.some((subgroup) => Boolean(subgroup.id));
                if (!hasSubcategories) {
                    const cards = document.createElement('div');
                    cards.className = 'npc-category-list';
                    group.items.forEach((npc) => cards.appendChild(createNpcCard(npc, base_path, canEdit)));
                    section.appendChild(cards);
                } else {
                    const subcategoryList = document.createElement('div');
                    subcategoryList.className = 'npc-subcategory-list';
                    group.subgroups.forEach((subgroup) => {
                        const cards = document.createElement('div');
                        cards.className = `npc-category-list${subgroup.id ? '' : ' npc-category-list--direct'}`;
                        subgroup.items.forEach((npc) => cards.appendChild(createNpcCard(npc, base_path, canEdit)));
                        if (!subgroup.id) {
                            subcategoryList.appendChild(cards);
                            return;
                        }
                        const subgroupSection = document.createElement('section');
                        subgroupSection.className = 'npc-subcategory-group';
                        subgroupSection.dataset.npcSubcategory = subgroup.id;
                        subgroupSection.dataset.npcSubcategoryStorageKey = npcSubcategoryStorageKey(group.id, subgroup.id);
                        if (subgroup.color) subgroupSection.style.setProperty('--npc-subcategory-accent', subgroup.color);
                        const subgroupHeader = document.createElement('header');
                        subgroupHeader.className = 'npc-subcategory-header';
                        const subgroupToggle = document.createElement('button');
                        subgroupToggle.type = 'button';
                        subgroupToggle.dataset.npcSubcategoryToggle = '';
                        const subgroupTitle = document.createElement('h3');
                        if (subgroup.icon) {
                            const subgroupIcon = document.createElement('i');
                            subgroupIcon.className = `fas ${subgroup.icon}`;
                            subgroupTitle.appendChild(subgroupIcon);
                        }
                        subgroupTitle.appendChild(document.createTextNode(subgroup.category));
                        const subgroupMeta = document.createElement('span');
                        subgroupMeta.className = 'npc-subcategory-meta';
                        const subgroupCount = document.createElement('span');
                        subgroupCount.className = 'npc-subcategory-count';
                        subgroupCount.textContent = String(subgroup.items.length);
                        const subgroupChevron = document.createElement('i');
                        subgroupChevron.className = 'fas fa-chevron-down npc-subcategory-chevron';
                        subgroupChevron.setAttribute('aria-hidden', 'true');
                        subgroupMeta.append(subgroupCount, subgroupChevron);
                        subgroupToggle.append(subgroupTitle, subgroupMeta);
                        subgroupHeader.appendChild(subgroupToggle);
                        subgroupSection.appendChild(subgroupHeader);
                        cards.dataset.npcSubcategoryContent = '';
                        subgroupSection.appendChild(cards);
                        const collapsed = readNpcSubcategoryCollapsed(subgroupSection.dataset.npcSubcategoryStorageKey);
                        subgroupSection.dataset.npcSubcategoryCollapsed = collapsed ? 'true' : 'false';
                        setNpcSubcategoryCollapsed(subgroupSection, collapsed);
                        subgroupToggle.addEventListener('click', () => {
                            const nextCollapsed = subgroupSection.dataset.npcSubcategoryCollapsed !== 'true';
                            subgroupSection.dataset.npcSubcategoryCollapsed = nextCollapsed ? 'true' : 'false';
                            writeNpcSubcategoryCollapsed(subgroupSection.dataset.npcSubcategoryStorageKey, nextCollapsed);
                            setNpcSubcategoryCollapsed(subgroupSection, nextCollapsed);
                        });
                        subcategoryList.appendChild(subgroupSection);
                    });
                    section.appendChild(subcategoryList);
                }
                container.appendChild(section);
            });
            window.CriptaImageAdjust?.initFrameCircleImages?.(container);
        }

        function npcSubcategoryStorageKey(groupId, subgroupId) {
            const campaignId = window.CriptaApp?.campaigns?.currentId?.() || 'cripta-di-sangue';
            return `npc-subcategory:${campaignId}:${groupId || 'uncategorized'}:${subgroupId}`;
        }

        function readNpcSubcategoryCollapsed(key) {
            try {
                return window.sessionStorage.getItem(key) !== 'expanded';
            } catch (_) {
                return true;
            }
        }

        function writeNpcSubcategoryCollapsed(key, collapsed) {
            try {
                window.sessionStorage.setItem(key, collapsed ? 'collapsed' : 'expanded');
            } catch (_) {
                // La preferenza resta valida per la sessione corrente anche senza storage.
            }
        }

        function setNpcSubcategoryCollapsed(section, collapsed) {
            section.classList.toggle('is-collapsed', collapsed);
            const toggle = section.querySelector('[data-npc-subcategory-toggle]');
            const content = section.querySelector('[data-npc-subcategory-content]');
            if (toggle) toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            if (content) content.hidden = collapsed;
        }

        function groupNpcsByCategory(npcs) {
            const groups = new Map();
            (Array.isArray(npcs) ? npcs : []).forEach((npc) => {
                const category = String(npc?.categoryGroupName ?? npc?.category ?? '').trim();
                const groupId = npc?.categoryGroupId ?? (npc?.categoryId || category);
                const id = window.CriptaNpcCategories?.normalizeId?.(groupId) ?? String(groupId).toLocaleLowerCase('it');
                const key = id || '__uncategorized__';
                if (!groups.has(key)) {
                    groups.set(key, { id, category, color: npc?.categoryGroupColor || npc?.categoryColor || '', icon: npc?.categoryGroupIcon || npc?.categoryIcon || '', priority: null, items: [], subgroupMap: new Map() });
                }
                const group = groups.get(key);
                if (!group.color && (npc?.categoryGroupColor || npc?.categoryColor)) group.color = npc.categoryGroupColor || npc.categoryColor;
                if (!group.icon && (npc?.categoryGroupIcon || npc?.categoryIcon)) group.icon = npc.categoryGroupIcon || npc.categoryIcon;
                const priority = normalizeCategoryPriority(npc?.categoryGroupPriority ?? npc?.categoryPriority);
                if (priority !== null && (group.priority === null || priority < group.priority)) {
                    group.priority = priority;
                }
                group.items.push(npc);
                const subcategoryId = String(npc?.categorySubcategoryId || '');
                const subgroupKey = subcategoryId || '__direct__';
                if (!group.subgroupMap.has(subgroupKey)) {
                    group.subgroupMap.set(subgroupKey, {
                        id: subcategoryId,
                        category: String(npc?.categorySubcategory || ''),
                        color: npc?.categoryColor || '',
                        icon: npc?.categoryIcon || '',
                        priority: normalizeCategoryPriority(npc?.categoryPriority),
                        items: []
                    });
                }
                group.subgroupMap.get(subgroupKey).items.push(npc);
            });
            const output = Array.from(groups.values()).map((group) => {
                group.subgroups = Array.from(group.subgroupMap.values()).sort((left, right) => {
                    if (!left.id && right.id) return -1;
                    if (left.id && !right.id) return 1;
                    const leftPriority = normalizeCategoryPriority(left.priority);
                    const rightPriority = normalizeCategoryPriority(right.priority);
                    if (leftPriority !== null && rightPriority !== null && leftPriority !== rightPriority) return leftPriority - rightPriority;
                    return left.category.localeCompare(right.category, 'it');
                });
                delete group.subgroupMap;
                return group;
            });
            return output.sort((left, right) => {
                const leftPriority = normalizeCategoryPriority(left.priority);
                const rightPriority = normalizeCategoryPriority(right.priority);
                if (leftPriority !== null && rightPriority !== null && leftPriority !== rightPriority) return leftPriority - rightPriority;
                if (leftPriority !== null && rightPriority === null) return -1;
                if (leftPriority === null && rightPriority !== null) return 1;
                if (!left.category && right.category) return 1;
                if (left.category && !right.category) return -1;
                return left.category.localeCompare(right.category, 'it');
            });
        }

        function normalizeCategoryPriority(value) {
            return window.CriptaCharacterNormalize.normalizeCategoryPriority(value);
        }

        function normalizeCharacterBlocks(character) {
            if (Array.isArray(character.content_blocks)) return character.content_blocks;
            if (!Array.isArray(character.blocks)) return [];
            return character.blocks.map((block) => ({
                type: block.type === 'image' || block.image ? 'image_box' : 'lore',
                title: block.title || 'Informazioni',
                icon: block.icon || 'fa-book-open',
                image: block.image || '',
                hidden: Boolean(block.hidden),
                markdownText: block.text || '',
                markdownHtml: block.text ? renderMarkdown(block.text) : ''
            }));
        }

        function renderMarkdown(markdown) {
            return window.CriptaMarkdown.render(markdown);
        }

        async function loadCharactersManifest(base_path) {
            const yamlUrl = window.CriptaApp?.urls?.data?.('characters/index.yaml') || base_path + 'data/characters/index.yaml';
            try {
                const resp = await fetch(yamlUrl);
                if (resp.ok) {
                    const text = await resp.text();
                    const parsed = parseYamlLite(text);
                    if (Array.isArray(parsed)) return parsed;
                }
            } catch (err) {
                console.warn('Impossibile leggere manifest YAML, provo JSON:', err);
            }

            const jsonUrl = window.CriptaApp?.urls?.data?.('characters/index.json') || base_path + 'data/characters/index.json';
            const jsonResp = await fetch(jsonUrl);
            if (jsonResp.ok) return jsonResp.json();

            throw new Error('Impossibile caricare il manifest dei personaggi.');
        }

        async function loadCharacterYaml(entry, base_path) {
            const filePath = entry.file || `characters/${entry.id}.yaml`;
            const yamlUrl = window.CriptaApp?.urls?.data?.(filePath) || base_path + 'data/' + filePath;
            try {
                const resp = await fetch(yamlUrl);
                if (resp.ok) {
                    const text = await resp.text();
                    const parsed = parseYamlLite(text);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
                }
            } catch (err) {
                console.warn(`Impossibile leggere YAML per ${entry.id}, provo JSON:`, err);
            }

            const jsonUrl = yamlUrl.replace(/\\.yaml$/, '.json');
            const jsonResp = await fetch(jsonUrl);
            if (jsonResp.ok) return jsonResp.json();
            console.error(`Impossibile caricare i dati del personaggio ${entry.id}`);
            return null;
        }

        function normalizeRosterSearch(value) {
            return String(value || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLocaleLowerCase('it')
                .trim();
        }

        function initNpcRosterControls(container, options = {}) {
            const search = document.getElementById('npc-search');
            const npcFilters = document.getElementById('npc-status-filters');
            const typeFilters = document.getElementById('npc-type-filters');
            const sortSwitch = document.querySelector('[data-npc-sort-switch]');
            const archiveToggle = typeFilters?.querySelector('[data-roster-archive-toggle]');
            const archiveCount = archiveToggle?.querySelector('[data-roster-archive-count]');
            const count = document.getElementById('npc-count');
            const empty = document.getElementById('npc-filter-empty');
            const createAction = document.querySelector('[data-npc-create-link]');
            const editToggle = document.querySelector('[data-npc-edit-toggle]');
            const state = { query: '', npcStatus: 'all', type: 'person', showArchived: false, editing: false, sortMode: normalizeNpcRosterSortMode(options.sortMode) };

            const syncSortSwitch = () => {
                sortSwitch?.querySelectorAll('[data-npc-sort]').forEach((button) => {
                    const active = normalizeNpcRosterSortMode(button.dataset.npcSort) === state.sortMode;
                    button.classList.toggle('is-active', active);
                    button.setAttribute('aria-pressed', active ? 'true' : 'false');
                });
            };

            const apply = () => {
                if (editToggle) {
                    editToggle.hidden = options.canEdit !== true;
                    editToggle.classList.toggle('is-active', state.editing);
                    editToggle.setAttribute('aria-pressed', String(state.editing));
                    editToggle.innerHTML = state.editing
                        ? '<i class="fas fa-check" aria-hidden="true"></i><span>Fine modifica</span>'
                        : '<i class="fas fa-pen" aria-hidden="true"></i><span>Modifica</span>';
                }
                document.querySelectorAll('[data-npc-edit-action]').forEach((action) => { action.hidden = !state.editing; });
                if (!state.editing) {
                    state.showArchived = false;
                    archiveToggle?.classList.remove('is-active');
                    archiveToggle?.setAttribute('aria-pressed', 'false');
                }
                const query = normalizeRosterSearch(state.query);
                const isGlobalSearch = Boolean(query) && state.type !== 'merchant';
                const isBestiary = state.type === 'creature';
                if (isBestiary && state.npcStatus !== 'all') {
                    state.npcStatus = 'all';
                    npcFilters?.querySelectorAll('[data-roster-filter]').forEach((entry) => {
                        const active = entry.dataset.rosterFilter === 'all';
                        entry.classList.toggle('is-active', active);
                        entry.setAttribute('aria-pressed', active ? 'true' : 'false');
                    });
                }
                if (npcFilters) npcFilters.hidden = isBestiary;
                if (search) search.placeholder = state.type === 'merchant'
                    ? 'Cerca tra i mercanti...'
                    : 'Cerca in NPC, Bestiario e Altri...';
                if (createAction) createAction.innerHTML = isBestiary
                    ? '<i class="fas fa-plus"></i><span>Nuova creatura</span>'
                    : '<i class="fas fa-plus"></i><span>Nuovo NPC</span>';
                if (typeFilters) typeFilters.dataset.activeDirectory = state.type;
                const cards = Array.from(container.querySelectorAll('[data-roster-card="npc"]'));
                const archivedTotal = cards.filter((card) => card.dataset.rosterArchived === 'true').length;
                if (archiveCount) archiveCount.textContent = String(archivedTotal);
                let visibleTotal = 0;
                cards.forEach((card) => {
                    const tags = String(card.dataset.rosterTags || '').split(' ').filter(Boolean);
                    const matchesQuery = !query || String(card.dataset.rosterSearch || '').includes(query);
                    const matchesStatus = state.npcStatus === 'all' || card.dataset.rosterStatus === state.npcStatus;
                    const matchesType = isGlobalSearch
                        || (state.type === 'merchant' && tags.includes('mercante'))
                        || card.dataset.rosterSection === state.type;
                    const matchesArchive = state.showArchived ? card.dataset.rosterArchived === 'true' : card.dataset.rosterArchived !== 'true';
                    card.hidden = !(matchesQuery && matchesStatus && matchesType && matchesArchive);
                    if (!card.hidden) visibleTotal += 1;
                });
                container.querySelectorAll('.npc-subcategory-group').forEach((section) => {
                    const visibleCards = Array.from(section.querySelectorAll('[data-roster-card="npc"]')).filter((card) => !card.hidden);
                    section.hidden = visibleCards.length === 0;
                    const sectionCount = section.querySelector('.npc-subcategory-count');
                    if (sectionCount) sectionCount.textContent = String(visibleCards.length);
                    const userCollapsed = section.dataset.npcSubcategoryCollapsed === 'true';
                    setNpcSubcategoryCollapsed(section, Boolean(query) && visibleCards.length ? false : userCollapsed);
                });
                container.querySelectorAll('.npc-category-group').forEach((section) => {
                    const visibleCards = Array.from(section.querySelectorAll('[data-roster-card="npc"]')).filter((card) => !card.hidden);
                    section.hidden = visibleCards.length === 0;
                    const chapter = section._npcAtlasChapter;
                    if (chapter) {
                        chapter.hidden = section.hidden;
                        if (chapter.hidden) chapter.removeAttribute('aria-current');
                    }
                    const sectionCount = section.querySelector('.npc-category-count');
                    if (sectionCount) sectionCount.textContent = String(visibleCards.length);
                });
                const atlasIndex = container.parentElement.querySelector('[data-npc-atlas-index]');
                if (atlasIndex) atlasIndex.parentElement.hidden = !atlasIndex.querySelector('button:not([hidden])');
                if (count) {
                    const noun = isGlobalSearch
                        ? (visibleTotal === 1 ? 'risultato' : 'risultati')
                        : state.type === 'creature'
                            ? (visibleTotal === 1 ? 'creatura' : 'creature')
                            : state.type === 'merchant'
                                ? (visibleTotal === 1 ? 'mercante' : 'mercanti')
                                : state.type === 'other'
                                    ? (visibleTotal === 1 ? 'voce in Altri' : 'voci in Altri')
                                    : 'NPC';
                    count.textContent = `${visibleTotal} ${noun}`;
                }
                if (empty) {
                    empty.hidden = visibleTotal !== 0;
                    const title = empty.querySelector('[data-roster-empty-title]');
                    if (title) title.textContent = state.showArchived
                        ? 'Nessun elemento archiviato'
                        : isGlobalSearch
                            ? 'Nessun risultato'
                            : state.type === 'creature'
                                ? 'Nessuna creatura nel Bestiario'
                                : state.type === 'other' ? 'Nessun NPC nella sezione Altri' : 'Nessun NPC trovato';
                }
                options.onFiltersApplied?.();
            };

            editToggle?.addEventListener('click', () => {
                if (options.canEdit !== true) return;
                state.editing = !state.editing;
                closeNpcRosterPicker();
                options.onEditModeChange?.(state.editing);
                apply();
            });
            search?.addEventListener('input', (event) => { state.query = event.target.value; apply(); });
            sortSwitch?.addEventListener('click', (event) => {
                const button = event.target.closest('[data-npc-sort]');
                if (!button) return;
                const sortMode = normalizeNpcRosterSortMode(button.dataset.npcSort);
                if (sortMode === state.sortMode) return;
                state.sortMode = writeNpcRosterSortMode(sortMode);
                syncSortSwitch();
                options.onSortModeChange?.(state.sortMode);
            });
            npcFilters?.addEventListener('click', (event) => {
                const button = event.target.closest('[data-roster-filter]');
                if (!button) return;
                state.npcStatus = button.dataset.rosterFilter || 'all';
                npcFilters.querySelectorAll('[data-roster-filter]').forEach((entry) => {
                    const active = entry === button;
                    entry.classList.toggle('is-active', active);
                    entry.setAttribute('aria-pressed', active ? 'true' : 'false');
                });
                apply();
            });
            typeFilters?.addEventListener('click', (event) => {
                const typeButton = event.target.closest('[data-roster-type]');
                if (typeButton) {
                    state.type = typeButton.dataset.rosterType || 'person';
                    typeFilters.querySelectorAll('[data-roster-type]').forEach((entry) => {
                        const active = entry === typeButton;
                        entry.classList.toggle('is-active', active);
                        entry.setAttribute('aria-pressed', active ? 'true' : 'false');
                    });
                }
                const archiveButton = event.target.closest('[data-roster-archive-toggle]');
                if (archiveButton && state.editing) {
                    state.showArchived = !state.showArchived;
                    archiveButton.classList.toggle('is-active', state.showArchived);
                    archiveButton.setAttribute('aria-pressed', state.showArchived ? 'true' : 'false');
                }
                if (typeButton || archiveButton) apply();
            });
            syncSortSwitch();
            apply();
            return apply;
        }
        function createNpcCard(npc, base_path, canEdit = false, options = {}) {
            const statusMap = {
                vivo: { text: 'VIVO', class: 'status-vivo' },
                morto: { text: 'MORTO', class: 'status-morto' },
                ignoto: { text: 'IGNOTO', class: 'status-ignoto' }
            };
            const statusInfo = statusMap[npc.status] || null;
            const canMoveCategory = canEdit && npc.managedProfileCanEdit === true && !npc.pendingCreate && Boolean(npc.managedActorWorldId && npc.managedActorId);
            const canChangeVisibility = canMoveCategory;
            const canChangeLifeState = canMoveCategory && npc.kind !== 'creature';
            const lifeStateBadge = canChangeLifeState
                ? `<span class="npc-status-badge npc-life-state-control ${statusInfo?.class || 'status-none'}" role="button" tabindex="0" aria-haspopup="dialog" aria-expanded="false" aria-label="Cambia stato di ${escapeNpcAttribute(npc.name)}: ${statusInfo?.text || 'Nessuno'}" title="Cambia stato">${statusInfo?.text || 'NESSUNO'}<i class="fas fa-chevron-down" aria-hidden="true"></i></span>`
                : statusInfo && npc.kind !== 'creature' && !npc.pendingCreate
                    ? `<span class="npc-status-badge ${statusInfo.class}">${statusInfo.text}</span>` : '';
            const role = String(npc.role || '').trim();
            const roleLabel = /^npc$/i.test(role) ? '' : role;
            const updatedAtLabel = options.showUpdatedAt ? formatNpcUpdatedAt(npc.updatedAt) : '';
            const categoryLabel = options.showUpdatedAt
                ? [npc.categoryParent, npc.category].map((value) => String(value || '').trim()).filter((value, index, values) => value && values.indexOf(value) === index).join(' / ')
                : '';

            const card = document.createElement('a');
            card.href = npc.pendingCreate ? '#' : (npc.detailUrl || npc.managedActorUrl || buildNpcDetailUrl({ id: npc.id, type: 'npc' }));
            card.className = 'npc-card';
            card.classList.toggle('is-category-saving', Boolean(npc.profileSaving));
            card.draggable = false;
            card.dataset.rosterCard = 'npc';
            card.dataset.rosterStatus = ['vivo', 'morto', 'ignoto'].includes(String(npc.status || '').toLowerCase()) ? String(npc.status).toLowerCase() : 'none';
            card.dataset.rosterKind = npc.kind === 'creature' ? 'creature' : 'person';
            card.dataset.rosterSection = card.dataset.rosterKind === 'creature' ? 'creature' : (npc.categoryRosterSection === 'other' ? 'other' : 'person');
            card.dataset.rosterTags = (Array.isArray(npc.tags) ? npc.tags : []).join(' ');
            card.dataset.rosterArchived = npc.archived === true ? 'true' : 'false';
            card.dataset.rosterSearch = normalizeRosterSearch([npc.name, npc.role, npc.quote, npc.categoryParent, npc.category, npc.status, npc.statusNote, npc.kind, ...(npc.tags || []), npc.searchTerms].filter(Boolean).join(' '));
            card.dataset.managedActorWorld = String(npc.managedActorWorldId || '');
            card.dataset.managedActorId = String(npc.managedActorId || '');
            card.dataset.npcCategoryId = String(npc.categoryId || '');
            card.dataset.rosterUpdatedAt = String(npc.updatedAt || '');
            const hiddenFromPlayers = npc.hidden === true || npc.status === 'hidden';
            if (hiddenFromPlayers) card.classList.add('npc-card--dm-hidden');
            if (npc.archived) card.classList.add('npc-card--archived');
            if (npc.pendingCreate) {
                card.classList.add('npc-card--pending');
                card.setAttribute('aria-disabled', 'true');
                card.addEventListener('click', (event) => event.preventDefault());
            }
            const hasDedicatedIdle = npc.images.hasDedicatedIdle ?? Boolean(npc.images.idle);
            const hasDedicatedHover = npc.images.hasDedicatedHover ?? Boolean(npc.images.hover);
            const avatarImage = npc.images.idle || npc.images.token || npc.images.avatar || '';
            const hoverImage = npc.images.hover || npc.images.token || avatarImage;
            // Le immagini dedicate hanno la priorit?; token resta il fallback
            // soltanto quando idle/hover ? assente o il file non ? disponibile.
            const avatarFallback = npc.images.idleFallback || npc.images.token || npc.images.avatarFallback || '';
            const tokenOnly = Boolean(avatarImage && !hasDedicatedIdle && npc.images.token
                && normalizeImageIdentity(avatarImage) === normalizeImageIdentity(npc.images.token));
            const hoverFallback = npc.images.hoverFallback || npc.images.token || avatarFallback;
            if (normalizeImageIdentity(avatarImage) === normalizeImageIdentity(hoverImage)) {
                card.classList.add('npc-card--no-avatar-swap');
            }
            const visibilityBadge = hiddenFromPlayers
                ? '<span class="npc-player-visibility-badge"><i class="fas fa-user-shield" aria-hidden="true"></i>Solo DM</span>'
                : '';
            const sync = npc.sync || {};
            const syncProblems = Number(sync.conflicts || 0) + Number(sync.failed || 0);
            const syncBadge = syncProblems
                ? `<span class="npc-sync-badge is-conflict"><i class="fas fa-triangle-exclamation"></i>${syncProblems} problemi</span>`
                : Number(sync.pending || 0) > 0
                    ? `<span class="npc-sync-badge is-pending"><i class="fas fa-clock"></i>${Number(sync.pending)} in attesa</span>`
                    : '';
            const avatarMarkup = avatarImage
                ? `<img src="${resolveNpcImageUrl(npc, avatarImage, base_path)}" data-original-src="${resolveNpcImageUrl(npc, avatarImage, base_path)}" data-fallback-src="${resolveNpcImageUrl(npc, avatarFallback, base_path)}" data-media-dedicated="${hasDedicatedIdle ? 'true' : 'false'}" alt="${escapeNpcAttribute(npc.name)}" class="npc-img-pop img-main" loading="eager" decoding="async" fetchpriority="auto" style="${buildImageStyle('avatar', npc.images.idleAdjust || npc.images.avatarAdjust, npc.images.hoverAdjust)}"><img src="${resolveNpcImageUrl(npc, hoverImage, base_path)}" data-original-src="${resolveNpcImageUrl(npc, hoverImage, base_path)}" data-fallback-src="${resolveNpcImageUrl(npc, hoverFallback, base_path)}" data-media-dedicated="${hasDedicatedHover ? 'true' : 'false'}" alt="${escapeNpcAttribute(npc.name)} Reveal" class="npc-img-pop img-hover" loading="lazy" decoding="async" fetchpriority="low" style="${buildImageStyle('hover', npc.images.hoverAdjust, npc.images.idleAdjust || npc.images.avatarAdjust)}">`
                : '<span class="npc-avatar-placeholder"><i class="fas fa-hourglass-half"></i></span>';

            card.innerHTML = `
                ${canMoveCategory ? `<span class="npc-selection-control" role="checkbox" tabindex="0" aria-checked="false" aria-label="Seleziona ${escapeNpcAttribute(npc.name)}" title="Seleziona NPC"><i class="fas fa-check" aria-hidden="true"></i></span>` : ''}
                ${visibilityBadge}${npc.archived ? '<span class="npc-archive-badge"><i class="fas fa-box-archive"></i>Archiviato</span>' : ''}${syncBadge}
                <div class="npc-atlas-plate${tokenOnly ? ' npc-atlas-plate--token' : ''}"><div class="npc-avatar-container">${avatarMarkup}</div></div>
                <div class="npc-info">
                    <div class="npc-header">
                        <div class="npc-title-row"><h3 class="npc-name">${escapeNpcAttribute(npc.name)}</h3>${lifeStateBadge}</div>
                        ${roleLabel ? `<span class="npc-role">${escapeNpcAttribute(roleLabel)}</span>` : ''}
                        <span class="npc-kind-badge"><i class="fas ${npc.kind === 'creature' ? 'fa-dragon' : 'fa-user'}"></i>${npc.kind === 'creature' ? 'Creatura' : 'Personaggio'}</span>
                        ${options.showUpdatedAt ? `<span class="npc-updated-meta">${categoryLabel ? `<span><i class="fas fa-folder" aria-hidden="true"></i>${escapeNpcAttribute(categoryLabel)}</span>` : ''}${updatedAtLabel ? `<time datetime="${escapeNpcAttribute(npc.updatedAt)}" title="Ultima modifica: ${escapeNpcAttribute(updatedAtLabel)}"><i class="fas fa-clock-rotate-left" aria-hidden="true"></i>${escapeNpcAttribute(updatedAtLabel)}</time>` : '<span><i class="fas fa-clock" aria-hidden="true"></i>Data non disponibile</span>'}</span>` : ''}
                    </div>
                    <p class="npc-desc">${escapeNpcAttribute(npc.quote || '')}</p>
                </div>
                <span class="npc-card-actions">
                    ${canMoveCategory ? '<span class="npc-category-drag-handle npc-category-picker-trigger" role="button" tabindex="0" draggable="false" aria-haspopup="dialog" aria-expanded="false" title="Cambia categoria. Puoi anche trascinare." aria-label="Sposta ' + escapeNpcAttribute(npc.name) + ' in una categoria diversa"><i class="fas fa-folder-open" aria-hidden="true"></i><span>Sposta</span></span>' : ''}
                    ${canChangeVisibility ? '<span class="npc-profile-visibility" role="switch" tabindex="0" aria-label="Dossier visibile a tutti: ' + escapeNpcAttribute(npc.name) + '"><span class="npc-visibility-caption" aria-hidden="true">Dossier</span><span class="npc-visibility-track" aria-hidden="true"></span><span class="npc-visibility-state" aria-hidden="true"></span></span>' : ''}
                    ${canMoveCategory ? `<span class="npc-archive-control" role="button" tabindex="0" data-npc-lifecycle-action="${npc.archived ? 'active' : 'archived'}" title="${npc.archived ? 'Ripristina nell’elenco' : 'Sposta nell’archivio'}" aria-label="${npc.archived ? 'Ripristina' : 'Archivia'} ${escapeNpcAttribute(npc.name)}"><i class="fas ${npc.archived ? 'fa-rotate-left' : 'fa-trash-can'}" aria-hidden="true"></i>${npc.archived ? '<span>Ripristina</span>' : ''}</span>` : ''}
                    <i class="fas fa-chevron-right arrow-icon"></i>
                </span>
            `;
            if (canChangeVisibility) {
                const visibilityControl = card.querySelector('.npc-profile-visibility');
                const toggleVisibility = async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (npc.visibilitySaving || npc.profileSaving) return;
                    npc.visibilitySaving = true;
                    updateNpcDossierVisibilityControl(card, npc);
                    try {
                        await setNpcDossierVisibility(npc, npc.managedProfileVisibility !== 'public');
                        showNpcRosterFeedback(npc.managedProfileVisibility === 'public'
                            ? `Dossier di ${npc.name} visibile a tutti.`
                            : `Dossier di ${npc.name} visibile solo al DM.`, 'success');
                    } catch (error) {
                        const conflict = error?.status === 409 || /revision conflict/i.test(error?.message || '');
                        showNpcRosterFeedback(conflict
                            ? 'Il dossier è cambiato. Ricarica l’elenco e riprova.'
                            : 'Visibilità non aggiornata. Riprova o verifica di essere connesso come DM.', 'error');
                    } finally {
                        npc.visibilitySaving = false;
                        updateNpcDossierVisibilityControl(card, npc);
                    }
                };
                visibilityControl.addEventListener('click', toggleVisibility);
                visibilityControl.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') toggleVisibility(event);
                });
                updateNpcDossierVisibilityControl(card, npc);
            }
            const frameHost = card.querySelector(".npc-avatar-container");
            const mainImage = card.querySelector(".img-main");
            const hoverImageElement = card.querySelector(".img-hover");
            const idleCircle = window.CriptaImageAdjust?.normalizeFrameCircle?.(npc.images.idleFrameCircle);
            const hoverCircle = window.CriptaImageAdjust?.normalizeFrameCircle?.(npc.images.hoverFrameCircle);
            if (idleCircle || hoverCircle) frameHost.dataset.frameCircleHost = "true";
            if (idleCircle) window.CriptaImageAdjust.setFrameCircleDataset(mainImage, idleCircle, { scale: .85 });
            if (hoverCircle) window.CriptaImageAdjust.setFrameCircleDataset(hoverImageElement, hoverCircle, { scale: 1 });
            if (idleCircle || hoverCircle) requestAnimationFrame(() => window.CriptaImageAdjust?.initFrameCircleImages?.(card));
            return card;

        }

        let npcRosterPicker = null;

        function closeNpcRosterPicker(restoreFocus = false) {
            npcRosterPicker?.close(restoreFocus);
        }

        function openNpcRosterPicker(trigger, { title, searchable = false, options, onSelect }) {
            if (npcRosterPicker?.trigger === trigger) {
                closeNpcRosterPicker(true);
                return;
            }
            closeNpcRosterPicker();
            const panel = document.createElement('div');
            panel.id = 'npc-roster-picker';
            panel.className = 'npc-roster-picker';
            panel.setAttribute('popover', 'auto');
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-labelledby', 'npc-roster-picker-title');
            panel.innerHTML = `
                <div class="npc-roster-picker-heading"><h2 id="npc-roster-picker-title">${escapeNpcAttribute(title)}</h2><button type="button" data-npc-picker-close aria-label="Chiudi"><i class="fas fa-xmark" aria-hidden="true"></i></button></div>
                ${searchable ? '<input type="search" data-npc-picker-search aria-label="Cerca categoria" placeholder="Cerca categoria…" autocomplete="off">' : ''}
                <div class="npc-roster-picker-options">${options.map((option) => `<button type="button" data-npc-picker-value="${escapeNpcAttribute(option.value)}" data-npc-picker-search-text="${escapeNpcAttribute(normalizeRosterSearch(option.label))}" class="${option.current ? 'is-current' : ''}"${option.current ? ' aria-current="true"' : ''}${option.lifeState ? ` data-life-state="${escapeNpcAttribute(option.lifeState)}"` : ''}><i class="fas ${escapeNpcAttribute(option.icon || 'fa-folder-open')}" aria-hidden="true"></i><span>${escapeNpcAttribute(option.label)}</span>${option.current ? '<i class="fas fa-check" aria-hidden="true"></i>' : ''}</button>`).join('')}</div>
                <p data-npc-picker-empty hidden>Nessuna categoria trovata.</p>`;
            document.body.appendChild(panel);
            const controller = new AbortController();
            const close = (restoreFocus = false) => {
                if (npcRosterPicker?.panel !== panel) return;
                npcRosterPicker = null;
                controller.abort();
                trigger.setAttribute('aria-expanded', 'false');
                trigger.removeAttribute('aria-controls');
                if (typeof panel.hidePopover === 'function' && panel.matches(':popover-open')) panel.hidePopover();
                panel.remove();
                if (restoreFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
            };
            npcRosterPicker = { panel, trigger, close };
            trigger.setAttribute('aria-expanded', 'true');
            trigger.setAttribute('aria-controls', panel.id);
            panel.addEventListener('toggle', (event) => {
                if (event.newState === 'closed') close();
            }, { signal: controller.signal });
            panel.showPopover?.();
            const anchor = trigger.getBoundingClientRect();
            const bounds = panel.getBoundingClientRect();
            const inset = 12;
            panel.style.left = `${Math.max(inset, Math.min(anchor.left, window.innerWidth - bounds.width - inset))}px`;
            const below = anchor.bottom + 6;
            panel.style.top = `${Math.max(inset, below + bounds.height <= window.innerHeight - inset ? below : Math.min(anchor.top - bounds.height - 6, window.innerHeight - bounds.height - inset))}px`;
            panel.querySelector('[data-npc-picker-close]').addEventListener('click', () => close(true));
            const buttons = [...panel.querySelectorAll('[data-npc-picker-value]')];
            for (const button of buttons) {
                button.addEventListener('click', () => {
                    const value = button.dataset.npcPickerValue;
                    close(true);
                    onSelect(value);
                });
            }
            const search = panel.querySelector('[data-npc-picker-search]');
            search?.addEventListener('input', () => {
                const terms = normalizeRosterSearch(search.value).split(' ').filter(Boolean);
                buttons.forEach((button) => {
                    button.hidden = !terms.every((term) => button.dataset.npcPickerSearchText.includes(term));
                });
                panel.querySelector('[data-npc-picker-empty]').hidden = buttons.some((button) => !button.hidden);
            });
            panel.addEventListener('keydown', (event) => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                if (event.target === search && event.key !== 'ArrowDown') return;
                const visible = buttons.filter((button) => !button.hidden);
                if (!visible.length) return;
                event.preventDefault();
                const current = visible.indexOf(document.activeElement);
                const index = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1
                    : event.key === 'ArrowDown' ? (current + 1) % visible.length : (current - 1 + visible.length) % visible.length;
                visible[index].focus();
            });
            document.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                close(true);
            }, { capture: true, signal: controller.signal });
            document.addEventListener('pointerdown', (event) => {
                if (!panel.contains(event.target) && !trigger.contains(event.target)) close();
            }, { signal: controller.signal });
            document.addEventListener('focusin', (event) => {
                if (!panel.contains(event.target) && !trigger.contains(event.target)) close();
            }, { signal: controller.signal });
            window.addEventListener('resize', () => close(), { signal: controller.signal });
            window.addEventListener('scroll', (event) => {
                if (!panel.contains(event.target)) close();
            }, { capture: true, signal: controller.signal });
            (search || panel.querySelector('.is-current') || buttons[0])?.focus({ preventScroll: true });
        }

        function initNpcRosterBulkActions(container, state) {
            const toolbar = document.querySelector('[data-npc-bulk-actions]');
            if (!toolbar) return;
            const selected = state.selectedNpcKeys ||= new Set();
            const keyOf = (npc) => managedNpcRosterKey(npc?.managedActorWorldId, npc?.managedActorId);
            const npcByKey = new Map(state.npcs.map((npc) => [keyOf(npc), npc]));
            const selectAll = toolbar.querySelector('[data-npc-bulk-select-all]');
            const clear = toolbar.querySelector('[data-npc-bulk-clear]');
            const categoryButton = toolbar.querySelector('[data-npc-bulk-category]');
            const lifecycleButton = toolbar.querySelector('[data-npc-bulk-lifecycle]');
            const archiveView = () => document.querySelector('[data-roster-archive-toggle]')?.getAttribute('aria-pressed') === 'true';
            const visibleCards = () => [...container.querySelectorAll('[data-roster-card="npc"]')]
                .filter((card) => !card.hidden && card.querySelector('.npc-selection-control'));
            const cardKey = (card) => managedNpcRosterKey(card.dataset.managedActorWorld, card.dataset.managedActorId);
            const sync = () => {
                toolbar.hidden = state.canEdit !== true;
                const visible = new Set(visibleCards().map(cardKey));
                for (const key of selected) {
                    if (!state.canEdit || !visible.has(key)) selected.delete(key);
                }
                container.querySelectorAll('.npc-selection-control').forEach((control) => {
                    const card = control.closest('[data-roster-card="npc"]');
                    const key = cardKey(card);
                    const npc = npcByKey.get(key);
                    const checked = selected.has(key);
                    card.classList.toggle('is-selected', checked);
                    control.setAttribute('aria-checked', String(checked));
                    control.setAttribute('aria-disabled', String(Boolean(state.bulkSaving || npc?.profileSaving || npc?.visibilitySaving)));
                });
                toolbar.querySelector('[data-npc-bulk-count]').textContent = selected.size
                    ? `${selected.size} NPC selezionat${selected.size === 1 ? 'o' : 'i'}` : 'Nessun NPC selezionato';
                toolbar.setAttribute('aria-busy', String(Boolean(state.bulkSaving)));
                selectAll.disabled = Boolean(state.bulkSaving) || !visible.size;
                clear.disabled = categoryButton.disabled = lifecycleButton.disabled = Boolean(state.bulkSaving) || !selected.size;
                lifecycleButton.innerHTML = archiveView()
                    ? '<i class="fas fa-rotate-left" aria-hidden="true"></i><span>Ripristina selezionati</span>'
                    : '<i class="fas fa-trash-can" aria-hidden="true"></i><span>Archivia selezionati</span>';
                toolbar.querySelector('[data-npc-bulk-status]').textContent = state.bulkMessage || '';
                document.querySelectorAll('#npc-search, #npc-type-filters button, #npc-status-filters button, [data-npc-sort-switch] button, [data-npc-edit-toggle], [data-npc-edit-action]').forEach((control) => {
                    control.disabled = Boolean(state.bulkSaving);
                });
            };
            state.syncBulkSelection = sync;
            const toggleSelection = (event) => {
                const control = event.target.closest('.npc-selection-control');
                if (!control || !container.contains(control)) return;
                if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
                event.preventDefault();
                event.stopPropagation();
                const key = cardKey(control.closest('[data-roster-card="npc"]'));
                const npc = npcByKey.get(key);
                if (!state.canEdit || state.bulkSaving || !npc || npc.profileSaving || npc.visibilitySaving) return;
                if (selected.has(key)) selected.delete(key);
                else selected.add(key);
                state.bulkMessage = '';
                sync();
            };
            container.addEventListener('click', toggleSelection);
            container.addEventListener('keydown', toggleSelection);
            selectAll.addEventListener('click', () => {
                if (!state.canEdit || state.bulkSaving) return;
                visibleCards().forEach((card) => {
                    const key = cardKey(card);
                    const npc = npcByKey.get(key);
                    if (npc && !npc.profileSaving && !npc.visibilitySaving) selected.add(key);
                });
                state.bulkMessage = '';
                sync();
            });
            clear.addEventListener('click', () => {
                if (state.bulkSaving) return;
                selected.clear();
                state.bulkMessage = '';
                sync();
            });
            const runBulk = async (change, { singular, plural, suffix = '' }) => {
                if (!state.canEdit || state.bulkSaving) return;
                sync();
                const targets = [...selected].map((key) => npcByKey.get(key)).filter(Boolean);
                if (!targets.length) return;
                closeNpcRosterPicker();
                state.bulkSaving = true;
                sync();
                try {
                    const result = await saveNpcBulkChanges(targets, change, ({ completed, total, npc }) => {
                        if (npc) updateNpcDossierVisibilityControl(null, npc);
                        else targets.forEach((entry) => updateNpcDossierVisibilityControl(null, entry));
                        state.bulkMessage = `Salvataggio ${completed} di ${total}…`;
                        sync();
                    });
                    for (const npc of result.succeeded) {
                        selected.delete(keyOf(npc));
                        if (npc.categorySubcategoryId) writeNpcSubcategoryCollapsed(npcSubcategoryStorageKey(npc.categoryGroupId, npc.categorySubcategoryId), false);
                    }
                    const count = result.succeeded.length;
                    state.bulkMessage = count ? `${count} NPC ${count === 1 ? singular : plural}${suffix}.` : 'Nessun NPC aggiornato.';
                    if (result.failed.length) {
                        const names = result.failed.slice(0, 3).map(({ npc }) => npc.name).join(', ');
                        state.bulkMessage += ` ${result.failed.length} non aggiornat${result.failed.length === 1 ? 'o' : 'i'} (${names}${result.failed.length > 3 ? '…' : ''}): restano selezionati.`;
                        if (result.failed.some(({ error }) => error?.status === 409 || /revision conflict/i.test(error?.message || ''))) {
                            state.bulkMessage += ' Alcuni dossier sono cambiati: ricarica l’elenco prima di riprovare.';
                        }
                    }
                    showNpcRosterFeedback(state.bulkMessage, result.failed.length ? 'error' : 'success');
                } catch (error) {
                    state.bulkMessage = error?.message || 'Operazione non completata. Verifica gli NPC selezionati.';
                    showNpcRosterFeedback(state.bulkMessage, 'error');
                } finally {
                    state.bulkSaving = false;
                    state.render?.();
                    sync();
                }
            };
            categoryButton.addEventListener('click', () => {
                if (!state.canEdit || state.bulkSaving || !selected.size) return;
                const categories = [{ id: '', name: 'Senza categoria', icon: 'fa-box-archive' }, ...selectableNpcCategories(state.categoryRegistry)];
                openNpcRosterPicker(categoryButton, {
                    title: `Sposta ${selected.size} NPC`, searchable: true,
                    options: categories.map((category) => ({ value: category.id, label: `${category.parentName ? `${category.parentName} / ` : ''}${category.name}${category.rosterSection === 'other' ? ' · Altri' : ''}`, icon: category.icon })),
                    onSelect: (id) => {
                        const category = categories.find((entry) => entry.id === id);
                        runBulk((npc) => setNpcCategory(npc, id, state.categoryRegistry), { singular: 'spostato', plural: 'spostati', suffix: ` in ${category.name}` });
                    }
                });
            });
            lifecycleButton.addEventListener('click', () => {
                const restore = archiveView();
                runBulk((npc) => setNpcLifecycle(npc, restore ? 'active' : 'archived'), restore
                    ? { singular: 'ripristinato', plural: 'ripristinati' } : { singular: 'archiviato', plural: 'archiviati' });
            });
            sync();
        }

        function initNpcRosterQuickActions(container, state = {}) {
            if (!container) return;
            container._npcCategoryDragCleanup?.();
            if (state.canEdit !== true) return;
            const listenerController = new AbortController();
            container._npcCategoryDragCleanup = () => listenerController.abort();
            const movable = (Array.isArray(state.npcs) ? state.npcs : []).filter((npc) => npc?.managedProfileCanEdit === true && !npc.pendingCreate && npc?.managedActorWorldId && npc?.managedActorId);
            if (!movable.length) return;

            const npcByKey = new Map(movable.map((npc) => [managedNpcRosterKey(npc.managedActorWorldId, npc.managedActorId), npc]));
            const categories = selectableNpcCategories(state.categoryRegistry);
            const dock = document.createElement('div');
            dock.className = 'npc-category-drop-dock';
            dock.hidden = true;
            dock.setAttribute('aria-label', 'Categorie di destinazione');
            const targets = [{ id: '', name: 'Senza categoria', icon: 'fa-box-archive', parentId: '' }, ...categories];
            dock.innerHTML = `<span class="npc-category-drop-dock-label"><i class="fas fa-folder-tree"></i> Sposta in</span><div>${targets.map((category) => `<button type="button" class="${category.parentId ? 'is-subcategory' : ''}" data-npc-category-drop-id="${escapeNpcAttribute(category.id)}"><i class="fas ${escapeNpcAttribute(category.icon || 'fa-folder-open')}"></i><span>${category.parentId ? '↳ ' : ''}${escapeNpcAttribute(category.parentName ? `${category.parentName} / ${category.name}` : category.name)}</span></button>`).join('')}</div>`;
            container.prepend(dock);

            let draggedNpc = null;
            const findNpc = (card) => npcByKey.get(managedNpcRosterKey(card?.dataset.managedActorWorld, card?.dataset.managedActorId));
            const saveQuickChange = async (npc, card, save, message, focusSelector) => {
                if (npc.profileSaving || npc.visibilitySaving) return;
                npc.profileSaving = true;
                card.classList.add('is-category-saving');
                updateNpcDossierVisibilityControl(card, npc);
                let saved = false;
                try {
                    await save();
                    if (focusSelector === '.npc-category-picker-trigger' && npc.categorySubcategoryId) {
                        writeNpcSubcategoryCollapsed(npcSubcategoryStorageKey(npc.categoryGroupId, npc.categorySubcategoryId), false);
                    }
                    saved = true;
                    showNpcRosterFeedback(message, 'success');
                } catch (error) {
                    const conflict = error?.status === 409 || /revision conflict/i.test(error?.message || '');
                    showNpcRosterFeedback(conflict ? 'Il dossier è cambiato. Ricarica l’elenco e riprova.' : error?.message || 'Modifica non riuscita. Riprova.', 'error');
                } finally {
                    npc.profileSaving = false;
                    const restoreFocus = card.contains(document.activeElement);
                    if (saved) state.render?.();
                    card.classList.remove('is-category-saving');
                    updateNpcDossierVisibilityControl(card, npc);
                    if (saved && restoreFocus) {
                        const updatedCard = [...container.querySelectorAll('[data-roster-card="npc"]')].find((entry) => findNpc(entry) === npc);
                        if (updatedCard && !updatedCard.hidden) updatedCard.querySelector(focusSelector)?.focus({ preventScroll: true });
                        else if (focusSelector === '.npc-archive-control') document.querySelector('[data-roster-archive-toggle]')?.focus({ preventScroll: true });
                    }
                }
            };
            container.querySelectorAll('.npc-archive-control').forEach((trigger) => {
                const card = trigger.closest('[data-roster-card="npc"]');
                const npc = findNpc(card);
                const changeLifecycle = (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!npc || npc.profileSaving || npc.visibilitySaving) return;
                    const next = trigger.dataset.npcLifecycleAction;
                    saveQuickChange(npc, card, () => setNpcLifecycle(npc, next), next === 'archived'
                        ? `${npc.name} archiviato. Lo trovi nell’Archivio.`
                        : `${npc.name} ripristinato nell’elenco.`, '.npc-archive-control');
                };
                trigger.addEventListener('click', changeLifecycle);
                trigger.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') changeLifecycle(event);
                });
            });
            const openCategoryPicker = (trigger, npc, card) => {
                if (!npc || npc.profileSaving || npc.visibilitySaving) return;
                const currentId = window.CriptaNpcCategories.normalizeId(npc.categoryId || npc.category);
                openNpcRosterPicker(trigger, {
                    title: `Sposta ${npc.name}`,
                    searchable: true,
                    options: targets.map((category) => ({
                        value: category.id,
                        label: `${category.parentName ? `${category.parentName} / ` : ''}${category.name}${category.rosterSection === 'other' ? ' · Altri' : ''}`,
                        icon: category.icon,
                        current: category.id === currentId
                    })),
                    onSelect: (id) => {
                        if (id === currentId) return;
                        const category = targets.find((target) => target.id === id);
                        saveQuickChange(npc, card, () => setNpcCategory(npc, id, state.categoryRegistry), `${npc.name} spostato in ${category.name}.`, '.npc-category-picker-trigger');
                    }
                });
            };
            container.querySelectorAll('.npc-life-state-control').forEach((trigger) => {
                const card = trigger.closest('[data-roster-card="npc"]');
                const npc = findNpc(card);
                const open = (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!npc || npc.profileSaving || npc.visibilitySaving) return;
                    const choices = [
                        { value: 'alive', label: 'Vivo', icon: 'fa-heart' },
                        { value: 'unknown', label: 'Ignoto', icon: 'fa-question' },
                        { value: 'dead', label: 'Morto', icon: 'fa-skull' },
                        { value: 'none', label: 'Nessuno', icon: 'fa-minus' }
                    ];
                    const current = normalizeManagedNpcLifeState(npc.lifeState, npc.status);
                    openNpcRosterPicker(trigger, {
                        title: `Stato di ${npc.name}`,
                        options: choices.map((choice) => ({ ...choice, lifeState: choice.value, current: choice.value === current })),
                        onSelect: (value) => {
                            if (value === current) return;
                            const label = choices.find((choice) => choice.value === value).label;
                            saveQuickChange(npc, card, () => setNpcLifeState(npc, value), `Stato di ${npc.name} aggiornato: ${label}.`, '.npc-life-state-control');
                        }
                    });
                };
                trigger.addEventListener('click', open);
                trigger.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') open(event);
                });
            });
            const clearTargets = () => {
                stopDragAutoScroll();
                container.classList.remove('is-category-dragging');
                container.querySelectorAll('.is-category-drop-target').forEach((target) => target.classList.remove('is-category-drop-target'));
                container.querySelectorAll('.npc-card.is-category-drag-source').forEach((card) => card.classList.remove('is-category-drag-source'));
                dock.hidden = true;
            };
            const finishDrag = () => {
                draggedNpc = null;
                clearTargets();
            };
            const moveTo = async (categoryId, card = null) => {
                if (!draggedNpc) return;
                const npc = draggedNpc;
                const targetId = window.CriptaNpcCategories?.normalizeId?.(categoryId || '') || '';
                const currentId = window.CriptaNpcCategories?.normalizeId?.(npc.categoryId || npc.category || '') || '';
                finishDrag();
                if (targetId === currentId) {
                    showNpcRosterFeedback(`${npc.name} \u00e8 gi\u00e0 in ${npc.category || 'Senza categoria'}.`, 'info');
                    return;
                }
                const targetCategory = targetId
                    ? window.CriptaNpcCategories?.resolve?.(state.categoryRegistry, targetId, '')
                    : null;
                if (targetId && !targetCategory) {
                    showNpcRosterFeedback('Categoria non disponibile.', 'error');
                    return;
                }
                await saveQuickChange(npc, card, () => setNpcCategory(npc, targetId, state.categoryRegistry), `${npc.name} spostato in ${targetCategory?.name || 'Senza categoria'}.`, '.npc-category-picker-trigger');
            };

            const pointerDropTargetAt = (clientX, clientY) => {
                const node = document.elementFromPoint(clientX, clientY);
                const target = node?.closest?.('[data-npc-category-drop-id], .npc-subcategory-group, .npc-category-group') || null;
                return target && container.contains(target) ? target : null;
            };
            const pointerTargetCategoryId = (target) => {
                if (!target) return null;
                if (target.matches('[data-npc-category-drop-id]')) return target.dataset.npcCategoryDropId || '';
                if (target.matches('.npc-subcategory-group')) return target.dataset.npcSubcategory || '';
                return target.dataset.npcCategory || '';
            };
            const highlightPointerTarget = (target) => {
                container.querySelectorAll('.is-category-drop-target').forEach((entry) => entry.classList.remove('is-category-drop-target'));
                target?.classList.add('is-category-drop-target');
            };
            let pointerSession = null;
            let dragAutoScrollFrame = 0;
            let dragAutoScrollVelocity = 0;
            const stopDragAutoScroll = () => {
                dragAutoScrollVelocity = 0;
                if (dragAutoScrollFrame) cancelAnimationFrame(dragAutoScrollFrame);
                dragAutoScrollFrame = 0;
            };
            const runDragAutoScroll = () => {
                if (!pointerSession?.active || !dragAutoScrollVelocity) {
                    dragAutoScrollFrame = 0;
                    return;
                }
                const scrollingElement = document.scrollingElement || document.documentElement;
                const previousTop = scrollingElement.scrollTop;
                scrollingElement.scrollTop += dragAutoScrollVelocity;
                if (scrollingElement.scrollTop === previousTop) {
                    stopDragAutoScroll();
                    return;
                }
                highlightPointerTarget(pointerDropTargetAt(pointerSession.clientX, pointerSession.clientY));
                dragAutoScrollFrame = requestAnimationFrame(runDragAutoScroll);
            };
            const updateDragAutoScroll = (clientX, clientY) => {
                if (!pointerSession?.active) return;
                pointerSession.clientX = clientX;
                pointerSession.clientY = clientY;
                const directTarget = pointerDropTargetAt(clientX, clientY);
                if (directTarget?.matches?.('[data-npc-category-drop-id]')) {
                    stopDragAutoScroll();
                    return;
                }
                const viewportHeight = Math.max(1, window.innerHeight);
                const edgeSize = Math.min(120, Math.max(80, viewportHeight * .15));
                let nextVelocity = 0;
                if (clientY < edgeSize) {
                    const strength = Math.min(1, Math.max(0, (edgeSize - clientY) / edgeSize));
                    nextVelocity = -Math.round(4 + (20 * strength));
                } else if (clientY > viewportHeight - edgeSize) {
                    const strength = Math.min(1, Math.max(0, (clientY - (viewportHeight - edgeSize)) / edgeSize));
                    nextVelocity = Math.round(4 + (20 * strength));
                }
                dragAutoScrollVelocity = nextVelocity;
                if (!nextVelocity) {
                    stopDragAutoScroll();
                    return;
                }
                if (!dragAutoScrollFrame) dragAutoScrollFrame = requestAnimationFrame(runDragAutoScroll);
            };
            listenerController.signal.addEventListener('abort', stopDragAutoScroll, { once: true });
            const updatePointerSession = (event) => {
                const session = pointerSession;
                if (!session || session.pointerId !== event.pointerId) return;
                if (!session.active) {
                    const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
                    if (distance < 6) return;
                    closeNpcRosterPicker();
                    session.active = true;
                    draggedNpc = session.npc;
                    session.card.classList.add('is-category-drag-source');
                    container.classList.add('is-category-dragging');
                    dock.hidden = false;
                }
                event.preventDefault();
                event.stopPropagation();
                updateDragAutoScroll(event.clientX, event.clientY);
                highlightPointerTarget(pointerDropTargetAt(event.clientX, event.clientY));
            };
            const completePointerSession = (event, cancelled = false) => {
                const session = pointerSession;
                if (!session || session.pointerId !== event.pointerId) return;
                const wasActive = session.active;
                const target = wasActive && !cancelled ? pointerDropTargetAt(event.clientX, event.clientY) : null;
                pointerSession = null;
                if (session.handle?.hasPointerCapture?.(event.pointerId)) {
                    session.handle.releasePointerCapture(event.pointerId);
                }
                if (cancelled) {
                    finishDrag();
                    return;
                }
                if (!wasActive) return;
                session.handle._npcSuppressPickerUntil = Date.now() + 350;
                event.preventDefault();
                event.stopPropagation();
                const categoryId = pointerTargetCategoryId(target);
                if (categoryId === null) {
                    finishDrag();
                    return;
                }
                moveTo(categoryId, session.card);
            };
            document.addEventListener('pointermove', updatePointerSession, {
                capture: true,
                signal: listenerController.signal
            });
            document.addEventListener('pointerup', (event) => completePointerSession(event), {
                capture: true,
                signal: listenerController.signal
            });
            document.addEventListener('pointercancel', (event) => completePointerSession(event, true), {
                capture: true,
                signal: listenerController.signal
            });
            container.querySelectorAll('.npc-category-drag-handle').forEach((handle) => {
                const card = handle.closest('[data-roster-card="npc"]');
                const npc = findNpc(card);
                handle.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.detail > 0 && Date.now() < (handle._npcSuppressPickerUntil || 0)) return;
                    openCategoryPicker(handle, npc, card);
                });
                handle.addEventListener('keydown', (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    event.stopPropagation();
                    openCategoryPicker(handle, npc, card);
                });
                handle.addEventListener('pointerdown', (event) => {
                    if (event.button !== 0 || !npc || !card || npc.profileSaving || npc.visibilitySaving) return;
                    pointerSession = {
                        pointerId: event.pointerId,
                        startX: event.clientX,
                        startY: event.clientY,
                        active: false,
                        npc,
                        handle,
                        card
                    };
                    handle.setPointerCapture?.(event.pointerId);
                    event.preventDefault();
                    event.stopPropagation();
                });
            });

        }

        function managedNpcRosterKey(worldId, actorId) {
            return `${String(worldId || '').trim().toLowerCase()}:${String(actorId || '').trim().toLowerCase()}`;
        }

        async function saveManagedNpcProfilePatch(npc, data) {
            const token = String(window.CriptaDiscordAuth?.getToken?.() || window.CriptaApp?.auth?.getToken?.() || '').trim();
            if (!token) throw new Error('Accedi come DM per modificare il dossier.');
            if (!npc?.managedActorWorldId || !npc?.managedActorId) throw new Error('Questo NPC non usa ancora il flusso gestito.');
            const payload = await window.CriptaApp.api.post(`api/managed-actors/${encodeURIComponent(npc.managedActorWorldId)}/${encodeURIComponent(npc.managedActorId)}/profile`, {
                expectedRevision: Math.max(0, Number(npc.managedProfileRevision || 0)),
                data
            }, { token });
            return payload?.data || {};
        }

        async function setNpcLifeState(npc, lifeState) {
            if (npc?.managedProfileCanEdit !== true || npc.pendingCreate || npc.kind === 'creature') throw new Error('Permesso DM richiesto.');
            if (!['alive', 'unknown', 'dead', 'none'].includes(lifeState)) throw new Error('Stato non valido.');
            const profile = await saveManagedNpcProfilePatch(npc, { lifeState });
            if (profile.lifeState !== lifeState) throw new Error('Stato non confermato.');
            npc.lifeState = lifeState;
            npc.status = normalizeManagedNpcStatus(lifeState);
            npc.managedProfileRevision = Math.max(0, Number(profile.revision || 0));
            npc.updatedAt = profile.updatedAt || npc.updatedAt;
            window.CriptaApp.api.clearCache?.();
            return profile;
        }

        async function saveNpcBulkChanges(npcs, save, onProgress) {
            const targets = [...new Map((Array.isArray(npcs) ? npcs : []).filter(Boolean)
                .map((npc) => [managedNpcRosterKey(npc.managedActorWorldId, npc.managedActorId), npc])).values()];
            const alreadyBusy = new Set(targets.filter((npc) => npc.profileSaving || npc.visibilitySaving));
            const result = { succeeded: [], failed: [] };
            targets.forEach((npc) => { if (!alreadyBusy.has(npc)) npc.profileSaving = true; });
            try {
                onProgress?.({ completed: 0, total: targets.length });
                for (const npc of targets) {
                    try {
                        if (alreadyBusy.has(npc)) throw new Error('Una modifica è già in corso per questo NPC.');
                        if (npc.managedProfileCanEdit !== true || npc.pendingCreate || !npc.managedActorWorldId || !npc.managedActorId) throw new Error('Permesso DM richiesto.');
                        await save(npc);
                        result.succeeded.push(npc);
                    } catch (error) {
                        result.failed.push({ npc, error });
                    }
                    onProgress?.({ completed: result.succeeded.length + result.failed.length, total: targets.length, npc });
                }
                return result;
            } finally {
                targets.forEach((npc) => { if (!alreadyBusy.has(npc)) npc.profileSaving = false; });
            }
        }

        async function setNpcLifecycle(npc, state) {
            if (npc?.managedProfileCanEdit !== true || npc.pendingCreate) throw new Error('Permesso DM richiesto.');
            if (!['active', 'archived'].includes(state)) throw new Error('Stato archivio non valido.');
            const profile = await saveManagedNpcProfilePatch(npc, { lifecycle: { state } });
            if (profile.lifecycle?.state !== state) throw new Error('Archiviazione non confermata.');
            npc.archived = state === 'archived';
            npc.managedProfileRevision = Math.max(0, Number(profile.revision || 0));
            npc.updatedAt = profile.updatedAt || npc.updatedAt;
            window.CriptaApp.api.clearCache?.();
            return profile;
        }

        async function setNpcCategory(npc, categoryId, registry) {
            if (npc?.managedProfileCanEdit !== true || npc.pendingCreate) throw new Error('Permesso DM richiesto.');
            const targetId = window.CriptaNpcCategories.normalizeId(categoryId);
            const target = targetId ? window.CriptaNpcCategories.resolve(registry, targetId) : null;
            if (targetId && (!target || target.archived || target.mergedInto)) throw new Error('Categoria non disponibile.');
            const profile = await saveManagedNpcProfilePatch(npc, { categoryId: targetId, category: target?.name || '' });
            if (profile.categoryId !== targetId) throw new Error('Categoria non confermata.');
            Object.assign(npc, {
                categoryId: targetId, category: target?.name || '',
                categoryPriority: target?.order ?? null, categoryColor: target?.color || '', categoryIcon: target?.icon || '',
                categoryParentId: '', categoryParent: '', categoryGroupId: '', categoryGroupName: '',
                categoryGroupPriority: null, categoryGroupColor: '', categoryGroupIcon: '',
                categorySubcategoryId: '', categorySubcategory: '', categoryRosterSection: 'npc'
            });
            if (target) Object.assign(npc, applyNpcCategoryMetadata(npc, registry));
            npc.managedProfileRevision = Math.max(0, Number(profile.revision || 0));
            npc.updatedAt = profile.updatedAt || npc.updatedAt;
            window.CriptaApp.api.clearCache?.();
            return profile;
        }

        function showNpcRosterFeedback(message, kind = 'info') {
            let feedback = document.querySelector('[data-npc-roster-feedback]');
            if (!feedback) {
                feedback = document.createElement('div');
                feedback.dataset.npcRosterFeedback = 'true';
                feedback.className = 'npc-roster-feedback';
                feedback.setAttribute('role', 'status');
                feedback.setAttribute('aria-live', 'polite');
                document.body.appendChild(feedback);
            }
            window.clearTimeout(feedback._npcFeedbackTimer);
            feedback.className = `npc-roster-feedback is-${kind}`;
            feedback.innerHTML = `<i class="fas ${kind === 'success' ? 'fa-circle-check' : kind === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-info'}"></i><span>${escapeNpcAttribute(message)}</span>`;
            feedback.classList.add('is-visible');
            feedback._npcFeedbackTimer = window.setTimeout(() => feedback.classList.remove('is-visible'), 3200);
        }

        async function setNpcDossierVisibility(npc, isPublic) {
            if (npc?.managedProfileCanEdit !== true || npc.pendingCreate) throw new Error('Permesso DM richiesto.');
            const state = isPublic ? 'public' : 'dm';
            const profile = await saveManagedNpcProfilePatch(npc, { visibility: { state } });
            if (profile.visibility?.state !== state) throw new Error('Visibilità non confermata.');
            npc.managedProfileVisibility = state;
            npc.managedProfileRevision = Math.max(0, Number(profile.revision || 0));
            npc.hidden = state === 'dm' && npc.managedStatsVisibility === 'dm';
            window.CriptaApp.api.clearCache?.();
            return profile;
        }

        function updateNpcDossierVisibilityControl(card, npc) {
            // Sorting or moving a card can replace it while its request is pending.
            const cards = new Set([card, ...document.querySelectorAll('[data-roster-card="npc"]')]);
            for (const target of cards) {
                if (!target || target.dataset.managedActorWorld !== npc.managedActorWorldId || target.dataset.managedActorId !== npc.managedActorId) continue;
                const busy = Boolean(npc.visibilitySaving || npc.profileSaving);
                target.classList.toggle('is-category-saving', Boolean(npc.profileSaving));
                target.querySelectorAll('.npc-category-picker-trigger, .npc-life-state-control, .npc-archive-control, .npc-selection-control').forEach((trigger) => {
                    trigger.setAttribute('aria-disabled', String(busy));
                    trigger.setAttribute('aria-busy', String(busy));
                });
                const control = target.querySelector('.npc-profile-visibility');
                if (!control) continue;
                const isPublic = npc.managedProfileVisibility === 'public';
                control.setAttribute('aria-checked', String(isPublic));
                control.setAttribute('aria-disabled', String(busy));
                control.setAttribute('aria-busy', String(busy));
                control.title = npc.visibilitySaving ? 'Salvataggio…' : isPublic
                    ? 'Dossier visibile a tutti. Premi per riservarlo al DM.'
                    : 'Dossier riservato al DM. Premi per renderlo visibile a tutti.';
                control.querySelector('.npc-visibility-state').textContent = npc.visibilitySaving ? 'Salvo…' : isPublic ? 'Tutti' : 'Solo DM';
                target.classList.toggle('npc-card--dm-hidden', npc.hidden === true);
                const badge = target.querySelector('.npc-player-visibility-badge');
                if (!npc.hidden) badge?.remove();
                else if (!badge) target.insertAdjacentHTML('afterbegin', '<span class="npc-player-visibility-badge"><i class="fas fa-user-shield" aria-hidden="true"></i>Solo DM</span>');
            }
        }

        function escapeNpcAttribute(value) {
            return String(value || '')
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }
        function normalizeImageIdentity(path) {
            return String(path || '')
                .trim()
                .replace(/[?#].*$/, '')
                .replace(/^https?:\/\/[^/]+\/?/i, '')
                .replace(/^\/+/, '')
                .toLowerCase();
        }
