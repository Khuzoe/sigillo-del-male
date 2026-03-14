(function () {
    const API_BASE_URL = typeof DISCORD_WORKER_URL === 'string'
        ? DISCORD_WORKER_URL
        : 'https://sigillo-api.khuzoe.workers.dev';
    const SESSION_API_URL = `${API_BASE_URL}/api/session`;
    const SESSION_VOTES_API_URL = `${API_BASE_URL}/api/session-votes`;
    const SESSION_CARD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1482056374731931860/7ls24iTa_HMAgwwTbY8Qc96tf79LOxk3f6epN_iW6PHDgI51Dg70UkKgFT5aVQSZRM03';
    const STORAGE_PREFIX = 'cripta-next-session-votes';
    const NEXT_SESSION_CONFIG_OVERRIDE_KEY = 'cripta-next-session-config-override';
    const PLAYERS_DATA_PATH = 'data/players.json';
    const DM_PLAYER = { id: 'dm', name: 'DM', discordId: '' };
    const VIEW_MODES = {
        poll: 'poll',
        scheduled: 'scheduled'
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
        return `${STORAGE_PREFIX}-${sessionNumber}`;
    }

    function getMonthIndex(monthId) {
        return ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'].indexOf(monthId);
    }

    function sanitizeNextSessionConfig(config) {
        return {
            number: Number(config?.number) || 1,
            dmDiscordId: String(config?.dmDiscordId || '').trim(),
            date: String(config?.date || '').trim(),
            timeStart: String(config?.timeStart || '').trim(),
            timeEnd: String(config?.timeEnd || '').trim(),
            isScheduled: Boolean(config?.isScheduled),
            availabilityOptions: sanitizeOptions(config?.availabilityOptions || []),
            availabilityVotes: Array.isArray(config?.availabilityVotes) ? config.availabilityVotes : []
        };
    }

    function readStoredNextSessionConfig(baseConfig) {
        return sanitizeNextSessionConfig(baseConfig);
    }

    function persistNextSessionConfig(config) {
        return sanitizeNextSessionConfig(config);
    }

    function getAssetsBasePath() {
        return window.location.pathname.includes('/pages/') ? '../assets/' : 'assets/';
    }

    function getVoteIconPath(value, playerId) {
        const state = getVoteState(value);
        if (!state?.value) return '';
        const normalizedPlayerId = String(playerId || '').trim().toLowerCase();
        const iconSet = VOTE_ICON_SETS[normalizedPlayerId] || VOTE_ICON_SETS.dm;
        const iconFile = iconSet?.[state.value];
        if (!iconFile) return '';
        return `${getAssetsBasePath()}img/ui/${iconFile}`;
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

    function loadCanvasImage(src) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error(`Impossibile caricare immagine: ${src}`));
            image.src = src;
        });
    }

    function formatExportOption(option) {
        const labelParts = formatAvailabilityLabel(option);
        return `${labelParts.day}${labelParts.month ? ` ${labelParts.month}` : ''} · ${option.time}`;
    }

    async function renderSessionCardPngBlob(config, viewMode = '') {
        const effectiveConfig = sanitizeNextSessionConfig(config);
        const options = sanitizeOptions(effectiveConfig.availabilityOptions);
        const isScheduledView = effectiveConfig.isScheduled && viewMode !== VIEW_MODES.poll;
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
        background.addColorStop(0, '#151116');
        background.addColorStop(1, '#09090d');
        context.fillStyle = background;
        context.fillRect(0, 0, width, height);

        const glow = context.createRadialGradient(width * 0.82, height * 0.12, 20, width * 0.82, height * 0.12, 520);
        glow.addColorStop(0, 'rgba(212, 175, 55, 0.18)');
        glow.addColorStop(1, 'rgba(212, 175, 55, 0)');
        context.fillStyle = glow;
        context.fillRect(0, 0, width, height);

        drawRoundedRect(context, 70, 70, width - 140, height - 140, 32, 'rgba(17, 18, 26, 0.88)', 'rgba(212, 175, 55, 0.24)', 2);
        drawRoundedRect(context, 94, 94, width - 188, height - 188, 28, 'rgba(8, 9, 14, 0.5)');

        try {
            const decorationImage = await loadCanvasImage(`${getAssetsBasePath()}img/ui/card.webp`);
            context.save();
            context.globalAlpha = 1;
            context.drawImage(decorationImage, width - 370, height - 330, 240, 260);
            context.restore();
        } catch (error) {
            console.warn('Impossibile caricare la decorazione della card per l\'export PNG:', error);
        }

        context.fillStyle = '#8f7c56';
        context.font = '600 26px Cinzel, Georgia, serif';
        context.letterSpacing = '0.08em';
        context.fillText('PROSSIMA SESSIONE', 130, 160);

        context.fillStyle = '#f0d48a';
        context.font = '700 74px Cinzel, Georgia, serif';
        context.fillText(`Sessione ${effectiveConfig.number}`, 130, 245);

        context.fillStyle = '#d8cfbe';
        context.font = '500 24px Segoe UI, Arial, sans-serif';

        if (isScheduledView) {
            drawRoundedRect(context, 130, 300, width - 260, 190, 24, 'rgba(24, 20, 26, 0.92)', 'rgba(212, 175, 55, 0.14)');
            context.fillStyle = '#9d8c6a';
            context.font = '600 21px Segoe UI, Arial, sans-serif';
            context.fillText('DATA FISSATA', 170, 350);
            context.fillStyle = '#f3ead5';
            context.font = '700 44px Cinzel, Georgia, serif';
            const dateLines = wrapCanvasText(context, effectiveConfig.date || 'Da definire', width - 360);
            dateLines.slice(0, 2).forEach((line, index) => {
                context.fillText(line, 170, 410 + (index * 54));
            });

            context.fillStyle = '#d8b25a';
            context.font = '600 28px Segoe UI, Arial, sans-serif';
            context.fillText(`${effectiveConfig.timeStart || '--:--'} - ${effectiveConfig.timeEnd || '--:--'}`, 170, 470);

            context.fillStyle = '#938260';
            context.font = '500 22px Segoe UI, Arial, sans-serif';
            context.fillText('Sigillo del Male', 130, height - 120);
        } else {
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
            context.fillText('Cripta di Sangue', 130, height - 100);
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
        const { blob, filename } = await renderSessionCardPngBlob(effectiveConfig, viewMode);
        const formData = new FormData();
        const content = effectiveConfig.isScheduled
            ? `@everyone Sessione ${effectiveConfig.number} fissata: ${effectiveConfig.date} · ${effectiveConfig.timeStart} - ${effectiveConfig.timeEnd}`
            : `Sessione ${effectiveConfig.number} - card generata`;

        formData.append('content', content);
        formData.append('file', blob, filename);

        const response = await fetch(`${SESSION_CARD_WEBHOOK_URL}?wait=true`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const responseText = await response.text().catch(() => '');
            throw new Error(responseText || `Webhook Discord HTTP ${response.status}`);
        }

        return response.json().catch(() => null);
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

    function buildEditorModalMarkup(editorState) {
        return `
            <div class="next-session-editor-modal visible" data-editor-action="close-overlay">
                <div class="next-session-editor-dialog" role="dialog" aria-modal="true" aria-label="Configura prossima sessione">
                    <div class="next-session-editor-header">
                        <div>
                            <span class="next-session-editor-kicker">Configurazione DM</span>
                            <h3 class="next-session-editor-title">Nuova Prossima Sessione</h3>
                        </div>
                        <button type="button" class="next-session-editor-close" data-editor-action="close" aria-label="Chiudi editor">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="next-session-editor-toolbar">
                        <div class="next-session-editor-toolbar-field">
                            <label for="next-session-editor-new-date">Aggiungi giorno</label>
                            <input id="next-session-editor-new-date" type="date" value="${escapeHtml(editorState.pendingDate || '')}" data-editor-field="pending-date">
                        </div>
                        <div class="next-session-editor-toolbar-actions">
                            <button type="button" class="next-session-editor-secondary" data-editor-action="shift-week">+1 settimana</button>
                            <button type="button" class="next-session-editor-add" data-editor-action="add-day">Aggiungi</button>
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
                        <button type="button" class="next-session-editor-primary" data-editor-action="save">Salva</button>
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

    async function loadRemoteSessionConfig(sessionNumber) {
        const response = await fetch(`${SESSION_API_URL}?number=${encodeURIComponent(sessionNumber)}`, {
            method: 'GET',
            headers: {
                Accept: 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Session API HTTP ${response.status}`);
        }

        const payload = await response.json();
        const sessionConfig = extractSessionConfigFromApiPayload(payload);
        if (!sessionConfig) {
            throw new Error('Session API: payload non valido');
        }

        return sanitizeNextSessionConfig(sessionConfig);
    }

    async function postRemoteSessionConfig(config, token = '') {
        const response = await fetch(SESSION_API_URL, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify(sanitizeNextSessionConfig(config))
        });

        let payload = null;
        try {
            payload = await response.json();
        } catch (_) {
            payload = null;
        }

        if (!response.ok) {
            const apiMessage = payload?.error || payload?.message || payload?.details || '';
            throw new Error(apiMessage ? `Session API POST HTTP ${response.status}: ${apiMessage}` : `Session API POST HTTP ${response.status}`);
        }

        const sessionConfig = extractSessionConfigFromApiPayload(payload);
        return sanitizeNextSessionConfig(sessionConfig || config);
    }

    async function loadSessionConfig({ fallbackPath }) {
        let fallbackConfig = null;

        if (fallbackPath) {
            const fallbackResponse = await fetch(fallbackPath);
            if (!fallbackResponse.ok) {
                throw new Error(`Errore caricamento fallback next session (${fallbackResponse.status})`);
            }
            fallbackConfig = sanitizeNextSessionConfig(await fallbackResponse.json());
        }

        const sessionNumber = Number(fallbackConfig?.number) || 1;

        try {
            return await loadRemoteSessionConfig(sessionNumber);
        } catch (error) {
            console.warn('Session API non raggiungibile, uso fallback locale.', error);
            if (fallbackConfig) return fallbackConfig;
            throw error;
        }
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

        const sanitized = normalizedVotes
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
        const optionTotals = totals[optionId] || { yes: 0, no: 0 };
        if (voteCount > 0 && optionTotals.yes === voteCount) {
            return 'is-all-yes';
        }
        if (optionTotals.no > 0) {
            return 'has-no';
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
        return `
            <div class="next-session-card">
                <div class="next-session-card-controls">
                    ${canConfigureSession ? `
                        <button type="button" class="next-session-edit-trigger" data-editor-action="open" aria-label="Configura prossima sessione">
                            <i class="fas fa-pen"></i>
                        </button>
                    ` : ''}
                    ${config.availabilityOptions?.length ? `
                        <button type="button" class="next-session-view-trigger" data-view-mode="${VIEW_MODES.poll}" aria-label="Mostra sondaggio disponibilita">
                            <i class="fas fa-table"></i>
                        </button>
                    ` : ''}
                </div>
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

    async function renderScheduledSession(container, config) {
        let authState = null;
        try {
            authState = window.CriptaDiscordAuth?.verify ? await window.CriptaDiscordAuth.verify().catch(() => null) : null;
        } catch (_) {
            authState = null;
        }

        const currentDiscordId = String(authState?.user?.id || authState?.user?.sub || '').trim();
        const canConfigureSession = (
            Boolean(currentDiscordId)
            && Boolean(config?.dmDiscordId)
            && currentDiscordId === String(config.dmDiscordId).trim()
        );

        container.innerHTML = buildScheduledMarkup(config, canConfigureSession);
        const toggleButton = container.querySelector('[data-view-mode]');
        const exportButton = container.querySelector('[data-export-session-card]');
        const editButton = container.querySelector('[data-editor-action="open"]');
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
                    const pollEditButton = container.querySelector('[data-editor-action="open"]');
                    if (pollEditButton) {
                        pollEditButton.click();
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

    function buildPollMarkup(config, options, votes, statusMessage, canConfigureSession, editorState) {
        const totals = computeTotals(votes, options);
        const voteCount = votes.length;
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
                                    class="availability-choice availability-choice-single${vote.selections[option.id] ? ` ${getVoteState(vote.selections[option.id]).className} is-active` : ' is-empty'}"
                                    data-row-index="${rowIndex}"
                                    data-option-id="${escapeHtml(option.id)}"
                                    data-action="cycle"
                                    ${vote.canEdit ? '' : 'disabled'}
                                    aria-label="Cambia voto di ${escapeHtml(vote.name)} per ${escapeHtml(option.label)}">
                                    ${vote.selections[option.id]
                    ? `<img class="availability-choice-icon" src="${escapeHtml(getVoteIconPath(vote.selections[option.id], vote.playerId))}" alt="" loading="lazy" decoding="async">`
                    : ''}
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
                        <button type="button" class="next-session-edit-trigger" data-editor-action="open" aria-label="Configura prossima sessione">
                            <i class="fas fa-pen"></i>
                        </button>
                    ` : ''}
                    ${config.isScheduled ? `
                        <button type="button" class="next-session-view-trigger" data-view-mode="${VIEW_MODES.scheduled}" aria-label="Mostra sessione fissata">
                            <i class="fas fa-calendar-check"></i>
                        </button>
                    ` : ''}
                </div>
                <span class="next-label">Prossima Sessione</span>
                <h2 class="next-title text-gold-gradient">Sessione ${escapeHtml(config.number)}</h2>
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
        const options = sanitizeOptions(effectiveConfig.availabilityOptions);
        container.innerHTML = `
            <div class="next-session-card next-session-card-poll">
                <span class="next-label">Prossima Sessione</span>
                <h2 class="next-title text-gold-gradient">Sessione ${escapeHtml(effectiveConfig.number)}</h2>
                <p class="availability-intro">Caricamento giocatori...</p>
            </div>
        `;

        let players = [];
        let authState = null;
        try {
            [players, authState] = await Promise.all([
                loadEligiblePlayers(effectiveConfig),
                window.CriptaDiscordAuth?.verify ? window.CriptaDiscordAuth.verify().catch(() => null) : Promise.resolve(null)
            ]);
        } catch (error) {
            console.error('Impossibile caricare i player per il planner della prossima sessione:', error);
            container.innerHTML = `
                <div class="next-session-card next-session-card-poll">
                    <span class="next-label">Prossima Sessione</span>
                    <h2 class="next-title text-gold-gradient">Sessione ${escapeHtml(effectiveConfig.number)}</h2>
                    <p class="availability-intro">Impossibile caricare i player del gruppo.</p>
                </div>
            `;
            return;
        }

        const currentDiscordId = String(authState?.user?.id || authState?.user?.sub || '').trim();
        const authToken = typeof window.CriptaDiscordAuth?.getToken === 'function'
            ? window.CriptaDiscordAuth.getToken()
            : '';
        const orderedPlayers = [...players].sort((left, right) => {
            const leftIsCurrent = Boolean(currentDiscordId) && Boolean(left.discordId) && left.discordId === currentDiscordId;
            const rightIsCurrent = Boolean(currentDiscordId) && Boolean(right.discordId) && right.discordId === currentDiscordId;
            if (leftIsCurrent === rightIsCurrent) return 0;
            return leftIsCurrent ? -1 : 1;
        });
        const canConfigureSession = (
            Boolean(currentDiscordId)
            && Boolean(effectiveConfig.dmDiscordId)
            && currentDiscordId === effectiveConfig.dmDiscordId
        );
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

        let statusMessage = '';
        let editorState = {
            open: false,
            pendingDate: '',
            error: '',
            days: buildDefaultEditorDays()
        };

        function decorateVotes(baseVoteList) {
            return orderedPlayers.map((player) => {
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

            return sanitizeNextSessionConfig({
                ...effectiveConfig,
                number: Number(effectiveConfig.number) + 1,
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
                document.body.insertAdjacentHTML('beforeend', buildEditorModalMarkup(editorState));
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
                    if (!targetVote.canEdit || !targetVote.discordId || !authToken) {
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
                    rerender();

                    try {
                        const payload = await postRemoteVote({
                            sessionNumber: effectiveConfig.number,
                            playerDiscordId: targetVote.discordId,
                            optionId,
                            value: nextChoice,
                            token: authToken
                        });
                        const remoteVotes = sanitizeVotes(extractVotesFromApiPayload(payload?.data || payload), options, players);
                        votes = remoteVotes.length > 0 ? decorateVotes(remoteVotes) : decorateVotes(votes.map(({ canEdit, ...vote }) => vote));
                        persistVotes(effectiveConfig.number, votes.map(({ canEdit, ...vote }) => vote));
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

                    if (action === 'open') {
                        editorState = {
                            ...editorState,
                            open: true,
                            error: '',
                            pendingDate: '',
                            days: buildDefaultEditorDays()
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

                    if (action === 'add-day') {
                        const pendingDate = String(editorState.pendingDate || '').trim();
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
                                afternoon: false,
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
                            pendingDate: editorState.pendingDate ? shiftDateValueByDays(editorState.pendingDate, 7) : ''
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
                            editorState = { ...editorState, error: 'La nuova sessione non contiene slot validi.' };
                            rerender();
                            return;
                        }

                        try {
                            const savedConfig = await postRemoteSessionConfig(nextConfig, authToken);
                            persistNextSessionConfig(savedConfig);
                            renderNextSession(savedConfig, container);
                        } catch (error) {
                            console.error('Impossibile salvare la prossima sessione:', error);
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
                            editorState = { ...editorState, pendingDate: target.value, error: '' };
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
