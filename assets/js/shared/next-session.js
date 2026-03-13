(function () {
    const API_BASE_URL = typeof DISCORD_WORKER_URL === 'string'
        ? DISCORD_WORKER_URL
        : 'https://sigillo-api.khuzoe.workers.dev';
    const SESSION_VOTES_API_URL = `${API_BASE_URL}/api/session-votes`;
    const STORAGE_PREFIX = 'cripta-next-session-votes';
    const PLAYERS_DATA_PATH = 'data/players.json';
    const DM_PLAYER = { id: 'dm', name: 'DM', discordId: '' };
    const VOTE_STATES = [
        { value: 'yes', label: 'SI', className: 'is-yes' },
        { value: 'maybe', label: 'FORSE', className: 'is-maybe' },
        { value: 'no', label: 'NO', className: 'is-no' }
    ];

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function parseScheduledDate(dateValue, timeValue) {
        if (!dateValue || !timeValue) return null;

        const dateMatch = String(dateValue).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (dateMatch) {
            const [, day, month, year] = dateMatch;
            return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timeValue}:00`);
        }

        const monthMap = {
            "Gennaio": "January",
            "Febbraio": "February",
            "Marzo": "March",
            "Aprile": "April",
            "Maggio": "May",
            "Giugno": "June",
            "Luglio": "July",
            "Agosto": "August",
            "Settembre": "September",
            "Ottobre": "October",
            "Novembre": "November",
            "Dicembre": "December"
        };

        let normalized = String(dateValue).trim();
        Object.entries(monthMap).forEach(([it, en]) => {
            normalized = normalized.replace(it, en);
        });

        const parsed = new Date(`${normalized} ${timeValue}:00`);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function getStorageKey(sessionNumber) {
        return `${STORAGE_PREFIX}-${sessionNumber}`;
    }

    function getAssetsBasePath() {
        return window.location.pathname.includes('/pages/') ? '../assets/' : 'assets/';
    }

    async function loadEligiblePlayers(config) {
        const response = await fetch(`${getAssetsBasePath()}${PLAYERS_DATA_PATH}`);
        if (!response.ok) {
            throw new Error(`File dati players non trovato (${response.status})`);
        }

        const players = await response.json();
        if (!Array.isArray(players)) return [];

        const eligiblePlayers = players
            .filter((player) => !player.hidden && player.isActive !== false)
            .map((player) => ({
                ...player,
                discordId: String(player.discordId || '').trim()
            }));
        const dmPlayer = {
            ...DM_PLAYER,
            discordId: String(config?.dmDiscordId || '').trim()
        };
        return [dmPlayer, ...eligiblePlayers];
    }

    function sanitizeOptions(options) {
        if (!Array.isArray(options)) return [];

        return options
            .map((option, index) => {
                const id = String(option?.id || `option-${index + 1}`).trim();
                const label = String(option?.label || option?.date || '').trim();
                const time = String(option?.time || '').trim();
                const meta = String(option?.meta || '').trim();
                if (!label) return null;
                return { id, label, time, meta };
            })
            .filter(Boolean);
    }

    function sanitizeVotes(votes, options, players) {
        const allowedIds = new Set(options.map(option => option.id));
        const playersByDiscordId = new Map(
            players
                .filter((player) => player.discordId)
                .map((player) => [String(player.discordId), player])
        );
        const playersById = new Map(players.map((player) => [String(player.id), player]));
        const playersByName = new Map(players.map((player) => [String(player.name || '').trim().toLowerCase(), player]));
        if (!Array.isArray(votes)) return [];

        const normalizedVotes = votes.length > 0 && votes.every((vote) =>
            vote && typeof vote === 'object' && 'optionId' in vote && 'value' in vote
        )
            ? aggregateFlatVotes(votes)
            : votes;

        return normalizedVotes
            .map((vote) => {
                const rawPlayerId = String(vote?.playerId || vote?.id || '').trim();
                const rawName = String(vote?.name || '').trim();
                const matchedPlayer = playersByDiscordId.get(rawPlayerId)
                    || playersById.get(rawPlayerId)
                    || playersByName.get(rawName.toLowerCase());
                if (!matchedPlayer) return null;

                const selections = {};
                const sourceSelections = vote?.selections && typeof vote.selections === 'object'
                    ? vote.selections
                    : {};

                options.forEach((option) => {
                    const rawValue = String(sourceSelections[option.id] || '').toLowerCase();
                    selections[option.id] = VOTE_STATES.some(state => state.value === rawValue) ? rawValue : '';
                });

                Object.keys(sourceSelections).forEach((key) => {
                    if (!allowedIds.has(key)) {
                        delete selections[key];
                    }
                });

                return {
                    playerId: matchedPlayer.id,
                    discordId: matchedPlayer.discordId || rawPlayerId,
                    name: matchedPlayer.name,
                    selections
                };
            })
            .filter(Boolean);
    }

    function aggregateFlatVotes(votes) {
        const grouped = new Map();

        votes.forEach((vote) => {
            const rawPlayerId = String(vote?.playerId || vote?.id || '').trim();
            if (!rawPlayerId) return;

            const optionId = String(vote?.optionId || '').trim();
            if (!optionId) return;

            const value = String(vote?.value || '').toLowerCase();
            if (!grouped.has(rawPlayerId)) {
                grouped.set(rawPlayerId, {
                    playerId: rawPlayerId,
                    name: String(vote?.name || '').trim(),
                    selections: {}
                });
            }

            grouped.get(rawPlayerId).selections[optionId] = value;
        });

        return Array.from(grouped.values());
    }

    function readStoredVotes(sessionNumber, fallbackVotes, options, players) {
        try {
            const raw = window.localStorage.getItem(getStorageKey(sessionNumber));
            if (!raw) return sanitizeVotes(fallbackVotes, options, players);
            return sanitizeVotes(JSON.parse(raw), options, players);
        } catch (error) {
            console.warn('Impossibile leggere i voti salvati della prossima sessione:', error);
            return sanitizeVotes(fallbackVotes, options, players);
        }
    }

    function extractVotesFromApiPayload(payload) {
        if (Array.isArray(payload)) return payload;
        if (payload && Array.isArray(payload.votes)) return payload.votes;
        if (payload && payload.data && Array.isArray(payload.data.votes)) return payload.data.votes;
        return [];
    }

    async function loadRemoteVotes(sessionNumber, options, players) {
        const response = await fetch(`${SESSION_VOTES_API_URL}?session=${encodeURIComponent(sessionNumber)}`, {
            method: 'GET',
            headers: {
                Accept: 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Session votes API HTTP ${response.status}`);
        }

        const payload = await response.json();
        return sanitizeVotes(extractVotesFromApiPayload(payload), options, players);
    }

    async function postRemoteVote({ sessionNumber, playerDiscordId, optionId, value, token }) {
        const response = await fetch(SESSION_VOTES_API_URL, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
                sessionNumber,
                playerId: playerDiscordId,
                optionId,
                value
            })
        });

        let payload = null;
        try {
            payload = await response.json();
        } catch (_) {
            payload = null;
        }

        if (!response.ok) {
            const apiMessage = payload?.error || payload?.message || payload?.details || '';
            throw new Error(apiMessage ? `Session votes API POST HTTP ${response.status}: ${apiMessage}` : `Session votes API POST HTTP ${response.status}`);
        }

        return payload;
    }

    function persistVotes(sessionNumber, votes) {
        try {
            window.localStorage.setItem(getStorageKey(sessionNumber), JSON.stringify(votes));
        } catch (error) {
            console.warn('Impossibile salvare i voti della prossima sessione:', error);
        }
    }

    function computeTotals(votes, options) {
        return options.reduce((acc, option) => {
            acc[option.id] = { yes: 0, maybe: 0, no: 0 };
            votes.forEach((vote) => {
                const value = vote.selections[option.id];
                if (value && acc[option.id][value] !== undefined) {
                    acc[option.id][value] += 1;
                }
            });
            return acc;
        }, {});
    }

    function getNextVoteValue(currentValue) {
        if (currentValue === 'yes') return 'maybe';
        if (currentValue === 'maybe') return 'no';
        if (currentValue === 'no') return '';
        return 'yes';
    }

    function getVoteState(value) {
        return VOTE_STATES.find((state) => state.value === value) || null;
    }

    function renderCountdown(targetDate, root) {
        const countdownEl = root.querySelector('[data-countdown]');
        if (!countdownEl) return;

        const parts = {
            d: countdownEl.querySelector('[data-unit="days"]'),
            h: countdownEl.querySelector('[data-unit="hours"]'),
            m: countdownEl.querySelector('[data-unit="minutes"]'),
            s: countdownEl.querySelector('[data-unit="seconds"]')
        };

        function update() {
            const now = Date.now();
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

            if (parts.d) parts.d.textContent = String(days).padStart(2, '0');
            if (parts.h) parts.h.textContent = String(hours).padStart(2, '0');
            if (parts.m) parts.m.textContent = String(minutes).padStart(2, '0');
            if (parts.s) parts.s.textContent = String(seconds).padStart(2, '0');
        }

        update();
        window.setInterval(update, 1000);
    }

    function buildScheduledMarkup(config) {
        return `
            <div class="next-session-card">
                <span class="next-label">Prossima Sessione</span>
                <h2 class="next-title text-gold-gradient">Sessione ${escapeHtml(config.number)}</h2>
                <div class="next-details">
                    <div class="detail-item">
                        <span class="detail-label">Data</span>
                        <span class="detail-value"><i class="far fa-calendar-alt" style="margin-right: 8px; color: var(--gold);"></i> ${escapeHtml(config.date)}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Orario</span>
                        <span class="detail-value"><i class="far fa-clock" style="margin-right: 8px; color: var(--gold);"></i> ${escapeHtml(config.timeStart)} - ${escapeHtml(config.timeEnd)}</span>
                    </div>
                </div>
                <div class="countdown-container" data-countdown>
                    <div class="countdown-box"><span class="count-number" data-unit="days">00</span><span class="count-label">Giorni</span></div>
                    <div class="countdown-box"><span class="count-number" data-unit="hours">00</span><span class="count-label">Ore</span></div>
                    <div class="countdown-box"><span class="count-number" data-unit="minutes">00</span><span class="count-label">Minuti</span></div>
                    <div class="countdown-box"><span class="count-number" data-unit="seconds">00</span><span class="count-label">Secondi</span></div>
                </div>
            </div>
        `;
    }

    function buildEmptyMarkup(config) {
        return `
            <div class="next-session-card" style="border-color: #555;">
                <span class="next-label">Prossima Sessione</span>
                <h2 class="next-title" style="color: #aaa;">Sessione ${escapeHtml(config.number)}</h2>
                <div class="tbd-message">
                    <i class="fas fa-hourglass-half" style="margin-right: 10px;"></i>
                    Da Fissare
                </div>
            </div>
        `;
    }

    function buildPollMarkup(config, options, votes, statusMessage) {
        const totals = computeTotals(votes, options);
        const rowsMarkup = votes.length > 0
            ? votes.map((vote, rowIndex) => `
                <tr class="${vote.canEdit ? 'availability-row-is-own' : 'availability-row-is-readonly'}">
                    <th scope="row" class="availability-name-cell${vote.canEdit ? ' is-own' : ''}">
                        <span class="availability-name-text">${escapeHtml(vote.name)}</span>
                    </th>
                    ${options.map(option => `
                        <td class="availability-vote-cell">
                            <div class="availability-choice-slot" role="group" aria-label="Voto ${escapeHtml(vote.name)} per ${escapeHtml(option.label)} ${escapeHtml(option.time)}">
                                <button
                                    type="button"
                                    class="availability-clear-vote"
                                    data-row-index="${rowIndex}"
                                    data-option-id="${escapeHtml(option.id)}"
                                    data-action="clear"
                                    ${vote.canEdit ? '' : 'disabled'}
                                    aria-label="Rimuovi voto di ${escapeHtml(vote.name)} per ${escapeHtml(option.label)}">
                                    <i class="fas fa-times"></i>
                                </button>
                                <button
                                    type="button"
                                    class="availability-choice availability-choice-single${vote.selections[option.id] ? ` ${getVoteState(vote.selections[option.id]).className} is-active` : ' is-empty'}"
                                    data-row-index="${rowIndex}"
                                    data-option-id="${escapeHtml(option.id)}"
                                    data-action="cycle"
                                    ${vote.canEdit ? '' : 'disabled'}
                                    aria-label="Cambia voto di ${escapeHtml(vote.name)} per ${escapeHtml(option.label)}">
                                    ${vote.selections[option.id] ? getVoteState(vote.selections[option.id]).label : ''}
                                </button>
                            </div>
                        </td>
                    `).join('')}
                </tr>
            `).join('')
            : `
                <tr>
                    <td class="availability-empty-state" colspan="${options.length + 1}">
                        Nessun player disponibile per il voto.
                    </td>
                </tr>
            `;

        return `
            <div class="next-session-card next-session-card-poll">
                <span class="next-label">Prossima Sessione</span>
                <h2 class="next-title text-gold-gradient">Sessione ${escapeHtml(config.number)}</h2>
                ${statusMessage ? `<div class="availability-feedback">${escapeHtml(statusMessage)}</div>` : ''}
                <div class="availability-table-wrap">
                    <table class="availability-table">
                        <thead>
                            <tr>
                                <th class="availability-corner-cell">Nome</th>
                                ${options.map(option => `
                                    <th class="availability-option-cell" scope="col">
                                        <span class="availability-option-label">${escapeHtml(option.label)}</span>
                                        ${option.time ? `<span class="availability-option-time">${escapeHtml(option.time)}</span>` : ''}
                                        ${option.meta ? `<span class="availability-option-meta">${escapeHtml(option.meta)}</span>` : ''}
                                        <div class="availability-option-totals">
                                            <span class="availability-total availability-total-yes">SI ${totals[option.id].yes}</span>
                                            <span class="availability-total availability-total-maybe">FORSE ${totals[option.id].maybe}</span>
                                            <span class="availability-total availability-total-no">NO ${totals[option.id].no}</span>
                                        </div>
                                    </th>
                                `).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsMarkup}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    async function renderAvailabilityPoll(container, config) {
        const options = sanitizeOptions(config.availabilityOptions);
        container.innerHTML = `
            <div class="next-session-card next-session-card-poll">
                <span class="next-label">Prossima Sessione</span>
                <h2 class="next-title text-gold-gradient">Sessione ${escapeHtml(config.number)}</h2>
                <p class="availability-intro">Caricamento giocatori...</p>
            </div>
        `;

        let players = [];
        let authState = null;
        try {
            [players, authState] = await Promise.all([
                loadEligiblePlayers(config),
                window.CriptaDiscordAuth?.verify ? window.CriptaDiscordAuth.verify().catch(() => null) : Promise.resolve(null)
            ]);
        } catch (error) {
            console.error('Impossibile caricare i player per il planner della prossima sessione:', error);
            container.innerHTML = `
                <div class="next-session-card next-session-card-poll">
                    <span class="next-label">Prossima Sessione</span>
                    <h2 class="next-title text-gold-gradient">Sessione ${escapeHtml(config.number)}</h2>
                    <p class="availability-intro">Impossibile caricare i player del gruppo.</p>
                </div>
            `;
            return;
        }

        const currentDiscordId = String(authState?.user?.id || authState?.user?.sub || '').trim();
        const authToken = typeof window.CriptaDiscordAuth?.getToken === 'function'
            ? window.CriptaDiscordAuth.getToken()
            : '';
        const localFallbackVotes = readStoredVotes(config.number, config.availabilityVotes, options, players);
        let baseVotes = localFallbackVotes;
        try {
            baseVotes = await loadRemoteVotes(config.number, options, players);
            persistVotes(config.number, baseVotes);
        } catch (error) {
            console.warn('Session votes API non raggiungibile, uso fallback locale.', error);
        }

        let votes = players.map((player) => {
            const existingVote = baseVotes.find((vote) => vote.playerId === player.id);
            return existingVote || {
                playerId: player.id,
                discordId: player.discordId || '',
                name: player.name,
                selections: options.reduce((acc, option) => {
                    acc[option.id] = '';
                    return acc;
                }, {})
            };
        }).map((vote) => ({
            ...vote,
            canEdit: Boolean(currentDiscordId) && Boolean(vote.discordId) && vote.discordId === currentDiscordId
        }));

        let statusMessage = currentDiscordId
            ? ''
            : 'Accedi con Discord per modificare il tuo voto.';

        function decorateVotes(baseVoteList) {
            return players.map((player) => {
                const existingVote = baseVoteList.find((vote) => vote.playerId === player.id);
                return existingVote || {
                    playerId: player.id,
                    discordId: player.discordId || '',
                    name: player.name,
                    selections: options.reduce((acc, option) => {
                        acc[option.id] = '';
                        return acc;
                    }, {})
                };
            }).map((vote) => ({
                ...vote,
                canEdit: Boolean(currentDiscordId) && Boolean(vote.discordId) && vote.discordId === currentDiscordId
            }));
        }

        function rerender() {
            container.innerHTML = buildPollMarkup(config, options, votes, statusMessage);
            const table = container.querySelector('.availability-table');

            if (table) {
                table.addEventListener('click', async (event) => {
                    const target = event.target.closest('button');
                    if (!target) return;

                    const rowIndex = Number(target.getAttribute('data-row-index'));
                    const optionId = target.getAttribute('data-option-id');
                    const action = target.getAttribute('data-action');
                    if (!Number.isInteger(rowIndex) || !optionId || !action || !votes[rowIndex]) {
                        return;
                    }

                    const targetVote = votes[rowIndex];
                    if (!targetVote.canEdit || !targetVote.discordId || !authToken) {
                        statusMessage = 'Puoi modificare solo la tua riga dopo il login Discord.';
                        rerender();
                        return;
                    }

                    const currentChoice = targetVote.selections[optionId];
                    const nextChoice = action === 'clear' ? '' : getNextVoteValue(currentChoice);
                    const previousVotes = votes;

                    votes = votes.map((vote, index) => {
                        if (index !== rowIndex) return vote;
                        return {
                            ...vote,
                            selections: {
                                ...vote.selections,
                                [optionId]: nextChoice
                            }
                        };
                    });
                    statusMessage = 'Salvataggio in corso...';
                    rerender();

                    try {
                        const payload = await postRemoteVote({
                            sessionNumber: config.number,
                            playerDiscordId: targetVote.discordId,
                            optionId,
                            value: nextChoice,
                            token: authToken
                        });
                        const remoteVotes = sanitizeVotes(extractVotesFromApiPayload(payload?.data || payload), options, players);
                        votes = remoteVotes.length > 0 ? decorateVotes(remoteVotes) : decorateVotes(votes.map(({ canEdit, ...vote }) => vote));
                        persistVotes(config.number, votes.map(({ canEdit, ...vote }) => vote));
                        statusMessage = '';
                        rerender();
                    } catch (error) {
                        console.error('Impossibile salvare il voto della prossima sessione:', error);
                        votes = previousVotes;
                        statusMessage = error?.message || 'Impossibile salvare il voto sul server.';
                        rerender();
                    }
                });
            }
        }

        rerender();
    }

    function renderNextSession(config, container) {
        if (!container || !config) return;

        const availabilityOptions = sanitizeOptions(config.availabilityOptions);
        if (availabilityOptions.length > 0) {
            renderAvailabilityPoll(container, config);
            return;
        }

        if (config.isScheduled) {
            container.innerHTML = buildScheduledMarkup(config);
            const targetDate = parseScheduledDate(config.date, config.timeStart);
            if (targetDate) {
                renderCountdown(targetDate.getTime(), container);
            }
            return;
        }

        container.innerHTML = buildEmptyMarkup(config);
    }

    window.CriptaNextSession = {
        render: renderNextSession
    };
})();
