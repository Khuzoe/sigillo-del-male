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

    function getCurrentCampaignId() {
        return window.CriptaApp?.campaigns?.currentId?.() || 'cripta-di-sangue';
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

    function buildImageFallbackHandler(fallbackUrl) {
        const value = String(fallbackUrl || '').replace(/'/g, "\\'");
        return value ? ` onerror="this.onerror=null;this.src='${value}'"` : '';
    }

    Promise.all([
        fetchJson(window.CriptaApp?.urls?.data?.('sessions.json') || 'assets/data/sessions.json', 'Errore caricamento sessions.json').catch((error) => {
            console.info('Archivio sessioni non disponibile per questa campagna:', error);
            return { sessions: [] };
        }),
        fetchJson(window.CriptaApp?.urls?.data?.('players.json') || 'assets/data/players.json', 'Errore caricamento players.json').catch((error) => {
            console.info('Player non disponibili per questa campagna:', error);
            return [];
        }),
        window.CriptaNextSession?.loadConfig
            ? window.CriptaNextSession.loadConfig({ fallbackPath: window.CriptaApp?.urls?.data?.('next-session.json') || 'assets/data/next-session.json' })
            : fetchJson(window.CriptaApp?.urls?.data?.('next-session.json') || 'assets/data/next-session.json', 'Errore caricamento next-session.json')
    ])
        .then(([sessionsData, playersData, nextSessionConfig]) => {
            const sessionContainer = document.getElementById('next-session-container');
            window.CriptaNextSession?.render(nextSessionConfig, sessionContainer);

            updateHomeCampaignLabel(nextSessionConfig);
            const sessions = Array.isArray(sessionsData?.sessions) ? sessionsData.sessions : [];
            const lastSession = sessions[sessions.length - 1];
            const latestEventsContainer = document.getElementById('latest-events-section');
            setupLatestSession(lastSession, latestEventsContainer);

            setupHomePlayers(playersData);
            setupRecentNpcs();
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
            summaryElement.innerHTML = session.summary;
            let summaryText = summaryElement.textContent || summaryElement.innerText || "";
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

    async function setupRecentNpcs() {
        const container = document.getElementById('recent-npcs-row');
        if (!container) return;

        try {
            const data = await fetchJson(window.CriptaApp?.urls?.data?.('home-recent-npcs.json') || 'assets/data/home-recent-npcs.json', 'Lista NPC recenti non trovata');
            const items = Array.isArray(data.items) ? data.items : [];
            if (items.length === 0) {
                container.innerHTML = '';
                return;
            }

            container.innerHTML = items.slice(0, 4).map(npc => renderRecentNpcCard(npc)).join('');
        } catch (error) {
            console.warn('Impossibile caricare NPC recenti:', error);
            container.innerHTML = '';
        }
    }

    function setupHomePlayers(players) {
        const container = document.getElementById('home-players-row');
        if (!container) return;

        const items = Array.isArray(players)
            ? players.filter((player) => !player.hidden && player.isActive !== false).slice(0, 4)
            : [];

        if (items.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = items.map((player) => renderHomePlayerCard(player)).join('');
    }

    function renderHomePlayerCard(player) {
        const avatarPath = resolveImageUrl(getSyncedPlayerImagePath(player, 'hover'));
        return `
            <a href="pages/characters/character.html?id=${player.id}&type=player" class="home-char-card mini">
                <div class="home-char-avatar"><img src="${avatarPath}" alt="${player.name}"></div>
                <div class="home-char-info">
                    <h4 class="name">${player.name}</h4><span class="role">${player.role || 'Protagonista'}</span>
                </div>
            </a>
        `;
    }

    function renderRecentNpcCard(npc) {
        const avatarPath = resolveImageUrl(getSyncedNpcImagePath(npc, 'hover'));
        const fallbackPath = resolveImageUrl(npc.hoverFallback || npc.token || npc.avatar);
        const url = npc.url || `pages/characters/character.html?id=${npc.id}`;
        return `
            <a href="${url}" class="home-char-card mini">
                <div class="home-char-avatar"><img src="${avatarPath}" alt="${npc.name}"${buildImageFallbackHandler(fallbackPath)}></div>
                <div class="home-char-info">
                    <h4 class="name">${npc.name}</h4><span class="role">${npc.role}</span>
                </div>
            </a>
        `;
    }
});
