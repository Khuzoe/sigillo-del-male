(function () {
    "use strict";

    const E = window.CriptaCalendarEngine;
    const API = window.CriptaCalendarService;
    const KINDS = {
        event: ["Evento", "fa-star", "gold"],
        note: ["Nota", "fa-note-sticky", "violet"],
        holiday: ["Ricorrenza", "fa-sun", "amber"],
        deadline: ["Scadenza", "fa-hourglass-end", "red"],
        mission: ["Missione", "fa-compass", "green"],
        travel: ["Viaggio", "fa-route", "blue"],
        session: ["Sessione", "fa-book-open", "violet"],
        reminder: ["Promemoria", "fa-bell", "amber"]
    };
    const VISIBILITY = {
        public: ["Pubblico", "fa-globe"],
        players: ["Giocatori", "fa-users"],
        dm: ["Solo DM", "fa-user-shield"],
        owner: ["Personale", "fa-lock"]
    };
    const S = {
        definition: null, clock: null, events: [], permissions: {}, version: 0,
        view: window.matchMedia("(max-width: 700px)").matches ? "agenda" : "month", viewYear: 1492, viewMonthId: "", selectedDate: null,
        filter: "all", source: "api", saving: false, modal: null, modalDirty: false, leaveGuard: null
    };
    let root;
    let modalRoot;

    window.CriptaApp.onPageReady("calendario", init);

    async function init() {
        root = document.getElementById("calendar-root");
        modalRoot = document.getElementById("calendar-modal-root");
        if (!root || !modalRoot) return;
        if (!root.dataset.bound) {
            root.dataset.bound = "true";
            root.addEventListener("click", onRootClick);
            modalRoot.addEventListener("click", onModalClick);
            modalRoot.addEventListener("input", onModalInput);
            modalRoot.addEventListener("change", onModalInput);
        }
        S.leaveGuard?.();
        S.leaveGuard = window.CriptaApp.navigation?.addLeaveGuard?.("calendar-editor", () => S.modalDirty ? ({
            active: true,
            message: "Hai modifiche non salvate nel calendario. Continuare senza salvarle?",
            discard: () => { S.modalDirty = false; }
        }) : null);
        try {
            consume(await API.load(), true);
            render();
        } catch (error) {
            console.error("Calendario non disponibile", error);
            root.innerHTML = `<div class="calendar-error"><i class="fa-solid fa-triangle-exclamation"></i><h1>Il calendario non si ? aperto</h1><p>${esc(error?.message || error)}</p><button data-action="reload">Riprova</button></div>`;
        }
    }

    function consume(payload, initial = false) {
        const calendar = payload?.calendar || {};
        S.definition = E.normalizeDefinition(calendar.definition);
        S.clock = E.normalizeClock(S.definition, calendar.clock);
        S.events = Array.isArray(calendar.events) ? calendar.events : [];
        S.permissions = payload?.permissions || {};
        S.source = String(payload?.source || "api");
        S.version = Number(payload?.version || 0);
        if (initial || !S.viewMonthId) {
            S.viewYear = S.clock.date.year;
            S.viewMonthId = S.clock.date.monthId;
            S.selectedDate = { ...S.clock.date };
        }
        window.CriptaApp.api?.clearCache?.("api/calendar");
    }

    function render() {
        const def = S.definition;
        const month = def.months.find((entry) => entry.id === S.viewMonthId) || def.months[0];
        root.innerHTML = `
            <header class="calendar-hero archive-hero archive-hero--calendar">
                <div class="calendar-hero__copy archive-hero__copy">
                    <div class="calendar-kicker archive-hero__eyebrow"><span></span>Tempo della campagna</div>
                    <h1>Calendario</h1>
                    <div class="archive-hero__meta">
                        <span><i class="fa-solid fa-clock" aria-hidden="true"></i>${esc(def.name)}</span>
                    </div>
                </div>
                <div class="archive-hero__sigil" aria-hidden="true">
                    <span class="archive-hero__orbit"></span>
                    <span class="archive-hero__emblem"><i class="fa-solid fa-calendar-days"></i></span>
                </div>
            </header>
            ${renderClock()}
            <section class="calendar-toolbar" aria-label="Navigazione calendario">
                <div class="calendar-view-tabs" role="tablist" aria-label="Vista">
                    ${viewButton("month", "fa-calendar-days", "Mese")}
                    ${viewButton("agenda", "fa-list-ul", "Agenda")}
                    ${viewButton("timeline", "fa-clock-rotate-left", "Cronologia")}
                </div>
                <div class="calendar-toolbar__period">
                    <button data-action="previous-period" aria-label="Periodo precedente"><i class="fa-solid fa-chevron-left"></i></button>
                    <strong>${S.view === "month" ? `${esc(month.name)} ${esc(E.formatYear(def, S.viewYear))}` : S.view === "agenda" ? "Prossimi eventi" : "Eventi trascorsi"}</strong>
                    <button data-action="next-period" aria-label="Periodo successivo" ${S.view === "month" ? "" : "hidden"}><i class="fa-solid fa-chevron-right"></i></button>
                    <button class="calendar-today" data-action="jump-current"><i class="fa-solid fa-location-crosshairs"></i> Data della campagna</button>
                </div>
                <div class="calendar-toolbar__actions">
                    ${S.permissions.canEdit ? '<button data-action="open-config"><i class="fa-solid fa-sliders"></i><span>Configura</span></button>' : ""}
                    ${renderCreateButton("toolbar")}
                </div>
            </section>
            <section class="calendar-filterbar" aria-label="Filtri eventi">
                <button class="${S.filter === "all" ? "is-active" : ""}" data-filter="all">Tutto</button>
                ${Object.entries(KINDS).map(([kind, meta]) => `<button class="${S.filter === kind ? "is-active" : ""}" data-filter="${kind}"><i class="fa-solid ${meta[1]}"></i>${esc(meta[0])}</button>`).join("")}
            </section>
            <div class="calendar-content">${S.view === "month" ? renderMonth() : renderStream(S.view === "timeline")}</div>
        `;
    }

    function renderClock() {
        const def = S.definition;
        const weekday = def.weekdays[E.weekdayIndex(def, S.clock.date)]?.name || "";
        return `
            <section class="calendar-current" aria-label="Data attuale della campagna">
                <span class="calendar-current__orb"><i class="fa-regular fa-moon"></i></span>
                <div class="calendar-current__date"><small>${esc(weekday)}</small><strong>${esc(E.formatDate(def, S.clock.date))}</strong></div>
                <button class="calendar-current__time ${S.permissions.canEdit ? "is-editable" : ""}" ${S.permissions.canEdit ? 'data-action="open-clock"' : ""}>
                    <small>Ora del mondo</small><strong>${esc(E.formatTime(def, S.clock.time))}</strong>
                </button>
                ${S.permissions.canEdit ? `<div class="calendar-time-steps">${def.timeSystem.quickSteps.map((step) => `<button data-action="step-time" data-unit="${esc(step.unit)}" data-amount="${step.amount}" ${S.saving ? "disabled" : ""}>${esc(stepLabel(step))}</button>`).join("")}</div>` : ""}
            </section>
        `;
    }

    function viewButton(view, icon, label) {
        return `<button role="tab" aria-selected="${S.view === view}" class="${S.view === view ? "is-active" : ""}" data-view="${view}"><i class="fa-solid ${icon}"></i><span>${label}</span></button>`;
    }

    function renderMonth() {
        const def = S.definition;
        const month = def.months.find((entry) => entry.id === S.viewMonthId) || def.months[0];
        const offset = E.weekdayIndex(def, { year: S.viewYear, monthId: month.id, day: 1 });
        const cells = Array.from({ length: offset }, () => '<span class="calendar-day is-empty" aria-hidden="true"></span>');
        for (let day = 1; day <= month.days; day += 1) {
            const date = { year: S.viewYear, monthId: month.id, day };
            const events = eventsForDate(date);
            const selected = sameDate(date, S.selectedDate);
            const current = sameDate(date, S.clock.date);
            cells.push(`
                <button class="calendar-day ${selected ? "is-selected" : ""} ${current ? "is-current" : ""}" role="gridcell" aria-selected="${selected}" data-date="${esc(E.dateKey(def, date))}">
                    <span class="calendar-day__top"><b>${day}</b>${current ? "<em>Ora</em>" : ""}</span>
                    <span class="calendar-day__events">
                        ${events.slice(0, 2).map(renderChip).join("")}
                        ${events.length > 2 ? `<span class="calendar-day__more">+${events.length - 2}</span>` : ""}
                    </span>
                </button>
            `);
        }
        return `
            <section class="calendar-month-panel">
                <div class="calendar-grid-scroll">
                    <div class="calendar-grid" style="--week-size:${def.weekdays.length}" role="grid" aria-label="${esc(month.name)} ${S.viewYear}">
                        <div class="calendar-weekdays" role="row">${def.weekdays.map((weekday) => `<span role="columnheader" title="${esc(weekday.name)}"><b>${esc(weekday.short)}</b><em>${esc(weekday.name)}</em></span>`).join("")}</div>
                        <div class="calendar-days" role="rowgroup">${cells.join("")}</div>
                    </div>
                </div>
            </section>
            ${renderDayDrawer()}
        `;
    }

    function renderChip(event) {
        const meta = KINDS[event.kind] || KINDS.event;
        const prefix = event.allDay ? "" : `${esc(E.formatTime(S.definition, event.start.time))} ? `;
        return `<span class="calendar-event-chip calendar-event-chip--${meta[2]}"><i class="fa-solid ${meta[1]}"></i><span>${prefix}${esc(event.title)}</span></span>`;
    }

    function renderDayDrawer() {
        const date = S.selectedDate || S.clock.date;
        const events = eventsForDate(date);
        return `
            <section class="calendar-day-drawer">
                <header>
                    <div><span class="calendar-kicker">${esc(S.definition.weekdays[E.weekdayIndex(S.definition, date)]?.name || "")}</span><h2>${esc(E.formatDate(S.definition, date))}</h2></div>
                    ${renderCreateButton("day")}
                </header>
                <div class="calendar-day-drawer__events">
                    ${events.length ? events.map(renderCard).join("") : renderEmptyDay()}
                </div>
            </section>
        `;
    }

    function renderStream(past) {
        const today = E.dateToOrdinal(S.definition, S.clock.date);
        const events = filteredEvents().filter((event) => {
            const value = E.dateToOrdinal(S.definition, event.start.date);
            return past ? value < today : value >= today;
        }).sort((left, right) => E.compareMoments(S.definition, left.start, right.start) * (past ? -1 : 1));
        return `
            <section class="calendar-stream">
                <div class="calendar-stream__rail" aria-hidden="true"></div>
                ${events.length ? events.slice(0, 120).map((event) => {
                    const meta = KINDS[event.kind] || KINDS.event;
                    return `<article class="calendar-stream__row">
                        <time><b>${event.start.date.day}</b><span>${esc(monthName(event.start.date.monthId))}</span><em>${esc(E.formatYear(S.definition, event.start.date.year))}</em></time>
                        <span class="calendar-stream__dot calendar-stream__dot--${meta[2]}"></span>
                        ${renderCard(event)}
                    </article>`;
                }).join("") : '<div class="calendar-empty calendar-empty--large"><i class="fa-solid fa-hourglass"></i><strong>Nessun evento</strong><span>Non ci sono elementi visibili in questa parte della cronologia.</span></div>'}
            </section>
        `;
    }

    function renderCard(event) {
        const meta = KINDS[event.kind] || KINDS.event;
        const visibility = VISIBILITY[event.visibility] || VISIBILITY.dm;
        return `
            <article class="calendar-event-card calendar-event-card--${meta[2]} ${event.status === "cancelled" ? "is-cancelled" : ""}">
                <span class="calendar-event-card__icon"><i class="fa-solid ${meta[1]}"></i></span>
                <div class="calendar-event-card__body">
                    <div class="calendar-event-card__meta">
                        <span>${esc(meta[0])}</span>
                        <span><i class="fa-solid ${visibility[1]}"></i>${esc(visibility[0])}</span>
                        ${event.allDay ? "<span>Giornata intera</span>" : `<span>${esc(E.formatTime(S.definition, event.start.time))}</span>`}
                    </div>
                    <h3>${esc(event.title)}</h3>
                    ${event.description ? `<p>${block(event.description)}</p>` : ""}
                    ${event.end ? `<small class="calendar-event-card__range"><i class="fa-solid fa-arrow-right"></i> fino a ${esc(E.formatDate(S.definition, event.end.date))}${event.allDay ? "" : `, ${esc(E.formatTime(S.definition, event.end.time))}`}</small>` : ""}
                </div>
                ${event.canEdit ? `<button class="calendar-event-card__edit" data-edit-event="${esc(event.id)}" aria-label="Modifica ${esc(event.title)}"><i class="fa-solid fa-pen"></i></button>` : ""}
            </article>
        `;
    }

    function filteredEvents() {
        return S.events.filter((event) => event.status !== "archived").filter((event) => S.filter === "all" || event.kind === S.filter);
    }

    function eventsForDate(date) {
        const ordinal = E.dateToOrdinal(S.definition, date);
        return filteredEvents().filter((event) => {
            const start = E.dateToOrdinal(S.definition, event.start.date);
            const end = event.end ? E.dateToOrdinal(S.definition, event.end.date) : start;
            return ordinal >= start && ordinal <= end;
        }).sort((left, right) => E.compareMoments(S.definition, left.start, right.start));
    }

    async function onRootClick(event) {
        const target = event.target.closest("button");
        if (!target) return;
        if (target.dataset.action === "reload") return init();
        if (target.dataset.view) {
            S.view = target.dataset.view;
            render();
            return;
        }
        if (target.dataset.filter) {
            S.filter = target.dataset.filter;
            render();
            return;
        }
        if (target.dataset.date) {
            S.selectedDate = E.parseLegacyDateKey(target.dataset.date, S.definition);
            render();
            requestAnimationFrame(() => root.querySelector(".calendar-day-drawer")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
            return;
        }
        if (target.dataset.editEvent) return openEventEditor(S.events.find((item) => item.id === target.dataset.editEvent));
        const action = target.dataset.action;
        if (action === "previous-period") return changeMonth(-1);
        if (action === "next-period") return changeMonth(1);
        if (action === "jump-current") {
            S.viewYear = S.clock.date.year;
            S.viewMonthId = S.clock.date.monthId;
            S.selectedDate = { ...S.clock.date };
            S.view = "month";
            return render();
        }
        if (action === "new-event") return openEventEditor();
        if (action === "write-help") return showWriteHelp();
        if (action === "open-config") return openConfigEditor();
        if (action === "open-clock") return openClockEditor();
        if (action === "step-time") return stepTime(Number(target.dataset.amount), target.dataset.unit);
    }

    function changeMonth(amount) {
        if (S.view !== "month") {
            S.view = "month";
            return render();
        }
        const months = S.definition.months;
        let index = months.findIndex((month) => month.id === S.viewMonthId) + amount;
        if (index < 0) {
            index = months.length - 1;
            S.viewYear -= 1;
        } else if (index >= months.length) {
            index = 0;
            S.viewYear += 1;
        }
        S.viewMonthId = months[index].id;
        S.selectedDate = { year: S.viewYear, monthId: S.viewMonthId, day: 1 };
        render();
    }

    async function stepTime(amount, unit) {
        if (S.saving) return;
        S.saving = true;
        render();
        try {
            consume(await API.updateClock({ delta: { amount, unit } }, S.clock.revision, S.version));
            toast(`Tempo ${amount >= 0 ? "avanzato" : "riportato indietro"} di ${stepLabel({ amount, unit }).replace(/^[+-]/, "")}.`);
        } catch (error) {
            toast(error?.message || error, true);
            await reloadConflict(error);
        } finally {
            S.saving = false;
            render();
        }
    }

    function openEventEditor(existing) {
        const isDm = Boolean(S.permissions.canEdit);
        const date = existing?.start?.date || S.selectedDate || S.clock.date;
        const draft = existing || {
            id: "", revision: 0, kind: isDm ? "event" : "note",
            visibility: isDm ? "players" : "owner", status: "scheduled",
            title: "", description: "", allDay: true,
            start: { date, time: { ...S.clock.time } }, end: null
        };
        S.modal = { type: "event", draft };
        S.modalDirty = false;
        modalRoot.innerHTML = `
            <div class="calendar-modal-backdrop">
                <section class="calendar-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-editor-title">
                    <header class="calendar-modal__header">
                        <div><span>${existing ? "Modifica evento" : "Nuova voce"}</span><h2 id="calendar-editor-title">${esc(existing?.title || "Scrivi nel calendario")}</h2></div>
                        <button data-modal-action="close" aria-label="Chiudi"><i class="fa-solid fa-xmark"></i></button>
                    </header>
                    <form class="calendar-modal__body" data-event-form>
                        <section class="calendar-editor-panel">
                            <div class="calendar-editor-grid calendar-editor-grid--identity">
                                <label class="calendar-field calendar-field--title"><span>Titolo</span><input name="title" value="${attr(draft.title)}" maxlength="240" required autofocus></label>
                                ${isDm ? `
                                    <label class="calendar-field"><span>Tipo</span><select name="kind">${Object.entries(KINDS).map(([key, meta]) => `<option value="${key}" ${draft.kind === key ? "selected" : ""}>${esc(meta[0])}</option>`).join("")}</select></label>
                                    <label class="calendar-field"><span>Stato</span><select name="status"><option value="scheduled" ${draft.status === "scheduled" ? "selected" : ""}>Previsto</option><option value="completed" ${draft.status === "completed" ? "selected" : ""}>Completato</option><option value="cancelled" ${draft.status === "cancelled" ? "selected" : ""}>Annullato</option></select></label>
                                ` : '<input type="hidden" name="kind" value="note"><input type="hidden" name="status" value="scheduled">'}
                                <label class="calendar-field"><span>Visibilit?</span><select name="visibility">${visibilityOptions(draft.visibility, isDm)}</select></label>
                            </div>
                        </section>
                        <section class="calendar-editor-panel">
                            <div class="calendar-editor-panel__heading">
                                <i class="fa-regular fa-clock"></i>
                                <div><span>Quando</span><h3>Data e durata</h3></div>
                                <label class="calendar-switch"><input type="checkbox" name="allDay" ${draft.allDay ? "checked" : ""}><span></span> Giornata intera</label>
                            </div>
                            <div class="calendar-datetime-grid">
                                ${dateFields("start", draft.start.date)}
                                ${timeFields("start", draft.start.time || S.clock.time, draft.allDay)}
                            </div>
                            <label class="calendar-end-toggle"><input type="checkbox" name="hasEnd" ${draft.end ? "checked" : ""}><span></span> Ha una data di fine</label>
                            <div class="calendar-end-fields" ${draft.end ? "" : "hidden"}>
                                <div class="calendar-datetime-grid">
                                    ${dateFields("end", draft.end?.date || draft.start.date)}
                                    ${timeFields("end", draft.end?.time || draft.start.time || S.clock.time, draft.allDay)}
                                </div>
                            </div>
                        </section>
                        <section class="calendar-editor-panel">
                            <label class="calendar-field"><span>Descrizione</span><textarea name="description" rows="8" maxlength="12000" placeholder="Cosa accade? Chi ? coinvolto?">${esc(draft.description || "")}</textarea></label>
                        </section>
                    </form>
                    <footer class="calendar-modal__footer">
                        ${existing ? '<button class="is-danger" data-modal-action="archive"><i class="fa-solid fa-box-archive"></i> Archivia</button>' : "<span></span>"}
                        <div><button data-modal-action="close">Annulla</button><button class="is-primary" data-modal-action="save-event"><i class="fa-solid fa-floppy-disk"></i> Salva</button></div>
                    </footer>
                </section>
            </div>
        `;
        document.body.classList.add("calendar-modal-open");
    }

    function openClockEditor() {
        S.modal = { type: "clock" };
        S.modalDirty = false;
        modalRoot.innerHTML = `
            <div class="calendar-modal-backdrop">
                <section class="calendar-modal calendar-modal--compact" role="dialog" aria-modal="true" aria-labelledby="calendar-clock-title">
                    <header class="calendar-modal__header"><div><span>Orologio della campagna</span><h2 id="calendar-clock-title">Imposta data e ora</h2></div><button data-modal-action="close"><i class="fa-solid fa-xmark"></i></button></header>
                    <form class="calendar-modal__body" data-clock-form><section class="calendar-editor-panel"><div class="calendar-datetime-grid">${dateFields("clock", S.clock.date)}${timeFields("clock", S.clock.time, false)}</div></section></form>
                    <footer class="calendar-modal__footer"><span></span><div><button data-modal-action="close">Annulla</button><button class="is-primary" data-modal-action="save-clock"><i class="fa-solid fa-check"></i> Imposta</button></div></footer>
                </section>
            </div>
        `;
        document.body.classList.add("calendar-modal-open");
    }

    function dateFields(prefix, value) {
        const date = E.normalizeDate(S.definition, value);
        const month = S.definition.months.find((entry) => entry.id === date.monthId) || S.definition.months[0];
        return `
            <label class="calendar-field"><span>Anno</span><input type="number" name="${prefix}Year" value="${date.year}" required></label>
            <label class="calendar-field"><span>Mese</span><select name="${prefix}Month">${S.definition.months.map((entry) => `<option value="${attr(entry.id)}" ${entry.id === date.monthId ? "selected" : ""}>${esc(entry.name)}</option>`).join("")}</select></label>
            <label class="calendar-field"><span>Giorno</span><input type="number" name="${prefix}Day" min="1" max="${month.days}" value="${date.day}" required data-day-for="${prefix}"></label>
        `;
    }

    function timeFields(prefix, value, hidden) {
        const time = E.normalizeTime(S.definition, value);
        return `
            <div class="calendar-time-fields" data-time-fields ${hidden ? "hidden" : ""}>
                <label class="calendar-field"><span>Ora</span><input type="number" name="${prefix}Hour" min="0" max="${S.definition.timeSystem.hoursPerDay - 1}" value="${time.hour}" required></label>
                <span>:</span>
                <label class="calendar-field"><span>Minuto</span><input type="number" name="${prefix}Minute" min="0" max="${S.definition.timeSystem.minutesPerHour - 1}" value="${time.minute}" required></label>
            </div>
        `;
    }

    function openConfigEditor() {
        const def = S.definition;
        S.modal = { type: "config" };
        S.modalDirty = false;
        modalRoot.innerHTML = `
            <div class="calendar-modal-backdrop">
                <section class="calendar-modal calendar-modal--config" role="dialog" aria-modal="true" aria-labelledby="calendar-config-title">
                    <header class="calendar-modal__header"><div><span>Regole del mondo</span><h2 id="calendar-config-title">Configura calendario</h2></div><button data-modal-action="close"><i class="fa-solid fa-xmark"></i></button></header>
                    <form class="calendar-modal__body" data-config-form>
                        <section class="calendar-editor-panel">
                            <div class="calendar-editor-panel__heading"><i class="fa-solid fa-signature"></i><div><span>Identit?</span><h3>Nome ed era</h3></div></div>
                            <div class="calendar-editor-grid calendar-editor-grid--two">
                                <label class="calendar-field"><span>Nome calendario</span><input name="name" value="${attr(def.name)}" required></label>
                                <label class="calendar-field"><span>Era</span><input name="epochName" value="${attr(def.epochName)}" placeholder="es. DR"></label>
                            </div>
                        </section>
                        <section class="calendar-editor-panel">
                            <div class="calendar-editor-panel__heading"><i class="fa-solid fa-hourglass-half"></i><div><span>Tempo</span><h3>Durata del giorno</h3></div></div>
                            <div class="calendar-editor-grid calendar-editor-grid--three">
                                <label class="calendar-field"><span>Ore per giorno</span><input type="number" name="hoursPerDay" min="1" max="9999" value="${def.timeSystem.hoursPerDay}" required></label>
                                <label class="calendar-field"><span>Minuti per ora</span><input type="number" name="minutesPerHour" min="1" max="9999" value="${def.timeSystem.minutesPerHour}" required></label>
                                <label class="calendar-field"><span>Scorciatoie</span><input name="quickSteps" value="${attr(def.timeSystem.quickSteps.map(shortStep).join(", "))}" placeholder="-1h, -15m, +15m, +1h"></label>
                            </div>
                        </section>
                        <section class="calendar-editor-panel">
                            <div class="calendar-editor-panel__heading"><i class="fa-solid fa-calendar-week"></i><div><span>Struttura</span><h3>Settimana e mesi</h3></div></div>
                            <div class="calendar-editor-grid calendar-editor-grid--two">
                                <label class="calendar-field"><span>Giorni ? Nome | abbreviazione</span><textarea name="weekdays" rows="12">${esc(def.weekdays.map((day) => `${day.name}|${day.short}`).join("\n"))}</textarea></label>
                                <label class="calendar-field"><span>Mesi ? Nome | giorni</span><textarea name="months" rows="12">${esc(def.months.map((month) => `${month.name}|${month.days}`).join("\n"))}</textarea></label>
                                <label class="calendar-field"><span>Primo giorno della settimana</span><select name="firstWeekdayIndex">${def.weekdays.map((day, index) => `<option value="${index}" ${def.firstWeekdayIndex === index ? "selected" : ""}>${esc(day.name)}</option>`).join("")}</select></label>
                            </div>
                        </section>
                        <section class="calendar-editor-panel">
                            <div class="calendar-editor-panel__heading"><i class="fa-solid fa-location-dot"></i><div><span>Data attuale</span><h3>Posizione nel tempo</h3></div></div>
                            <div class="calendar-datetime-grid">${dateFields("config", S.clock.date)}${timeFields("config", S.clock.time, false)}</div>
                        </section>
                    </form>
                    <footer class="calendar-modal__footer"><small>Il vecchio calendario resta conservato come backup.</small><div><button data-modal-action="close">Annulla</button><button class="is-primary" data-modal-action="save-config"><i class="fa-solid fa-floppy-disk"></i> Salva configurazione</button></div></footer>
                </section>
            </div>
        `;
        document.body.classList.add("calendar-modal-open");
    }

    async function onModalClick(event) {
        const button = event.target.closest("button");
        const action = button?.dataset.modalAction;
        if (!action) return;
        event.preventDefault();
        if (action === "close") return closeModal();
        if (action === "save-event") return saveEvent();
        if (action === "archive") return archiveEvent();
        if (action === "save-clock") return saveClock();
        if (action === "save-config") return saveConfig();
    }

    function onModalInput(event) {
        S.modalDirty = true;
        const form = event.target.form;
        if (!form) return;
        if (event.target.name === "allDay") {
            form.querySelectorAll("[data-time-fields]").forEach((node) => { node.hidden = event.target.checked; });
        }
        if (event.target.name === "hasEnd") {
            const end = form.querySelector(".calendar-end-fields");
            if (end) end.hidden = !event.target.checked;
        }
        if (event.target.name?.endsWith("Month")) {
            const prefix = event.target.name.replace(/Month$/, "");
            const month = S.definition.months.find((entry) => entry.id === event.target.value);
            const day = form.querySelector(`[data-day-for="${prefix}"]`);
            if (day && month) {
                day.max = String(month.days);
                if (Number(day.value) > month.days) day.value = String(month.days);
            }
        }
    }

    async function saveEvent() {
        const form = modalRoot.querySelector("[data-event-form]");
        if (!form?.reportValidity()) return;
        const data = new FormData(form);
        const existing = S.modal?.draft;
        const allDay = data.get("allDay") === "on";
        const event = {
            ...existing,
            title: String(data.get("title") || "").trim(),
            kind: String(data.get("kind") || "note"),
            status: String(data.get("status") || "scheduled"),
            visibility: String(data.get("visibility") || "owner"),
            description: String(data.get("description") || ""),
            allDay,
            start: readMoment(data, "start", allDay),
            end: data.get("hasEnd") === "on" ? readMoment(data, "end", allDay) : null
        };
        await modalSave(() => API.upsertEvent(event, Number(existing?.revision || 0), S.version), "Evento salvato.");
    }

    async function archiveEvent() {
        const existing = S.modal?.draft;
        if (!existing?.id || !confirm(`Archiviare "${existing.title}"? Il dato rester? conservato.`)) return;
        await modalSave(() => API.archiveEvent(existing.id, existing.revision, S.version), "Evento archiviato.");
    }

    async function saveClock() {
        const form = modalRoot.querySelector("[data-clock-form]");
        if (!form?.reportValidity()) return;
        const data = new FormData(form);
        await modalSave(() => API.updateClock({ clock: readMoment(data, "clock", false) }, S.clock.revision, S.version), "Data della campagna aggiornata.");
    }

    async function saveConfig() {
        const form = modalRoot.querySelector("[data-config-form]");
        if (!form?.reportValidity()) return;
        const data = new FormData(form);
        const weekdays = parseRows(data.get("weekdays"), (parts, index) => ({
            id: S.definition.weekdays[index]?.id,
            name: parts[0],
            short: parts[1] || parts[0].slice(0, 3)
        }));
        const months = parseRows(data.get("months"), (parts, index) => ({
            id: S.definition.months[index]?.id,
            name: parts[0],
            days: Number(parts[1] || 30)
        }));
        if (!weekdays.length || !months.length) return toast("Servono almeno un giorno della settimana e un mese.", true);
        const definition = E.normalizeDefinition({
            ...S.definition,
            name: data.get("name"),
            epochName: data.get("epochName"),
            firstWeekdayIndex: Number(data.get("firstWeekdayIndex") || 0),
            weekdays,
            months,
            timeSystem: {
                hoursPerDay: Number(data.get("hoursPerDay")),
                minutesPerHour: Number(data.get("minutesPerHour")),
                quickSteps: parseQuickSteps(data.get("quickSteps"))
            }
        });
        const clock = {
            ...S.clock,
            date: {
                year: Number(data.get("configYear")),
                monthId: data.get("configMonth"),
                day: Number(data.get("configDay"))
            },
            time: {
                hour: Number(data.get("configHour")),
                minute: Number(data.get("configMinute"))
            }
        };
        await modalSave(() => API.saveConfig(definition, clock, S.version), "Configurazione salvata.");
    }

    async function modalSave(operation, successMessage) {
        const button = modalRoot.querySelector(".is-primary");
        if (button) button.disabled = true;
        try {
            consume(await operation());
            S.modalDirty = false;
            closeModal(true);
            render();
            toast(successMessage);
        } catch (error) {
            toast(error?.message || error, true);
            await reloadConflict(error);
        } finally {
            if (button) button.disabled = false;
        }
    }

    function closeModal(force = false) {
        if (!force && S.modalDirty && !confirm("Chiudere senza salvare le modifiche?")) return;
        S.modal = null;
        S.modalDirty = false;
        modalRoot.innerHTML = "";
        document.body.classList.remove("calendar-modal-open");
    }

    async function reloadConflict(error) {
        if (!/409|conflitt|cambiat|modificat/i.test(String(error?.message || ""))) return;
        try {
            consume(await API.load());
            render();
        } catch (_) {}
    }

    function readMoment(data, prefix, allDay) {
        return {
            date: {
                year: Number(data.get(`${prefix}Year`)),
                monthId: String(data.get(`${prefix}Month`) || ""),
                day: Number(data.get(`${prefix}Day`))
            },
            time: allDay ? null : {
                hour: Number(data.get(`${prefix}Hour`)),
                minute: Number(data.get(`${prefix}Minute`))
            }
        };
    }

    function visibilityOptions(selected, isDm) {
        const allowed = isDm ? ["public", "players", "dm", "owner"] : ["owner", "players"];
        return allowed.map((key) => `<option value="${key}" ${selected === key ? "selected" : ""}>${esc(VISIBILITY[key][0])}</option>`).join("");
    }

    function parseRows(value, mapper) {
        return String(value || "").split(/\r?\n/).map((line) => line.split("|").map((part) => part.trim())).filter((parts) => parts[0]).slice(0, 48).map(mapper);
    }

    function parseQuickSteps(value) {
        return String(value || "").split(/[,;]+/).map((entry) => {
            const match = entry.trim().match(/^([+-]?\d+)\s*([mhd])$/i);
            if (!match) return null;
            return {
                amount: Number(match[1]),
                unit: match[2].toLowerCase() === "h" ? "hour" : match[2].toLowerCase() === "d" ? "day" : "minute"
            };
        }).filter(Boolean).slice(0, 10);
    }

    function shortStep(step) {
        return `${step.amount >= 0 ? "+" : ""}${step.amount}${step.unit === "hour" ? "h" : step.unit === "day" ? "d" : "m"}`;
    }

    function stepLabel(step) {
        const amount = Number(step.amount || 0);
        const absolute = Math.abs(amount);
        const unit = step.unit === "hour" ? (absolute === 1 ? "ora" : "ore") : step.unit === "day" ? (absolute === 1 ? "giorno" : "giorni") : "min";
        return `${amount >= 0 ? "+" : "-"}${absolute} ${unit}`;
    }

    function canCreateEntry() {
        return Boolean(S.permissions.canCreateNote || S.permissions.canEdit);
    }

    function createEntryLabel() {
        return S.permissions.canEdit ? "Aggiungi evento" : S.permissions.canCreateNote ? "Aggiungi nota" : "Aggiungi evento";
    }

    function renderCreateButton(context) {
        const allowed = canCreateEntry();
        const classes = [context === "toolbar" ? "is-primary" : "calendar-add-day", allowed ? "" : "is-locked"].filter(Boolean).join(" ");
        const action = allowed ? "new-event" : "write-help";
        const icon = allowed ? "fa-plus" : "fa-lock";
        const title = allowed ? createEntryLabel() : writeHelpMessage();
        return `<button class="${classes}" data-action="${action}" title="${attr(title)}"><i class="fa-solid ${icon}"></i><span>${esc(createEntryLabel())}</span></button>`;
    }

    function renderEmptyDay() {
        const message = canCreateEntry()
            ? `Premi "${createEntryLabel()}" per iniziare.`
            : writeHelpMessage();
        return `<div class="calendar-empty"><i class="fa-regular fa-calendar"></i><strong>Una pagina ancora vuota</strong><span>${esc(message)}</span></div>`;
    }

    function writeHelpMessage() {
        if (!S.permissions.authenticated) return "Accedi per aggiungere una nota al calendario.";
        if (S.source === "static") return "Calendario in sola lettura: il Worker v2 non \u00e8 ancora disponibile.";
        return "Il tuo account non ha permessi di scrittura in questa campagna.";
    }

    function showWriteHelp() {
        toast(writeHelpMessage(), true);
    }

    function monthName(monthId) {
        return S.definition.months.find((month) => month.id === monthId)?.name || monthId;
    }

    function sameDate(left, right) {
        return Boolean(left && right && left.year === right.year && left.monthId === right.monthId && left.day === right.day);
    }

    function toast(message, error = false) {
        const container = document.getElementById("calendar-toasts");
        if (!container) return;
        const node = document.createElement("div");
        node.className = `calendar-toast ${error ? "is-error" : "is-success"}`;
        node.innerHTML = `<i class="fa-solid ${error ? "fa-triangle-exclamation" : "fa-check"}"></i><span>${esc(message)}</span>`;
        container.append(node);
        requestAnimationFrame(() => node.classList.add("is-visible"));
        setTimeout(() => {
            node.classList.remove("is-visible");
            setTimeout(() => node.remove(), 220);
        }, 4200);
    }

    function block(value) {
        return esc(value).replace(/\n/g, "<br>");
    }

    function esc(value) {
        return window.CriptaApp.utils.escapeHtml(String(value ?? ""));
    }

    function attr(value) {
        return esc(value).replace(/"/g, "&quot;");
    }
})();
