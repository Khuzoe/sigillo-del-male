(() => {
  "use strict";

  const S = {
    data: null,
    search: "",
    year: "",
    status: "",
    expanded: new Set(),
    editor: null,
    draftTimer: 0
  };
  const R = {};

  function esc(value) {
    const helper = window.CriptaApp?.utils?.escapeHtml;
    if (typeof helper === "function") return helper(String(value ?? ""));
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function cache() {
    const ids = [
      "sessions-summary", "next-session-container", "sessions-search", "sessions-year-filter",
      "sessions-status-filter", "sessions-status-wrap", "sessions-new", "sessions-state",
      "sessions-content", "sessions-spotlight-section", "sessions-spotlight",
      "sessions-journal-section", "sessions-grid", "sessions-count", "sessions-empty",
      "session-editor-root", "sessions-toasts"
    ];
    ids.forEach((id) => { R[id] = document.getElementById(id); });
  }

  function toast(message, type, duration) {
    const root = R["sessions-toasts"];
    if (!root) return;
    const node = document.createElement("div");
    node.className = "sessions-toast sessions-toast--" + (type || "info");
    node.innerHTML = '<i class="fa-solid ' + (type === "error" ? "fa-triangle-exclamation" : type === "success" ? "fa-circle-check" : "fa-circle-info") + '"></i><span>' + esc(message) + "</span>";
    root.appendChild(node);
    window.setTimeout(() => node.classList.add("sessions-toast--visible"), 20);
    window.setTimeout(() => {
      node.classList.remove("sessions-toast--visible");
      window.setTimeout(() => node.remove(), 260);
    }, duration || 4200);
  }

  function compareSessions(a, b) {
    const byDate = String(b?.date || "").localeCompare(String(a?.date || ""));
    return byDate || Number(b?.number || 0) - Number(a?.number || 0);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("it-IT").format(Math.max(0, Number(value || 0) || 0));
  }

  function statusBadge(session) {
    if (!S.data?.canEdit) return "";
    const label = window.CriptaSessions.STATUS_LABELS[session.status] || session.status;
    return '<span class="session-status session-status--' + esc(session.status) + '">' + esc(label) + "</span>";
  }

  function visibilityBadge(session) {
    if (!S.data?.canEdit || session.visibility === "public") return "";
    const label = window.CriptaSessions.VISIBILITY_LABELS[session.visibility] || session.visibility;
    return '<span class="session-visibility"><i class="fa-solid fa-eye-slash"></i>' + esc(label) + "</span>";
  }

  function participantChips(session) {
    const refs = Array.isArray(session.participants) ? session.participants : [];
    if (!refs.length) return "";
    const chips = refs.slice(0, 8).map((ref) => {
      const icon = ref.type === "player" ? "fa-shield-halved" : "fa-mask";
      return '<span class="session-person session-person--' + esc(ref.type) + '"><i class="fa-solid ' + icon + '"></i>' + esc(ref.name) + "</span>";
    }).join("");
    return '<div class="session-people">' + chips + (refs.length > 8 ? '<span class="session-person">+' + (refs.length - 8) + "</span>" : "") + "</div>";
  }

  function eventHtml(event, compact) {
    const meta = window.CriptaSessions.EVENT_TYPES[event.type] || window.CriptaSessions.EVENT_TYPES.event;
    return '<article class="session-event session-event--' + esc(event.type) + '">' +
      '<span class="session-event__icon"><i class="fa-solid ' + esc(meta.icon) + '"></i></span>' +
      '<div class="session-event__copy"><span class="session-event__type">' + esc(meta.label) + "</span>" +
      "<h4>" + esc(event.title || meta.label) + "</h4>" +
      '<p class="' + (compact ? "session-event__text--clamp" : "") + '">' + esc(event.text) + "</p></div></article>";
  }

  function xpHtml(session) {
    const xp = session.xp || { total: 0, each: 0, bonus: [] };
    const bonus = Array.isArray(xp.bonus) ? xp.bonus : [];
    return '<div class="session-xp">' +
      '<span class="session-xp__icon"><i class="fa-solid fa-star"></i></span>' +
      '<span><strong>' + formatNumber(xp.total) + " XP</strong><small>" + formatNumber(xp.each) + " a testa</small></span>" +
      (bonus.length ? '<span class="session-xp__bonus">' + bonus.map((item) => esc(item.name) + " +" + formatNumber(item.amount)).join(" · ") + "</span>" : "") +
      "</div>";
  }

  function detailList(icon, title, values, css) {
    const rows = (Array.isArray(values) ? values : []).filter(Boolean);
    if (!rows.length) return "";
    return '<section class="session-detail session-detail--' + css + '"><h4><i class="fa-solid ' + icon + '"></i>' + esc(title) + "</h4><ul>" +
      rows.map((entry) => "<li>" + esc(entry) + "</li>").join("") + "</ul></section>";
  }

  function relationSummary(session) {
    const links = session.links || {};
    const total = ["missions", "items", "locations"].reduce((sum, key) => sum + (Array.isArray(links[key]) ? links[key].length : 0), 0);
    if (!total) return "";
    return '<span class="session-link-count"><i class="fa-solid fa-link"></i>' + total + " collegament" + (total === 1 ? "o" : "i") + "</span>";
  }

  function cardHtml(session, spotlight) {
    const expanded = spotlight || S.expanded.has(session.id);
    const events = Array.isArray(session.events) ? session.events : [];
    const shown = expanded ? events : events.slice(0, 2);
    const title = session.title || "Sessione " + session.number;
    const teaser = session.teaser || events[0]?.text || "";
    return '<article class="session-card ' + (spotlight ? "session-card--spotlight " : "") + (expanded ? "session-card--expanded" : "") + '" id="session-' + esc(session.number) + '" data-session="' + esc(session.id) + '">' +
      '<div class="session-card__rail"><span>' + esc(session.number) + "</span></div>" +
      '<header class="session-card__header"><div class="session-card__identity">' +
      '<span class="session-card__chapter">Sessione ' + esc(session.number) + "</span>" +
      "<h3>" + esc(title) + "</h3>" +
      '<div class="session-card__meta"><time datetime="' + esc(session.date) + '"><i class="fa-regular fa-calendar"></i>' + esc(session.dateLabel || window.CriptaSessions.dateLabel(session.date)) + "</time>" +
      statusBadge(session) + visibilityBadge(session) + relationSummary(session) + "</div></div>" +
      '<div class="session-card__actions">' +
      (S.data?.canEdit ? '<button type="button" data-action="edit" data-session="' + esc(session.id) + '" aria-label="Modifica sessione"><i class="fa-solid fa-pen"></i></button>' : "") +
      (!spotlight ? '<button type="button" data-action="toggle" data-session="' + esc(session.id) + '" aria-expanded="' + (expanded ? "true" : "false") + '"><i class="fa-solid fa-chevron-' + (expanded ? "up" : "down") + '"></i></button>' : "") +
      "</div></header>" +
      (!expanded && teaser ? '<p class="session-card__teaser">' + esc(teaser) + "</p>" : "") +
      participantChips(session) +
      '<div class="session-events">' + shown.map((event) => eventHtml(event, !expanded)).join("") + "</div>" +
      (!expanded && events.length > shown.length ? '<button class="session-more" type="button" data-action="toggle" data-session="' + esc(session.id) + '">Altri ' + (events.length - shown.length) + ' momenti <i class="fa-solid fa-arrow-right"></i></button>' : "") +
      (expanded ? '<div class="session-details">' +
        detailList("fa-gem", "Bottino e ricompense", session.loot, "loot") +
        detailList("fa-bolt", "Conseguenze", session.consequences, "consequences") +
        "</div>" : "") +
      '<footer class="session-card__footer">' + xpHtml(session) +
      (session.levelUp ? '<span class="session-milestone"><i class="fa-solid fa-arrow-trend-up"></i>Livello ' + esc(session.levelUp) + "</span>" : "") +
      (session.skillPoint ? '<span class="session-milestone"><i class="fa-solid fa-wand-sparkles"></i>+1 punto abilità</span>' : "") +
      "</footer></article>";
  }

  function corpus(session) {
    return [
      session.title, session.teaser, session.dateLabel,
      ...(session.events || []).flatMap((event) => [event.title, event.text]),
      ...(session.loot || []), ...(session.consequences || []),
      ...(session.participants || []).map((ref) => ref.name),
      ...Object.values(session.links || {}).flat().map((ref) => ref.name)
    ].join(" ").toLocaleLowerCase("it");
  }

  function filteredSessions() {
    const query = S.search.trim().toLocaleLowerCase("it");
    return (S.data?.sessions || []).filter((session) => {
      if (S.year && !session.date.startsWith(S.year + "-")) return false;
      if (S.status && session.status !== S.status) return false;
      return !query || corpus(session).includes(query);
    }).sort(compareSessions);
  }

  function renderSummary() {
    const sessions = (S.data?.sessions || []).filter((entry) => entry.status === "published");
    const totalXp = sessions.reduce((sum, entry) => sum + Math.max(0, Number(entry.xp?.total || 0) || 0), 0);
    const latest = sessions.slice().sort(compareSessions)[0];
    const rows = [
      ["fa-book-open", sessions.length, "sessioni"],
      ["fa-star", formatNumber(totalXp), "XP narrati"],
      ["fa-feather-pointed", latest ? "#" + latest.number : "-", "ultimo capitolo"]
    ];
    R["sessions-summary"].innerHTML = rows.map((item) => '<div class="sessions-summary__item"><i class="fa-solid ' + item[0] + '"></i><span><strong>' + esc(item[1]) + "</strong><small>" + esc(item[2]) + "</small></span></div>").join("");
  }

  function renderYears() {
    const years = [...new Set((S.data?.sessions || []).map((entry) => entry.date.slice(0, 4)).filter(Boolean))].sort().reverse();
    const select = R["sessions-year-filter"];
    const current = select.value;
    select.innerHTML = '<option value="">Tutti gli anni</option>' + years.map((year) => '<option value="' + esc(year) + '">' + esc(year) + "</option>").join("");
    select.value = years.includes(current) ? current : "";
  }

  function render() {
    const sessions = filteredSessions();
    renderSummary();
    renderYears();
    R["sessions-new"].hidden = !S.data?.canEdit;
    R["sessions-status-wrap"].hidden = !S.data?.canEdit;
    R["sessions-state"].hidden = true;
    R["sessions-content"].hidden = false;

    const latestIndex = sessions.findIndex((session) => session.status === "published");
    const latest = latestIndex >= 0 ? sessions[latestIndex] : sessions[0];
    const rest = latest ? sessions.filter((session) => session.id !== latest.id) : [];

    R["sessions-spotlight-section"].hidden = !latest;
    R["sessions-spotlight"].innerHTML = latest ? cardHtml(latest, true) : "";
    R["sessions-journal-section"].hidden = !rest.length;
    R["sessions-grid"].innerHTML = rest.map((session) => cardHtml(session, false)).join("");
    R["sessions-count"].textContent = rest.length + " capitol" + (rest.length === 1 ? "o" : "i");
    R["sessions-empty"].hidden = Boolean(sessions.length);
  }

  function showError(error) {
    const state = R["sessions-state"];
    state.hidden = false;
    R["sessions-content"].hidden = true;
    state.className = "sessions-state sessions-state--error";
    state.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i><span>' + esc(error?.message || "Impossibile aprire il diario.") + '</span><button type="button" data-action="reload">Riprova</button>';
  }

  async function loadPlanning() {
    const root = R["next-session-container"];
    if (!root) return;
    try {
      const fallback = window.CriptaApp?.urls?.data?.("next-session.json") || "../assets/data/next-session.json";
      const config = window.CriptaNextSession?.loadConfig ? await window.CriptaNextSession.loadConfig({ fallbackPath: fallback }) : null;
      if (config) window.CriptaNextSession?.render(config, root);
      else root.closest(".sessions-planning")?.setAttribute("hidden", "");
    } catch (error) {
      console.info("Prossima sessione non disponibile.", error);
      root.closest(".sessions-planning")?.setAttribute("hidden", "");
    }
  }

  function draftKey(id) {
    const campaign = window.CriptaApp?.campaigns?.currentId?.() || "cripta-di-sangue";
    return "cripta:session-draft:" + campaign + ":" + id;
  }

  function snapshot(value) {
    const comparable = window.CriptaSessions.clone(value);
    delete comparable.summary;
    delete comparable.updatedAt;
    delete comparable.updatedBy;
    return JSON.stringify(comparable);
  }

  function dirty() {
    return Boolean(S.editor && snapshot(S.editor.draft) !== S.editor.baseline);
  }

  function saveLocalDraft() {
    if (!S.editor || !dirty()) return;
    try {
      localStorage.setItem(draftKey(S.editor.draft.id), JSON.stringify({ savedAt: new Date().toISOString(), draft: S.editor.draft }));
    } catch (_) {}
  }

  function clearLocalDraft(id) {
    try { localStorage.removeItem(draftKey(id)); } catch (_) {}
  }

  function scheduleDraft() {
    clearTimeout(S.draftTimer);
    S.draftTimer = window.setTimeout(saveLocalDraft, 450);
  }

  function parseLines(value) {
    return String(value || "").split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  }

  function optionsHtml(options, selected) {
    return Object.entries(options).map((entry) => '<option value="' + esc(entry[0]) + '"' + (entry[0] === selected ? " selected" : "") + ">" + esc(entry[1].label || entry[1]) + "</option>").join("");
  }

  function relationKey(ref) {
    return ref.type + ":" + ref.id;
  }

  function selectedKeys(refs) {
    return new Set((refs || []).map(relationKey));
  }

  function relationChecklist(title, icon, name, values, selected) {
    const rows = Array.isArray(values) ? values : [];
    if (!rows.length) return "";
    const items = rows.map((ref) => {
      const key = relationKey(ref);
      const iconClass = ref.type === "player" ? "fa-shield-halved" : ref.type === "npc" ? "fa-mask" : "fa-link";
      return '<label data-relation-name="' + esc(ref.name.toLowerCase()) + '"><input type="checkbox" name="' + esc(name) + '" value="' + esc(key) + '"' + (selected.has(key) ? " checked" : "") + '><span><i class="fa-solid ' + iconClass + '"></i>' + esc(ref.name) + "</span></label>";
    }).join("");
    return '<details class="session-relations" open><summary><span><i class="fa-solid ' + icon + '"></i>' + esc(title) + '</span><small>' + rows.length + "</small></summary>" +
      '<label class="session-relations__search"><i class="fa-solid fa-magnifying-glass"></i><input type="search" placeholder="Filtra..." data-relation-filter="' + esc(name) + '"></label>' +
      '<div class="session-relations__grid" data-relation-list="' + esc(name) + '">' + items + "</div></details>";
  }

  function eventEditorHtml(event, index, events) {
    const total = events.length;
    return '<article class="session-event-editor" data-event-editor="' + esc(event.id) + '">' +
      '<header><span class="session-event-editor__index">' + (index + 1) + '</span><strong>' + esc(event.title || "Nuovo momento") + '</strong><div>' +
      '<button type="button" data-editor-action="up" data-event="' + esc(event.id) + '"' + (index === 0 ? " disabled" : "") + ' aria-label="Sposta su"><i class="fa-solid fa-arrow-up"></i></button>' +
      '<button type="button" data-editor-action="down" data-event="' + esc(event.id) + '"' + (index === total - 1 ? " disabled" : "") + ' aria-label="Sposta giù"><i class="fa-solid fa-arrow-down"></i></button>' +
      '<button type="button" data-editor-action="remove" data-event="' + esc(event.id) + '" aria-label="Rimuovi"><i class="fa-solid fa-trash"></i></button></div></header>' +
      '<div class="session-event-editor__fields"><label><span>Tipo</span><select data-event-field="type">' + optionsHtml(window.CriptaSessions.EVENT_TYPES, event.type) + '</select></label>' +
      '<label><span>Visibilità</span><select data-event-field="visibility"><option value="public"' + (event.visibility !== "dm" ? " selected" : "") + '>Pubblica</option><option value="dm"' + (event.visibility === "dm" ? " selected" : "") + ">Solo DM</option></select></label>" +
      '<label class="session-field--wide"><span>Titolo del momento</span><input data-event-field="title" value="' + esc(event.title) + '" placeholder="Es. Il patto di Zara"></label>' +
      '<label class="session-field--wide"><span>Racconto</span><textarea data-event-field="text" rows="4" placeholder="Che cosa è successo?">' + esc(event.text) + "</textarea></label></div></article>";
  }

  function editorHtml(session) {
    const directory = S.data?.directory || {};
    const selectedParticipants = selectedKeys(session.participants);
    const links = session.links || {};
    const bonusText = (session.xp?.bonus || []).map((entry) => entry.name + " | " + entry.amount).join("\n");
    const partyText = (session.partyChanges || []).map((entry) => (entry.type === "out" ? "esce" : "entra") + " | " + entry.name).join("\n");
    return '<div class="session-editor-backdrop"><section class="session-editor" role="dialog" aria-modal="true" aria-labelledby="session-editor-title">' +
      '<header class="session-editor__header"><div><span>Diario della campagna</span><h2 id="session-editor-title">' + esc(session.title) + '</h2><small data-save-state><i class="fa-solid fa-check"></i> Tutto salvato</small></div><button type="button" data-editor-action="close" aria-label="Chiudi"><i class="fa-solid fa-xmark"></i></button></header>' +
      '<div class="session-editor__body">' +
      '<section class="session-editor-panel session-editor-panel--identity"><div class="session-editor-panel__heading"><span><i class="fa-solid fa-book-open"></i></span><div><small>Identità</small><h3>Il capitolo</h3></div></div><div class="session-form-grid">' +
      '<label><span>Numero</span><input type="number" min="0" name="session-number" value="' + esc(session.number) + '"></label>' +
      '<label><span>Data</span><input type="date" name="session-date" value="' + esc(session.date) + '"></label>' +
      '<label><span>Stato</span><select name="session-status">' + optionsHtml(window.CriptaSessions.STATUS_LABELS, session.status) + "</select></label>" +
      '<label><span>Visibilità</span><select name="session-visibility">' + optionsHtml(window.CriptaSessions.VISIBILITY_LABELS, session.visibility) + "</select></label>" +
      '<label class="session-field--wide"><span>Titolo</span><input name="session-title" value="' + esc(session.title) + '" placeholder="Titolo della sessione"></label>' +
      '<label class="session-field--wide"><span>Anteprima breve</span><textarea name="session-teaser" rows="2" placeholder="Una frase che introduce il capitolo...">' + esc(session.teaser) + "</textarea></label></div></section>" +
      '<section class="session-editor-panel"><div class="session-editor-panel__heading"><span><i class="fa-solid fa-feather-pointed"></i></span><div><small>Cronaca</small><h3>Momenti della sessione</h3></div><button type="button" data-editor-action="add-event"><i class="fa-solid fa-plus"></i>Aggiungi momento</button></div><div class="session-events-editor">' +
      (session.events || []).map(eventEditorHtml).join("") + "</div></section>" +
      '<section class="session-editor-panel"><div class="session-editor-panel__heading"><span><i class="fa-solid fa-trophy"></i></span><div><small>Esito</small><h3>Progressi e conseguenze</h3></div></div><div class="session-form-grid">' +
      '<label><span>XP totali</span><input type="number" min="0" name="session-xp-total" value="' + esc(session.xp?.total || 0) + '"></label>' +
      '<label><span>XP a testa</span><input type="number" min="0" name="session-xp-each" value="' + esc(session.xp?.each || 0) + '"></label>' +
      '<label><span>Livello ottenuto</span><input name="session-level" value="' + esc(session.levelUp) + '" placeholder="Facoltativo"></label>' +
      '<label class="session-check"><input type="checkbox" name="session-skill-point"' + (session.skillPoint ? " checked" : "") + '><span>+1 punto abilità</span></label>' +
      '<label class="session-field--wide"><span>Bonus individuali <small>Nome | XP, uno per riga</small></span><textarea name="session-xp-bonus" rows="3">' + esc(bonusText) + "</textarea></label>" +
      '<label class="session-field--wide"><span>Bottino e ricompense <small>Una voce per riga</small></span><textarea name="session-loot" rows="4">' + esc((session.loot || []).join("\n")) + "</textarea></label>" +
      '<label class="session-field--wide"><span>Conseguenze <small>Una voce per riga</small></span><textarea name="session-consequences" rows="4">' + esc((session.consequences || []).join("\n")) + "</textarea></label>" +
      '<label class="session-field--wide"><span>Cambi nel gruppo <small>entra/esce | Nome</small></span><textarea name="session-party" rows="3">' + esc(partyText) + "</textarea></label></div></section>" +
      '<section class="session-editor-panel"><div class="session-editor-panel__heading"><span><i class="fa-solid fa-link"></i></span><div><small>Relazioni</small><h3>Collegamenti della campagna</h3></div></div><div class="session-relations-layout">' +
      relationChecklist("Personaggi e NPC", "fa-users", "session-participant", directory.participants, selectedParticipants) +
      relationChecklist("Missioni", "fa-compass", "session-mission", directory.missions, selectedKeys(links.missions)) +
      relationChecklist("Oggetti", "fa-gem", "session-item", directory.items, selectedKeys(links.items)) +
      relationChecklist("Luoghi", "fa-map-location-dot", "session-location", directory.locations, selectedKeys(links.locations)) +
      "</div></section>" +
      '<section class="session-editor-panel session-editor-panel--dm"><div class="session-editor-panel__heading"><span><i class="fa-solid fa-user-secret"></i></span><div><small>Privato</small><h3>Note del DM</h3></div></div><label><textarea name="session-dm-notes" rows="6" placeholder="Appunti, retroscena e promemoria non visibili ai giocatori...">' + esc(session.dmNotes) + "</textarea></label></section>" +
      '</div><footer class="session-editor__footer"><button type="button" class="session-editor__archive" data-editor-action="archive"><i class="fa-solid fa-box-archive"></i>' + (session.status === "archived" ? "Ripristina come bozza" : "Archivia") + '</button><div><button type="button" data-editor-action="close">Annulla</button><button type="button" class="session-editor__save" data-editor-action="save"><i class="fa-solid fa-floppy-disk"></i>Salva sessione</button></div></footer></section></div>';
  }

  function directoryMap() {
    const directory = S.data?.directory || {};
    const map = new Map();
    ["participants", "missions", "items", "locations"].forEach((key) => (directory[key] || []).forEach((ref) => map.set(relationKey(ref), ref)));
    return map;
  }

  function collectEditor() {
    if (!S.editor) return;
    const root = R["session-editor-root"];
    const draft = S.editor.draft;
    const value = (selector) => root.querySelector(selector)?.value ?? "";
    draft.number = Math.max(0, Number(value('[name="session-number"]')) || 0);
    draft.date = value('[name="session-date"]');
    draft.dateLabel = window.CriptaSessions.dateLabel(draft.date);
    draft.title = value('[name="session-title"]').trim() || "Sessione " + draft.number;
    draft.status = value('[name="session-status"]') || "draft";
    draft.visibility = value('[name="session-visibility"]') || "dm";
    draft.teaser = value('[name="session-teaser"]').trim();
    draft.events = [...root.querySelectorAll("[data-event-editor]")].map((card) => {
      const event = (draft.events || []).find((entry) => entry.id === card.dataset.eventEditor) || window.CriptaSessions.createEvent(draft.id);
      const field = (name) => card.querySelector('[data-event-field="' + name + '"]')?.value ?? "";
      return { ...event, type: field("type"), visibility: field("visibility"), title: field("title").trim() || "Nuovo momento", text: field("text").trim() };
    });
    draft.summary = draft.events.map((event) => "<p>" + esc(event.text) + "</p>").join("");
    draft.xp = {
      total: Math.max(0, Number(value('[name="session-xp-total"]')) || 0),
      each: Math.max(0, Number(value('[name="session-xp-each"]')) || 0),
      bonus: parseLines(value('[name="session-xp-bonus"]')).map((line) => {
        const parts = line.split("|");
        return { name: (parts[0] || "").trim(), amount: Math.max(0, Number(parts[1] || 0) || 0) };
      }).filter((entry) => entry.name)
    };
    draft.levelUp = value('[name="session-level"]').trim();
    draft.skillPoint = Boolean(root.querySelector('[name="session-skill-point"]')?.checked);
    draft.loot = parseLines(value('[name="session-loot"]'));
    draft.consequences = parseLines(value('[name="session-consequences"]'));
    draft.partyChanges = parseLines(value('[name="session-party"]')).map((line) => {
      const parts = line.split("|");
      return { type: (parts[0] || "").trim().toLowerCase() === "esce" ? "out" : "in", name: (parts[1] || parts[0] || "").trim() };
    }).filter((entry) => entry.name);
    draft.dmNotes = value('[name="session-dm-notes"]').trim();
    const refs = directoryMap();
    const checked = (name, current) => {
      const selected = [...root.querySelectorAll('[name="' + name + '"]:checked')].map((input) => refs.get(input.value)).filter(Boolean);
      const unavailable = (current || []).filter((ref) => !refs.has(relationKey(ref)));
      return [...selected, ...unavailable];
    };
    const currentLinks = draft.links || {};
    draft.participants = checked("session-participant", draft.participants);
    draft.links = {
      missions: checked("session-mission", currentLinks.missions),
      items: checked("session-item", currentLinks.items),
      locations: checked("session-location", currentLinks.locations)
    };
    const state = root.querySelector("[data-save-state]");
    if (state) state.innerHTML = dirty() ? '<i class="fa-solid fa-circle"></i> Modifiche non salvate' : '<i class="fa-solid fa-check"></i> Tutto salvato';
    const heading = root.querySelector("#session-editor-title");
    if (heading) heading.textContent = draft.title;
  }

  function renderEditor(preserveScroll) {
    const root = R["session-editor-root"];
    if (!S.editor) {
      root.innerHTML = "";
      document.body.classList.remove("session-editor-open");
      return;
    }
    const oldBody = root.querySelector(".session-editor__body");
    const scroll = preserveScroll ? oldBody?.scrollTop || 0 : 0;
    root.innerHTML = editorHtml(S.editor.draft);
    document.body.classList.add("session-editor-open");
    const body = root.querySelector(".session-editor__body");
    if (body) body.scrollTop = scroll;
  }

  async function openEditor(session) {
    if (!S.data?.directoryLoaded) {
      try {
        S.data.directory = await window.CriptaSessions.loadDirectory();
      } catch (error) {
        console.info("Collegamenti della campagna non disponibili; l'editor resta utilizzabile.", error);
        S.data.directory = { participants: [], missions: [], items: [], locations: [] };
      }
      S.data.directoryLoaded = true;
    }
    const draft = window.CriptaSessions.clone(session);
    try {
      const local = JSON.parse(localStorage.getItem(draftKey(draft.id)) || "null");
      if (local?.draft && snapshot(local.draft) !== snapshot(draft)) {
        if (confirm("È disponibile una bozza locale più recente. Vuoi ripristinarla?")) Object.assign(draft, local.draft);
        else clearLocalDraft(draft.id);
      }
    } catch (_) {}
    S.editor = { draft, baseline: snapshot(session), saving: false };
    renderEditor(false);
    window.setTimeout(() => R["session-editor-root"].querySelector('[name="session-title"]')?.focus(), 30);
  }

  function closeEditor(force) {
    if (!S.editor) return;
    collectEditor();
    if (!force && dirty() && !confirm("Hai modifiche non salvate. Vuoi chiudere? La bozza resterà disponibile su questo dispositivo.")) return;
    if (dirty()) saveLocalDraft();
    else clearLocalDraft(S.editor.draft.id);
    S.editor = null;
    renderEditor(false);
  }

  function mutateEvent(action, id) {
    collectEditor();
    const events = S.editor.draft.events || [];
    if (action === "add-event") events.push(window.CriptaSessions.createEvent(S.editor.draft.id));
    else {
      const index = events.findIndex((entry) => entry.id === id);
      if (index < 0) return;
      if (action === "remove" && events.length > 1) events.splice(index, 1);
      if (action === "up" && index > 0) [events[index - 1], events[index]] = [events[index], events[index - 1]];
      if (action === "down" && index < events.length - 1) [events[index + 1], events[index]] = [events[index], events[index + 1]];
    }
    S.editor.draft.events = events;
    scheduleDraft();
    renderEditor(true);
  }

  async function ensureBootstrap() {
    if (S.data?.needsBootstrap) S.data = await window.CriptaSessions.bootstrap(S.data);
  }

  async function saveEditor() {
    if (!S.editor || S.editor.saving) return;
    collectEditor();
    const editor = S.editor;
    editor.saving = true;
    R["session-editor-root"].querySelector(".session-editor__save")?.setAttribute("disabled", "");
    try {
      await ensureBootstrap();
      const current = (S.data.sessions || []).find((entry) => entry.id === editor.draft.id);
      const expectedRevision = Number(current?.revision ?? editor.draft.revision ?? 0) || 0;
      const result = await window.CriptaSessions.upsert(editor.draft, expectedRevision);
      if (!result?.session) throw new Error("Il Worker non ha restituito la sessione salvata.");
      const normalized = window.CriptaSessions.normalize(result.session, 0);
      const index = S.data.sessions.findIndex((entry) => entry.id === normalized.id);
      if (index >= 0) S.data.sessions[index] = normalized;
      else S.data.sessions.push(normalized);
      S.data.version = Number(result.version || S.data.version);
      clearLocalDraft(editor.draft.id);
      S.editor = null;
      renderEditor(false);
      window.CriptaApp?.api?.clearCache?.("api/session-journal");
      render();
      toast("Sessione salvata.", "success");
    } catch (error) {
      editor.saving = false;
      R["session-editor-root"].querySelector(".session-editor__save")?.removeAttribute("disabled");
      saveLocalDraft();
      console.error(error);
      toast(error.message || "Salvataggio fallito. La bozza locale è al sicuro.", "error", 7000);
    }
  }

  function handleEditorAction(button) {
    const action = button.dataset.editorAction;
    if (action === "close") return closeEditor(false);
    if (action === "save") return saveEditor();
    if (action === "archive") {
      collectEditor();
      S.editor.draft.status = S.editor.draft.status === "archived" ? "draft" : "archived";
      scheduleDraft();
      return renderEditor(true);
    }
    return mutateEvent(action, button.dataset.event || "");
  }

  function bind(scope) {
    scope.listen(document, "click", (event) => {
      const editorButton = event.target.closest("[data-editor-action]");
      if (editorButton && R["session-editor-root"].contains(editorButton)) {
        event.preventDefault();
        handleEditorAction(editorButton);
        return;
      }
      if (event.target.classList.contains("session-editor-backdrop")) {
        closeEditor(false);
        return;
      }
      const button = event.target.closest("[data-action]");
      if (!button) return;
      const action = button.dataset.action;
      if (action === "reload") return init(true);
      if (action === "toggle") {
        const id = button.dataset.session;
        if (S.expanded.has(id)) S.expanded.delete(id);
        else S.expanded.add(id);
        render();
      }
      if (action === "edit") {
        const session = (S.data?.sessions || []).find((entry) => entry.id === button.dataset.session);
        if (session) openEditor(session);
      }
    });
    scope.listen(R["sessions-search"], "input", (event) => { S.search = event.target.value || ""; render(); });
    scope.listen(R["sessions-year-filter"], "change", (event) => { S.year = event.target.value || ""; render(); });
    scope.listen(R["sessions-status-filter"], "change", (event) => { S.status = event.target.value || ""; render(); });
    scope.listen(R["sessions-new"], "click", () => openEditor(window.CriptaSessions.createSession(S.data?.sessions || [])));
    scope.listen(R["session-editor-root"], "input", (event) => {
      if (!S.editor) return;
      if (event.target.matches("[data-relation-filter]")) {
        const list = R["session-editor-root"].querySelector('[data-relation-list="' + event.target.dataset.relationFilter + '"]');
        const query = event.target.value.trim().toLowerCase();
        list?.querySelectorAll("[data-relation-name]").forEach((row) => { row.hidden = Boolean(query && !row.dataset.relationName.includes(query)); });
        return;
      }
      collectEditor();
      scheduleDraft();
    });
    scope.listen(R["session-editor-root"], "change", () => {
      if (S.editor) {
        collectEditor();
        scheduleDraft();
      }
    });
    scope.listen(document, "keydown", (event) => {
      if (event.key === "Escape" && S.editor) {
        event.preventDefault();
        closeEditor(false);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && S.editor) {
        event.preventDefault();
        saveEditor();
      }
    });
    window.CriptaApp?.navigation?.addLeaveGuard?.("sessions-editor", () => {
      if (!S.editor) return null;
      collectEditor();
      if (!dirty()) return null;
      return {
        active: true,
        message: "Hai modifiche non salvate nella sessione. La bozza locale verrà conservata: continuare?",
        discard: saveLocalDraft
      };
    });
  }

  async function init(force) {
    const state = R["sessions-state"];
    state.hidden = false;
    state.className = "sessions-state";
    state.innerHTML = '<span class="sessions-state__spinner" aria-hidden="true"></span><span>Sto aprendo le cronache...</span>';
    R["sessions-content"].hidden = true;
    try {
      S.data = await window.CriptaSessions.load({ force: Boolean(force) });
      S.expanded.clear();
      render();
      if (S.data.needsBootstrap && S.data.canEdit && S.data.bootstrapAvailable) {
        try {
          S.data = await window.CriptaSessions.bootstrap(S.data);
          render();
          toast("Il nuovo diario è stato creato come copia. I dati precedenti sono rimasti intatti.", "success", 6000);
        } catch (error) {
          console.info("Inizializzazione del diario rimandata; il fallback statico resta attivo.", error);
        }
      }
    } catch (error) {
      console.error(error);
      showError(error);
    }
  }

  window.CriptaApp.onPageReady("sessioni", () => {
    const scope = window.CriptaApp.createPageScope("sessioni");
    cache();
    bind(scope);
    loadPlanning();
    init(false);
  });
})();
