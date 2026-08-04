window.CriptaApp.onPageReady("index", () => {
    const fetchJson = (url, label) => {
        if (typeof window.CriptaApp?.fetchJson === "function") {
            return window.CriptaApp.fetchJson(url);
        }

        return fetch(url).then(response => {
            if (!response.ok) {
                throw new Error(`${label} (${response.status})`);
            }
            return response.json();
        });
    };

    function resolveImageUrl(path, fallback = 'assets/img/logo.webp') {
        const value = String(path || '').trim();
        if (!value) return fallback;
        if (/^(https?:|data:|blob:)/i.test(value)) return value;
        if (value.startsWith('media/')) return window.CriptaApp.urls.api(value);
        if (value.startsWith('/media/')) return window.CriptaApp.urls.api(value.slice(1));
        if (value.startsWith('assets/')) return value;
        return `assets/${value}`;
    }

    function slugify(value) {
        return window.CriptaApp.utils.slugify(value, 'personaggio');
    }

    function escapeHtml(value) {
        return window.CriptaApp.utils.escapeHtml(value);
    }

    function getCurrentCampaignId() {
        return window.CriptaApp?.campaigns?.currentId?.() || 'cripta-di-sangue';
    }

    function buildSiteUrl(path) {
        if (typeof window.CriptaApp?.urls?.site === 'function') {
            return window.CriptaApp.urls.site(path);
        }
        const url = new URL(path, window.location.href);
        const campaignId = getCurrentCampaignId();
        if (campaignId && campaignId !== 'cripta-di-sangue') {
            url.searchParams.set('campaign', campaignId);
        }
        return url.toString();
    }

    async function loadManagedPlayerIndex() {
        try {
            if (typeof window.CriptaApp?.api?.get !== 'function') return { actors: [], archivedLegacyCharacterIds: [] };
            const token = String(window.CriptaDiscordAuth?.getToken?.() || '').trim();
            const payload = await window.CriptaApp.api.get('api/managed-actors?view=directory', {
                ...(token ? { token } : {})
            });
            return {
                actors: Array.isArray(payload?.data) ? payload.data : [],
                archivedLegacyCharacterIds: Array.isArray(payload?.archivedLegacyCharacterIds) ? payload.archivedLegacyCharacterIds : []
            };
        } catch (error) {
            console.info('Schede gestite non disponibili nella home:', error);
            return { actors: [], archivedLegacyCharacterIds: [] };
        }
    }

    function getSyncedPlayerImagePath(player, variant = 'hover') {
        if (typeof window.CriptaMedia?.buildPlayerMediaPath === 'function') {
            return window.CriptaMedia.buildPlayerMediaPath(player, variant, { campaignId: getCurrentCampaignId() });
        }
        const playerId = slugify(player?.id || player?.name || 'personaggio');
        return `media/campaigns/${getCurrentCampaignId()}/players/${playerId}-${variant}.webp`;
    }

    function getSyncedNpcImagePath(npc, variant = 'hover') {
        if (typeof window.CriptaMedia?.buildNpcMediaPath === 'function') {
            return window.CriptaMedia.buildNpcMediaPath(npc, variant, { campaignId: getCurrentCampaignId() });
        }
        const npcId = slugify(npc?.id || npc?.name || 'npc');
        return `media/campaigns/${getCurrentCampaignId()}/characters/${npcId}/${variant}.webp`;
    }

    function addImageCandidate(candidates, path) {
        const url = resolveImageUrl(path, '');
        if (url && !candidates.includes(url)) candidates.push(url);
    }

    function addManagedImageEntry(entries, descriptor) {
        const url = resolveImageUrl(descriptor?.path, '');
        if (!url || entries.some((entry) => entry.url === url)) return;
        entries.push({
            url,
            frameCircle: window.CriptaImageAdjust?.normalizeFrameCircle?.(descriptor?.presentation?.frameCircle) || null
        });
    }

    function getManagedPlayerImageEntries(player) {
        const media = player?._managedActor?.media || null;
        if (!media) return [];
        const entries = [];
        addManagedImageEntry(entries, media.idle);
        addManagedImageEntry(entries, media.token);
        addManagedImageEntry(entries, media.avatar);
        addManagedImageEntry(entries, media.hover);
        entries.push({ url: resolveImageUrl('assets/img/logo.webp'), frameCircle: null });
        return entries;
    }

    function getPlayerImageCandidates(player) {
        const managedEntries = getManagedPlayerImageEntries(player);
        if (managedEntries.length) return managedEntries.map((entry) => entry.url);

        const candidates = [];
        const images = player?.images || {};
        addImageCandidate(candidates, images.hover || images.cardHover || images.listHover || images.showcaseHover);
        addImageCandidate(candidates, getSyncedPlayerImagePath(player, 'hover'));
        addImageCandidate(candidates, images.idle || images.card || images.list || images.showcase);
        addImageCandidate(candidates, getSyncedPlayerImagePath(player, 'idle'));
        addImageCandidate(candidates, images.token);
        addImageCandidate(candidates, getSyncedPlayerImagePath(player, 'token'));
        addImageCandidate(candidates, images.avatar || images.portrait);
        addImageCandidate(candidates, getSyncedPlayerImagePath(player, 'avatar'));

        if (getCurrentCampaignId() === 'cripta-di-sangue') {
            const playerId = slugify(player?.id || player?.name || 'personaggio');
            addImageCandidate(candidates, `media/players/${playerId}_animation.webp`);
            addImageCandidate(candidates, `media/players/${playerId}_transp.webp`);
            addImageCandidate(candidates, `media/players/${playerId}.webp`);
        }

        addImageCandidate(candidates, 'assets/img/logo.webp');
        return candidates;
    }

    function buildFrameCircleAttributes(circle) {
        if (!circle) return '';
        return ` data-frame-circle="1" data-frame-circle-x="${circle.x}" data-frame-circle-y="${circle.y}" data-frame-circle-radius="${circle.radius}"`;
    }

    function resetHomeFrameCircleLayout(image) {
        [
            'position', 'inset', 'left', 'top', 'width', 'height', 'maxWidth', 'maxHeight',
            'objectFit', 'objectPosition', 'transform', 'transformOrigin'
        ].forEach((property) => image.style[property] = '');
    }

    function setupHomePlayerImages(container) {
        container.querySelectorAll('img[data-home-player-media]').forEach((image) => {
            const applyFrame = () => window.CriptaImageAdjust?.applyFrameCircleLayout?.(image);
            image.addEventListener('load', applyFrame);
            image.addEventListener('error', () => {
                let fallbacks = [];
                try {
                    fallbacks = JSON.parse(image.dataset.homePlayerFallbacks || '[]');
                } catch (_) {
                    fallbacks = [];
                }
                const next = fallbacks.shift();
                image.dataset.homePlayerFallbacks = JSON.stringify(fallbacks);
                if (!next?.url) {
                    image.style.display = 'none';
                    return;
                }
                resetHomeFrameCircleLayout(image);
                window.CriptaImageAdjust?.setFrameCircleDataset?.(image, next.frameCircle || null);
                image.src = next.url;
            });
            applyFrame();
        });
        window.CriptaImageAdjust?.initFrameCircleImages?.(container);
    }

    function buildImageFallbackAttributes(urls) {
        const candidates = Array.isArray(urls) ? urls.filter(Boolean) : [];
        const fallbacks = candidates.slice(1);
        if (!fallbacks.length) {
            return ` onerror="this.style.display='none'"`;
        }
        return ` data-fallback-srcs='${escapeHtml(JSON.stringify(fallbacks))}' onerror="var f=JSON.parse(this.dataset.fallbackSrcs||'[]');var n=f.shift();this.dataset.fallbackSrcs=JSON.stringify(f);if(n){this.src=n;}else{this.style.display='none';this.onerror=null;}"`;
    }

    function buildImageFallbackHandler(fallbackUrl) {
        const value = String(fallbackUrl || '').replace(/'/g, "\\'");
        return value ? ` onerror="this.onerror=null;this.src='${value}'"` : '';
    }

    function updateHeroMetric(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = String(Number.isFinite(Number(value)) ? Number(value) : 0);
    }

    Promise.all([
        fetchJson(window.CriptaApp?.urls?.data?.('sessions.json') || 'assets/data/sessions.json', 'Errore caricamento sessions.json').catch((error) => {
            if (!/HTTP 404/i.test(String(error?.message || error))) {
                console.warn('Archivio sessioni non disponibile per questa campagna:', error);
            }
            return { sessions: [] };
        }),
        fetchJson(window.CriptaApp?.urls?.data?.('players.json') || 'assets/data/players.json', 'Errore caricamento players.json').catch((error) => {
            console.info('Player non disponibili per questa campagna:', error);
            return [];
        }),
        window.CriptaNextSession?.loadConfig
            ? window.CriptaNextSession.loadConfig({ fallbackPath: window.CriptaApp?.urls?.data?.('next-session.json') || 'assets/data/next-session.json' })
            : fetchJson(window.CriptaApp?.urls?.data?.('next-session.json') || 'assets/data/next-session.json', 'Errore caricamento next-session.json'),
        loadManagedPlayerIndex()
    ])
        .then(([sessionsData, playersData, nextSessionConfig, managedDirectory]) => {
            const sessionContainer = document.getElementById('next-session-container');
            window.CriptaNextSession?.render(nextSessionConfig, sessionContainer);

            updateHomeCampaignLabel(nextSessionConfig);
            const sessions = Array.isArray(sessionsData?.sessions) ? sessionsData.sessions : [];
            updateHeroMetric('home-session-count', sessions.length);
            const lastSession = sessions[sessions.length - 1];
            const latestEventsContainer = document.getElementById('latest-events-section');
            setupLatestSession(lastSession, latestEventsContainer);

            setupHomePlayers(playersData, managedDirectory.actors);
            setupRecentNpcs(managedDirectory.archivedLegacyCharacterIds);
        })
        .catch(error => {
            console.error("Errore nel caricamento delle sessioni:", error);
            const sessionContainer = document.getElementById('next-session-container');
            sessionContainer.innerHTML = `<p style="color:red; text-align:center;">Impossibile caricare i dati della prossima sessione.</p>`;
        });

    function setupLatestSession(session, container) {
        if (!container) return;
        const sessionCard = container.querySelector('.session-card');
        if (session && sessionCard) {
            const summaryElement = document.createElement('div');
            summaryElement.innerHTML = String(session.summary || '').replace(/<\/(p|li|div|h[1-6])>/gi, '$& ');
            let summaryText = summaryElement.textContent || summaryElement.innerText || "";
            summaryText = summaryText.replace(/\s+/g, ' ').trim();
            if (summaryText.length > 250) {
                summaryText = summaryText.substring(0, 250) + '...';
            }

            sessionCard.innerHTML = `
            <div class="session-header">
                <h3 class="session-title text-gold-gradient">Sessione ${session.id}</h3>
                <span class="session-date">${session.date.split(' - ')[0]}</span>
            </div>
            <div class="session-body">
                <p>${summaryText}</p>
            </div>
            <a href="pages/sessioni.html#session-${session.id}" class="read-more">Leggi il riassunto completo &rarr;</a>
        `;
        }
        if (!session && sessionCard) {
            sessionCard.innerHTML = `
            <div class="session-header">
                <h3 class="session-title text-gold-gradient">Nessuna sessione registrata</h3>
            </div>
            <div class="session-body">
                <p>Questa campagna non ha ancora riassunti pubblicati.</p>
            </div>
        `;
        }
    }

    function updateHomeCampaignLabel(config) {
        const campaignName = String(config?.campaignName || '').trim();
        if (!campaignName) return;
        const title = document.querySelector('.dashboard-header h1');
        if (title) title.textContent = campaignName;
    }

    async function setupRecentNpcs(archivedLegacyCharacterIds = []) {
        const container = document.getElementById('recent-npcs-row');
        if (!container) return;
        const panel = container.closest('.home-npcs-panel');
        if (panel) panel.hidden = false;

        try {
            const data = await fetchJson(window.CriptaApp?.urls?.data?.('home-recent-npcs.json') || 'assets/data/home-recent-npcs.json', 'Lista NPC recenti non trovata');
            const archivedIds = new Set(archivedLegacyCharacterIds.map((id) => slugify(id)));
            const items = (Array.isArray(data.items) ? data.items : []).filter((npc) => !archivedIds.has(slugify(npc.id || npc.entityId || '')));
            if (items.length === 0) {
                container.innerHTML = '';
                if (panel) panel.hidden = true;
                return;
            }

            container.innerHTML = items.slice(0, 4).map(npc => renderRecentNpcCard(npc)).join('');
        } catch (error) {
            if (!/HTTP 404/i.test(String(error?.message || error))) {
                console.warn('Impossibile caricare NPC recenti:', error);
            }
            container.innerHTML = '';
            if (panel) panel.hidden = true;
        }
    }

    function buildManagedHomePlayers(rosterPlayers, managedPlayers) {
        const roster = Array.isArray(rosterPlayers) ? rosterPlayers : [];
        const rosterById = new Map(roster.map((player, index) => [slugify(player?.id || ''), { player, index }]));
        return (Array.isArray(managedPlayers) ? managedPlayers : [])
            .filter((actor) => {
                const relationshipType = String(actor?.relationshipType || '').trim().toLowerCase();
                const actorType = String(actor?.actorType || '').trim().toLowerCase();
                const ownerCharacterId = String(actor?.ownerCharacterId || '').trim();
                return Boolean(ownerCharacterId) && (relationshipType === 'player' || actorType === 'character' || actorType === 'player');
            })
            .map((actor) => {
                const id = slugify(actor.ownerCharacterId);
                const rosterEntry = rosterById.get(id);
                const legacyMetadata = rosterEntry?.player || {};
                const archived = String(actor?.profile?.lifecycle?.state || 'active').toLowerCase() === 'archived';
                return {
                    id,
                    name: actor.name || legacyMetadata.name || id,
                    role: actor?.profile?.role || legacyMetadata.role || 'Protagonista',
                    hidden: legacyMetadata.hidden === true,
                    isActive: !archived && legacyMetadata.isActive !== false,
                    _managedActor: actor,
                    _rosterOrder: Number.isInteger(rosterEntry?.index) ? rosterEntry.index : Number.MAX_SAFE_INTEGER
                };
            })
            .sort((left, right) => {
                if (left._rosterOrder !== right._rosterOrder) return left._rosterOrder - right._rosterOrder;
                return String(left.name || '').localeCompare(String(right.name || ''), 'it');
            });
    }

    function setupHomePlayers(players, managedPlayers = []) {
        const container = document.getElementById('home-players-row');
        if (!container) return;

        const activePlayers = buildManagedHomePlayers(players, managedPlayers)
            .filter((player) => !player.hidden && player.isActive !== false);
        const items = activePlayers.slice(0, 4);

        updateHeroMetric('home-player-count', activePlayers.length);
        if (items.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = items.map((player) => renderHomePlayerCard(player, managedPlayers)).join('');
        setupHomePlayerImages(container);
    }

    function renderHomePlayerCard(player, managedPlayers = []) {
        const managedEntries = getManagedPlayerImageEntries(player);
        const imageCandidates = managedEntries.length
            ? managedEntries.map((entry) => entry.url)
            : getPlayerImageCandidates(player);
        const primaryEntry = managedEntries[0] || { url: imageCandidates[0], frameCircle: null };
        const avatarPath = primaryEntry.url || resolveImageUrl('', 'assets/img/logo.webp');
        const fallbackEntries = managedEntries.length
            ? managedEntries.slice(1)
            : imageCandidates.slice(1).map((url) => ({ url, frameCircle: null }));
        const playerUrl = window.CriptaApp?.urls?.player?.(player, managedPlayers)
            || buildSiteUrl(`pages/characters/character.html?id=${encodeURIComponent(player.id)}&type=player`);
        return `
            <a href="${escapeHtml(playerUrl)}" class="home-char-card home-char-card--player mini">
                <div class="home-char-avatar" data-frame-circle-host="true"><img src="${escapeHtml(avatarPath)}" alt="${escapeHtml(player.name)}" loading="eager" fetchpriority="high" decoding="async" data-home-player-media data-home-player-fallbacks='${escapeHtml(JSON.stringify(fallbackEntries))}'${buildFrameCircleAttributes(primaryEntry.frameCircle)}></div>
                <div class="home-char-info">
                    <h4 class="name">${escapeHtml(player.name)}</h4>
                    <span class="role">${escapeHtml(player.role || 'Protagonista')}</span>
                </div>
                <span class="home-char-card__arrow" aria-hidden="true"><i class="fa-solid fa-chevron-right"></i></span>
            </a>
        `;
    }

    function renderRecentNpcCard(npc) {
        const avatarPath = resolveImageUrl(getSyncedNpcImagePath(npc, 'hover'));
        const fallbackPath = resolveImageUrl(npc.hoverFallback || npc.token || npc.avatar);
        const rawUrl = npc.url || `pages/characters/character.html?id=${encodeURIComponent(npc.id || '')}`;
        const url = buildSiteUrl(rawUrl);
        return `
            <a href="${escapeHtml(url)}" class="home-char-card home-char-card--npc mini">
                <div class="home-char-avatar"><img src="${escapeHtml(avatarPath)}" alt="${escapeHtml(npc.name || 'NPC')}" loading="eager" decoding="async"${buildImageFallbackHandler(fallbackPath)}></div>
                <div class="home-char-info">
                    <h4 class="name">${escapeHtml(npc.name || 'NPC')}</h4>
                    <span class="role">${escapeHtml(npc.role || 'NPC')}</span>
                </div>
                <span class="home-char-card__arrow" aria-hidden="true"><i class="fa-solid fa-chevron-right"></i></span>
            </a>
        `;
    }
});
