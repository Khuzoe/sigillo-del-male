document.addEventListener('DOMContentLoaded', () => {
    fetch('assets/data/sessions.json')
        .then(response => response.json())
        .then(data => {
            const nextSessionConfig = data.nextSession;
            const sessionContainer = document.getElementById('next-session-container');
            setupNextSession(nextSessionConfig, sessionContainer);

            const lastSession = data.sessions[data.sessions.length - 1];
            const latestEventsContainer = document.getElementById('latest-events-section');
            setupLatestSession(lastSession, latestEventsContainer);
        })
        .catch(error => {
            console.error("Errore nel caricamento delle sessioni:", error);
            const sessionContainer = document.getElementById('next-session-container');
            sessionContainer.innerHTML = `<p style="color:red; text-align:center;">Impossibile caricare i dati delle sessioni.</p>`;
        });

    const monthMap = {
        "Gennaio": "January", "Febbraio": "February", "Marzo": "March",
        "Aprile": "April", "Maggio": "May", "Giugno": "June",
        "Luglio": "July", "Agosto": "August", "Settembre": "September",
        "Ottobre": "October", "Novembre": "November", "Dicembre": "December"
    };

    function setupNextSession(config, container) {
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
                        <span class="detail-value"><i class="far fa-calendar-alt" style="margin-right: 8px;"></i> ${config.date}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Orario</span>
                        <span class="detail-value"><i class="far fa-clock" style="margin-right: 8px;"></i> ${config.timeStart} - ${config.timeEnd}</span>
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

            const days = Math.floor(distance / (1000 * 60 * 60 * 24));
            const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((distance % (1000 * 60)) / 1000);

            document.getElementById('d').innerText = days < 10 ? '0' + days : days;
            document.getElementById('h').innerText = hours < 10 ? '0' + hours : hours;
            document.getElementById('m').innerText = minutes < 10 ? '0' + minutes : minutes;
            document.getElementById('s').innerText = seconds < 10 ? '0' + seconds : seconds;
        }

        update();
        setInterval(update, 1000);
    }

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
});
