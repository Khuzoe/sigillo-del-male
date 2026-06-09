(function () {
    const API_BASE_URL = typeof window.CriptaApp?.config?.workerOrigin === 'string'
        ? window.CriptaApp.config.workerOrigin
        : (typeof DISCORD_WORKER_URL === 'string' ? DISCORD_WORKER_URL : 'https://sigillo-api.khuzoe.workers.dev');
    const SESSION_CARD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1482056374731931860/7ls24iTa_HMAgwwTbY8Qc96tf79LOxk3f6epN_iW6PHDgI51Dg70UkKgFT5aVQSZRM03';
    const STORAGE_PREFIX = 'cripta-next-session-votes';
    const NEXT_SESSION_CONFIG_OVERRIDE_KEY = 'cripta-next-session-config-override';
    const PLAYERS_DATA_PATH = 'data/players.json';
    const DM_PLAYER = { id: 'dm', name: 'DM', discordId: '' };
    const VIEW_MODES = {
        poll: 'poll',
        scheduled: 'scheduled'
    };
    const EDITOR_MODES = {
        editCurrent: 'edit-current',
        createNext: 'create-next'
    };
    const PRESET_SLOTS = {
        afternoon: {
            label: 'POMERIGGIO',
            start: '15:00',
            end: '18:30'
        },
        evening: {
            label: 'SERA',
            start: '20:30',
            end: '23:30'
        }
    };
    const VOTE_STATES = [
        { value: 'yes', label: 'SI', className: 'is-yes' },
        { value: 'maybe', label: 'FORSE', className: 'is-maybe' },
        { value: 'no', label: 'NO', className: 'is-no' }
    ];
    const VOTE_ICON_SETS = {
        dm: {
            yes: 'dm_yes.webp',
            maybe: 'dm_maybe.webp',
            no: 'dm_no.webp'
        },
        garun: {
            yes: 'garun_yes.webp',
            maybe: 'garun_maybe.webp',
            no: 'garun_no.webp'
        },
        randra: {
            yes: 'randra_yes.webp',
            maybe: 'randra_maybe.webp',
            no: 'randra_no.webp'
        },
        valdor: {
            yes: 'valdor_yes.webp',
            maybe: 'valdor_maybe.webp',
            no: 'valdor_no.webp'
        },
        theldarion: {
            yes: 'theldarion_yes.webp',
            maybe: 'theldarion_maybe.webp',
            no: 'theldarion_no.webp'
        }
    };
    let currentVoteIconSets = VOTE_ICON_SETS;

    const authService = {
        async verify() {
            return window.CriptaDiscordAuth?.verify
                ? window.CriptaDiscordAuth.verify().catch(() => null)
                : null;
        },
        getToken() {
            return typeof window.CriptaDiscordAuth?.getToken === 'function'
                ? window.CriptaDiscordAuth.getToken()
                : '';
        },
        getAccountId(authState, accounts = []) {
            const user = authState?.user || {};
            const explicitAccountId = String(user.accountId || '').trim();
            if (explicitAccountId) return explicitAccountId;

            const id = String(user.id || user.sub || '').trim();
            const discordId = this.getDiscordId(authState);
            const account = getAccountByDiscordId(accounts, discordId || id);
            return String(account?.id || id || '').trim();
        },
        getDiscordId(authState) {
            const user = authState?.user || {};
            const explicitDiscordId = String(user.discordId || '').trim();
            if (explicitDiscordId) return explicitDiscordId;
            const id = String(user.id || user.sub || '').trim();
            return /^\d{5,32}$/.test(id) ? id : '';
        }
    };

    const dataService = {
        async fetchJson(url, label = 'Errore caricamento JSON') {
            if (typeof window.CriptaApp?.fetchJson === 'function') {
                try {
                    return await window.CriptaApp.fetchJson(url);
                } catch (error) {
                    const statusMatch = String(error?.message || '').match(/HTTP\s+(\d+)/i);
                    if (statusMatch) {
                        throw new Error(`${label} (${statusMatch[1]})`);
                    }
                    throw error;
                }
            }

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`${label} (${response.status})`);
            }
            return response.json();
        }
    };

    const sessionApiService = {
        async request(pathname, options = {}, label = 'Worker API') {
            if (typeof window.CriptaApp?.api?.request === 'function') {
                try {
                    return await window.CriptaApp.api.request(pathname, options);
                } catch (error) {
                    const message = String(error?.message || error || '').trim();
                    throw new Error(message ? `${label} ${message}` : `${label} errore sconosciuto`);
                }
            }

            const cleanPath = String(pathname || '').replace(/^\/+/, '');
            const url = new URL(`${API_BASE_URL}/${cleanPath}`);
            if (options.query && typeof options.query === 'object') {
                Object.entries(options.query).forEach(([key, value]) => {
                    if (value === undefined || value === null || value === '') return;
                    url.searchParams.set(key, String(value));
                });
            }
            if (!url.searchParams.has('campaign')) {
                url.searchParams.set('campaign', window.CriptaApp?.campaigns?.currentId?.() || 'cripta-di-sangue');
            }

            const response = await fetch(url.toString(), {
                method: options.method || 'GET',
                headers: {
                    Accept: 'application/json',
                    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
                },
                ...(options.body ? { body: JSON.stringify(options.body) } : {})
            });

            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                const apiMessage = payload?.error || payload?.message || payload?.details || '';
                throw new Error(apiMessage ? `${label} HTTP ${response.status}: ${apiMessage}` : `${label} HTTP ${response.status}`);
            }

            return payload;
        },
        getCurrentSession() {
            return this.request('api/session/current', { method: 'GET' }, 'Session API');
        },
        saveSession(config, token = '') {
            return this.request('api/session', {
                method: 'POST',
                token,
                body: buildSessionSavePayload(config)
            }, 'Session API POST');
        },
        getVotes(sessionNumber) {
            return this.request('api/session-votes', {
                method: 'GET',
                query: { session: sessionNumber }
            }, 'Session votes API');
        },
        saveVote({ sessionNumber, playerAccountId, playerDiscordId, optionId, value, token }) {
            const accountId = String(playerAccountId || '').trim();
            return this.request('api/session-votes', {
                method: 'POST',
                token,
                body: {
                    sessionNumber,
                    accountId,
                    playerId: accountId,
                    discordId: playerDiscordId || '',
                    optionId,
                    value
                }
            }, 'Session votes API POST');
        }
    };

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
        const campaignId = window.CriptaApp?.campaigns?.currentId?.() || 'cripta-di-sangue';
        return `${STORAGE_PREFIX}-${campaignId}-${sessionNumber}`;
    }

    function getMonthIndex(monthId) {
        return ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'].indexOf(monthId);
    }

    function sanitizeNextSessionConfig(config) {
        return {
            campaignId: String(config?.campaignId || '').trim(),
            campaignName: String(config?.campaignName || '').trim(),
            pollTitle: normalizeItalianLabel(config?.pollTitle),
            pollSubtitle: normalizeItalianLabel(config?.pollSubtitle),
            sessionCardImage: String(config?.sessionCardImage || config?.ui?.sessionCardImage || '').trim(),
            sessionCardImageVersion: String(config?.sessionCardImageVersion || config?.ui?.sessionCardImageVersion || '').trim(),
            discordWebhookUrl: String(config?.discordWebhookUrl || '').trim(),
            disableDiscordNotifications: Boolean(config?.disableDiscordNotifications),
            number: Number(config?.number) || 1,
            dmAccountId: String(config?.dmAccountId || '').trim(),
            dmDiscordId: String(config?.dmDiscordId || '').trim(),
            pollManagerAccountIds: sanitizeStringList(config?.pollManagerAccountIds || config?.sessionManagerAccountIds || []),
            pollManagerDiscordIds: sanitizeStringList(config?.pollManagerDiscordIds || config?.sessionManagerDiscordIds || []),
            date: String(config?.date || '').trim(),
            timeStart: String(config?.timeStart || '').trim(),
            timeEnd: String(config?.timeEnd || '').trim(),
            isScheduled: Boolean(config?.isScheduled),
            availabilityOptions: sanitizeOptions(config?.availabilityOptions || []),
            availabilityVotes: Array.isArray(config?.availabilityVotes) ? config.availabilityVotes : [],
            voteIcons: sanitizeVoteIconSets(config?.voteIcons || config?.ui?.voteIcons || {})
        };
    }

    function normalizeItalianLabel(value) {
        return String(value || '')
            .trim()
            .replace(/\bdisponibilita\b/gi, 'disponibilità');
    }

    function sanitizeStringList(value) {
        if (!Array.isArray(value)) return [];
        return [...new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean))];
    }

    function sanitizeVoteIconSets(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
        const out = {};
        Object.entries(value).forEach(([rawPlayerId, rawIcons]) => {
            if (!rawIcons || typeof rawIcons !== 'object' || Array.isArray(rawIcons)) return;
            const playerId = String(rawPlayerId || '').trim().toLowerCase();
            if (!playerId) return;
            const icons = {};
            VOTE_STATES.forEach((state) => {
                const iconPath = String(rawIcons[state.value] || '').trim();
                if (iconPath) icons[state.value] = iconPath;
            });
            if (Object.keys(icons).length) out[playerId] = icons;
        });
        return out;
    }

    function setCurrentVoteIconSets(config) {
        currentVoteIconSets = {
            ...VOTE_ICON_SETS,
            ...(config?.voteIcons || {})
        };
    }

    function readStoredNextSessionConfig(baseConfig) {
        return sanitizeNextSessionConfig(baseConfig);
    }

    function persistNextSessionConfig(config) {
        return sanitizeNextSessionConfig(config);
    }

    function buildSessionSavePayload(config) {
        const cleanConfig = sanitizeNextSessionConfig(config);
        return {
            campaignId: cleanConfig.campaignId,
            number: cleanConfig.number,
            dmAccountId: cleanConfig.dmAccountId,
            dmDiscordId: cleanConfig.dmDiscordId,
            pollManagerAccountIds: cleanConfig.pollManagerAccountIds,
            pollManagerDiscordIds: cleanConfig.pollManagerDiscordIds,
            campaignName: cleanConfig.campaignName,
            pollTitle: cleanConfig.pollTitle,
            pollSubtitle: cleanConfig.pollSubtitle,
            sessionCardImage: cleanConfig.sessionCardImage,
            sessionCardImageVersion: cleanConfig.sessionCardImageVersion,
            discordWebhookUrl: cleanConfig.discordWebhookUrl,
            disableDiscordNotifications: cleanConfig.disableDiscordNotifications,
            date: cleanConfig.date,
            timeStart: cleanConfig.timeStart,
            timeEnd: cleanConfig.timeEnd,
            isScheduled: cleanConfig.isScheduled,
            availabilityOptions: cleanConfig.availabilityOptions
        };
    }

    function getCurrentCampaignId() {
        return String(window.CriptaApp?.campaigns?.currentId?.() || 'cripta-di-sangue').trim() || 'cripta-di-sangue';
    }

    function getSessionWebhookUrl(config) {
        if (config?.disableDiscordNotifications) return '';
        const explicitWebhookUrl = String(config?.discordWebhookUrl || '').trim();
        if (explicitWebhookUrl) return explicitWebhookUrl;
        return getCurrentCampaignId() === 'cripta-di-sangue' ? SESSION_CARD_WEBHOOK_URL : '';
    }

    function getAssetsBasePath() {
        return window.location.pathname.includes('/pages/') ? '../assets/' : 'assets/';
    }

    function getVoteIconPath(value, playerId) {
        const state = getVoteState(value);
        if (!state?.value) return '';
        const normalizedPlayerId = String(playerId || '').trim().toLowerCase();
        const iconSet = currentVoteIconSets[normalizedPlayerId] || currentVoteIconSets.dm || VOTE_ICON_SETS.dm;
        const iconFile = iconSet?.[state.value];
        if (!iconFile) return '';
        return resolveVoteIconUrl(iconFile);
    }

    function getVoteIconFallbackPath(value, playerId) {
        const state = getVoteState(value);
        if (!state?.value) return '';
        const normalizedPlayerId = String(playerId || '').trim().toLowerCase();
        const iconSet = currentVoteIconSets[normalizedPlayerId] || currentVoteIconSets.dm || VOTE_ICON_SETS.dm;
        const iconFile = String(iconSet?.[state.value] || '').trim();
        if (!/^\/?media\/ui\//i.test(iconFile)) return '';
        return resolveVoteIconUrl(iconFile.replace(/^\/?media\/ui\//i, 'assets/img/ui/'));
    }

    function resolveVoteIconUrl(iconPath) {
        const value = String(iconPath || '').trim();
        if (!value) return '';
        if (/^(https?:|data:|blob:)/i.test(value)) return value;
        if (value.startsWith('media/')) {
            return typeof window.CriptaApp?.urls?.api === 'function'
                ? window.CriptaApp.urls.api(value)
                : `${API_BASE_URL}/${value}`;
        }
        if (value.startsWith('/media/')) {
            const cleanValue = value.replace(/^\/+/, '');
            return typeof window.CriptaApp?.urls?.api === 'function'
                ? window.CriptaApp.urls.api(cleanValue)
                : `${API_BASE_URL}/${cleanValue}`;
        }
        if (value.startsWith('assets/')) {
            return typeof window.CriptaApp?.urls?.site === 'function'
                ? window.CriptaApp.urls.site(value)
                : `${getAssetsBasePath()}${value.replace(/^assets\//, '')}`;
        }
        if (value.includes('/')) {
            return typeof window.CriptaApp?.urls?.site === 'function'
                ? window.CriptaApp.urls.site(value)
                : value;
        }
        return `${getAssetsBasePath()}img/ui/${value}`;
    }

    function getSessionCardImagePath(config) {
        const explicitPath = String(config?.sessionCardImage || '').trim();
        if (explicitPath) return explicitPath;
        const campaignId = String(config?.campaignId || getCurrentCampaignId()).trim();
        if (campaignId === 'mago-folle') return 'img/ui/mago-folle/card.webp';
        if (campaignId === 'oltre-il-velo') return 'img/ui/oltre-il-velo/card.webp';
        return 'img/ui/card.webp';
    }

    function appendCacheBust(url, version) {
        const cleanVersion = String(version || '').trim();
        if (!cleanVersion || /^(data:|blob:)/i.test(url)) return url;
        try {
            const resolvedUrl = new URL(url, window.location.href);
            resolvedUrl.searchParams.set('v', cleanVersion);
            return resolvedUrl.toString();
        } catch (error) {
            const separator = url.includes('?') ? '&' : '?';
            return `${url}${separator}v=${encodeURIComponent(cleanVersion)}`;
        }
    }

    function resolveSessionCardImageUrl(imagePath, version = '') {
        const value = String(imagePath || '').trim() || 'img/ui/card.webp';
        let resolved = '';
        if (/^(https?:|data:|blob:)/i.test(value)) return appendCacheBust(value, version);
        if (value.startsWith('media/')) {
            resolved = typeof window.CriptaApp?.urls?.api === 'function'
                ? window.CriptaApp.urls.api(value)
                : `${API_BASE_URL}/${value}`;
            return appendCacheBust(resolved, version);
        }
        if (value.startsWith('/media/')) {
            const cleanValue = value.replace(/^\/+/, '');
            resolved = typeof window.CriptaApp?.urls?.api === 'function'
                ? window.CriptaApp.urls.api(cleanValue)
                : `${API_BASE_URL}/${cleanValue}`;
            return appendCacheBust(resolved, version);
        }
        if (value.startsWith('assets/')) {
            resolved = typeof window.CriptaApp?.urls?.site === 'function'
                ? window.CriptaApp.urls.site(value)
                : `${window.location.pathname.includes('/pages/') ? '../' : ''}${value}`;
            return appendCacheBust(resolved, version);
        }
        if (value.startsWith('/')) return appendCacheBust(value, version);
        if (value.startsWith('img/')) {
            resolved = typeof window.CriptaApp?.urls?.site === 'function'
                ? window.CriptaApp.urls.site(`assets/${value}`)
                : `${getAssetsBasePath()}${value}`;
            return appendCacheBust(resolved, version);
        }
        if (value.includes('/')) {
            resolved = typeof window.CriptaApp?.urls?.site === 'function'
                ? window.CriptaApp.urls.site(value)
                : value;
            return appendCacheBust(resolved, version);
        }
        return appendCacheBust(`${getAssetsBasePath()}img/ui/${value}`, version);
    }

    async function loadEligiblePlayers(config) {
        const playersPath = window.CriptaApp?.urls?.data?.('players.json') || `${getAssetsBasePath()}${PLAYERS_DATA_PATH}`;
        const [players, accounts] = await Promise.all([
            dataService.fetchJson(playersPath, 'File dati players non trovato'),
            loadGlobalAccounts()
        ]);
        if (!Array.isArray(players)) return [];

        const eligiblePlayers = players
            .filter((player) => !player.hidden && player.isActive !== false)
            .map((player) => normalizeCampaignPlayer(player, accounts));
        const dmPlayer = {
            ...DM_PLAYER,
            discordId: String(config?.dmDiscordId || '').trim(),
            accountId: String(config?.dmAccountId || getAccountByDiscordId(accounts, config?.dmDiscordId)?.id || config?.dmDiscordId || '').trim(),
            accountName: getAccountByDiscordId(accounts, config?.dmDiscordId)?.name || ''
        };
        return [dmPlayer, ...eligiblePlayers];
    }

    async function loadGlobalAccounts() {
        const accountsPath = window.CriptaApp?.urls?.globalData?.('users.json') || `${getAssetsBasePath()}data/users.json`;
        try {
            const accounts = await dataService.fetchJson(accountsPath, 'File dati utenti non trovato');
            return Array.isArray(accounts) ? accounts : [];
        } catch (_) {
            return [];
        }
    }

    function normalizeCampaignPlayer(player, accounts) {
        const rawAccountId = String(player?.accountId || '').trim();
        const account = rawAccountId ? getAccountById(accounts, rawAccountId) : getAccountByDiscordId(accounts, player?.discordId);
        const accountId = String(rawAccountId || account?.id || player?.discordId || '').trim();
        const discordId = String(player?.discordId || account?.discordId || '').trim();
        const characterName = String(player?.characterName || player?.name || '').trim();
        return {
            ...player,
            id: String(player?.id || characterName || accountId || discordId).trim(),
            name: characterName || account?.name || accountId || discordId,
            accountId,
            accountName: String(account?.name || '').trim(),
            discordId,
            campaignRole: String(player?.campaignRole || player?.role || 'player').trim()
        };
    }

    function getAccountById(accounts, accountId) {
        const id = String(accountId || '').trim();
        return Array.isArray(accounts) ? accounts.find((account) => String(account?.id || '').trim() === id) : null;
    }

    function getAccountByDiscordId(accounts, discordId) {
        const id = String(discordId || '').trim();
        return Array.isArray(accounts) ? accounts.find((account) => String(account?.discordId || '').trim() === id) : null;
    }

    function getPollManagerIdentities(config, accounts = []) {
        const accountIds = new Set();
        const discordIds = new Set();
        const addAccountId = (value) => {
            const id = String(value || '').trim();
            if (!id) return;
            accountIds.add(id);
            const account = getAccountById(accounts, id);
            if (account?.discordId) discordIds.add(String(account.discordId).trim());
        };
        const addDiscordId = (value) => {
            const id = String(value || '').trim();
            if (!id) return;
            discordIds.add(id);
            const account = getAccountByDiscordId(accounts, id);
            if (account?.id) accountIds.add(String(account.id).trim());
        };

        addAccountId(config?.dmAccountId);
        addDiscordId(config?.dmDiscordId);
        sanitizeStringList(config?.pollManagerAccountIds || []).forEach(addAccountId);
        sanitizeStringList(config?.pollManagerDiscordIds || []).forEach(addDiscordId);

        return {
            accountIds: [...accountIds],
            discordIds: [...discordIds]
        };
    }

    function canManagePoll(config, currentAccountId, currentDiscordId, accounts = []) {
        const accountId = String(currentAccountId || '').trim();
        const discordId = String(currentDiscordId || '').trim();
        const identities = getPollManagerIdentities(config, accounts);
        return Boolean(accountId && identities.accountIds.includes(accountId))
            || Boolean(discordId && identities.discordIds.includes(discordId));
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

    function parseDateValueFromOptionId(optionId) {
        const match = String(optionId || '').trim().toLowerCase().match(/^(lun|mar|mer|gio|ven|sab|dom)-(\d{1,2})-(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)-(\d{4})/);
        if (!match) return '';
        const day = String(Number(match[2])).padStart(2, '0');
        const monthIndex = getMonthIndex(match[3]);
        if (monthIndex < 0) return '';
        const month = String(monthIndex + 1).padStart(2, '0');
        const suffix = Number(match[4]);
        const year = Number.isFinite(suffix) && suffix <= 2359 ? new Date().getFullYear() : suffix;
        return `${year}-${month}-${day}`;
    }

    function parseTimeRange(timeRange) {
        const match = String(timeRange || '').trim().match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
        if (!match) return null;
        return { start: match[1], end: match[2] };
    }

    function minutesFromTime(timeValue) {
        const match = String(timeValue || '').trim().match(/^(\d{2}):(\d{2})$/);
        if (!match) return Number.NaN;
        return Number(match[1]) * 60 + Number(match[2]);
    }

    function computeDurationMeta(startTime, endTime) {
        const startMinutes = minutesFromTime(startTime);
        const endMinutes = minutesFromTime(endTime);
        if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || endMinutes <= startMinutes) {
            return '';
        }

        const duration = endMinutes - startMinutes;
        const hours = Math.floor(duration / 60);
        const minutes = duration % 60;
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }

    function buildOptionLabelFromDate(dateValue) {
        const date = new Date(`${dateValue}T12:00:00`);
        if (Number.isNaN(date.getTime())) return '';
        const shortDays = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
        const shortMonths = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
        return `${shortDays[date.getDay()]} ${date.getDate()} ${shortMonths[date.getMonth()]}`;
    }

    function buildOptionId(dateValue, startTime) {
        const date = new Date(`${dateValue}T12:00:00`);
        if (Number.isNaN(date.getTime())) return '';
        const dayIds = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
        const monthIds = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
        const dayId = dayIds[date.getDay()];
        const day = String(date.getDate()).padStart(2, '0');
        const monthId = monthIds[date.getMonth()];
        const compactTime = String(startTime || '').replace(':', '');
        return `${dayId}-${day}-${monthId}-${compactTime}`;
    }

    function buildOptionFromDateSlot(dateValue, startTime, endTime) {
        return {
            id: buildOptionId(dateValue, startTime),
            label: buildOptionLabelFromDate(dateValue),
            time: `${startTime} - ${endTime}`,
            meta: computeDurationMeta(startTime, endTime)
        };
    }

    function formatLongItalianDate(dateValue) {
        const date = new Date(`${dateValue}T12:00:00`);
        if (Number.isNaN(date.getTime())) return '';

        const dayNames = ['Domenica', 'Luned\u00ec', 'Marted\u00ec', 'Mercoled\u00ec', 'Gioved\u00ec', 'Venerd\u00ec', 'Sabato'];
        const monthNames = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
        return `${dayNames[date.getDay()]} ${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
    }

    function buildScheduledConfigFromOption(config, option) {
        const dateValue = parseDateValueFromOptionId(option?.id || '');
        const timeRange = parseTimeRange(option?.time || '');
        if (!dateValue || !timeRange) return null;

        return sanitizeNextSessionConfig({
            ...config,
            date: formatLongItalianDate(dateValue),
            timeStart: timeRange.start,
            timeEnd: timeRange.end,
            isScheduled: true
        });
    }

    function getDefaultViewMode(config, options) {
        if (config?.isScheduled) return VIEW_MODES.scheduled;
        if (Array.isArray(options) && options.length > 0) return VIEW_MODES.poll;
        return 'empty';
    }

    function downloadBlob(blob, filename) {
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }

    function drawRoundedRect(context, x, y, width, height, radius, fillStyle, strokeStyle = '', lineWidth = 1) {
        context.beginPath();
        context.moveTo(x + radius, y);
        context.lineTo(x + width - radius, y);
        context.quadraticCurveTo(x + width, y, x + width, y + radius);
        context.lineTo(x + width, y + height - radius);
        context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        context.lineTo(x + radius, y + height);
        context.quadraticCurveTo(x, y + height, x, y + height - radius);
        context.lineTo(x, y + radius);
        context.quadraticCurveTo(x, y, x + radius, y);
        context.closePath();
        context.fillStyle = fillStyle;
        context.fill();
        if (strokeStyle) {
            context.strokeStyle = strokeStyle;
            context.lineWidth = lineWidth;
            context.stroke();
        }
    }

    function withCanvasShadow(context, options, draw) {
        context.save();
        context.shadowColor = options.color || 'rgba(0, 0, 0, 0.35)';
        context.shadowBlur = Number(options.blur) || 24;
        context.shadowOffsetX = Number(options.offsetX) || 0;
        context.shadowOffsetY = Number(options.offsetY) || 10;
        draw();
        context.restore();
    }

    function drawSessionCardTexture(context, width, height, theme) {
        context.save();
        context.globalAlpha = 0.16;
        context.strokeStyle = theme.textureStroke || 'rgba(240, 212, 138, 0.08)';
        context.lineWidth = 1;
        for (let x = -height; x < width; x += 34) {
            context.beginPath();
            context.moveTo(x, height);
            context.lineTo(x + height, 0);
            context.stroke();
        }
        context.globalAlpha = 0.08;
        context.fillStyle = theme.textureDot || 'rgba(240, 212, 138, 0.18)';
        for (let y = 126; y < height - 126; y += 52) {
            for (let x = 146; x < width - 146; x += 64) {
                if (((x + y) % 5) !== 0) continue;
                context.beginPath();
                context.arc(x, y, 1.2, 0, Math.PI * 2);
                context.fill();
            }
        }
        context.restore();
    }

    function wrapCanvasText(context, text, maxWidth) {
        const words = String(text || '').split(/\s+/).filter(Boolean);
        if (words.length === 0) return [''];

        const lines = [];
        let currentLine = words[0];
        for (let index = 1; index < words.length; index += 1) {
            const candidate = `${currentLine} ${words[index]}`;
            if (context.measureText(candidate).width <= maxWidth) {
                currentLine = candidate;
            } else {
                lines.push(currentLine);
                currentLine = words[index];
            }
        }
        lines.push(currentLine);
        return lines;
    }

    function drawAdaptiveCanvasText(context, text, x, y, maxWidth, options = {}) {
        const value = String(text || '');
        const family = options.family || 'Cinzel, Georgia, serif';
        const weight = options.weight || '700';
        const minSize = Number(options.minSize) || 26;
        const maxSize = Number(options.maxSize) || 34;
        const lineHeight = Number(options.lineHeight) || 38;
        for (let size = maxSize; size >= minSize; size -= 1) {
            context.font = `${weight} ${size}px ${family}`;
            if (context.measureText(value).width <= maxWidth) {
                context.fillText(value, x, y);
                return 1;
            }
        }

        context.font = `${weight} ${minSize}px ${family}`;
        const lines = wrapCanvasText(context, value, maxWidth);
        lines.slice(0, 2).forEach((line, index) => {
            context.fillText(line, x, y + (index * lineHeight));
        });
        return Math.min(lines.length, 2);
    }

    function loadCanvasImage(src) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error(`Impossibile caricare immagine: ${src}`));
            image.src = src;
        });
    }

    function drawImageContain(context, image, x, y, boxWidth, boxHeight, options = {}) {
        if (!image?.width || !image?.height) return;
        const scale = Math.min(boxWidth / image.width, boxHeight / image.height);
        const drawWidth = image.width * scale;
        const drawHeight = image.height * scale;
        const alignX = typeof options.alignX === 'number' ? options.alignX : 0.5;
        const alignY = typeof options.alignY === 'number' ? options.alignY : 0.5;
        const drawX = x + ((boxWidth - drawWidth) * alignX);
        const drawY = y + ((boxHeight - drawHeight) * alignY);
        context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    }

    function getSessionCardTheme(config) {
        const campaignId = String(config?.campaignId || getCurrentCampaignId()).trim().toLowerCase();
        if (campaignId === 'mago-folle') {
            return {
                backgroundTop: '#111018',
                backgroundBottom: '#08090f',
                panelFill: 'rgba(12, 14, 22, 0.9)',
                innerPanelFill: 'rgba(8, 10, 16, 0.58)',
                infoFill: 'rgba(20, 16, 25, 0.9)',
                accent: '#f0d48a',
                accentSoft: 'rgba(240, 212, 138, 0.28)',
                glow: 'rgba(83, 169, 255, 0.18)',
                muted: '#9e8d65',
                text: '#f5ead0',
                subtext: '#cdbb8d',
                imageGlow: 'rgba(83, 169, 255, 0.2)',
                imageBox: { x: 725, y: 289, width: 580, height: 435, alignX: 0.5, alignY: 1 },
                imageGlowBox: { x: 680, y: 249, width: 650, height: 520, cx: 1015, cy: 569, inner: 70, outer: 460 },
                titleShadow: 'rgba(83, 169, 255, 0.16)',
                textureStroke: 'rgba(83, 169, 255, 0.08)',
                textureDot: 'rgba(240, 212, 138, 0.16)'
            };
        }
        return {
            backgroundTop: '#171013',
            backgroundBottom: '#08090c',
            panelFill: 'rgba(17, 18, 26, 0.88)',
            innerPanelFill: 'rgba(9, 8, 11, 0.52)',
            infoFill: 'rgba(27, 16, 22, 0.92)',
            accent: '#f0d48a',
            accentSoft: 'rgba(212, 175, 55, 0.24)',
            glow: 'rgba(151, 35, 30, 0.18)',
            muted: '#8f7c56',
            text: '#f3ead5',
            subtext: '#d8b25a',
            imageGlow: 'rgba(151, 35, 30, 0.24)',
            imageBox: { x: 725, y: 289, width: 580, height: 435, alignX: 0.5, alignY: 1 },
            imageGlowBox: { x: 680, y: 249, width: 650, height: 520, cx: 1015, cy: 569, inner: 70, outer: 460 },
            titleShadow: 'rgba(151, 35, 30, 0.2)',
            textureStroke: 'rgba(151, 35, 30, 0.08)',
            textureDot: 'rgba(212, 175, 55, 0.14)'
        };
    }

    function getDisplayCampaignName(config) {
        const rawName = String(config?.campaignName || '').trim();
        if (rawName && !/^(campagna|nome campagna)$/i.test(rawName)) return rawName;

        const campaignId = String(config?.campaignId || getCurrentCampaignId()).trim().toLowerCase();
        const knownNames = {
            'cripta-di-sangue': 'Cripta di Sangue',
            'mago-folle': 'Mago Folle',
            'oltre-il-velo': 'Oltre il Velo'
        };
        if (knownNames[campaignId]) return knownNames[campaignId];

        return campaignId
            .split(/[-_]+/)
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ') || 'Campagna';
    }

    function getNextSessionCardHeading(config) {
        const campaignId = String(config?.campaignId || getCurrentCampaignId()).trim().toLowerCase();
        if (campaignId === 'mago-folle' || campaignId === 'oltre-il-velo') {
            return {
                title: 'Prossima Sessione',
                subtitle: getDisplayCampaignName(config)
            };
        }

        return {
            title: config.pollTitle || `Sessione ${config.number}`,
            subtitle: config.pollSubtitle || config.campaignName || 'Prossima Sessione'
        };
    }

    function formatExportOption(option) {
        const labelParts = formatAvailabilityLabel(option);
        return `${labelParts.day}${labelParts.month ? ` ${labelParts.month}` : ''} · ${option.time}`;
    }

    async function renderSessionCardPngBlob(config, viewMode = '') {
        const effectiveConfig = sanitizeNextSessionConfig(config);
        const options = sanitizeOptions(effectiveConfig.availabilityOptions);
        const isScheduledView = effectiveConfig.isScheduled && viewMode !== VIEW_MODES.poll;
        const cardTheme = getSessionCardTheme(effectiveConfig);
        const width = 1400;
        const height = isScheduledView ? 860 : 1040;
        const scale = Math.max(2, Math.min(3, Math.ceil(window.devicePixelRatio || 2)));
        const canvas = document.createElement('canvas');
        canvas.width = width * scale;
        canvas.height = height * scale;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('Canvas non disponibile per l\'export PNG.');
        }

        context.scale(scale, scale);

        const background = context.createLinearGradient(0, 0, 0, height);
        background.addColorStop(0, cardTheme.backgroundTop);
        background.addColorStop(1, cardTheme.backgroundBottom);
        context.fillStyle = background;
        context.fillRect(0, 0, width, height);

        const glow = context.createRadialGradient(width * 0.82, height * 0.12, 20, width * 0.82, height * 0.12, 520);
        glow.addColorStop(0, cardTheme.glow);
        glow.addColorStop(1, 'rgba(212, 175, 55, 0)');
        context.fillStyle = glow;
        context.fillRect(0, 0, width, height);

        drawRoundedRect(context, 70, 70, width - 140, height - 140, 32, cardTheme.panelFill, cardTheme.accentSoft, 2);
        drawRoundedRect(context, 94, 94, width - 188, height - 188, 28, cardTheme.innerPanelFill);
        drawSessionCardTexture(context, width, height, cardTheme);

        let decorationImage = null;
        try {
            decorationImage = await loadCanvasImage(
                resolveSessionCardImageUrl(
                    getSessionCardImagePath(effectiveConfig),
                    effectiveConfig.sessionCardImageVersion
                )
            );
        } catch (error) {
            console.warn('Impossibile caricare la decorazione della card per l\'export PNG:', error);
        }

        context.fillStyle = cardTheme.muted;
        context.font = '600 26px Cinzel, Georgia, serif';
        context.letterSpacing = '0.08em';
        context.fillText('PROSSIMA SESSIONE', 130, 160);

        context.save();
        context.shadowColor = cardTheme.titleShadow;
        context.shadowBlur = 22;
        context.shadowOffsetY = 2;
        context.fillStyle = cardTheme.accent;
        context.font = `700 ${isScheduledView ? 66 : 74}px Cinzel, Georgia, serif`;
        context.fillText(`Sessione ${effectiveConfig.number}`, 130, isScheduledView ? 236 : 245);
        context.restore();

        context.fillStyle = '#d8cfbe';
        context.font = '500 24px Segoe UI, Arial, sans-serif';

        if (isScheduledView) {
            const campaignName = getDisplayCampaignName(effectiveConfig);
            context.font = '700 20px Cinzel, Georgia, serif';
            const badgeWidth = Math.max(240, Math.min(410, context.measureText(campaignName).width + 94));
            withCanvasShadow(context, { color: 'rgba(0, 0, 0, 0.35)', blur: 20, offsetY: 8 }, () => {
                drawRoundedRect(context, width - 130 - badgeWidth, 128, badgeWidth, 54, 18, 'rgba(12, 12, 18, 0.72)', cardTheme.accentSoft, 2);
            });
            context.fillStyle = cardTheme.subtext;
            context.font = '700 18px Segoe UI, Arial, sans-serif';
            context.fillText('CAMPAGNA', width - 102 - badgeWidth, 151);
            context.fillStyle = cardTheme.text;
            context.font = '700 20px Cinzel, Georgia, serif';
            context.fillText(campaignName, width - 102 - badgeWidth, 174);

            withCanvasShadow(context, { color: 'rgba(0, 0, 0, 0.42)', blur: 34, offsetY: 16 }, () => {
                drawRoundedRect(context, 130, 276, 575, 394, 24, cardTheme.infoFill, 'rgba(212, 175, 55, 0.16)');
            });
            const panelGlow = context.createLinearGradient(130, 276, 705, 670);
            panelGlow.addColorStop(0, cardTheme.accentSoft);
            panelGlow.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
            panelGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
            drawRoundedRect(context, 130, 276, 575, 394, 24, panelGlow);

            drawRoundedRect(context, 154, 318, 6, 236, 3, cardTheme.accent);
            context.fillStyle = cardTheme.muted;
            context.font = '700 20px Segoe UI, Arial, sans-serif';
            context.fillText('SESSIONE CONFERMATA', 178, 328);
            drawRoundedRect(context, 178, 344, 178, 3, 2, cardTheme.accentSoft);

            drawRoundedRect(context, 178, 358, 485, 96, 18, 'rgba(8, 9, 14, 0.62)', 'rgba(212, 175, 55, 0.1)');
            context.fillStyle = cardTheme.muted;
            context.font = '700 16px Segoe UI, Arial, sans-serif';
            context.fillText('DATA', 210, 394);
            context.fillStyle = cardTheme.text;
            drawAdaptiveCanvasText(context, effectiveConfig.date || 'Da definire', 210, 434, 420, {
                minSize: 25,
                maxSize: 31,
                lineHeight: 34
            });

            drawRoundedRect(context, 178, 478, 270, 72, 18, 'rgba(8, 9, 14, 0.62)', 'rgba(212, 175, 55, 0.1)');
            context.fillStyle = cardTheme.muted;
            context.font = '700 15px Segoe UI, Arial, sans-serif';
            context.fillText('ORARIO', 210, 504);
            context.fillStyle = cardTheme.subtext;
            context.font = '700 29px Segoe UI, Arial, sans-serif';
            context.fillText(`${effectiveConfig.timeStart || '--:--'} - ${effectiveConfig.timeEnd || '--:--'}`, 210, 538);

            drawRoundedRect(context, 178, 616, 230, 2, 1, cardTheme.accentSoft);

            if (decorationImage) {
                const glowBox = cardTheme.imageGlowBox;
                const imageBox = cardTheme.imageBox;
                const imageGlow = context.createRadialGradient(glowBox.cx, glowBox.cy, glowBox.inner, glowBox.cx, glowBox.cy, glowBox.outer);
                imageGlow.addColorStop(0, cardTheme.imageGlow || cardTheme.glow);
                imageGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
                context.fillStyle = imageGlow;
                context.fillRect(glowBox.x, glowBox.y, glowBox.width, glowBox.height);
                drawImageContain(context, decorationImage, imageBox.x, imageBox.y, imageBox.width, imageBox.height, {
                    alignX: imageBox.alignX,
                    alignY: imageBox.alignY
                });
            }
        } else {
            if (decorationImage) {
                context.save();
                context.globalAlpha = 1;
                const decorationX = width - 700;
                const decorationY = height - 347;
                const decorationScale = 0.24;
                const decorationWidth = decorationImage.width * decorationScale;
                const decorationHeight = decorationImage.height * decorationScale;
                context.drawImage(decorationImage, decorationX, decorationY, decorationWidth, decorationHeight);
                context.restore();
            }

            context.fillStyle = '#9d8c6a';
            context.font = '600 21px Segoe UI, Arial, sans-serif';
            context.fillText('SONDAGGIO DISPONIBILITA', 130, 320);

            const cards = options.slice(0, 10);
            const columns = 2;
            const cardWidth = 550;
            const cardHeight = 110;
            const gap = 26;
            cards.forEach((option, index) => {
                const column = index % columns;
                const row = Math.floor(index / columns);
                const x = 130 + column * (cardWidth + gap);
                const y = 360 + row * (cardHeight + 20);
                drawRoundedRect(context, x, y, cardWidth, cardHeight, 22, 'rgba(24, 20, 26, 0.92)', 'rgba(212, 175, 55, 0.12)');
                context.fillStyle = '#f1ddb0';
                context.font = '700 28px Cinzel, Georgia, serif';
                context.fillText(formatExportOption(option), x + 26, y + 48);
                context.fillStyle = '#bda57a';
                context.font = '500 18px Segoe UI, Arial, sans-serif';
                context.fillText('Slot disponibile per la votazione', x + 26, y + 82);
            });

            if (options.length > cards.length) {
                context.fillStyle = '#8e7e5e';
                context.font = '500 20px Segoe UI, Arial, sans-serif';
                context.fillText(`+ ${options.length - cards.length} altre opzioni`, 130, height - 145);
            }

            context.fillStyle = '#938260';
            context.font = '500 22px Segoe UI, Arial, sans-serif';
            context.fillText(getDisplayCampaignName(effectiveConfig), 130, height - 100);
        }

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) {
            throw new Error('Impossibile generare il PNG della sessione.');
        }

        return {
            blob,
            filename: `sessione-${effectiveConfig.number}.png`
        };
    }

    async function exportSessionCardAsPng(config, viewMode = '') {
        const { blob, filename } = await renderSessionCardPngBlob(config, viewMode);
        downloadBlob(blob, filename);
    }

    async function postSessionCardToDiscord(config, viewMode = '') {
        const effectiveConfig = sanitizeNextSessionConfig(config);
        const webhookUrl = getSessionWebhookUrl(effectiveConfig);
        if (!webhookUrl) return null;
        const { blob, filename } = await renderSessionCardPngBlob(effectiveConfig, viewMode);
        const formData = new FormData();
        const content = effectiveConfig.isScheduled
            ? `@everyone Sessione ${effectiveConfig.number} fissata: ${effectiveConfig.date} · ${effectiveConfig.timeStart} - ${effectiveConfig.timeEnd}`
            : `Sessione ${effectiveConfig.number} - card generata`;

        formData.append('content', content);
        formData.append('file', blob, filename);

        const response = await fetch(`${webhookUrl}?wait=true`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const responseText = await response.text().catch(() => '');
            throw new Error(responseText || `Webhook Discord HTTP ${response.status}`);
        }

        return response.json().catch(() => null);
    }

    async function postSessionPollLinkToDiscord(config) {
        const effectiveConfig = sanitizeNextSessionConfig(config);
        const webhookUrl = getSessionWebhookUrl(effectiveConfig);
        if (!webhookUrl) return null;
        const pollUrl = getSessionPollUrl(effectiveConfig);
        const response = await fetch(`${webhookUrl}?wait=true`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content: `@everyone Nuova sessione ${effectiveConfig.number} creata.\nVota qui: ${pollUrl}`
            })
        });

        if (!response.ok) {
            const responseText = await response.text().catch(() => '');
            throw new Error(responseText || `Webhook Discord HTTP ${response.status}`);
        }

        return response.json().catch(() => null);
    }

    function getSessionPollUrl(config) {
        const campaignId = String(config?.campaignId || '').trim();
        if (typeof window.CriptaApp?.urls?.pollPage === 'function') {
            return window.CriptaApp.urls.pollPage(campaignId);
        }
        const url = new URL('https://khuzoe.github.io/sigillo-del-male/pages/sondaggio.html');
        if (campaignId && campaignId !== 'cripta-di-sangue') url.searchParams.set('campaign', campaignId);
        return url.toString();
    }

    function buildEditorDaysFromConfig(config) {
        const grouped = new Map();
        sanitizeOptions(config?.availabilityOptions || []).forEach((option) => {
            const dateValue = parseDateValueFromOptionId(option.id);
            const parsedRange = parseTimeRange(option.time);
            if (!dateValue || !parsedRange) return;

            if (!grouped.has(dateValue)) {
                grouped.set(dateValue, {
                    dateValue,
                    afternoon: false,
                    evening: false,
                    customEnabled: false,
                    customStart: '19:00',
                    customEnd: '22:00'
                });
            }

            const dayEntry = grouped.get(dateValue);
            if (parsedRange.start === PRESET_SLOTS.afternoon.start && parsedRange.end === PRESET_SLOTS.afternoon.end) {
                dayEntry.afternoon = true;
            } else if (parsedRange.start === PRESET_SLOTS.evening.start && parsedRange.end === PRESET_SLOTS.evening.end) {
                dayEntry.evening = true;
            } else {
                dayEntry.customEnabled = true;
                dayEntry.customStart = parsedRange.start;
                dayEntry.customEnd = parsedRange.end;
            }
        });

        return Array.from(grouped.values()).sort((left, right) => left.dateValue.localeCompare(right.dateValue));
    }

    function buildDefaultEditorDays() {
        const now = new Date();
        const todayDay = now.getDay();
        const daysUntilNextMonday = todayDay === 0 ? 1 : 8 - todayDay;
        const nextMonday = new Date(now);
        nextMonday.setHours(12, 0, 0, 0);
        nextMonday.setDate(now.getDate() + daysUntilNextMonday);

        return Array.from({ length: 7 }, (_, offset) => {
            const date = new Date(nextMonday);
            date.setDate(nextMonday.getDate() + offset);
            const dateValue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            const isWeekend = offset >= 5;
            return {
                dateValue,
                afternoon: isWeekend,
                evening: true,
                customEnabled: false,
                customStart: '19:00',
                customEnd: '22:00'
            };
        });
    }

    function shiftDateValueByDays(dateValue, daysToAdd) {
        const date = new Date(`${dateValue}T12:00:00`);
        if (Number.isNaN(date.getTime())) return dateValue;
        date.setDate(date.getDate() + daysToAdd);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    function shiftEditorDaysByWeek(days) {
        return days.map((day) => ({
            ...day,
            dateValue: shiftDateValueByDays(day.dateValue, 7)
        }));
    }

    function isWeekendDateValue(dateValue) {
        const date = new Date(`${dateValue}T12:00:00`);
        if (Number.isNaN(date.getTime())) return false;
        const day = date.getDay();
        return day === 0 || day === 6;
    }

    function createEditorDayFromDate(dateValue) {
        const isWeekend = isWeekendDateValue(dateValue);
        return {
            dateValue,
            afternoon: isWeekend,
            evening: true,
            customEnabled: false,
            customStart: '19:00',
            customEnd: '22:00'
        };
    }

    function getEditorPickerMonth(editorState) {
        const value = String(editorState?.pickerMonth || editorState?.days?.[0]?.dateValue || '').trim();
        if (/^\d{4}-\d{2}/.test(value)) return value.slice(0, 7);
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    function shiftMonthValue(monthValue, offset) {
        const match = String(monthValue || '').match(/^(\d{4})-(\d{2})$/);
        const base = match
            ? new Date(Number(match[1]), Number(match[2]) - 1, 1, 12)
            : new Date();
        base.setMonth(base.getMonth() + offset);
        return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`;
    }

    function formatEditorMonthLabel(monthValue) {
        const match = String(monthValue || '').match(/^(\d{4})-(\d{2})$/);
        if (!match) return '';
        const date = new Date(Number(match[1]), Number(match[2]) - 1, 1, 12);
        return date.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
    }

    function buildEditorCalendarMarkup(editorState) {
        const monthValue = getEditorPickerMonth(editorState);
        const [year, month] = monthValue.split('-').map(Number);
        const firstDay = new Date(year, month - 1, 1, 12);
        const mondayOffset = (firstDay.getDay() + 6) % 7;
        const gridStart = new Date(firstDay);
        gridStart.setDate(firstDay.getDate() - mondayOffset);
        const existingDates = new Set((editorState.days || []).map((day) => day.dateValue));
        const weekdays = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

        const days = Array.from({ length: 42 }, (_, index) => {
            const date = new Date(gridStart);
            date.setDate(gridStart.getDate() + index);
            const dateValue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            const isCurrentMonth = date.getMonth() === month - 1;
            const isExisting = existingDates.has(dateValue);
            const isWeekend = isWeekendDateValue(dateValue);
            return `
                <button type="button"
                    class="next-session-calendar-day ${isCurrentMonth ? '' : 'is-outside'} ${isWeekend ? 'is-weekend' : ''} ${isExisting ? 'is-selected is-existing' : ''}"
                    data-editor-action="toggle-pending-date"
                    data-pending-date="${escapeHtml(dateValue)}"
                    aria-pressed="${isExisting ? 'true' : 'false'}"
                    title="${escapeHtml(isExisting ? 'Rimuovi questo giorno dal sondaggio' : formatLongItalianDate(dateValue))}">
                    <span>${date.getDate()}</span>
                    ${isWeekend ? '<small>p+s</small>' : ''}
                </button>
            `;
        }).join('');

        return `
            <div class="next-session-calendar">
                <div class="next-session-calendar-header">
                    <button type="button" class="next-session-calendar-nav" data-editor-action="previous-picker-month" aria-label="Mese precedente">
                        <i class="fas fa-chevron-left" aria-hidden="true"></i>
                    </button>
                    <strong>${escapeHtml(formatEditorMonthLabel(monthValue))}</strong>
                    <button type="button" class="next-session-calendar-nav" data-editor-action="next-picker-month" aria-label="Mese successivo">
                        <i class="fas fa-chevron-right" aria-hidden="true"></i>
                    </button>
                </div>
                <div class="next-session-calendar-weekdays">
                    ${weekdays.map((day) => `<span>${escapeHtml(day)}</span>`).join('')}
                </div>
                <div class="next-session-calendar-grid">
                    ${days}
                </div>
            </div>
        `;
    }

    function getEditorModeMeta(mode, sessionNumber) {
        if (mode === EDITOR_MODES.editCurrent) {
            return {
                title: `Modifica Sondaggio Sessione ${sessionNumber}`,
                ariaLabel: `Modifica sondaggio sessione ${sessionNumber}`,
                saveLabel: 'Salva modifiche'
            };
        }

        return {
            title: `Nuova Sessione ${Number(sessionNumber) + 1}`,
            ariaLabel: `Crea sessione ${Number(sessionNumber) + 1}`,
            saveLabel: 'Crea sessione'
        };
    }

    function buildEditorModalMarkup(editorState, config) {
        const modeMeta = getEditorModeMeta(editorState.mode, config?.number || 1);
        return `
            <div class="next-session-editor-modal visible" data-editor-action="close-overlay">
                <div class="next-session-editor-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(modeMeta.ariaLabel)}">
                    <div class="next-session-editor-header">
                        <div>
                            <span class="next-session-editor-kicker">Configurazione DM</span>
                            <h3 class="next-session-editor-title">${escapeHtml(modeMeta.title)}</h3>
                        </div>
                        <button type="button" class="next-session-editor-close" data-editor-action="close" aria-label="Chiudi editor">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="next-session-editor-toolbar next-session-editor-date-picker">
                        <div class="next-session-editor-toolbar-field">
                            <label>Seleziona date</label>
                            ${buildEditorCalendarMarkup(editorState)}
                        </div>
                    </div>
                    ${editorState.error ? `<p class="next-session-editor-error">${escapeHtml(editorState.error)}</p>` : ''}
                    <div class="next-session-editor-day-list">
                        ${editorState.days.length > 0 ? editorState.days.map((day, index) => `
                            <section class="next-session-editor-day">
                                <div class="next-session-editor-day-top">
                                    <input type="date" value="${escapeHtml(day.dateValue)}" data-editor-day-index="${index}" data-editor-field="date">
                                    <button type="button" class="next-session-editor-remove-day" data-editor-day-index="${index}" data-editor-action="remove-day" aria-label="Rimuovi giorno">
                                        <i class="fas fa-trash-alt"></i>
                                    </button>
                                </div>
                                <div class="next-session-editor-slot-grid">
                                    <label class="next-session-editor-slot">
                                        <input type="checkbox" ${day.afternoon ? 'checked' : ''} data-editor-day-index="${index}" data-editor-field="afternoon">
                                        <span>${PRESET_SLOTS.afternoon.label}</span>
                                        <small>${PRESET_SLOTS.afternoon.start} - ${PRESET_SLOTS.afternoon.end}</small>
                                    </label>
                                    <label class="next-session-editor-slot">
                                        <input type="checkbox" ${day.evening ? 'checked' : ''} data-editor-day-index="${index}" data-editor-field="evening">
                                        <span>${PRESET_SLOTS.evening.label}</span>
                                        <small>${PRESET_SLOTS.evening.start} - ${PRESET_SLOTS.evening.end}</small>
                                    </label>
                                    <label class="next-session-editor-slot next-session-editor-slot-custom">
                                        <input type="checkbox" ${day.customEnabled ? 'checked' : ''} data-editor-day-index="${index}" data-editor-field="custom-enabled">
                                        <span>CUSTOM</span>
                                        <div class="next-session-editor-custom-times">
                                            <input type="time" value="${escapeHtml(day.customStart)}" ${day.customEnabled ? '' : 'disabled'} data-editor-day-index="${index}" data-editor-field="custom-start">
                                            <span>-</span>
                                            <input type="time" value="${escapeHtml(day.customEnd)}" ${day.customEnabled ? '' : 'disabled'} data-editor-day-index="${index}" data-editor-field="custom-end">
                                        </div>
                                    </label>
                                </div>
                            </section>
                        `).join('') : '<p class="next-session-editor-empty">Seleziona almeno un giorno dal calendario per iniziare.</p>'}
                    </div>
                    <div class="next-session-editor-footer">
                        <button type="button" class="next-session-editor-secondary" data-editor-action="close">Annulla</button>
                        <button type="button" class="next-session-editor-primary" data-editor-action="save">${escapeHtml(modeMeta.saveLabel)}</button>
                    </div>
                </div>
            </div>
        `;
    }

    function extractSessionConfigFromApiPayload(payload) {
        if (!payload || typeof payload !== 'object') return null;
        if (payload.session && typeof payload.session === 'object') return payload.session;
        if (payload.data && typeof payload.data === 'object') {
            if (payload.data.session && typeof payload.data.session === 'object') return payload.data.session;
            if ('number' in payload.data || 'availabilityOptions' in payload.data) return payload.data;
        }
        if ('number' in payload || 'availabilityOptions' in payload) return payload;
        return null;
    }

    async function loadRemoteSessionConfig() {
        const payload = await sessionApiService.getCurrentSession();
        const sessionConfig = extractSessionConfigFromApiPayload(payload);
        if (!sessionConfig) {
            throw new Error('Session API: payload non valido');
        }

        return sanitizeNextSessionConfig(sessionConfig);
    }

    async function postRemoteSessionConfig(config, token = '') {
        const payload = await sessionApiService.saveSession(config, token);

        const sessionConfig = extractSessionConfigFromApiPayload(payload);
        return sanitizeNextSessionConfig(sessionConfig || config);
    }

    async function loadSessionConfig({ fallbackPath }) {
        let fallbackConfig = null;
        const campaignId = getCurrentCampaignId();

        if (fallbackPath) {
            fallbackConfig = {
                ...sanitizeNextSessionConfig(
                    await dataService.fetchJson(
                        window.CriptaApp?.urls?.data?.('next-session.json') || fallbackPath,
                        'Errore caricamento fallback next session'
                    )
                ),
                campaignId
            };
        }

        try {
            const remoteConfig = await loadRemoteSessionConfig();
            if (campaignId !== 'cripta-di-sangue' && remoteConfig.campaignId !== campaignId) {
                if (fallbackConfig) return fallbackConfig;
                throw new Error(`Session API: campagna "${remoteConfig.campaignId}" diversa da "${campaignId}"`);
            }
            const localOnlyConfig = fallbackConfig || {};
            return {
                ...remoteConfig,
                campaignName: localOnlyConfig.campaignName || remoteConfig.campaignName,
                pollTitle: localOnlyConfig.pollTitle || remoteConfig.pollTitle,
                pollSubtitle: localOnlyConfig.pollSubtitle || remoteConfig.pollSubtitle,
                sessionCardImage: localOnlyConfig.sessionCardImage || remoteConfig.sessionCardImage,
                sessionCardImageVersion: localOnlyConfig.sessionCardImageVersion || remoteConfig.sessionCardImageVersion,
                discordWebhookUrl: localOnlyConfig.discordWebhookUrl || remoteConfig.discordWebhookUrl,
                disableDiscordNotifications: typeof localOnlyConfig.disableDiscordNotifications === 'boolean'
                    ? localOnlyConfig.disableDiscordNotifications
                    : remoteConfig.disableDiscordNotifications,
                dmAccountId: localOnlyConfig.dmAccountId || remoteConfig.dmAccountId,
                dmDiscordId: localOnlyConfig.dmDiscordId || remoteConfig.dmDiscordId,
                pollManagerAccountIds: localOnlyConfig.pollManagerAccountIds?.length ? localOnlyConfig.pollManagerAccountIds : remoteConfig.pollManagerAccountIds,
                pollManagerDiscordIds: localOnlyConfig.pollManagerDiscordIds?.length ? localOnlyConfig.pollManagerDiscordIds : remoteConfig.pollManagerDiscordIds,
                voteIcons: localOnlyConfig.voteIcons || {},
                campaignId: remoteConfig.campaignId || campaignId
            };
        } catch (error) {
            console.warn('Session API non raggiungibile, uso fallback locale.', error);
            if (fallbackConfig) return fallbackConfig;
            throw error;
        }
    }

    function sanitizeVotes(votes, options, players) {
        const allowedIds = new Set(options.map(option => option.id));
        const playersByAccountId = new Map(
            players
                .filter((player) => player.accountId)
                .map((player) => [String(player.accountId), player])
        );
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

        const sanitized = normalizedVotes
            .map((vote) => {
                const rawPlayerId = String(vote?.playerId || vote?.id || '').trim();
                const rawAccountId = String(vote?.accountId || '').trim();
                const rawDiscordId = String(vote?.discordId || '').trim();
                const rawName = String(vote?.name || '').trim();
                const matchedPlayer = playersByAccountId.get(rawAccountId)
                    || playersByAccountId.get(rawPlayerId)
                    || playersByDiscordId.get(rawDiscordId)
                    || playersByDiscordId.get(rawPlayerId)
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
                    accountId: matchedPlayer.accountId || rawAccountId || '',
                    discordId: matchedPlayer.discordId || rawDiscordId || (/^\d{5,32}$/.test(rawPlayerId) ? rawPlayerId : ''),
                    name: matchedPlayer.name,
                    selections
                };
            })
            .filter(Boolean);

        const mergedByPlayerId = new Map();
        sanitized.forEach((vote) => {
            const existing = mergedByPlayerId.get(vote.playerId);
            if (!existing) {
                mergedByPlayerId.set(vote.playerId, vote);
                return;
            }

            mergedByPlayerId.set(vote.playerId, {
                ...existing,
                ...vote,
                selections: {
                    ...existing.selections,
                    ...vote.selections
                }
            });
        });

        return Array.from(mergedByPlayerId.values());
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
                    accountId: String(vote?.accountId || '').trim(),
                    discordId: String(vote?.discordId || '').trim(),
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
        const payload = await sessionApiService.getVotes(sessionNumber);
        return sanitizeVotes(extractVotesFromApiPayload(payload), options, players);
    }

    async function postRemoteVote({ sessionNumber, playerAccountId, playerDiscordId, optionId, value, token }) {
        return sessionApiService.saveVote({ sessionNumber, playerAccountId, playerDiscordId, optionId, value, token });
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

    function getVoteChoiceClass(value) {
        const state = getVoteState(value);
        return `availability-choice availability-choice-single${state ? ` ${state.className} is-active` : ' is-empty'}`;
    }

    function buildVoteChoiceContent(value, playerId) {
        if (!value) return '';
        const iconPath = getVoteIconPath(value, playerId);
        const fallbackPath = getVoteIconFallbackPath(value, playerId);
        const fallbackAttrs = fallbackPath && fallbackPath !== iconPath
            ? ` data-fallback-src="${escapeHtml(fallbackPath)}" onerror="if(this.dataset.fallbackSrc){this.src=this.dataset.fallbackSrc;this.dataset.fallbackSrc='';}else{this.style.display='none';}"`
            : ' onerror="this.style.display=\'none\';"';
        return value
            ? `<img class="availability-choice-icon" src="${escapeHtml(iconPath)}" alt="" loading="lazy" decoding="async"${fallbackAttrs}>`
            : '';
    }

    function preloadVoteIcons(players) {
        if (typeof window.Image !== 'function') return;
        const playerIds = new Set(['dm']);
        players.forEach((player) => {
            const playerId = String(player?.id || '').trim().toLowerCase();
            if (playerId) playerIds.add(playerId);
        });

        playerIds.forEach((playerId) => {
            VOTE_STATES.forEach((state) => {
                const iconPath = getVoteIconPath(state.value, playerId);
                if (!iconPath) return;
                const image = new window.Image();
                image.src = iconPath;
            });
        });
    }

    function formatAvailabilityLabel(option) {
        const rawId = String(option?.id || '').trim().toLowerCase();
        const match = rawId.match(/^(lun|mar|mer|gio|ven|sab|dom)-(\d{1,2})-(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)-\d+/);
        if (match) {
            const dayNames = {
                lun: "LUNEDÌ",
                mar: "MARTEDÌ",
                mer: "MERCOLEDÌ",
                gio: "GIOVEDÌ",
                ven: "VENERDÌ",
                sab: "SABATO",
                dom: "DOMENICA"
            };
            const monthNames = {
                gen: 'GENNAIO',
                feb: 'FEBBRAIO',
                mar: 'MARZO',
                apr: 'APRILE',
                mag: 'MAGGIO',
                giu: 'GIUGNO',
                lug: 'LUGLIO',
                ago: 'AGOSTO',
                set: 'SETTEMBRE',
                ott: 'OTTOBRE',
                nov: 'NOVEMBRE',
                dic: 'DICEMBRE'
            };
            return {
                day: `${dayNames[match[1]]} ${Number(match[2])}`,
                month: monthNames[match[3]]
            };
        }

        return {
            day: String(option?.label || '').trim().toUpperCase(),
            month: ''
        };
    }

    function formatAvailabilityLabel(option) {
        const rawId = String(option?.id || '').trim().toLowerCase();
        const match = rawId.match(/^(lun|mar|mer|gio|ven|sab|dom)-(\d{1,2})-(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)-\d+/);
        if (match) {
            const dayNames = {
                lun: 'LUNED\u00cc',
                mar: 'MARTED\u00cc',
                mer: 'MERCOLED\u00cc',
                gio: 'GIOVED\u00cc',
                ven: 'VENERD\u00cc',
                sab: 'SABATO',
                dom: 'DOMENICA'
            };
            const monthNames = {
                gen: 'GENNAIO',
                feb: 'FEBBRAIO',
                mar: 'MARZO',
                apr: 'APRILE',
                mag: 'MAGGIO',
                giu: 'GIUGNO',
                lug: 'LUGLIO',
                ago: 'AGOSTO',
                set: 'SETTEMBRE',
                ott: 'OTTOBRE',
                nov: 'NOVEMBRE',
                dic: 'DICEMBRE'
            };
            return {
                day: `${dayNames[match[1]]} ${Number(match[2])}`,
                month: monthNames[match[3]]
            };
        }

        return {
            day: String(option?.label || '').trim().toUpperCase(),
            month: ''
        };
    }

    function getColumnStateClass(optionId, totals, voteCount) {
        const optionTotals = totals[optionId] || { yes: 0, maybe: 0, no: 0 };
        if (voteCount > 0 && optionTotals.yes === voteCount) {
            return 'is-all-yes';
        }
        if (optionTotals.no > 0) {
            return 'has-no';
        }
        if ((optionTotals.yes + optionTotals.maybe) > 0 && optionTotals.maybe > 0) {
            return 'is-yes-maybe';
        }
        return '';
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

    function buildScheduledMarkup(config, canConfigureSession) {
        const { title, subtitle } = getNextSessionCardHeading(config);
        return `
            <div class="next-session-card">
                <div class="next-session-card-controls">
                    ${canConfigureSession ? `
                        <button type="button" class="next-session-edit-trigger" data-editor-action="${EDITOR_MODES.editCurrent}" aria-label="Modifica sondaggio corrente">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button type="button" class="next-session-add-trigger" data-editor-action="${EDITOR_MODES.createNext}" aria-label="Crea nuova sessione">
                            <i class="fas fa-plus"></i>
                        </button>
                    ` : ''}
                    <button type="button" class="next-session-export-trigger" data-export-session-card aria-label="Scarica card sessione">
                        <i class="fas fa-download"></i>
                    </button>
                    ${config.availabilityOptions?.length ? `
                        <button type="button" class="next-session-view-trigger" data-view-mode="${VIEW_MODES.poll}" aria-label="Mostra sondaggio disponibilità">
                            <i class="fas fa-table"></i>
                        </button>
                    ` : ''}
                </div>
                <span class="next-label">${escapeHtml(subtitle)}</span>
                <h2 class="next-title text-gold-gradient">${escapeHtml(title)}</h2>
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

    async function renderScheduledSession(container, config) {
        let authState = null;
        let accounts = [];
        try {
            [authState, accounts] = await Promise.all([
                authService.verify(),
                loadGlobalAccounts()
            ]);
        } catch (_) {
            authState = null;
            accounts = [];
        }

        const currentAccountId = authService.getAccountId(authState, accounts);
        const currentDiscordId = authService.getDiscordId(authState);
        const canConfigureSession = canManagePoll(config, currentAccountId, currentDiscordId, accounts);

        container.innerHTML = buildScheduledMarkup(config, canConfigureSession);
        const toggleButton = container.querySelector('[data-view-mode]');
        const exportButton = container.querySelector('[data-export-session-card]');
        const editButton = container.querySelector(`[data-editor-action="${EDITOR_MODES.editCurrent}"]`);
        const createButton = container.querySelector(`[data-editor-action="${EDITOR_MODES.createNext}"]`);
        if (toggleButton) {
            toggleButton.addEventListener('click', () => {
                container.dataset.nextSessionView = VIEW_MODES.poll;
                renderNextSession(config, container);
            });
        }
        if (editButton) {
            editButton.addEventListener('click', () => {
                container.dataset.nextSessionView = VIEW_MODES.poll;
                renderNextSession(config, container);
                window.setTimeout(() => {
                    const pollEditButton = container.querySelector(`[data-editor-action="${EDITOR_MODES.editCurrent}"]`);
                    if (pollEditButton) {
                        pollEditButton.click();
                    }
                }, 0);
            });
        }
        if (createButton) {
            createButton.addEventListener('click', () => {
                container.dataset.nextSessionView = VIEW_MODES.poll;
                renderNextSession(config, container);
                window.setTimeout(() => {
                    const pollCreateButton = container.querySelector(`[data-editor-action="${EDITOR_MODES.createNext}"]`);
                    if (pollCreateButton) {
                        pollCreateButton.click();
                    }
                }, 0);
            });
        }
        if (exportButton) {
            exportButton.addEventListener('click', () => {
                exportSessionCardAsPng(config, VIEW_MODES.scheduled).catch((error) => {
                    console.error('Impossibile esportare la card della sessione:', error);
                });
            });
        }
        const targetDate = parseScheduledDate(config.date, config.timeStart);
        if (targetDate) {
            renderCountdown(targetDate.getTime(), container);
        }
    }

    function buildEmptyMarkup(config) {
        const { title, subtitle } = getNextSessionCardHeading(config);
        return `
            <div class="next-session-card" style="border-color: #555;">
                <span class="next-label">${escapeHtml(subtitle)}</span>
                <h2 class="next-title" style="color: #aaa;">${escapeHtml(title)}</h2>
                <div class="tbd-message">
                    <i class="fas fa-hourglass-half" style="margin-right: 10px;"></i>
                    Da Fissare
                </div>
            </div>
        `;
    }

    function buildPollMarkup(config, options, votes, statusMessage, canConfigureSession, editorState) {
        const totals = computeTotals(votes, options);
        const voteCount = votes.length;
        const subtitle = config.pollSubtitle || config.campaignName || 'Prossima Sessione';
        const rowsMarkup = votes.length > 0
            ? votes.map((vote, rowIndex) => `
                <tr class="${vote.canEdit ? 'availability-row-is-own' : 'availability-row-is-readonly'}">
                    <th scope="row" class="availability-name-cell${vote.canEdit ? ' is-own' : ''}">
                        <span class="availability-name-text">${escapeHtml(vote.name)}</span>
                    </th>
                    ${options.map(option => `
                        <td class="availability-vote-cell ${getColumnStateClass(option.id, totals, voteCount)}">
                            <div class="availability-choice-slot" role="group" aria-label="Voto ${escapeHtml(vote.name)} per ${escapeHtml(option.label)} ${escapeHtml(option.time)}">
                                ${vote.canEdit ? `
                                    <button
                                        type="button"
                                        class="availability-clear-vote"
                                        data-row-index="${rowIndex}"
                                        data-option-id="${escapeHtml(option.id)}"
                                        data-action="clear"
                                        aria-label="Rimuovi voto di ${escapeHtml(vote.name)} per ${escapeHtml(option.label)}">
                                        <i class="fas fa-times"></i>
                                    </button>
                                ` : ''}
                                <button
                                    type="button"
                                    class="${getVoteChoiceClass(vote.selections[option.id])}"
                                    data-row-index="${rowIndex}"
                                    data-option-id="${escapeHtml(option.id)}"
                                    data-action="cycle"
                                    ${vote.canEdit ? '' : 'disabled'}
                                    aria-label="Cambia voto di ${escapeHtml(vote.name)} per ${escapeHtml(option.label)}">
                                    ${buildVoteChoiceContent(vote.selections[option.id], vote.playerId)}
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
                <div class="next-session-card-controls">
                    ${canConfigureSession ? `
                        <button type="button" class="next-session-edit-trigger" data-editor-action="${EDITOR_MODES.editCurrent}" aria-label="Modifica sondaggio corrente">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button type="button" class="next-session-add-trigger" data-editor-action="${EDITOR_MODES.createNext}" aria-label="Crea nuova sessione">
                            <i class="fas fa-plus"></i>
                        </button>
                    ` : ''}
                    ${config.isScheduled ? `
                        <button type="button" class="next-session-view-trigger" data-view-mode="${VIEW_MODES.scheduled}" aria-label="Mostra sessione fissata">
                            <i class="fas fa-calendar-check"></i>
                        </button>
                    ` : ''}
                </div>
                <span class="next-label next-label-poll">${escapeHtml(subtitle)}</span>
                ${statusMessage ? `<div class="availability-feedback">${escapeHtml(statusMessage)}</div>` : ''}
                <div class="availability-table-wrap">
                    <table class="availability-table">
                        <thead>
                            <tr>
                                <th class="availability-corner-cell">Nome</th>
                                ${options.map(option => {
            const labelParts = formatAvailabilityLabel(option);
            return `
                                    <th class="availability-option-cell ${getColumnStateClass(option.id, totals, voteCount)}" scope="col">
                                        <button
                                            type="button"
                                            class="availability-option-trigger${canConfigureSession ? ' is-confirmable' : ''}"
                                            ${canConfigureSession ? `data-confirm-option-id="${escapeHtml(option.id)}"` : 'disabled'}
                                            aria-label="Conferma la prossima sessione su ${escapeHtml(labelParts.day)} ${labelParts.month ? escapeHtml(labelParts.month) : ''} ${escapeHtml(option.time || '')}">
                                            <span class="availability-option-label">${escapeHtml(labelParts.day)}</span>
                                            ${labelParts.month ? `<span class="availability-option-month">${escapeHtml(labelParts.month)}</span>` : ''}
                                            ${option.time ? `<span class="availability-option-time">${escapeHtml(option.time)}</span>` : ''}
                                        </button>
                                    </th>
                                `;
        }).join('')}
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
        const effectiveConfig = sanitizeNextSessionConfig(config);
        setCurrentVoteIconSets(effectiveConfig);
        const options = sanitizeOptions(effectiveConfig.availabilityOptions);
        const title = effectiveConfig.pollTitle || `Sessione ${effectiveConfig.number}`;
        const subtitle = effectiveConfig.pollSubtitle || effectiveConfig.campaignName || 'Prossima Sessione';
        container.innerHTML = `
            <div class="next-session-card next-session-card-poll">
                <span class="next-label">${escapeHtml(subtitle)}</span>
                <h2 class="next-title text-gold-gradient">${escapeHtml(title)}</h2>
                <p class="availability-intro">Caricamento giocatori...</p>
            </div>
        `;

        let players = [];
        let authState = null;
        let accounts = [];
        try {
            [players, authState, accounts] = await Promise.all([
                loadEligiblePlayers(effectiveConfig),
                authService.verify(),
                loadGlobalAccounts()
            ]);
        } catch (error) {
            console.error('Impossibile caricare i player per il planner della prossima sessione:', error);
            container.innerHTML = `
                <div class="next-session-card next-session-card-poll">
                    <span class="next-label">${escapeHtml(subtitle)}</span>
                    <h2 class="next-title text-gold-gradient">${escapeHtml(title)}</h2>
                    <p class="availability-intro">Impossibile caricare i player del gruppo.</p>
                </div>
            `;
            return;
        }

        const currentAccountId = authService.getAccountId(authState, accounts);
        const currentDiscordId = authService.getDiscordId(authState);
        const authToken = authService.getToken();
        const orderedPlayers = [...players].sort((left, right) => {
            const leftIsCurrent = (Boolean(currentAccountId) && Boolean(left.accountId) && left.accountId === currentAccountId)
                || (Boolean(currentDiscordId) && Boolean(left.discordId) && left.discordId === currentDiscordId);
            const rightIsCurrent = (Boolean(currentAccountId) && Boolean(right.accountId) && right.accountId === currentAccountId)
                || (Boolean(currentDiscordId) && Boolean(right.discordId) && right.discordId === currentDiscordId);
            if (leftIsCurrent === rightIsCurrent) return 0;
            return leftIsCurrent ? -1 : 1;
        });
        preloadVoteIcons(orderedPlayers);
        const canConfigureSession = canManagePoll(effectiveConfig, currentAccountId, currentDiscordId, accounts);
        const localFallbackVotes = readStoredVotes(effectiveConfig.number, effectiveConfig.availabilityVotes, options, players);
        let baseVotes = localFallbackVotes;
        try {
            baseVotes = await loadRemoteVotes(effectiveConfig.number, options, players);
            persistVotes(effectiveConfig.number, baseVotes);
        } catch (error) {
            console.warn('Session votes API non raggiungibile, uso fallback locale.', error);
        }

        let votes = orderedPlayers.map((player) => {
            const existingVote = baseVotes.find((vote) => vote.playerId === player.id);
            return existingVote || {
                playerId: player.id,
                accountId: player.accountId || '',
                discordId: player.discordId || '',
                name: player.name,
                selections: options.reduce((acc, option) => {
                    acc[option.id] = '';
                    return acc;
                }, {})
            };
        }).map((vote) => ({
            ...vote,
            canEdit: (Boolean(currentAccountId) && Boolean(vote.accountId) && vote.accountId === currentAccountId)
                || (Boolean(currentDiscordId) && Boolean(vote.discordId) && vote.discordId === currentDiscordId)
        }));

        let statusMessage = '';
        let editorState = {
            open: false,
            mode: EDITOR_MODES.createNext,
            error: '',
            days: buildDefaultEditorDays()
        };

        function decorateVotes(baseVoteList) {
            return orderedPlayers.map((player) => {
                const existingVote = baseVoteList.find((vote) => vote.playerId === player.id);
                return existingVote || {
                    playerId: player.id,
                    accountId: player.accountId || '',
                    discordId: player.discordId || '',
                    name: player.name,
                    selections: options.reduce((acc, option) => {
                        acc[option.id] = '';
                        return acc;
                    }, {})
                };
            }).map((vote) => ({
                ...vote,
                canEdit: (Boolean(currentAccountId) && Boolean(vote.accountId) && vote.accountId === currentAccountId)
                    || (Boolean(currentDiscordId) && Boolean(vote.discordId) && vote.discordId === currentDiscordId)
            }));
        }

        function setColumnStateClass(element, optionId, totals, voteCount) {
            if (!element) return;
            element.classList.remove('is-all-yes', 'has-no', 'is-yes-maybe');
            const stateClass = getColumnStateClass(optionId, totals, voteCount);
            if (stateClass) {
                element.classList.add(stateClass);
            }
        }

        function getOptionButton(row, optionId, action = 'cycle') {
            return Array.from(row.querySelectorAll('[data-option-id]'))
                .find((button) => button.getAttribute('data-option-id') === optionId && button.getAttribute('data-action') === action);
        }

        function updateStatusMessage() {
            const title = container.querySelector('.next-title');
            let feedback = container.querySelector('.availability-feedback');
            if (!statusMessage) {
                if (feedback) feedback.remove();
                return;
            }

            if (!feedback && title) {
                title.insertAdjacentHTML('afterend', '<div class="availability-feedback"></div>');
                feedback = container.querySelector('.availability-feedback');
            }
            if (feedback) {
                feedback.textContent = statusMessage;
            }
        }

        function refreshPollVotesDom() {
            const table = container.querySelector('.availability-table');
            if (!table) {
                rerender();
                return;
            }

            const totals = computeTotals(votes, options);
            const voteCount = votes.length;

            options.forEach((option, optionIndex) => {
                setColumnStateClass(table.querySelectorAll('.availability-option-cell')[optionIndex], option.id, totals, voteCount);
            });

            const rows = Array.from(table.tBodies[0]?.rows || []);
            votes.forEach((vote, rowIndex) => {
                const row = rows[rowIndex];
                if (!row) return;

                row.className = vote.canEdit ? 'availability-row-is-own' : 'availability-row-is-readonly';
                const nameCell = row.querySelector('.availability-name-cell');
                if (nameCell) {
                    nameCell.classList.toggle('is-own', Boolean(vote.canEdit));
                }

                options.forEach((option) => {
                    const button = getOptionButton(row, option.id);
                    if (!button) return;

                    const value = vote.selections[option.id] || '';
                    const cell = button.closest('.availability-vote-cell');
                    setColumnStateClass(cell, option.id, totals, voteCount);
                    button.className = getVoteChoiceClass(value);
                    button.innerHTML = buildVoteChoiceContent(value, vote.playerId);
                });
            });

            updateStatusMessage();
        }

        function updateEditorDay(index, patch) {
            editorState = {
                ...editorState,
                error: '',
                days: editorState.days.map((day, dayIndex) => dayIndex === index ? { ...day, ...patch } : day)
            };
        }

        function buildConfigFromEditorState() {
            const availabilityOptions = [];
            const normalizedDays = [...editorState.days].sort((left, right) => left.dateValue.localeCompare(right.dateValue));

            normalizedDays.forEach((day) => {
                if (day.afternoon) {
                    availabilityOptions.push(buildOptionFromDateSlot(day.dateValue, PRESET_SLOTS.afternoon.start, PRESET_SLOTS.afternoon.end));
                }
                if (day.evening) {
                    availabilityOptions.push(buildOptionFromDateSlot(day.dateValue, PRESET_SLOTS.evening.start, PRESET_SLOTS.evening.end));
                }
                if (day.customEnabled) {
                    availabilityOptions.push(buildOptionFromDateSlot(day.dateValue, day.customStart, day.customEnd));
                }
            });

            const isEditingCurrent = editorState.mode === EDITOR_MODES.editCurrent;

            return sanitizeNextSessionConfig({
                ...effectiveConfig,
                number: isEditingCurrent ? Number(effectiveConfig.number) : Number(effectiveConfig.number) + 1,
                date: '',
                timeStart: '',
                timeEnd: '',
                isScheduled: false,
                availabilityOptions,
                availabilityVotes: []
            });
        }

        function rerender() {
            const previousTableWrap = container.querySelector('.availability-table-wrap');
            const previousScroll = {
                pageX: window.scrollX,
                pageY: window.scrollY,
                tableLeft: previousTableWrap ? previousTableWrap.scrollLeft : 0,
                tableTop: previousTableWrap ? previousTableWrap.scrollTop : 0
            };

            container.innerHTML = buildPollMarkup(effectiveConfig, options, votes, statusMessage, canConfigureSession, editorState);
            const table = container.querySelector('.availability-table');
            const card = container.querySelector('.next-session-card-poll');
            const tableWrap = container.querySelector('.availability-table-wrap');
            const existingModal = document.querySelector('.next-session-editor-modal');
            if (existingModal) {
                existingModal.remove();
            }
            document.body.classList.toggle('next-session-editor-open', Boolean(editorState.open));

            if (canConfigureSession && editorState.open) {
                document.body.insertAdjacentHTML('beforeend', buildEditorModalMarkup(editorState, effectiveConfig));
            }
            const modal = document.querySelector('.next-session-editor-modal');

            if (tableWrap) {
                window.requestAnimationFrame(() => {
                    tableWrap.scrollLeft = previousScroll.tableLeft;
                    tableWrap.scrollTop = previousScroll.tableTop;
                    window.scrollTo(previousScroll.pageX, previousScroll.pageY);
                });
            } else {
                window.requestAnimationFrame(() => {
                    window.scrollTo(previousScroll.pageX, previousScroll.pageY);
                });
            }

            if (table) {
                table.addEventListener('click', async (event) => {
                    const target = event.target.closest('button');
                    if (!target) return;

                    const confirmOptionId = target.getAttribute('data-confirm-option-id');
                    if (confirmOptionId) {
                        const selectedOption = options.find((option) => option.id === confirmOptionId);
                        if (!selectedOption || !canConfigureSession) {
                            return;
                        }

                        const labelParts = formatAvailabilityLabel(selectedOption);
                        const confirmationLabel = `${labelParts.day}${labelParts.month ? ` ${labelParts.month}` : ''} ${selectedOption.time || ''}`.trim();
                        const shouldSchedule = window.confirm(`Confermare la prossima sessione su ${confirmationLabel}?`);
                        if (!shouldSchedule) {
                            return;
                        }

                        const scheduledConfig = buildScheduledConfigFromOption(effectiveConfig, selectedOption);
                        if (!scheduledConfig) {
                            statusMessage = 'Impossibile confermare questa data.';
                            rerender();
                            return;
                        }

                        try {
                            const savedConfig = await postRemoteSessionConfig(scheduledConfig, authToken);
                            persistNextSessionConfig(savedConfig);
                            try {
                                await postSessionCardToDiscord(savedConfig, VIEW_MODES.scheduled);
                            } catch (discordError) {
                                console.error('Impossibile inviare la card su Discord:', discordError);
                            }
                            container.dataset.nextSessionView = VIEW_MODES.scheduled;
                            renderNextSession(savedConfig, container);
                        } catch (error) {
                            console.error('Impossibile confermare la prossima sessione:', error);
                            statusMessage = error?.message || 'Impossibile confermare la sessione sul server.';
                            rerender();
                        }
                        return;
                    }

                    const rowIndex = Number(target.getAttribute('data-row-index'));
                    const optionId = target.getAttribute('data-option-id');
                    const action = target.getAttribute('data-action');
                    if (!Number.isInteger(rowIndex) || !optionId || !action || !votes[rowIndex]) {
                        return;
                    }

                    const targetVote = votes[rowIndex];
                    if (!targetVote.canEdit || !targetVote.accountId || !authToken) {
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
                    statusMessage = '';
                    refreshPollVotesDom();

                    try {
                        const payload = await postRemoteVote({
                            sessionNumber: effectiveConfig.number,
                            playerAccountId: targetVote.accountId,
                            playerDiscordId: targetVote.discordId,
                            optionId,
                            value: nextChoice,
                            token: authToken
                        });
                        const remoteVotes = sanitizeVotes(extractVotesFromApiPayload(payload?.data || payload), options, players);
                        votes = remoteVotes.length > 0 ? decorateVotes(remoteVotes) : decorateVotes(votes.map(({ canEdit, ...vote }) => vote));
                        persistVotes(effectiveConfig.number, votes.map(({ canEdit, ...vote }) => vote));
                        statusMessage = '';
                        refreshPollVotesDom();
                    } catch (error) {
                        console.error('Impossibile salvare il voto della prossima sessione:', error);
                        votes = previousVotes;
                        statusMessage = error?.message || 'Impossibile salvare il voto sul server.';
                        refreshPollVotesDom();
                    }
                });
            }

            if (card) {
                card.addEventListener('click', (event) => {
                    const button = event.target.closest('button');
                    if (!button) return;

                    const action = button.getAttribute('data-editor-action');
                    const viewMode = button.getAttribute('data-view-mode');
                    if (viewMode === VIEW_MODES.scheduled || viewMode === VIEW_MODES.poll) {
                        container.dataset.nextSessionView = viewMode;
                        renderNextSession(effectiveConfig, container);
                        return;
                    }

                    if (!action || !canConfigureSession) return;

                    if (action === EDITOR_MODES.editCurrent || action === EDITOR_MODES.createNext) {
                        const initialDays = action === EDITOR_MODES.editCurrent
                            ? buildEditorDaysFromConfig(effectiveConfig)
                            : buildDefaultEditorDays();
                        editorState = {
                            ...editorState,
                            mode: action,
                            open: true,
                            error: '',
                            days: initialDays.length > 0 ? initialDays : buildDefaultEditorDays()
                        };
                        rerender();
                        return;
                    }
                });
            }

            if (modal) {
                modal.addEventListener('click', async (event) => {
                    const button = event.target.closest('[data-editor-action]');
                    if (!button) return;

                    const action = button.getAttribute('data-editor-action');
                    if (!action || !canConfigureSession) return;
                    if (action === 'close-overlay' && event.target !== button) return;

                    if (action === 'close' || action === 'close-overlay') {
                        editorState = {
                            ...editorState,
                            open: false,
                            error: ''
                        };
                        rerender();
                        return;
                    }

                    if (action === 'previous-picker-month' || action === 'next-picker-month') {
                        editorState = {
                            ...editorState,
                            pickerMonth: shiftMonthValue(getEditorPickerMonth(editorState), action === 'next-picker-month' ? 1 : -1),
                            error: ''
                        };
                        rerender();
                        return;
                    }

                    if (action === 'toggle-pending-date') {
                        const dateValue = String(button.getAttribute('data-pending-date') || '').trim();
                        if (!dateValue) return;
                        if (editorState.days.some((day) => day.dateValue === dateValue)) {
                            editorState = {
                                ...editorState,
                                error: '',
                                days: editorState.days.filter((day) => day.dateValue !== dateValue)
                            };
                            rerender();
                            return;
                        }
                        editorState = {
                            ...editorState,
                            error: '',
                            days: [
                                ...editorState.days,
                                createEditorDayFromDate(dateValue)
                            ].sort((left, right) => left.dateValue.localeCompare(right.dateValue))
                        };
                        rerender();
                        return;
                    }

                    if (action === 'add-day') {
                        const pendingDate = String(editorState.pendingDate || '').trim();
                        const pendingDates = Array.from(new Set([
                            ...(editorState.pendingDates || []),
                            pendingDate
                        ].filter(Boolean))).sort((left, right) => left.localeCompare(right));
                        if (pendingDates.length > 1 || (editorState.pendingDates || []).length > 0) {
                            if (!pendingDates.length) {
                                editorState = { ...editorState, error: 'Seleziona almeno un giorno dal calendario.' };
                                rerender();
                                return;
                            }
                            const existingDates = new Set(editorState.days.map((day) => day.dateValue));
                            const datesToAdd = pendingDates.filter((dateValue) => !existingDates.has(dateValue));
                            if (!datesToAdd.length) {
                                editorState = { ...editorState, error: 'Le date selezionate sono gia presenti.' };
                                rerender();
                                return;
                            }
                            editorState = {
                                ...editorState,
                                error: '',
                                pendingDate: '',
                                pendingDates: [],
                                days: [
                                    ...editorState.days,
                                    ...datesToAdd.map(createEditorDayFromDate)
                                ].sort((left, right) => left.dateValue.localeCompare(right.dateValue))
                            };
                            rerender();
                            return;
                        }
                        if (!pendingDate) {
                            editorState = { ...editorState, error: 'Seleziona un giorno dal calendario.' };
                            rerender();
                            return;
                        }
                        if (editorState.days.some((day) => day.dateValue === pendingDate)) {
                            editorState = { ...editorState, error: 'Questo giorno è già presente.' };
                            rerender();
                            return;
                        }
                        editorState = {
                            ...editorState,
                            error: '',
                            pendingDate: '',
                            days: [...editorState.days, {
                                dateValue: pendingDate,
                                afternoon: isWeekendDateValue(pendingDate),
                                evening: true,
                                customEnabled: false,
                                customStart: '19:00',
                                customEnd: '22:00'
                            }].sort((left, right) => left.dateValue.localeCompare(right.dateValue))
                        };
                        rerender();
                        return;
                    }

                    if (action === 'shift-week') {
                        editorState = {
                            ...editorState,
                            error: '',
                            days: shiftEditorDaysByWeek(editorState.days),
                            pendingDate: editorState.pendingDate ? shiftDateValueByDays(editorState.pendingDate, 7) : '',
                            pendingDates: (editorState.pendingDates || []).map((dateValue) => shiftDateValueByDays(dateValue, 7))
                        };
                        rerender();
                        return;
                    }

                    if (action === 'remove-day') {
                        const index = Number(button.getAttribute('data-editor-day-index'));
                        if (!Number.isInteger(index)) return;
                        editorState = {
                            ...editorState,
                            error: '',
                            days: editorState.days.filter((_, dayIndex) => dayIndex !== index)
                        };
                        rerender();
                        return;
                    }

                    if (action === 'save') {
                        if (editorState.days.length === 0) {
                            editorState = { ...editorState, error: 'Aggiungi almeno un giorno prima di salvare.' };
                            rerender();
                            return;
                        }

                        if (editorState.days.some((day) => !day.dateValue)) {
                            editorState = { ...editorState, error: 'Ogni riga deve avere una data valida.' };
                            rerender();
                            return;
                        }

                        if (editorState.days.some((day) => !day.afternoon && !day.evening && !day.customEnabled)) {
                            editorState = { ...editorState, error: 'Ogni giorno deve avere almeno uno slot attivo.' };
                            rerender();
                            return;
                        }

                        if (editorState.days.some((day) => day.customEnabled && (!day.customStart || !day.customEnd || minutesFromTime(day.customEnd) <= minutesFromTime(day.customStart)))) {
                            editorState = { ...editorState, error: 'Gli orari custom devono avere una fine successiva all\'inizio.' };
                            rerender();
                            return;
                        }

                        const nextConfig = buildConfigFromEditorState();
                        if (nextConfig.availabilityOptions.length === 0) {
                            editorState = {
                                ...editorState,
                                error: editorState.mode === EDITOR_MODES.editCurrent
                                    ? 'Il sondaggio corrente non contiene slot validi.'
                                    : 'La nuova sessione non contiene slot validi.'
                            };
                            rerender();
                            return;
                        }

                        try {
                            const savedConfig = await postRemoteSessionConfig(nextConfig, authToken);
                            persistNextSessionConfig(savedConfig);
                            if (editorState.mode === EDITOR_MODES.createNext) {
                                try {
                                    await postSessionPollLinkToDiscord(savedConfig);
                                } catch (discordError) {
                                    console.error('Impossibile inviare il link del sondaggio su Discord:', discordError);
                                }
                            }
                            renderNextSession(savedConfig, container);
                        } catch (error) {
                            console.error('Impossibile salvare la configurazione della sessione:', error);
                            editorState = { ...editorState, error: error?.message || 'Impossibile salvare la sessione sul server.' };
                            rerender();
                        }
                    }
                });

                modal.querySelectorAll('[data-editor-field]').forEach((field) => {
                    field.addEventListener('change', (event) => {
                        if (!canConfigureSession) return;
                        const target = event.currentTarget;
                        const fieldName = target.getAttribute('data-editor-field');
                        const index = Number(target.getAttribute('data-editor-day-index'));

                        if (fieldName === 'pending-date') {
                            addPendingDateToEditorState(target.value);
                            rerender();
                            return;
                        }

                        if (!Number.isInteger(index) || !editorState.days[index]) return;

                        if (fieldName === 'date') {
                            updateEditorDay(index, { dateValue: target.value });
                            return;
                        }
                        if (fieldName === 'afternoon') {
                            updateEditorDay(index, { afternoon: target.checked });
                            return;
                        }
                        if (fieldName === 'evening') {
                            updateEditorDay(index, { evening: target.checked });
                            return;
                        }
                        if (fieldName === 'custom-enabled') {
                            updateEditorDay(index, { customEnabled: target.checked });
                            rerender();
                            return;
                        }
                        if (fieldName === 'custom-start') {
                            updateEditorDay(index, { customStart: target.value });
                            return;
                        }
                        if (fieldName === 'custom-end') {
                            updateEditorDay(index, { customEnd: target.value });
                        }
                    });
                });
            }
        }

        rerender();
    }

    function renderNextSession(config, container) {
        if (!container || !config) return;

        const effectiveConfig = readStoredNextSessionConfig(config);
        const availabilityOptions = sanitizeOptions(effectiveConfig.availabilityOptions);
        let requestedViewMode = String(container.dataset.nextSessionView || '').trim();
        if (requestedViewMode === VIEW_MODES.scheduled && !effectiveConfig.isScheduled) {
            requestedViewMode = '';
        }
        if (requestedViewMode === VIEW_MODES.poll && availabilityOptions.length === 0) {
            requestedViewMode = '';
        }
        const defaultViewMode = getDefaultViewMode(effectiveConfig, availabilityOptions);
        const shouldShowScheduled = effectiveConfig.isScheduled
            && (requestedViewMode === VIEW_MODES.scheduled || (!requestedViewMode && defaultViewMode === VIEW_MODES.scheduled));
        const shouldShowPoll = availabilityOptions.length > 0
            && (requestedViewMode === VIEW_MODES.poll || (!requestedViewMode && defaultViewMode === VIEW_MODES.poll));

        if (shouldShowScheduled) {
            renderScheduledSession(container, effectiveConfig);
            return;
        }

        if (shouldShowPoll) {
            renderAvailabilityPoll(container, effectiveConfig);
            return;
        }

        container.innerHTML = buildEmptyMarkup(effectiveConfig);
    }

    window.CriptaNextSession = {
        render: renderNextSession,
        loadConfig: loadSessionConfig
    };
})();
