document.addEventListener("DOMContentLoaded", async function () {
    try {
        const response = await fetch('../assets/data/sessions.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

        const sessions = data.sessions.slice().reverse();
        const nextSessionConfig = data.nextSession;

        renderNextSession(nextSessionConfig);
        renderSessionNav(sessions);
        renderTimeline(sessions);

    } catch (error) {
        console.error("Errore nel caricamento delle sessioni:", error);
        document.getElementById('timeline-container').innerHTML = '<p style="color: var(--red);">Impossibile caricare le sessioni.</p>';
    }
});

function renderNextSession(config) {
    const container = document.getElementById('next-session-container');
    if (!container) return;

    const monthMap = {
        "Gennaio": "January", "Febbraio": "February", "Marzo": "March",
        "Aprile": "April", "Maggio": "May", "Giugno": "June",
        "Luglio": "July", "Agosto": "August", "Settembre": "September",
        "Ottobre": "October", "Novembre": "November", "Dicembre": "December"
    };

    if (config.isScheduled) {
        let dateStr = config.date;
        for (let [it, en] of Object.entries(monthMap)) {
            dateStr = dateStr.replace(it, en);
        }
        const targetDate = new Date(`${dateStr} ${config.timeStart}:00`).getTime();

        container.innerHTML = `
            <div class="next-session-card">
                <span class="next-label">Prossima Sessione</span>
                <h2 class="next-title text-gold-gradient">Sessione ${config.number}</h2>
                <div class="next-details">
                    <div class="detail-item">
                        <span class="detail-label">Data</span>
                        <span class="detail-value"><i class="far fa-calendar-alt" style="margin-right: 8px; color: var(--gold);"></i> ${config.date}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Orario</span>
                        <span class="detail-value"><i class="far fa-clock" style="margin-right: 8px; color: var(--gold);"></i> ${config.timeStart} - ${config.timeEnd}</span>
                    </div>
                </div>
                <div class="countdown-container" id="countdown">
                    <div class="countdown-box"><span class="count-number" id="d">00</span><span class="count-label">Giorni</span></div>
                    <div class="countdown-box"><span class="count-number" id="h">00</span><span class="count-label">Ore</span></div>
                    <div class="countdown-box"><span class="count-number" id="m">00</span><span class="count-label">Minuti</span></div>
                    <div class="countdown-box"><span class="count-number" id="s">00</span><span class="count-label">Secondi</span></div>
                </div>
            </div>
        `;
        startCountdown(targetDate);
    } else {
        container.innerHTML = `
            <div class="next-session-card" style="border-color: #555;">
                <span class="next-label">Prossima Sessione</span>
                <h2 class="next-title" style="color: #aaa;">Sessione ${config.number}</h2>
                <div class="tbd-message">
                    <i class="fas fa-hourglass-half" style="margin-right: 10px;"></i>
                    Da Fissare
                </div>
            </div>
        `;
    }
}

function startCountdown(targetDate) {
    const countdownEl = document.getElementById('countdown');
    if (!countdownEl) return;

    function update() {
        const now = new Date().getTime();
        const distance = targetDate - now;

        if (distance < 0) {
            if (distance > -14400000) {
                countdownEl.innerHTML = '<div class="session-live">SESSIONE IN CORSO!</div>';
            } else {
                countdownEl.innerHTML = '<div class="session-live" style="color:#aaa">SESSIONE CONCLUSA</div>';
            }
            return;
        }

        document.getElementById('d').innerText = Math.floor(distance / (1000 * 60 * 60 * 24)).toString().padStart(2, '0');
        document.getElementById('h').innerText = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)).toString().padStart(2, '0');
        document.getElementById('m').innerText = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0');
        document.getElementById('s').innerText = Math.floor((distance % (1000 * 60)) / 1000).toString().padStart(2, '0');
    }
    update();
    setInterval(update, 1000);
}

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
