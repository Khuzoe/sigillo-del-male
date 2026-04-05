document.addEventListener('DOMContentLoaded', () => {
    Promise.all([
        fetch('assets/data/sessions.json').then(response => {
            if (!response.ok) {
                throw new Error(`Errore caricamento sessions.json (${response.status})`);
            }
            return response.json();
        }),
        fetch('assets/data/players.json').then(response => {
            if (!response.ok) {
                throw new Error(`Errore caricamento players.json (${response.status})`);
            }
            return response.json();
        }),
        window.CriptaNextSession?.loadConfig
            ? window.CriptaNextSession.loadConfig({ fallbackPath: 'assets/data/next-session.json' })
            : fetch('assets/data/next-session.json').then(response => {
                if (!response.ok) {
                    throw new Error(`Errore caricamento next-session.json (${response.status})`);
                }
                return response.json();
            })
    ])
        .then(([sessionsData, playersData, nextSessionConfig]) => {
            const sessionContainer = document.getElementById('next-session-container');
            window.CriptaNextSession?.render(nextSessionConfig, sessionContainer);

            const lastSession = sessionsData.sessions[sessionsData.sessions.length - 1];
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
    }

    async function setupRecentNpcs() {
        const container = document.getElementById('recent-npcs-row');
        if (!container) return;

        try {
            const response = await fetch('assets/data/home-recent-npcs.json');
            if (!response.ok) {
                throw new Error(`Lista NPC recenti non trovata (${response.status})`);
            }
            const data = await response.json();
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
        const avatarPath = player.images?.avatar ? `assets/${player.images.avatar}` : 'assets/img/logo.webp';
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
        const avatarPath = npc.avatar ? `assets/${npc.avatar}` : 'assets/img/logo.webp';
        const url = npc.url || `pages/characters/character.html?id=${npc.id}`;
        return `
            <a href="${url}" class="home-char-card mini">
                <div class="home-char-avatar"><img src="${avatarPath}" alt="${npc.name}"></div>
                <div class="home-char-info">
                    <h4 class="name">${npc.name}</h4><span class="role">${npc.role}</span>
                </div>
            </a>
        `;
    }
});
