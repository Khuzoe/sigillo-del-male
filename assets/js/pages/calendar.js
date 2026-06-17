(function () {
    const DEFAULT_CONFIG = {
        type: "config",
        id: "default",
        name: "Calendario di Harptos",
        epochName: "DR",
        weekdays: ["Primo", "Secondo", "Terzo", "Quarto", "Quinto", "Sesto", "Settimo", "Ottavo", "Nono", "Decimo"],
        months: [
            { name: "Hammer", days: 30 },
            { name: "Alturiak", days: 30 },
            { name: "Ches", days: 30 },
            { name: "Tarsakh", days: 30 },
            { name: "Mirtul", days: 30 },
            { name: "Kythorn", days: 30 },
            { name: "Flamerule", days: 30 },
            { name: "Eleasis", days: 30 },
            { name: "Eleint", days: 30 },
            { name: "Marpenoth", days: 30 },
            { name: "Uktar", days: 30 },
            { name: "Nightal", days: 30 }
        ],
        firstWeekdayIndex: 0
    };

    const DEFAULT_STATE = {
        type: "state",
        id: "current",
        currentDate: "1492-1-1"
    };

    const state = {
        data: [],
        version: 0,
        source: "static",
        config: structuredCloneSafe(DEFAULT_CONFIG),
        calendarState: structuredCloneSafe(DEFAULT_STATE),
        notes: [],
        importantDays: [],
        selectedDate: null,
        viewYear: 1492,
        viewMonth: 1,
        isDm: false,
        authState: null,
        status: "",
        statusError: false,
        configOpen: false
    };

    window.CriptaApp.onPageReady("calendario", initCalendarPage);

    async function initCalendarPage() {
        const root = document.getElementById("calendar-root");
        if (!root) return;
        try {
            state.authState = await window.CriptaDiscordAuth?.verify?.().catch(() => null);
            state.isDm = await window.CriptaDiscordAuth?.isCurrentUserDm?.(window.CriptaBasePath || "").catch(() => false);
            await loadCalendarDocument();
            const current = parseDateKey(state.calendarState.currentDate) || { year: 1492, month: 1, day: 1 };
            state.selectedDate = toDateKey(current);
            state.viewYear = current.year;
            state.viewMonth = current.month;
            render(root);
        } catch (error) {
            console.error("Errore calendario:", error);
            root.innerHTML = '<p class="calendar-state">Impossibile caricare il calendario.</p>';
        }
    }

    async function loadCalendarDocument() {
        let payload = null;
        try {
            payload = await window.CriptaApp?.api?.get?.("api/data/calendar", { query: { _: Date.now() } });
        } catch (error) {
            console.warn("Calendario KV non disponibile, uso fallback statico.", error);
        }

        if (!Array.isArray(payload?.data)) {
            const fallbackUrl = window.CriptaApp?.urls?.globalData?.("calendar.json") || "../assets/data/calendar.json";
            const response = await fetch(fallbackUrl);
            payload = {
                source: "static",
                version: 0,
                data: response.ok ? await response.json() : [DEFAULT_CONFIG, DEFAULT_STATE]
            };
        }

        state.data = Array.isArray(payload.data) ? payload.data : [];
        state.version = Number(payload.version || 0);
        state.source = payload.source || "static";
        normalizeCalendarData();
    }

    function normalizeCalendarData() {
        const config = state.data.find((entry) => entry?.type === "config") || DEFAULT_CONFIG;
        const calendarState = state.data.find((entry) => entry?.type === "state") || DEFAULT_STATE;
        state.config = normalizeConfig(config);
        state.calendarState = {
            ...DEFAULT_STATE,
            ...calendarState,
            currentDate: toDateKey(parseDateKey(calendarState.currentDate) || parseDateKey(DEFAULT_STATE.currentDate))
        };
        state.notes = state.data
            .filter((entry) => entry?.type === "note")
            .map(normalizeNote)
            .filter(Boolean);
        state.importantDays = state.data
            .filter((entry) => entry?.type === "important-day")
            .map(normalizeImportantDay)
            .filter(Boolean);
    }

    function normalizeConfig(config) {
        const weekdays = Array.isArray(config.weekdays) && config.weekdays.length
            ? config.weekdays.map((day) => String(day || "").trim()).filter(Boolean)
            : DEFAULT_CONFIG.weekdays;
        const months = Array.isArray(config.months) && config.months.length
            ? config.months.map((month, index) => ({
                name: String(month?.name || `Mese ${index + 1}`).trim(),
                days: clampInt(month?.days, 1, 99, 30)
            })).filter((month) => month.name && month.days > 0)
            : DEFAULT_CONFIG.months;
        return {
            ...DEFAULT_CONFIG,
            ...config,
            type: "config",
            id: "default",
            name: String(config.name || DEFAULT_CONFIG.name).trim() || DEFAULT_CONFIG.name,
            epochName: String(config.epochName || "").trim(),
            weekdays,
            months,
            firstWeekdayIndex: clampInt(config.firstWeekdayIndex, 0, Math.max(0, weekdays.length - 1), 0)
        };
    }

    function normalizeNote(note) {
        const date = toDateKey(parseDateKey(note.date));
        if (!date) return null;
        return {
            type: "note",
            id: String(note.id || `note-${crypto.randomUUID()}`).trim(),
            date,
            title: String(note.title || "").trim(),
            text: String(note.text || "").trim(),
            visibility: note.visibility === "private" ? "private" : "shared",
            ownerAccountId: String(note.ownerAccountId || note.accountId || "").trim(),
            ownerDiscordId: String(note.ownerDiscordId || "").trim(),
            ownerName: String(note.ownerName || "").trim(),
            updatedAt: String(note.updatedAt || "").trim()
        };
    }

    function normalizeImportantDay(day) {
        const date = toDateKey(parseDateKey(day.date));
        if (!date) return null;
        return {
            type: "important-day",
            id: String(day.id || `important-${date}`).trim(),
            date,
            title: String(day.title || "Giorno importante").trim().slice(0, 160),
            updatedAt: String(day.updatedAt || "").trim()
        };
    }

    function render(root) {
        const month = state.config.months[state.viewMonth - 1] || state.config.months[0];
        const currentDate = parseDateKey(state.calendarState.currentDate);
        root.innerHTML = `
            <div class="calendar-toolbar">
                <div class="calendar-title-stack">
                    <span class="calendar-kicker">${escapeHtml(state.config.name)}</span>
                    <h2 class="calendar-title">${escapeHtml(month.name)} ${escapeHtml(formatYear(state.viewYear))}</h2>
                </div>
                <div class="calendar-toolbar-actions">
                    <button type="button" class="calendar-icon-btn" data-calendar-action="prev" title="Mese precedente" aria-label="Mese precedente"><i class="fas fa-chevron-left"></i></button>
                    <button type="button" class="calendar-action-btn" data-calendar-action="today">Oggi</button>
                    <button type="button" class="calendar-icon-btn" data-calendar-action="next" title="Mese successivo" aria-label="Mese successivo"><i class="fas fa-chevron-right"></i></button>
                    ${state.isDm ? '<button type="button" class="calendar-action-btn" data-calendar-action="toggle-config"><i class="fas fa-gear"></i> Configura</button>' : ""}
                </div>
            </div>
            ${state.isDm ? renderConfigPanel() : ""}
            <div class="calendar-layout">
                <section class="calendar-grid-panel" style="--calendar-week-size: ${state.config.weekdays.length}">
                    <div class="calendar-month-head">
                        <h2>${escapeHtml(month.name)}</h2>
                        <span class="calendar-month-meta">Giorno corrente: ${escapeHtml(formatDateLabel(currentDate))}</span>
                    </div>
                    ${renderMonthGrid()}
                </section>
                <aside class="calendar-notes-panel">
                    ${renderNotesPanel()}
                </aside>
            </div>
        `;
        bindEvents(root);
    }

    function renderMonthGrid() {
        const month = state.config.months[state.viewMonth - 1] || state.config.months[0];
        const firstWeekday = getWeekdayIndex({ year: state.viewYear, month: state.viewMonth, day: 1 });
        const cells = [];
        for (let i = 0; i < firstWeekday; i += 1) {
            cells.push('<div class="calendar-day is-empty" aria-hidden="true"></div>');
        }
        for (let day = 1; day <= month.days; day += 1) {
            const date = { year: state.viewYear, month: state.viewMonth, day };
            const key = toDateKey(date);
            const notes = getVisibleNotesForDate(key);
            const important = getImportantDay(key);
            const selected = key === state.selectedDate;
            const current = key === state.calendarState.currentDate;
            cells.push(`
                <button type="button" class="calendar-day ${selected ? "is-selected" : ""} ${current ? "is-current" : ""} ${important ? "is-important" : ""}" data-calendar-date="${escapeHtml(key)}">
                    <span class="calendar-day-number">${day}</span>
                    ${important ? `<span class="calendar-day-important"><i class="fas fa-star"></i>${escapeHtml(important.title)}</span>` : ""}
                    ${notes.length ? `<span class="calendar-day-note-count"><i class="fas fa-note-sticky"></i>${notes.length}</span>` : ""}
                    ${notes.length ? renderDayNoteTitles(notes) : ""}
                </button>
            `);
        }
        return `
            <div class="calendar-weekdays">
                ${state.config.weekdays.map((day) => `<div class="calendar-weekday">${escapeHtml(day)}</div>`).join("")}
            </div>
            <div class="calendar-days">
                ${cells.join("")}
            </div>
        `;
    }

    function renderDayNoteTitles(notes) {
        return `
            <span class="calendar-day-note-list">
                ${notes.map((note) => `
                    <span class="calendar-day-note-title">${escapeHtml(note.title || note.text || "Nota").slice(0, 90)}</span>
                `).join("")}
            </span>
        `;
    }

    function renderNotesPanel() {
        const selected = parseDateKey(state.selectedDate) || parseDateKey(state.calendarState.currentDate);
        const selectedKey = toDateKey(selected);
        const notes = getVisibleNotesForDate(selectedKey);
        const important = getImportantDay(selectedKey);
        const loggedIn = Boolean(getAccountId());
        return `
            <h2>${escapeHtml(formatDateLabel(selected))}</h2>
            <p class="calendar-notes-date">${escapeHtml(getWeekdayName(selected))}</p>
            ${important ? `<div class="calendar-important-banner"><i class="fas fa-star"></i><span>${escapeHtml(important.title)}</span></div>` : ""}
            ${state.isDm ? renderImportantDayForm(selectedKey, important) : ""}
            <div class="calendar-note-list">
                ${notes.length ? notes.map(renderNote).join("") : '<p class="calendar-empty">Nessuna nota per questo giorno.</p>'}
            </div>
            ${loggedIn ? renderNoteForm(selected) : '<p class="calendar-empty">Accedi per scrivere note sul calendario.</p>'}
        `;
    }

    function renderImportantDayForm(dateKey, important) {
        return `
            <form class="calendar-important-form" data-calendar-important-form>
                <input type="hidden" name="date" value="${escapeHtml(dateKey)}">
                <div class="calendar-field">
                    <label>Giorno importante</label>
                    <input name="title" maxlength="160" value="${escapeHtml(important?.title || "Giorno importante")}" placeholder="Titolo del giorno">
                </div>
                <div class="calendar-inline-actions">
                    <button type="submit" class="calendar-action-btn">${important ? "Salva titolo" : "Fissa giorno"}</button>
                    ${important ? `<button type="button" class="calendar-action-btn calendar-secondary-btn" data-calendar-remove-important="${escapeHtml(dateKey)}">Rimuovi</button>` : ""}
                </div>
            </form>
        `;
    }

    function renderNote(note) {
        const canEdit = state.isDm || isOwnNote(note);
        return `
            <article class="calendar-note">
                ${note.title ? `<h3>${escapeHtml(note.title)}</h3>` : ""}
                ${note.text ? `<p>${escapeHtml(note.text)}</p>` : ""}
                <div class="calendar-note-meta">
                    <span>${escapeHtml(note.ownerName || "Nota")}${note.visibility === "private" ? " - privata" : ""}</span>
                    ${canEdit ? `<button type="button" class="calendar-icon-btn" data-calendar-delete-note="${escapeHtml(note.id)}" title="Elimina nota" aria-label="Elimina nota"><i class="fas fa-trash"></i></button>` : ""}
                </div>
            </article>
        `;
    }

    function renderNoteForm(date) {
        return `
            <form class="calendar-note-form" data-calendar-note-form>
                <input type="hidden" name="date" value="${escapeHtml(toDateKey(date))}">
                <div class="calendar-field">
                    <label>Titolo</label>
                    <input name="title" maxlength="160" placeholder="Evento, viaggio, promessa...">
                </div>
                <div class="calendar-field">
                    <label>Nota</label>
                    <textarea name="text" maxlength="4000" placeholder="Scrivi cosa va ricordato in questa data."></textarea>
                </div>
                <div class="calendar-field">
                    <label class="calendar-checkbox"><input type="checkbox" name="private"> PRIVATA</label>
                </div>
                <button type="submit" class="calendar-action-btn">Aggiungi nota</button>
                <div class="calendar-status ${state.statusError ? "is-error" : ""}">${escapeHtml(state.status)}</div>
            </form>
        `;
    }

    function renderConfigPanel() {
        const current = parseDateKey(state.calendarState.currentDate) || { year: 1492, month: 1, day: 1 };
        const monthLines = state.config.months.map((month) => `${month.name}|${month.days}`).join("\n");
        return `
            <section class="calendar-config-panel" ${state.configOpen ? "" : "hidden"}>
                <h2>Configurazione calendario</h2>
                <form class="calendar-config-form" data-calendar-config-form>
                    <div class="calendar-form-grid">
                        <div class="calendar-field">
                            <label>Nome calendario</label>
                            <input name="name" value="${escapeHtml(state.config.name)}">
                        </div>
                        <div class="calendar-field">
                            <label>Epoca</label>
                            <input name="epochName" value="${escapeHtml(state.config.epochName)}" placeholder="DR, Era, E.V.">
                        </div>
                        <div class="calendar-field">
                            <label>Primo giorno settimana</label>
                            <input name="firstWeekdayIndex" type="number" min="0" max="${Math.max(0, state.config.weekdays.length - 1)}" value="${state.config.firstWeekdayIndex}">
                        </div>
                    </div>
                    <div class="calendar-form-grid">
                        <div class="calendar-field">
                            <label>Anno corrente</label>
                            <input name="currentYear" type="number" value="${current.year}">
                        </div>
                        <div class="calendar-field">
                            <label>Mese corrente</label>
                            <input name="currentMonth" type="number" min="1" max="${state.config.months.length}" value="${current.month}">
                        </div>
                        <div class="calendar-field">
                            <label>Giorno corrente</label>
                            <input name="currentDay" type="number" min="1" max="${state.config.months[current.month - 1]?.days || 30}" value="${current.day}">
                        </div>
                    </div>
                    <div class="calendar-field">
                        <label>Giorni della settimana, uno per riga</label>
                        <textarea name="weekdays">${escapeHtml(state.config.weekdays.join("\n"))}</textarea>
                    </div>
                    <div class="calendar-field">
                        <label>Mesi, formato Nome|Giorni</label>
                        <textarea name="months">${escapeHtml(monthLines)}</textarea>
                    </div>
                    <button type="submit" class="calendar-action-btn">Salva configurazione</button>
                    <div class="calendar-status ${state.statusError ? "is-error" : ""}">${escapeHtml(state.status)}</div>
                </form>
            </section>
        `;
    }

    function bindEvents(root) {
        root.querySelectorAll("[data-calendar-action]").forEach((button) => {
            button.addEventListener("click", () => handleAction(button.dataset.calendarAction, root));
        });
        root.querySelectorAll("[data-calendar-date]").forEach((button) => {
            button.addEventListener("click", () => {
                const date = parseDateKey(button.dataset.calendarDate);
                if (!date) return;
                state.selectedDate = toDateKey(date);
                state.viewYear = date.year;
                state.viewMonth = date.month;
                render(root);
            });
        });
        root.querySelector("[data-calendar-note-form]")?.addEventListener("submit", async (event) => {
            event.preventDefault();
            await saveNote(new FormData(event.currentTarget), root);
        });
        root.querySelector("[data-calendar-config-form]")?.addEventListener("submit", async (event) => {
            event.preventDefault();
            await saveConfig(new FormData(event.currentTarget), root);
        });
        root.querySelectorAll("[data-calendar-delete-note]").forEach((button) => {
            button.addEventListener("click", async () => deleteNote(button.dataset.calendarDeleteNote, root));
        });
        root.querySelector("[data-calendar-important-form]")?.addEventListener("submit", async (event) => {
            event.preventDefault();
            await saveImportantDay(new FormData(event.currentTarget), root);
        });
        root.querySelector("[data-calendar-remove-important]")?.addEventListener("click", async (event) => {
            await removeImportantDay(event.currentTarget.dataset.calendarRemoveImportant, root);
        });
    }

    function handleAction(action, root) {
        if (action === "prev") {
            shiftMonth(-1);
        } else if (action === "next") {
            shiftMonth(1);
        } else if (action === "today") {
            const current = parseDateKey(state.calendarState.currentDate);
            if (current) {
                state.viewYear = current.year;
                state.viewMonth = current.month;
                state.selectedDate = toDateKey(current);
            }
        } else if (action === "toggle-config") {
            state.configOpen = !state.configOpen;
        }
        render(root);
    }

    function shiftMonth(delta) {
        const monthCount = state.config.months.length;
        let nextMonth = state.viewMonth + delta;
        let nextYear = state.viewYear;
        while (nextMonth < 1) {
            nextMonth += monthCount;
            nextYear -= 1;
        }
        while (nextMonth > monthCount) {
            nextMonth -= monthCount;
            nextYear += 1;
        }
        state.viewMonth = nextMonth;
        state.viewYear = nextYear;
        state.selectedDate = toDateKey({ year: nextYear, month: nextMonth, day: 1 });
    }

    async function saveNote(formData, root) {
        const token = readAuthToken();
        if (!token) {
            setStatus("Login richiesto per salvare note.", true, root);
            return;
        }
        const date = toDateKey(parseDateKey(formData.get("date")));
        const title = String(formData.get("title") || "").trim();
        const text = String(formData.get("text") || "").trim();
        if (!date || (!title && !text)) {
            setStatus("Scrivi almeno un titolo o una nota.", true, root);
            return;
        }
        const accountId = getAccountId();
        const note = {
            type: "note",
            id: `note-${crypto.randomUUID()}`,
            date,
            title,
            text,
            visibility: formData.get("private") ? "private" : "shared",
            ownerAccountId: accountId,
            ownerDiscordId: getDiscordId(),
            ownerName: getDisplayName(),
            updatedAt: new Date().toISOString()
        };
        const nextNotes = [...state.notes, note];
        try {
            await saveCalendarData(buildData({ notes: nextNotes }), token, { userScoped: !state.isDm });
            state.notes = nextNotes;
            setStatus("Nota salvata.", false, root);
            render(root);
        } catch (error) {
            console.error("Salvataggio nota calendario fallito:", error);
            setStatus(`Salvataggio fallito: ${error?.message || error}`, true, root);
        }
    }

    async function deleteNote(noteId, root) {
        const note = state.notes.find((entry) => entry.id === noteId);
        if (!note || (!state.isDm && !isOwnNote(note))) return;
        const token = readAuthToken();
        if (!token) {
            setStatus("Login richiesto per eliminare note.", true, root);
            return;
        }
        const nextNotes = state.notes.filter((entry) => entry.id !== noteId);
        try {
            await saveCalendarData(buildData({ notes: nextNotes }), token, { userScoped: !state.isDm });
            state.notes = nextNotes;
            setStatus("Nota eliminata.", false, root);
            render(root);
        } catch (error) {
            console.error("Eliminazione nota calendario fallita:", error);
            setStatus(`Eliminazione fallita: ${error?.message || error}`, true, root);
        }
    }

    async function saveImportantDay(formData, root) {
        if (!state.isDm) return;
        const token = readAuthToken();
        if (!token) {
            setStatus("Login DM richiesto per fissare giorni importanti.", true, root);
            return;
        }
        const date = toDateKey(parseDateKey(formData.get("date")));
        if (!date) return;
        const existing = getImportantDay(date);
        const title = String(formData.get("title") || "Giorno importante").trim() || "Giorno importante";
        const nextDay = {
            type: "important-day",
            id: existing?.id || `important-${date}`,
            date,
            title,
            updatedAt: new Date().toISOString()
        };
        const nextImportantDays = [
            ...state.importantDays.filter((entry) => entry.date !== date),
            nextDay
        ];
        try {
            await saveCalendarData(buildData({ importantDays: nextImportantDays }), token, { userScoped: false });
            state.importantDays = nextImportantDays;
            setStatus(existing ? "Titolo del giorno importante salvato." : "Giorno importante fissato.", false, root);
            render(root);
        } catch (error) {
            console.error("Salvataggio giorno importante fallito:", error);
            setStatus(`Salvataggio fallito: ${error?.message || error}`, true, root);
        }
    }

    async function removeImportantDay(dateKey, root) {
        if (!state.isDm) return;
        const token = readAuthToken();
        if (!token) {
            setStatus("Login DM richiesto per rimuovere giorni importanti.", true, root);
            return;
        }
        const date = toDateKey(parseDateKey(dateKey));
        if (!date) return;
        const nextImportantDays = state.importantDays.filter((entry) => entry.date !== date);
        try {
            await saveCalendarData(buildData({ importantDays: nextImportantDays }), token, { userScoped: false });
            state.importantDays = nextImportantDays;
            setStatus("Giorno importante rimosso.", false, root);
            render(root);
        } catch (error) {
            console.error("Rimozione giorno importante fallita:", error);
            setStatus(`Rimozione fallita: ${error?.message || error}`, true, root);
        }
    }

    async function saveConfig(formData, root) {
        if (!state.isDm) return;
        const token = readAuthToken();
        if (!token) {
            setStatus("Login DM richiesto per configurare il calendario.", true, root);
            return;
        }
        const weekdays = String(formData.get("weekdays") || "")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, 20);
        const months = String(formData.get("months") || "")
            .split(/\r?\n/)
            .map(parseMonthLine)
            .filter(Boolean)
            .slice(0, 36);
        if (!weekdays.length || !months.length) {
            setStatus("Servono almeno un giorno della settimana e un mese.", true, root);
            return;
        }
        const currentYear = clampInt(formData.get("currentYear"), -999999, 999999, 1492);
        const currentMonth = clampInt(formData.get("currentMonth"), 1, months.length, 1);
        const currentDay = clampInt(formData.get("currentDay"), 1, months[currentMonth - 1]?.days || 1, 1);
        const nextConfig = normalizeConfig({
            ...state.config,
            name: String(formData.get("name") || "").trim() || DEFAULT_CONFIG.name,
            epochName: String(formData.get("epochName") || "").trim(),
            weekdays,
            months,
            firstWeekdayIndex: clampInt(formData.get("firstWeekdayIndex"), 0, weekdays.length - 1, 0)
        });
        const nextState = {
            ...state.calendarState,
            currentDate: toDateKey({ year: currentYear, month: currentMonth, day: currentDay })
        };
        try {
            await saveCalendarData(buildData({ config: nextConfig, calendarState: nextState }), token, { userScoped: false });
            state.config = nextConfig;
            state.calendarState = nextState;
            state.viewYear = currentYear;
            state.viewMonth = currentMonth;
            state.selectedDate = nextState.currentDate;
            setStatus("Calendario aggiornato.", false, root);
            render(root);
        } catch (error) {
            console.error("Salvataggio configurazione calendario fallito:", error);
            setStatus(`Salvataggio fallito: ${error?.message || error}`, true, root);
        }
    }

    async function saveCalendarData(data, token, options = {}) {
        const body = {
            data,
            campaignId: getCampaignId()
        };
        if (!options.userScoped && state.source === "kv") body.expectedVersion = state.version;
        const response = await fetch(window.CriptaApp?.urls?.api?.("api/data/calendar") || "https://sigillo-api.khuzoe.workers.dev/api/data/calendar", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify(body)
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
        state.version = Number(payload?.version || state.version);
        state.source = "kv";
        state.data = data;
        window.CriptaApp?.api?.clearCache?.();
    }

    function buildData(overrides = {}) {
        const config = overrides.config || state.config;
        const calendarState = overrides.calendarState || state.calendarState;
        const notes = overrides.notes || state.notes;
        const importantDays = overrides.importantDays || state.importantDays;
        return [config, calendarState, ...importantDays, ...notes].map((entry) => ({ ...entry }));
    }

    function parseMonthLine(line) {
        const parts = String(line || "").split("|");
        const name = String(parts[0] || "").trim();
        const days = clampInt(parts[1], 1, 99, 30);
        return name ? { name, days } : null;
    }

    function getVisibleNotesForDate(dateKey) {
        return state.notes
            .filter((note) => note.date === dateKey)
            .filter((note) => note.visibility !== "private" || state.isDm || isOwnNote(note))
            .sort((a, b) => String(a.updatedAt || "").localeCompare(String(b.updatedAt || "")));
    }

    function getImportantDay(dateKey) {
        return state.importantDays.find((day) => day.date === dateKey) || null;
    }

    function isOwnNote(note) {
        const accountId = getAccountId();
        const discordId = getDiscordId();
        return Boolean(accountId && note.ownerAccountId === accountId)
            || Boolean(discordId && note.ownerDiscordId === discordId);
    }

    function getWeekdayIndex(date) {
        const weekSize = Math.max(1, state.config.weekdays.length);
        let days = state.config.firstWeekdayIndex || 0;
        const yearDays = state.config.months.reduce((sum, month) => sum + month.days, 0);
        days += (date.year - 1) * yearDays;
        for (let i = 0; i < date.month - 1; i += 1) days += state.config.months[i]?.days || 0;
        days += date.day - 1;
        return ((days % weekSize) + weekSize) % weekSize;
    }

    function getWeekdayName(date) {
        if (!date) return "";
        return state.config.weekdays[getWeekdayIndex(date)] || "";
    }

    function formatDateLabel(date) {
        if (!date) return "";
        const month = state.config.months[date.month - 1];
        return `${date.day} ${month?.name || `Mese ${date.month}`} ${formatYear(date.year)}`;
    }

    function formatYear(year) {
        return `${year}${state.config.epochName ? ` ${state.config.epochName}` : ""}`;
    }

    function parseDateKey(value) {
        const match = String(value || "").trim().match(/^(-?\d+)-(\d+)-(\d+)$/);
        if (!match) return null;
        const date = {
            year: Number(match[1]),
            month: Number(match[2]),
            day: Number(match[3])
        };
        if (!Number.isFinite(date.year) || !Number.isFinite(date.month) || !Number.isFinite(date.day)) return null;
        if (date.month < 1 || date.month > state.config.months.length) return null;
        const maxDay = state.config.months[date.month - 1]?.days || 31;
        if (date.day < 1 || date.day > maxDay) return null;
        return date;
    }

    function toDateKey(date) {
        if (!date) return "";
        return `${Number(date.year)}-${Number(date.month)}-${Number(date.day)}`;
    }

    function getCampaignId() {
        return window.CriptaApp?.campaigns?.currentId?.() || "cripta-di-sangue";
    }

    function readAuthToken() {
        return String(window.CriptaDiscordAuth?.getToken?.() || window.CriptaApp?.auth?.getToken?.() || "").trim();
    }

    function getAccountId() {
        const user = state.authState?.user || {};
        return String(user.accountId || user.id || user.sub || "").trim();
    }

    function getDiscordId() {
        const user = state.authState?.user || {};
        const explicit = String(user.discordId || "").trim();
        if (explicit) return explicit;
        const legacy = String(user.id || user.sub || "").trim();
        return /^\d{5,32}$/.test(legacy) ? legacy : "";
    }

    function getDisplayName() {
        const user = state.authState?.user || {};
        return String(user.global_name || user.username || user.name || user.id || "Utente").trim();
    }

    function setStatus(message, isError, root) {
        state.status = message;
        state.statusError = Boolean(isError);
        const target = root?.querySelector(".calendar-status");
        if (target) {
            target.textContent = message;
            target.classList.toggle("is-error", Boolean(isError));
        }
    }

    function clampInt(value, min, max, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.max(min, Math.min(max, Math.trunc(number)));
    }

    function escapeHtml(value) {
        return window.CriptaApp.utils.escapeHtml(value);
    }

    function structuredCloneSafe(value) {
        return window.CriptaApp.utils.structuredCloneSafe(value);
    }
})();
