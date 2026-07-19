(function () {
    "use strict";

    const API_ROOT = "api/calendar";

    function token() {
        return String(window.CriptaDiscordAuth?.getToken?.() || window.CriptaApp?.auth?.getToken?.() || "").trim();
    }

    function options(extra = {}) {
        const authToken = token();
        return { cache: false, ...extra, ...(authToken ? { token: authToken } : {}) };
    }

    async function load() {
        try {
            return await window.CriptaApp.api.get(API_ROOT, options({ query: { _: Date.now() } }));
        } catch (error) {
            console.warn("Calendario v2 non disponibile, uso il fallback locale.", error);
            const legacy = await window.CriptaApp.data.globalJson("calendar.json", { cache: false });
            return legacyFallback(legacy);
        }
    }

    function legacyFallback(payload) {
        const engine = window.CriptaCalendarEngine;
        const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
        const config = rows.find((entry) => entry?.type === "config") || {};
        const definition = engine.normalizeDefinition({
            name: config.name,
            epochName: config.epochName,
            firstWeekdayIndex: config.firstWeekdayIndex,
            weekdays: config.weekdays,
            months: config.months,
            timeSystem: config.timeSystem
        });
        const legacyState = rows.find((entry) => entry?.type === "state") || {};
        const clock = engine.normalizeClock(definition, {
            date: engine.parseLegacyDateKey(legacyState.currentDate, definition),
            time: legacyState.time
        });
        const events = rows
            .filter((entry) => ["note", "important-day"].includes(entry?.type))
            .filter((entry) => entry.visibility !== "private")
            .map((entry, index) => ({
                id: String(entry.id || `legacy-event-${index + 1}`),
                revision: 1,
                kind: entry.type === "important-day" ? "holiday" : "note",
                status: "scheduled",
                visibility: "public",
                title: String(entry.title || "Nota"),
                description: String(entry.text || ""),
                allDay: true,
                start: { date: engine.parseLegacyDateKey(entry.date, definition), time: null },
                end: null,
                ownerAccountId: String(entry.ownerAccountId || ""),
                ownerName: String(entry.ownerName || ""),
                canEdit: false
            }));
        return {
            ok: true,
            source: "static",
            schemaVersion: 2,
            version: 0,
            calendar: { definition, clock, events },
            permissions: { authenticated: Boolean(token()), canEdit: false, canCreateNote: false }
        };
    }

    function post(path, body) {
        const authToken = token();
        if (!authToken) return Promise.reject(new Error("Accedi per modificare il calendario."));
        return window.CriptaApp.api.post(`${API_ROOT}/${path}`, body, { token: authToken });
    }

    window.CriptaCalendarService = {
        load,
        upsertEvent(event, expectedRevision, expectedVersion) {
            return post("events/upsert", { event, expectedRevision, expectedVersion });
        },
        archiveEvent(eventId, expectedRevision, expectedVersion) {
            return post("events/archive", { eventId, expectedRevision, expectedVersion });
        },
        updateClock(change, expectedRevision, expectedVersion) {
            return post("clock", { ...change, expectedRevision, expectedVersion });
        },
        saveConfig(definition, clock, expectedVersion) {
            return post("config", { definition, clock, expectedVersion });
        }
    };
})();
