document.addEventListener("DOMContentLoaded", async function () {
    try {
        const [sessionsResponse, nextSessionResponse] = await Promise.all([
            fetch('../assets/data/sessions.json'),
            window.CriptaNextSession?.loadConfig
                ? window.CriptaNextSession.loadConfig({ fallbackPath: '../assets/data/next-session.json' })
                : fetch('../assets/data/next-session.json')
        ]);
        if (!sessionsResponse.ok) {
            throw new Error(`HTTP error sessions.json: ${sessionsResponse.status}`);
        }
        const sessionsData = await sessionsResponse.json();
        const nextSessionConfig = window.CriptaNextSession?.loadConfig
            ? nextSessionResponse
            : await (async () => {
                if (!nextSessionResponse.ok) {
                    throw new Error(`HTTP error next-session.json: ${nextSessionResponse.status}`);
                }
                return nextSessionResponse.json();
            })();

        const sessions = sessionsData.sessions.slice().reverse();

        window.CriptaNextSession?.render(nextSessionConfig, document.getElementById('next-session-container'));
        renderSessionNav(sessions);
        renderTimeline(sessions);

    } catch (error) {
        console.error("Errore nel caricamento delle sessioni:", error);
        document.getElementById('timeline-container').innerHTML = '<p style="color: var(--red);">Impossibile caricare le sessioni.</p>';
    }
});

function renderSessionNav(sessions) {
    const navContainer = document.getElementById('session-nav-container');
    if (!navContainer) return;

    const title = navContainer.querySelector('.session-nav-title');
    navContainer.innerHTML = '';
    if (title) navContainer.appendChild(title);

    sessions.forEach(session => {
        const link = document.createElement('a');
        link.href = `#session-${session.id}`;
        link.className = 'nav-item';
        link.innerHTML = `
            Sessione ${session.id}
            <span class="nav-date">${session.date}</span>
        `;
        navContainer.appendChild(link);
    });
}

function renderTimeline(sessions) {
    const timelineContainer = document.getElementById('timeline-container');
    if (!timelineContainer) return;
    timelineContainer.innerHTML = '';

    sessions.forEach(session => {
        const card = document.createElement('div');
        card.id = `session-${session.id}`;
        card.className = 'session-card';

        let headerBadges = `<span class="session-date">${session.date}</span>`;
        if (session.levelup) {
            headerBadges += `<span class="levelup-badge">LEVEL UP (${session.levelup})</span>`;
        }
        if (session.skillPoint) {
            headerBadges += `<span class="levelup-badge">+1 SKILL POINT</span>`;
        }

        let xpFooter = '';
        if (session.xp) {
            xpFooter = `
            <div class="xp-footer">
                <i class="fas fa-star" style="color: var(--gold); font-size: 1.2rem;"></i>
                <div>
                    <span class="xp-value">${session.xp.total} XP Totali</span>
                    <span class="xp-sub">(${session.xp.each} a testa)</span>
                </div>
            </div>`;
        } else if (session.reward) {
            xpFooter = `
            <div class="xp-footer">
                <i class="fas fa-gift" style="color: var(--gold); font-size: 1.2rem;"></i>
                <div>
                    <span class="xp-value">${session.reward}</span>
                </div>
            </div>`;
        } else {
            xpFooter = "";
        }

        card.innerHTML = `
            <div class="timeline-marker"><i class="fas fa-circle" style="font-size: 8px; color: var(--gold);"></i></div>
            <div class="session-header">
                <h3 class="session-title text-gold-gradient">Sessione ${session.id}</h3>
                <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                   ${headerBadges}
                </div>
            </div>
            <div class="session-body">
                ${session.summary}
            </div>
            ${xpFooter}
        `;
        timelineContainer.appendChild(card);
    });
}
