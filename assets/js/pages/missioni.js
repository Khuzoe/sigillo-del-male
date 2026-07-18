(() => {
  "use strict";
  const M = window.CriptaMissions;
  if (!M) {
    console.error("Missioni: servizio non disponibile.");
    return;
  }
  const S = { data: null, search: "", type: "", status: "", expanded: /* @__PURE__ */ new Set(), pending: /* @__PURE__ */ new Set(), editor: null, queue: Promise.resolve(), draftTimer: 0 };
  const R = {};
  const esc = (v) => window.CriptaApp?.utils?.escapeHtml?.(v) ?? String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
  const block = (v) => esc(v).replace(/\n/g, "<br>");
  const image = (path, fallback = "assets/img/ui/tab_icon.webp") => window.CriptaApp?.utils?.resolveImageUrl?.(path, { fallback }) || path || fallback;
  function cache() {
    ["summary", "search", "type-filters", "status-filter", "new", "state", "content", "main-section", "main-grid", "main-count", "active-section", "active-grid", "active-count", "available-section", "available-grid", "available-count", "archive", "archive-grid", "archive-count", "empty", "toasts"].forEach((k) => R[k] = document.getElementById(`missions-${k}`));
    R.editor = document.getElementById("mission-editor-root");
  }
  function toast(message, tone = "info", delay = 4e3) {
    if (!R.toasts) return;
    const n = document.createElement("div");
    n.className = `missions-toast missions-toast--${tone}`;
    n.innerHTML = `<i class="fa-solid ${tone === "error" ? "fa-circle-exclamation" : tone === "success" ? "fa-circle-check" : "fa-circle-info"}"></i><span>${esc(message)}</span>`;
    R.toasts.append(n);
    requestAnimationFrame(() => n.classList.add("is-visible"));
    setTimeout(() => {
      n.classList.remove("is-visible");
      setTimeout(() => n.remove(), 250);
    }, delay);
  }
  function showLoading() {
    R.state.hidden = false;
    R.content.hidden = true;
    R.state.classList.remove("is-error");
    R.state.innerHTML = '<span class="missions-state__spinner"></span><span>Sto aprendo il diario...</span>';
  }
  function showError(e) {
    R.state.hidden = false;
    R.content.hidden = true;
    R.state.classList.add("is-error");
    R.state.innerHTML = `<span class="missions-state__error"><i class="fa-solid fa-triangle-exclamation"></i></span><span><strong>Il diario non si \xE8 aperto.</strong><small>${esc(e?.message || e)}</small></span><button data-action="reload"><i class="fa-solid fa-rotate-right"></i> Riprova</button>`;
  }
  function renderFilters() {
    R["type-filters"].innerHTML = [["", "Tutte"], ...M.TYPE_OPTIONS].map(([v, l]) => `<button class="missions-filter ${S.type === v ? "is-active" : ""}" data-action="type" data-value="${esc(v)}" aria-pressed="${S.type === v}">${esc(l)}</button>`).join("");
  }
  function walkText(m) {
    const p = [m.title, m.summary, m.description, m.rewards, ...m.tags || []];
    [...m.giverRefs || [], ...m.assigneeRefs || []].forEach((r) => p.push(r.name));
    M.walkObjectives(m.objectives, (o) => p.push(o.title, o.description, o.reward));
    return p.join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }
  function filtered() {
    const q = S.search.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return (S.data?.missions || []).filter((m) => (!S.type || m.type === S.type) && (!S.status || m.status === S.status) && (!q || walkText(m).includes(q)));
  }
  function entityFor(m) {
    return M.findEntity(m.giverRefs?.[0] || m.assigneeRefs?.[0], S.data);
  }
  function entityImage(e) {
    const x = e?.media || {};
    return image(x.idle || x.token || x.avatar || x.hover || "");
  }
  function statusIcon(s) {
    return s === "completed" ? "fa-check" : s === "failed" ? "fa-xmark" : s === "active" ? "fa-arrow-right" : s === "hidden" ? "fa-eye-slash" : s === "archived" ? "fa-box-archive" : "fa-circle";
  }
  function objectiveCount(m) {
    let n = 0;
    M.walkObjectives(m.objectives, (o) => {
      if (!["hidden", "archived"].includes(o.status)) n++;
    });
    return n;
  }
  function renderAvatar(ref) {
    const e = M.findEntity(ref, S.data);
    return `<span class="mission-person" title="${esc(ref.name || e?.name)}"><img src="${esc(entityImage(e))}" alt=""><span>${esc(ref.name || e?.name)}</span></span>`;
  }
  function renderObjective(o, m, depth = 0) {
    const key = `${m.id}:${o.id}`, done = o.status === "completed", target = Math.max(1, +o.progress?.target || 1), current = done ? target : Math.max(0, +o.progress?.current || 0), children = (o.subObjectives || []).filter((x) => S.data.canEdit || !["hidden", "archived"].includes(x.status));
    return `<li class="mission-objective mission-objective--${esc(o.status)}" style="--objective-depth:${Math.min(depth, 5)}"><div class="mission-objective__row"><button class="mission-objective__check" data-action="objective" data-mission="${esc(m.id)}" data-objective="${esc(o.id)}" ${S.data.canEdit && !["hidden", "archived"].includes(o.status) ? "" : "disabled"} aria-pressed="${done}"><i class="fa-solid ${S.pending.has(key) ? "fa-spinner fa-spin" : statusIcon(o.status)}"></i></button><div class="mission-objective__body"><div class="mission-objective__titleline"><span class="mission-objective__title">${esc(o.title)}</span>${o.required === false ? '<span class="mission-objective__optional">Opzionale</span>' : ""}${target > 1 ? `<span class="mission-objective__counter">${current}/${target}</span>` : ""}${o.status === "hidden" && S.data.canEdit ? '<span class="mission-objective__private">DM</span>' : ""}</div>${o.description ? `<p>${block(o.description)}</p>` : ""}${o.reward ? `<div class="mission-objective__reward"><i class="fa-solid fa-gift"></i>${esc(o.reward)}</div>` : ""}</div></div>${children.length ? `<ul class="mission-objectives mission-objectives--nested">${children.map((x) => renderObjective(x, m, depth + 1)).join("")}</ul>` : ""}</li>`;
  }
  function nextObjectives(m, limit = 2) {
    const a = [];
    M.walkObjectives(m.objectives, (o) => {
      if (a.length < limit && ["pending", "active"].includes(o.status) && !(o.subObjectives || []).length) a.push(o);
    });
    return a;
  }
  function card(m, featured = false) {
    const open = S.expanded.has(m.id), p = M.progress(m), e = entityFor(m), giver = m.giverRefs?.[0], next = nextObjectives(m, featured ? 3 : 2), objectives = (m.objectives || []).filter((o) => S.data.canEdit || !["hidden", "archived"].includes(o.status));
    return `<article class="mission-card ${!e ? "mission-card--no-entity " : ""}${featured ? "mission-card--featured " : ""}mission-card--${esc(m.status)} ${open ? "is-expanded" : ""}" data-mission-id="${esc(m.id)}"><div class="mission-card__glow"></div><div class="mission-card__media"><img src="${esc(entityImage(e))}" alt="${esc(e?.name || giver?.name || m.title)}" loading="lazy"><span class="mission-card__media-shade"></span><span class="mission-card__type"><i class="fa-solid ${m.type === "main" ? "fa-crown" : m.type === "personal" ? "fa-user" : m.type === "faction" ? "fa-shield-halved" : "fa-scroll"}"></i>${esc(M.TYPE_LABELS[m.type] || m.type)}</span></div><div class="mission-card__content"><header class="mission-card__header"><div class="mission-card__heading"><span class="mission-card__giver">${giver ? `Affidata da ${esc(giver.name)}` : "Diario della compagnia"}</span><h3>${esc(m.title)}</h3></div><span class="mission-status mission-status--${esc(m.status)}"><i class="fa-solid ${statusIcon(m.status)}"></i>${esc(M.STATUS_LABELS[m.status] || m.status)}</span></header>${m.summary ? `<p class="mission-card__summary">${block(m.summary)}</p>` : ""}${next.length && !open ? `<div class="mission-next"><span>Prossimo passo</span>${next.map((o) => `<strong><i class="fa-solid fa-location-arrow"></i>${esc(o.title)}</strong>`).join("")}</div>` : ""}<div class="mission-card__progress"><div class="mission-card__progress-copy"><span>Avanzamento</span><strong>${p.count ? `${p.completed}/${p.count}` : "\u2014"}</strong></div><div class="mission-card__progress-track"><span style="width:${p.percent}%"></span></div><span class="mission-card__percent">${p.percent}%</span></div>${m.assigneeRefs?.length ? `<div class="mission-card__party"><span>Assegnata a</span><div>${m.assigneeRefs.slice(0, 5).map(renderAvatar).join("")}</div></div>` : ""}<div class="mission-card__details" ${open ? "" : "hidden"}>${m.description ? `<div class="mission-card__description">${block(m.description)}</div>` : ""}${objectives.length ? `<div class="mission-card__objectives-head"><span>Obiettivi</span><strong>${objectiveCount(m)}</strong></div><ul class="mission-objectives">${objectives.map((o) => renderObjective(o, m)).join("")}</ul>` : '<p class="mission-card__no-objectives">Nessun obiettivo visibile.</p>'}${m.rewards ? `<div class="mission-reward"><span class="mission-reward__icon"><i class="fa-solid fa-gem"></i></span><div><small>Ricompensa</small><strong>${block(m.rewards)}</strong></div></div>` : ""}${S.data.canEdit && m.dmNotes ? `<div class="mission-dm-notes"><i class="fa-solid fa-lock"></i><div><small>Note DM</small><p>${block(m.dmNotes)}</p></div></div>` : ""}</div><footer class="mission-card__footer"><button class="mission-card__expand" data-action="toggle" data-mission="${esc(m.id)}" aria-expanded="${open}"><span>${open ? "Riduci" : "Apri missione"}</span><i class="fa-solid fa-chevron-down"></i></button>${S.data.canEdit ? `<button class="mission-card__edit" data-action="edit" data-mission="${esc(m.id)}"><i class="fa-solid fa-pen"></i><span>Modifica</span></button>` : ""}</footer></div></article>`;
  }
  function section(section2, grid, count, list, featured = false) {
    section2.hidden = !list.length;
    count.textContent = list.length || "";
    grid.innerHTML = list.map((m) => card(m, featured)).join("");
  }
  function render() {
    if (!S.data) return;
    renderFilters();
    const all = S.data.missions || [];
    R.summary.innerHTML = `<div class="missions-summary__item missions-summary__item--active"><span>${all.filter((m) => m.status === "active").length}</span><small>In corso</small></div><div class="missions-summary__item"><span>${all.filter((m) => m.status === "available").length}</span><small>Disponibili</small></div><div class="missions-summary__item"><span>${all.filter((m) => m.status === "completed").length}</span><small>Completate</small></div>`;
    R.new.hidden = !S.data.canEdit;
    R["status-filter"].value = S.status;
    const a = filtered(), arch = /* @__PURE__ */ new Set(["completed", "failed", "archived"]), main = a.filter((m) => m.type === "main" && !arch.has(m.status)), active = a.filter((m) => m.type !== "main" && m.status === "active"), available = a.filter((m) => m.type !== "main" && ["available", "draft"].includes(m.status)), old = a.filter((m) => arch.has(m.status));
    section(R["main-section"], R["main-grid"], R["main-count"], main, true);
    section(R["active-section"], R["active-grid"], R["active-count"], active);
    section(R["available-section"], R["available-grid"], R["available-count"], available);
    R.archive.hidden = !old.length;
    R["archive-count"].textContent = old.length || "";
    R["archive-grid"].innerHTML = old.map((m) => card(m)).join("");
    R.empty.hidden = !!(main.length + active.length + available.length + old.length);
    R.state.hidden = true;
    R.content.hidden = false;
  }
  const findMission = (id) => S.data?.missions?.find((m) => m.id === id);
  function findObjective(list, id) {
    for (const o of list || []) {
      if (o.id === id) return o;
      const c = findObjective(o.subObjectives, id);
      if (c) return c;
    }
    return null;
  }
  function findLocation(list, id, parent = null) {
    for (let i = 0; i < (list || []).length; i++) {
      const o = list[i];
      if (o.id === id) return { objective: o, list, index: i, parent };
      const c = findLocation(o.subObjectives, id, o);
      if (c) return c;
    }
    return null;
  }
  async function ensureBootstrap() {
    if (!S.data?.needsBootstrap) return;
    S.data = await M.bootstrap(S.data);
    window.CriptaApp?.api?.clearCache?.("api/missions");
    toast("Registro v2 creato come copia sicura dei dati esistenti.", "success", 5200);
  }
  function toggleObjective(mid, oid) {
    const key = `${mid}:${oid}`;
    if (S.pending.has(key)) return;
    S.pending.add(key);
    render();
    S.queue = S.queue.then(async () => {
      try {
        await ensureBootstrap();
        const m = findMission(mid), o = findObjective(m?.objectives, oid);
        if (!m || !o) throw Error("Obiettivo non disponibile.");
        const target = Math.max(1, +o.progress?.target || 1), done = o.status === "completed", patch = done ? { status: "pending", progress: { current: 0, target } } : { status: "completed", progress: { current: target, target } }, result = await M.patchProgress(mid, oid, patch, m.revision), i = S.data.missions.findIndex((x) => x.id === mid);
        if (i >= 0 && result.mission) S.data.missions[i] = result.mission;
        S.data.version = +result.version || S.data.version;
      } catch (e) {
        console.error(e);
        toast(e.message || "Aggiornamento fallito.", "error", 6e3);
      } finally {
        S.pending.delete(key);
        render();
      }
    });
  }
  const storageKey = (id) => `cripta:missions:v2:draft:${M.campaignId()}:${id}`;
  const snapshot = (v) => JSON.stringify(v || null);
  const dirty = () => !!S.editor && snapshot(S.editor.draft) !== S.editor.baseline;
  function saveDraft() {
    if (!dirty()) return;
    try {
      localStorage.setItem(storageKey(S.editor.draft.id), JSON.stringify({ savedAt: (/* @__PURE__ */ new Date()).toISOString(), draft: S.editor.draft }));
    } catch (_) {
    }
  }
  function scheduleDraft() {
    clearTimeout(S.draftTimer);
    if (!dirty()) {
      clearDraft(S.editor?.draft?.id);
      return;
    }
    S.draftTimer = setTimeout(saveDraft, 250);
  }
  function clearDraft(id) {
    try {
      localStorage.removeItem(storageKey(id));
    } catch (_) {
    }
  }
  function localDraft(id) {
    try {
      return JSON.parse(localStorage.getItem(storageKey(id)) || "null");
    } catch (_) {
      return null;
    }
  }
  const refKey = (r) => r ? `${r.type}:${r.id}` : "";
  function refFromKey(key) {
    const [type, ...parts] = String(key || "").split(":"), id = parts.join(":"), e = S.data.entities.find((x) => x.type === type && x.id === id);
    return e ? M.entityRef(e) : null;
  }
  function entityOptions(selected = "", type = "") {
    return (S.data.entities || []).filter((e) => !type || e.type === type || type === "npc" && e.type === "companion").map((e) => `<option value="${esc(`${e.type}:${e.id}`)}" ${`${e.type}:${e.id}` === selected ? "selected" : ""}>${esc(e.name)}${e.role ? ` \u2014 ${esc(e.role)}` : ""}</option>`).join("");
  }
  function assigneePicker(refs = []) {
    const selected = new Set(refs.map(refKey)), entities = (S.data.entities || []).filter((e) => ["player", "companion"].includes(e.type));
    return `<div class="mission-entity-picker"><label class="mission-editor-search"><i class="fa-solid fa-magnifying-glass"></i><input type="search" data-entity-filter placeholder="Cerca personaggio..."></label><div class="mission-entity-picker__options">${entities.map((e) => {
      const k = `${e.type}:${e.id}`;
      return `<label class="mission-entity-option" data-entity-name="${esc(`${e.name} ${e.role}`.toLowerCase())}"><input type="checkbox" name="mission-assignee" value="${esc(k)}" ${selected.has(k) ? "checked" : ""}><span class="mission-entity-option__portrait"><img src="${esc(entityImage(e))}" alt=""></span><span><strong>${esc(e.name)}</strong><small>${esc(e.role || e.type)}</small></span><i class="fa-solid fa-check"></i></label>`;
    }).join("") || "<p>Nessun personaggio disponibile.</p>"}</div></div>`;
  }
  function objectiveEditor(o, depth = 0) {
    const loc = findLocation(S.editor.draft.objectives, o.id), arch = o.status === "archived";
    return `<article class="mission-objective-editor ${arch ? "is-archived" : ""}" data-objective-editor="${esc(o.id)}" style="--editor-depth:${Math.min(depth, 5)}"><div class="mission-objective-editor__rail"><span>${depth + 1}</span></div><div class="mission-objective-editor__content"><header class="mission-objective-editor__header"><span class="mission-objective-editor__handle"><i class="fa-solid fa-grip-lines"></i></span><input class="mission-objective-editor__title" data-objective-field="title" value="${esc(o.title)}"><div class="mission-objective-editor__actions"><button data-editor-action="up" data-objective="${esc(o.id)}" ${loc?.index === 0 ? "disabled" : ""} title="Sposta su"><i class="fa-solid fa-arrow-up"></i></button><button data-editor-action="down" data-objective="${esc(o.id)}" ${loc && loc.index === loc.list.length - 1 ? "disabled" : ""} title="Sposta gi\xF9"><i class="fa-solid fa-arrow-down"></i></button><button data-editor-action="child" data-objective="${esc(o.id)}" title="Aggiungi sotto-obiettivo"><i class="fa-solid fa-turn-down"></i></button><button class="${arch ? "is-restore" : "is-danger"}" data-editor-action="${arch ? "restore" : "archive-objective"}" data-objective="${esc(o.id)}"><i class="fa-solid ${arch ? "fa-rotate-left" : "fa-box-archive"}"></i></button></div></header><div class="mission-objective-editor__grid"><label><span>Stato</span><select data-objective-field="status">${M.OBJECTIVE_STATUS_OPTIONS.map(([v, l]) => `<option value="${v}" ${o.status === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label><label><span>Visibilit\xE0</span><select data-objective-field="visibility">${M.VISIBILITY_OPTIONS.map(([v, l]) => `<option value="${v}" ${o.visibility === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label><label class="mission-objective-editor__number"><span>Progresso</span><span><input type="number" min="0" data-objective-field="current" value="${+o.progress?.current || 0}"><b>/</b><input type="number" min="1" data-objective-field="target" value="${Math.max(1, +o.progress?.target || 1)}"></span></label><label><span>Assegnatario</span><select data-objective-field="assignee"><option value="">Tutta la compagnia</option>${entityOptions(refKey(o.assigneeRefs?.[0]))}</select></label></div><label class="mission-editor-field"><span>Dettagli</span><textarea rows="2" data-objective-field="description">${esc(o.description || "")}</textarea></label><div class="mission-objective-editor__bottom"><label class="mission-editor-check"><input type="checkbox" data-objective-field="required" ${o.required !== false ? "checked" : ""}><span><i class="fa-solid fa-check"></i></span> Necessario</label><label class="mission-editor-field mission-editor-field--reward"><span>Ricompensa specifica</span><input data-objective-field="reward" value="${esc(o.reward || "")}"></label></div></div>${o.subObjectives?.length ? `<div class="mission-objective-editor__children">${o.subObjectives.map((x) => objectiveEditor(x, depth + 1)).join("")}</div>` : ""}</article>`;
  }
  function identityPanel(m) {
    return `<section class="mission-editor-panel mission-editor-panel--identity"><div class="mission-editor-panel__title"><span><i class="fa-solid fa-compass"></i></span><div><small>Identit\xE0</small><h3>Il cuore della missione</h3></div></div><div class="mission-editor-grid mission-editor-grid--identity"><label class="mission-editor-field mission-editor-field--title"><span>Titolo</span><input name="mission-title" value="${esc(m.title)}" placeholder="Titolo della missione"></label><label class="mission-editor-field"><span>Tipo</span><select name="mission-type">${M.TYPE_OPTIONS.map(([v, l]) => `<option value="${v}" ${m.type === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label><label class="mission-editor-field"><span>Stato</span><select name="mission-status">${M.MISSION_STATUS_OPTIONS.map(([v, l]) => `<option value="${v}" ${m.status === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label><label class="mission-editor-field"><span>Visibilit\xE0</span><select name="mission-visibility">${M.VISIBILITY_OPTIONS.map(([v, l]) => `<option value="${v}" ${m.visibility === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label><label class="mission-editor-field mission-editor-field--summary"><span>Riassunto breve</span><textarea name="mission-summary" rows="2" placeholder="Una frase chiara per orientarsi">${esc(m.summary || "")}</textarea></label><label class="mission-editor-field mission-editor-field--description"><span>Descrizione</span><textarea name="mission-description" rows="5" placeholder="Contesto, indizi e dettagli visibili">${esc(m.description || "")}</textarea></label></div></section>`;
  }
  function relationsPanel(m) {
    return `<section class="mission-editor-panel"><div class="mission-editor-panel__title"><span><i class="fa-solid fa-people-arrows"></i></span><div><small>Legami</small><h3>Chi affida e chi partecipa</h3></div></div><div class="mission-editor-relations"><label class="mission-editor-field"><span>Committente</span><select name="mission-giver"><option value="">Nessun committente</option>${entityOptions(refKey(m.giverRefs?.[0]), "npc")}</select></label><div class="mission-editor-field"><span>Assegnatari</span>${assigneePicker(m.assigneeRefs)}</div></div></section>`;
  }
  function objectivesPanel(m) {
    return `<section class="mission-editor-panel mission-editor-panel--objectives"><div class="mission-editor-panel__title mission-editor-panel__title--actions"><span><i class="fa-solid fa-list-check"></i></span><div><small>Percorso</small><h3>Obiettivi e sotto-obiettivi</h3></div><button data-editor-action="add"><i class="fa-solid fa-plus"></i> Aggiungi obiettivo</button></div><div class="mission-objective-editor-list">${m.objectives?.length ? m.objectives.map((o) => objectiveEditor(o)).join("") : '<div class="mission-editor-empty"><i class="fa-solid fa-route"></i><strong>Il percorso \xE8 ancora vuoto</strong><span>Aggiungi il primo obiettivo per dare forma alla missione.</span><button data-editor-action="add"><i class="fa-solid fa-plus"></i> Primo obiettivo</button></div>'}</div></section>`;
  }
  function notesPanel(m) {
    return `<section class="mission-editor-panel mission-editor-panel--private"><div class="mission-editor-panel__title"><span><i class="fa-solid fa-gem"></i></span><div><small>Esito</small><h3>Ricompense e appunti riservati</h3></div></div><div class="mission-editor-grid mission-editor-grid--notes"><label class="mission-editor-field"><span>Ricompensa generale</span><textarea name="mission-rewards" rows="3">${esc(m.rewards || "")}</textarea></label><label class="mission-editor-field"><span>Note solo DM</span><textarea name="mission-dm-notes" rows="3">${esc(m.dmNotes || "")}</textarea></label></div></section>`;
  }
  function renderEditor() {
    if (!S.editor) {
      R.editor.innerHTML = "";
      document.body.classList.remove("mission-editor-open");
      return;
    }
    const m = S.editor.draft;
    R.editor.innerHTML = `<div class="mission-editor-backdrop"><section class="mission-editor" role="dialog" aria-modal="true" aria-labelledby="mission-editor-title"><header class="mission-editor__header"><div><span>${m.revision ? "Modifica missione" : "Nuova missione"}</span><h2 id="mission-editor-title">${esc(m.title)}</h2></div><div class="mission-editor__header-actions"><span class="mission-editor__saved" data-save-state>${dirty() ? '<i class="fa-solid fa-circle"></i> Modifiche non salvate' : '<i class="fa-solid fa-check"></i> Tutto salvato'}</span><button data-editor-action="close" aria-label="Chiudi"><i class="fa-solid fa-xmark"></i></button></div></header><div class="mission-editor__body">${identityPanel(m)}${relationsPanel(m)}${objectivesPanel(m)}${notesPanel(m)}</div><footer class="mission-editor__footer"><button class="mission-editor__archive" data-editor-action="archive"><i class="fa-solid fa-box-archive"></i>${m.status === "archived" ? "Ripristina come bozza" : "Archivia"}</button><div><button class="mission-editor__cancel" data-editor-action="close">Annulla</button><button class="mission-editor__save" data-editor-action="save"><i class="fa-solid fa-floppy-disk"></i> Salva missione</button></div></footer></section></div>`;
    document.body.classList.add("mission-editor-open");
  }
  function collect() {
    if (!S.editor) return;
    const root = R.editor, m = S.editor.draft, val = (s) => root.querySelector(s)?.value ?? "";
    m.title = val('[name="mission-title"]').trim() || "Missione senza titolo";
    m.type = val('[name="mission-type"]') || "side";
    m.status = val('[name="mission-status"]') || "draft";
    m.visibility = val('[name="mission-visibility"]') || "dm";
    m.summary = val('[name="mission-summary"]');
    m.description = val('[name="mission-description"]');
    m.rewards = val('[name="mission-rewards"]');
    m.dmNotes = val('[name="mission-dm-notes"]');
    const giver = refFromKey(val('[name="mission-giver"]'));
    m.giverRefs = giver ? [giver] : [];
    m.assigneeRefs = [...root.querySelectorAll('[name="mission-assignee"]:checked')].map((x2) => refFromKey(x2.value)).filter(Boolean);
    root.querySelectorAll("[data-objective-editor]").forEach((card2) => {
      const o = findObjective(m.objectives, card2.dataset.objectiveEditor);
      if (!o) return;
      const f = (n) => card2.querySelector(`:scope > .mission-objective-editor__content [data-objective-field="${n}"]`);
      o.title = f("title")?.value.trim() || "Obiettivo senza titolo";
      o.status = f("status")?.value || "pending";
      o.visibility = f("visibility")?.value || "public";
      const target = Math.max(1, +f("target")?.value || 1);
      o.progress = { current: Math.max(0, Math.min(target, +f("current")?.value || 0)), target };
      o.description = f("description")?.value || "";
      o.required = !!f("required")?.checked;
      o.reward = f("reward")?.value || "";
      const a = refFromKey(f("assignee")?.value);
      o.assigneeRefs = a ? [a] : [];
    });
    const h = root.querySelector("#mission-editor-title");
    if (h) h.textContent = m.title;
    const x = root.querySelector("[data-save-state]");
    if (x) x.innerHTML = dirty() ? '<i class="fa-solid fa-circle"></i> Modifiche non salvate' : '<i class="fa-solid fa-check"></i> Tutto salvato';
  }
  function openEditor(mission) {
    const draft = M.clone(mission), local = localDraft(draft.id);
    if (local?.draft && snapshot(local.draft) !== snapshot(draft)) {
      if (confirm(`\xC8 disponibile una bozza locale del ${new Date(local.savedAt).toLocaleString("it-IT")}. Vuoi ripristinarla?`)) Object.assign(draft, local.draft);
      else clearDraft(draft.id);
    }
    S.editor = { draft, baseline: snapshot(mission), saving: false };
    renderEditor();
    setTimeout(() => R.editor.querySelector('[name="mission-title"]')?.focus(), 30);
  }
  function closeEditor(force = false) {
    if (!S.editor) return;
    collect();
    if (!force && dirty() && !confirm("Hai modifiche non salvate. Vuoi chiudere e conservarle soltanto come bozza locale?")) return;
    if (dirty()) saveDraft();
    else clearDraft(S.editor.draft.id);
    S.editor = null;
    renderEditor();
  }
  function rerenderEditor() {
    const b = R.editor.querySelector(".mission-editor__body"), y = b?.scrollTop || 0;
    renderEditor();
    const n = R.editor.querySelector(".mission-editor__body");
    if (n) n.scrollTop = y;
  }
  function mutate(action, id) {
    collect();
    const m = S.editor.draft;
    if (action === "add") m.objectives.push(M.createObjective(m.id));
    else {
      const l = findLocation(m.objectives, id);
      if (!l) return;
      if (action === "child") l.objective.subObjectives.push(M.createObjective(l.objective.id));
      if (action === "up" && l.index > 0) [l.list[l.index - 1], l.list[l.index]] = [l.list[l.index], l.list[l.index - 1]];
      if (action === "down" && l.index < l.list.length - 1) [l.list[l.index + 1], l.list[l.index]] = [l.list[l.index], l.list[l.index + 1]];
      if (action === "archive-objective") l.objective.status = "archived";
      if (action === "restore") l.objective.status = "pending";
    }
    scheduleDraft();
    rerenderEditor();
  }
  async function saveEditor() {
    if (!S.editor || S.editor.saving) return;
    collect();
    const editor = S.editor;
    editor.saving = true;
    R.editor.querySelector(".mission-editor__save")?.setAttribute("disabled", "");
    try {
      await ensureBootstrap();
      const current = findMission(editor.draft.id), expected = +(current?.revision ?? editor.draft.revision ?? 0), result = await M.upsert(editor.draft, expected);
      if (!result.mission) throw Error("Risposta di salvataggio incompleta.");
      const i = S.data.missions.findIndex((x) => x.id === result.mission.id);
      if (i >= 0) S.data.missions[i] = result.mission;
      else S.data.missions.push(result.mission);
      S.data.version = +result.version || S.data.version;
      clearDraft(editor.draft.id);
      S.editor = null;
      renderEditor();
      render();
      window.CriptaApp?.api?.clearCache?.("api/missions");
      toast("Missione salvata.", "success");
    } catch (e) {
      editor.saving = false;
      R.editor.querySelector(".mission-editor__save")?.removeAttribute("disabled");
      saveDraft();
      console.error(e);
      toast(e.message || "Salvataggio fallito. La bozza \xE8 al sicuro.", "error", 7e3);
    }
  }
  function editorAction(button) {
    const a = button.dataset.editorAction, id = button.dataset.objective || "";
    if (a === "close") return closeEditor();
    if (a === "save") return saveEditor();
    if (a === "archive") {
      collect();
      S.editor.draft.status = S.editor.draft.status === "archived" ? "draft" : "archived";
      scheduleDraft();
      return rerenderEditor();
    }
    return mutate(a, id);
  }
  function bind(scope) {
    scope.listen(document, "click", (e) => {
      const eb = e.target.closest("[data-editor-action]");
      if (eb && R.editor.contains(eb)) {
        e.preventDefault();
        editorAction(eb);
        return;
      }
      if (e.target.classList.contains("mission-editor-backdrop")) {
        closeEditor();
        return;
      }
      const b = e.target.closest("[data-action]");
      if (!b) return;
      e.preventDefault();
      const a = b.dataset.action;
      if (a === "reload") init(true);
      if (a === "type") {
        S.type = b.dataset.value || "";
        render();
      }
      if (a === "toggle") {
        const id = b.dataset.mission;
        if (S.expanded.has(id)) S.expanded.delete(id);
        else S.expanded.add(id);
        render();
      }
      if (a === "edit") {
        const m = findMission(b.dataset.mission);
        if (m) openEditor(m);
      }
      if (a === "objective") toggleObjective(b.dataset.mission, b.dataset.objective);
    });
    scope.listen(R.search, "input", (e) => {
      S.search = e.target.value || "";
      render();
    });
    scope.listen(R["status-filter"], "change", (e) => {
      S.status = e.target.value || "";
      render();
    });
    scope.listen(R.new, "click", () => openEditor(M.createMission((S.data.missions || []).map((m) => m.id))));
    scope.listen(R.editor, "input", (e) => {
      if (!S.editor) return;
      if (e.target.matches("[data-entity-filter]")) {
        const q = e.target.value.trim().toLowerCase();
        R.editor.querySelectorAll("[data-entity-name]").forEach((x) => x.hidden = !!(q && !x.dataset.entityName.includes(q)));
        return;
      }
      collect();
      scheduleDraft();
    });
    scope.listen(R.editor, "change", () => {
      if (S.editor) {
        collect();
        scheduleDraft();
      }
    });
    scope.listen(document, "keydown", (e) => {
      if (e.key === "Escape" && S.editor) {
        e.preventDefault();
        closeEditor();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && S.editor) {
        e.preventDefault();
        saveEditor();
      }
    });
    window.CriptaApp?.navigation?.addLeaveGuard?.("missions-editor", () => {
      if (!S.editor) return null;
      collect();
      if (!dirty()) return null;
      return { active: true, message: "Hai modifiche non salvate nella missione. La bozza locale verr\xE0 conservata: continuare?", discard: saveDraft };
    });
  }
  async function init(force = false) {
    cache();
    if (!R.content) return;
    showLoading();
    try {
      S.data = await M.load({ force });
      S.expanded.clear();
      S.data.missions.filter((m) => m.type === "main" && ["active", "available"].includes(m.status)).forEach((m) => S.expanded.add(m.id));
      render();
      if (S.data.needsBootstrap && S.data.canEdit && S.data.bootstrapAvailable) {
        try {
          S.data = await M.bootstrap(S.data);
          render();
          toast("Nuovo registro creato come copia: i dati legacy sono rimasti intatti.", "success", 5600);
        } catch (e) {
          console.info("Bootstrap missioni rimandato; resta attivo il fallback legacy.", e);
        }
      }
    } catch (e) {
      console.error(e);
      showError(e);
    }
  }
  window.CriptaApp.onPageReady("missioni", () => {
    const scope = window.CriptaApp.createPageScope("missioni");
    S.editor = null;
    S.pending.clear();
    S.search = "";
    S.type = "";
    S.status = "";
    cache();
    bind(scope);
    init();
  });
})();
