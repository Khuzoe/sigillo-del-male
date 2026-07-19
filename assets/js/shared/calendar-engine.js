(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    root.CriptaCalendarEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const DEFAULT_DEFINITION = {
        schemaVersion: 2,
        revision: 1,
        name: "Calendario di Harptos",
        epochName: "DR",
        firstWeekdayIndex: 0,
        weekdays: ["Primo", "Secondo", "Terzo", "Quarto", "Quinto", "Sesto", "Settimo", "Ottavo", "Nono", "Decimo"].map((name, index) => ({
            id: `weekday-${index + 1}`, name, short: name.slice(0, 3)
        })),
        months: ["Hammer", "Alturiak", "Ches", "Tarsakh", "Mirtul", "Kythorn", "Flamerule", "Eleasis", "Eleint", "Marpenoth", "Uktar", "Nightal"].map((name, index) => ({
            id: `month-${index + 1}`, name, days: 30
        })),
        timeSystem: {
            hoursPerDay: 24,
            minutesPerHour: 60,
            quickSteps: [
                { unit: "hour", amount: -1 },
                { unit: "minute", amount: -15 },
                { unit: "minute", amount: 15 },
                { unit: "hour", amount: 1 }
            ]
        }
    };

    function integer(value, min, max, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.max(min, Math.min(max, Math.trunc(number)));
    }

    function slug(value, fallback) {
        return String(value || "").trim().toLowerCase()
            .replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || fallback;
    }

    function stableId(value, used, fallback) {
        const base = slug(value, fallback);
        let id = base;
        let suffix = 2;
        while (used.has(id)) id = `${base}-${suffix++}`;
        used.add(id);
        return id;
    }

    function normalizeDefinition(input) {
        const source = input && typeof input === "object" ? input : {};
        const sourceWeekdays = Array.isArray(source.weekdays) && source.weekdays.length ? source.weekdays : DEFAULT_DEFINITION.weekdays;
        const sourceMonths = Array.isArray(source.months) && source.months.length ? source.months : DEFAULT_DEFINITION.months;
        const weekdayIds = new Set();
        const monthIds = new Set();
        const weekdays = sourceWeekdays.slice(0, 32).map((entry, index) => {
            const row = typeof entry === "string" ? { name: entry } : (entry || {});
            const name = String(row.name || row.label || `Giorno ${index + 1}`).trim().slice(0, 80);
            return {
                id: stableId(row.id || name, weekdayIds, `weekday-${index + 1}`),
                name,
                short: String(row.short || name.slice(0, 3)).trim().slice(0, 12) || String(index + 1)
            };
        });
        const months = sourceMonths.slice(0, 48).map((entry, index) => {
            const row = typeof entry === "string" ? { name: entry } : (entry || {});
            const name = String(row.name || row.label || `Mese ${index + 1}`).trim().slice(0, 80);
            return {
                id: stableId(row.id || name, monthIds, `month-${index + 1}`),
                name,
                days: integer(row.days, 1, 9999, 30)
            };
        });
        const time = source.timeSystem && typeof source.timeSystem === "object" ? source.timeSystem : {};
        const steps = (Array.isArray(time.quickSteps) ? time.quickSteps : DEFAULT_DEFINITION.timeSystem.quickSteps)
            .slice(0, 10)
            .map((entry) => ({
                unit: ["minute", "hour", "day"].includes(entry?.unit) ? entry.unit : "minute",
                amount: integer(entry?.amount, -999999, 999999, 0)
            }))
            .filter((entry) => entry.amount !== 0);
        return {
            schemaVersion: 2,
            revision: integer(source.revision, 1, Number.MAX_SAFE_INTEGER, 1),
            name: String(source.name || DEFAULT_DEFINITION.name).trim().slice(0, 120) || DEFAULT_DEFINITION.name,
            epochName: String(source.epochName || "").trim().slice(0, 24),
            firstWeekdayIndex: integer(source.firstWeekdayIndex, 0, weekdays.length - 1, 0),
            weekdays,
            months,
            timeSystem: {
                hoursPerDay: integer(time.hoursPerDay, 1, 9999, 24),
                minutesPerHour: integer(time.minutesPerHour, 1, 9999, 60),
                quickSteps: steps.length ? steps : DEFAULT_DEFINITION.timeSystem.quickSteps.map((entry) => ({ ...entry }))
            }
        };
    }

    function firstDate(definition) {
        const def = normalizeDefinition(definition);
        return { year: 1492, monthId: def.months[0].id, day: 1 };
    }

    function parseLegacyDateKey(value, definition) {
        const match = String(value || "").trim().match(/^(-?\d+)-(\d+)-(\d+)$/);
        if (!match) return null;
        const def = normalizeDefinition(definition);
        const month = def.months[integer(match[2], 1, def.months.length, 1) - 1];
        return { year: Number(match[1]), monthId: month.id, month: Number(match[2]), day: Number(match[3]) };
    }

    function normalizeDate(definition, value, options = {}) {
        const def = normalizeDefinition(definition);
        const source = typeof value === "string" ? parseLegacyDateKey(value, def) : (value || {});
        const requestedMonth = String(source?.monthId || "");
        const numericMonth = integer(source?.month, 1, def.months.length, 1);
        const month = def.months.find((entry) => entry.id === requestedMonth) || def.months[numericMonth - 1] || def.months[0];
        const day = Number(source?.day);
        if (options.strict && requestedMonth && !def.months.some((entry) => entry.id === requestedMonth)) return null;
        if (options.strict && (!Number.isInteger(day) || day < 1 || day > month.days)) return null;
        return {
            year: integer(source?.year, -99999999, 99999999, 1492),
            monthId: month.id,
            day: integer(day, 1, month.days, 1)
        };
    }

    function normalizeTime(definition, value, options = {}) {
        const def = normalizeDefinition(definition);
        const source = value || {};
        const hour = Number(source.hour);
        const minute = Number(source.minute);
        if (options.strict && (!Number.isInteger(hour) || hour < 0 || hour >= def.timeSystem.hoursPerDay)) return null;
        if (options.strict && (!Number.isInteger(minute) || minute < 0 || minute >= def.timeSystem.minutesPerHour)) return null;
        return {
            hour: integer(hour, 0, def.timeSystem.hoursPerDay - 1, 0),
            minute: integer(minute, 0, def.timeSystem.minutesPerHour - 1, 0)
        };
    }

    function normalizeClock(definition, value) {
        const source = value && typeof value === "object" ? value : {};
        return {
            revision: integer(source.revision, 1, Number.MAX_SAFE_INTEGER, 1),
            date: normalizeDate(definition, source.date || source.currentDate || firstDate(definition)),
            time: normalizeTime(definition, source.time),
            updatedAt: String(source.updatedAt || ""),
            updatedBy: String(source.updatedBy || "")
        };
    }

    function monthIndex(definition, monthId) {
        return normalizeDefinition(definition).months.findIndex((entry) => entry.id === String(monthId || ""));
    }

    function yearLength(definition) {
        return normalizeDefinition(definition).months.reduce((sum, month) => sum + month.days, 0);
    }

    function dateToOrdinal(definition, value) {
        const def = normalizeDefinition(definition);
        const date = normalizeDate(def, value);
        const index = Math.max(0, def.months.findIndex((month) => month.id === date.monthId));
        return date.year * yearLength(def) + def.months.slice(0, index).reduce((sum, month) => sum + month.days, 0) + date.day - 1;
    }

    function ordinalToDate(definition, value) {
        const def = normalizeDefinition(definition);
        const length = yearLength(def);
        const ordinal = Math.trunc(Number(value) || 0);
        const year = Math.floor(ordinal / length);
        let remainder = ordinal - year * length;
        let month = def.months[0];
        for (const candidate of def.months) {
            month = candidate;
            if (remainder < candidate.days) break;
            remainder -= candidate.days;
        }
        return { year, monthId: month.id, day: remainder + 1 };
    }

    function addDays(definition, value, amount) {
        return ordinalToDate(definition, dateToOrdinal(definition, value) + Math.trunc(Number(amount) || 0));
    }

    function minuteIndex(definition, value) {
        const def = normalizeDefinition(definition);
        const time = normalizeTime(def, value);
        return time.hour * def.timeSystem.minutesPerHour + time.minute;
    }

    function timeFromIndex(definition, value) {
        const def = normalizeDefinition(definition);
        const perDay = def.timeSystem.hoursPerDay * def.timeSystem.minutesPerHour;
        const index = ((Math.trunc(Number(value) || 0) % perDay) + perDay) % perDay;
        return { hour: Math.floor(index / def.timeSystem.minutesPerHour), minute: index % def.timeSystem.minutesPerHour };
    }

    function shiftClock(definition, clockValue, amount, unit) {
        const def = normalizeDefinition(definition);
        const clock = normalizeClock(def, clockValue);
        const perHour = def.timeSystem.minutesPerHour;
        const perDay = def.timeSystem.hoursPerDay * perHour;
        const factor = unit === "day" ? perDay : unit === "hour" ? perHour : 1;
        const total = minuteIndex(def, clock.time) + Math.trunc(Number(amount) || 0) * factor;
        return {
            ...clock,
            date: addDays(def, clock.date, Math.floor(total / perDay)),
            time: timeFromIndex(def, total)
        };
    }

    function weekdayIndex(definition, value) {
        const def = normalizeDefinition(definition);
        const index = def.firstWeekdayIndex + dateToOrdinal(def, value);
        return ((index % def.weekdays.length) + def.weekdays.length) % def.weekdays.length;
    }

    function dateKey(definition, value) {
        const def = normalizeDefinition(definition);
        const date = normalizeDate(def, value);
        return `${date.year}-${Math.max(0, monthIndex(def, date.monthId)) + 1}-${date.day}`;
    }

    function formatYear(definition, year) {
        const def = normalizeDefinition(definition);
        return `${Number(year)}${def.epochName ? ` ${def.epochName}` : ""}`;
    }

    function formatDate(definition, value, options = {}) {
        const def = normalizeDefinition(definition);
        const date = normalizeDate(def, value);
        const month = def.months.find((entry) => entry.id === date.monthId) || def.months[0];
        const core = `${date.day} ${month.name} ${formatYear(def, date.year)}`;
        return options.weekday ? `${def.weekdays[weekdayIndex(def, date)]?.name || ""}, ${core}` : core;
    }

    function digitsFor(value) {
        return Math.max(2, String(Math.max(0, Number(value) - 1)).length);
    }

    function formatTime(definition, value) {
        const def = normalizeDefinition(definition);
        const time = normalizeTime(def, value);
        return `${String(time.hour).padStart(digitsFor(def.timeSystem.hoursPerDay), "0")}:${String(time.minute).padStart(digitsFor(def.timeSystem.minutesPerHour), "0")}`;
    }

    function compareDates(definition, left, right) {
        return dateToOrdinal(definition, left) - dateToOrdinal(definition, right);
    }

    function compareMoments(definition, left, right) {
        const dateDifference = compareDates(definition, left?.date || left, right?.date || right);
        return dateDifference || minuteIndex(definition, left?.time) - minuteIndex(definition, right?.time);
    }

    return {
        DEFAULT_DEFINITION, normalizeDefinition, normalizeDate, normalizeTime, normalizeClock,
        parseLegacyDateKey, monthIndex, yearLength, dateToOrdinal, ordinalToDate, addDays,
        minuteIndex, timeFromIndex, shiftClock, weekdayIndex, dateKey, formatYear,
        formatDate, formatTime, compareDates, compareMoments, firstDate
    };
});
