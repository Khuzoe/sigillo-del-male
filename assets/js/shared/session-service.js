(() => {
  "use strict";

  const STATUS_LABELS = {
    draft: "Bozza",
    published: "Pubblicata",
    archived: "Archiviata"
  };
  const VISIBILITY_LABELS = {
    public: "Tutti",
    players: "Giocatori autenticati",
    dm: "Solo DM"
  };
  const EVENT_TYPES = {
    event: { label: "Evento", icon: "fa-feather-pointed" },
    encounter: { label: "Incontro", icon: "fa-masks-theater" },
    discovery: { label: "Scoperta", icon: "fa-compass" },
    decision: { label: "Decisione", icon: "fa-code-branch" },
    consequence: { label: "Conseguenza", icon: "fa-bolt" }
  };

  function clone(value) {
    try {
      return structuredClone(value);
    } catch (_) {
      return JSON.parse(JSON.stringify(value ?? null));
    }
  }

  function slug(value, fallback) {
    const helper = window.CriptaApp?.utils?.slugify;
    if (typeof helper === "function") return helper(value, fallback || "sessione");
    const normalized = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return normalized || fallback || "sessione";
  }

  function stableHash(value) {
    let hash = 2166136261;
    const input = String(value || "");
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function campaignId() {
    return window.CriptaApp?.campaigns?.currentId?.() || "cripta-di-sangue";
  }

  function authToken() {
    return String(window.CriptaDiscordAuth?.getToken?.() || window.CriptaApp?.auth?.getToken?.() || "").trim();
  }

  function arrayFromPayload(payload, keys) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    for (const key of keys || []) {
      if (Array.isArray(payload?.[key])) return payload[key];
    }
    return [];
  }

  function cleanText(value) {
    return String(value ?? "").trim();
  }

  function htmlParagraphs(value) {
    const html = cleanText(value);
    if (!html) return [];
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const paragraphs = [...doc.body.querySelectorAll("p, li")]
        .map((node) => cleanText(node.textContent))
        .filter(Boolean);
      if (paragraphs.length) return paragraphs;
      const fallback = cleanText(doc.body.textContent);
      return fallback ? [fallback] : [];
    } catch (_) {
      return [html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()].filter(Boolean);
    }
  }

  function dateIso(value, fallback) {
    const direct = cleanText(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
    const legacy = cleanText(fallback || value);
    const match = legacy.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return "";
    return match[3] + "-" + match[2].padStart(2, "0") + "-" + match[1].padStart(2, "0");
  }

  function dateLabel(value, fallback) {
    const iso = dateIso(value, fallback);
    if (!iso) return cleanText(fallback || value);
    const parts = iso.split("-");
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }

  function normalizeRef(value, type) {
    if (!value) return null;
    const raw = typeof value === "string" ? { id: value, name: value } : value;
    const id = cleanText(raw.id || raw.actorId || raw.slug || raw.name).toLowerCase();
    if (!id) return null;
    return {
      id,
      type: cleanText(raw.type || type || "npc").toLowerCase(),
      name: cleanText(raw.name || raw.label || raw.title || id),
      worldId: cleanText(raw.worldId),
      actorId: cleanText(raw.actorId)
    };
  }

  function uniqueRefs(values, type) {
    const refs = (Array.isArray(values) ? values : []).map((entry) => normalizeRef(entry, type)).filter(Boolean);
    return refs.filter((entry, index) => refs.findIndex((candidate) => candidate.type === entry.type && candidate.id === entry.id) === index);
  }

  function normalizeEvent(value, index, seed) {
    const type = EVENT_TYPES[cleanText(value?.type).toLowerCase()] ? cleanText(value.type).toLowerCase() : "event";
    const title = cleanText(value?.title) || EVENT_TYPES[type].label;
    return {
      id: cleanText(value?.id) || "event-" + stableHash(seed + "|" + index + "|" + title),
      type,
      visibility: cleanText(value?.visibility).toLowerCase() === "dm" ? "dm" : "public",
      title,
      text: cleanText(value?.text || value?.description)
    };
  }

  function normalizeLegacy(raw, index) {
    const number = Math.max(0, Number(raw?.number ?? raw?.id ?? index + 1) || index + 1);
    const id = cleanText(raw?.journalId || raw?.recordId) || "session-" + number;
    const paragraphs = htmlParagraphs(raw?.summary);
    const suppliedEvents = Array.isArray(raw?.events) ? raw.events : [];
    const events = (suppliedEvents.length ? suppliedEvents : paragraphs.map((text, eventIndex) => ({
      id: "legacy-event-" + number + "-" + (eventIndex + 1),
      type: "event",
      title: eventIndex === 0 ? "In breve" : "Capitolo " + (eventIndex + 1),
      text
    }))).map((event, eventIndex) => normalizeEvent(event, eventIndex, id));
    const links = raw?.links && typeof raw.links === "object" ? raw.links : {};
    const xp = raw?.xp || {};
    return {
      id,
      number,
      revision: Math.max(1, Number(raw?.revision || 1) || 1),
      status: ["draft", "published", "archived"].includes(cleanText(raw?.status).toLowerCase()) ? cleanText(raw.status).toLowerCase() : "published",
      visibility: ["public", "players", "dm"].includes(cleanText(raw?.visibility).toLowerCase()) ? cleanText(raw.visibility).toLowerCase() : "public",
      title: cleanText(raw?.title) || "Sessione " + number,
      date: dateIso(raw?.dateIso || raw?.date, raw?.date),
      dateLabel: dateLabel(raw?.dateIso, raw?.date),
      teaser: cleanText(raw?.teaser),
      summary: cleanText(raw?.summary),
      events,
      participants: uniqueRefs([...(links.players || []), ...(links.npcs || []), ...(raw?.participants || [])]),
      links: {
        missions: uniqueRefs(links.missions, "mission"),
        items: uniqueRefs(links.items, "item"),
        locations: uniqueRefs(links.locations, "location")
      },
      xp: {
        total: Math.max(0, Number(xp.total || 0) || 0),
        each: Math.max(0, Number(xp.each || 0) || 0),
        bonus: (Array.isArray(xp.bonus) ? xp.bonus : []).map((entry) => ({
          name: cleanText(entry?.name),
          amount: Math.max(0, Number(entry?.amount || 0) || 0)
        })).filter((entry) => entry.name)
      },
      loot: (Array.isArray(raw?.loot) ? raw.loot : cleanText(raw?.reward) ? [raw.reward] : []).map(cleanText).filter(Boolean),
      consequences: (Array.isArray(raw?.consequences) ? raw.consequences : []).map(cleanText).filter(Boolean),
      partyChanges: Array.isArray(raw?.partyChanges) ? clone(raw.partyChanges) : [],
      levelUp: cleanText(raw?.levelUp || raw?.levelup),
      skillPoint: Boolean(raw?.skillPoint),
      dmNotes: cleanText(raw?.dmNotes),
      createdAt: cleanText(raw?.createdAt),
      createdBy: cleanText(raw?.createdBy),
      updatedAt: cleanText(raw?.updatedAt),
      updatedBy: cleanText(raw?.updatedBy),
      legacySource: raw?.legacySource || { collection: "sessions", id: String(raw?.id ?? number) }
    };
  }

  async function fetchCampaignJson(pathname, fallback) {
    try {
      return await window.CriptaApp.data.json(pathname, { cache: false });
    } catch (error) {
      console.info("Sessioni: sorgente " + pathname + " non disponibile.", error);
      return fallback;
    }
  }

  function normalizeDirectoryEntry(raw, type) {
    if (!raw || typeof raw !== "object") return null;
    const inferred = raw.ownerCharacterId ? "player" : type;
    const ref = normalizeRef({
      id: raw.ownerCharacterId || raw.id || raw.actorId || raw.slug || raw.name,
      type: inferred,
      name: raw.name || raw.title,
      worldId: raw.worldId,
      actorId: raw.actorId || raw.foundryActorId
    }, inferred);
    return ref;
  }

  async function loadDirectory() {
    const token = authToken();
    const results = await Promise.all([
      fetchCampaignJson("players.json", []),
      fetchCampaignJson("characters.json", []),
      fetchCampaignJson("items.json", []),
      fetchCampaignJson("locations.json", []),
      window.CriptaApp.api.get("api/managed-actors", { token: token || undefined, cache: false }).catch(() => ({ data: [] })),
      window.CriptaApp.api.get("api/missions", { token: token || undefined, cache: false }).catch(() => ({ data: [] }))
    ]);
    const participantValues = [
      ...arrayFromPayload(results[0], ["players", "characters"]).map((entry) => normalizeDirectoryEntry(entry, "player")),
      ...arrayFromPayload(results[1], ["characters", "npcs"]).map((entry) => normalizeDirectoryEntry(entry, "npc")),
      ...arrayFromPayload(results[4], ["actors"]).map((entry) => normalizeDirectoryEntry(entry, entry?.ownerCharacterId ? "player" : "npc"))
    ].filter(Boolean);
    const participants = participantValues.filter((entry, index) => participantValues.findIndex((candidate) => candidate.type === entry.type && candidate.id === entry.id) === index)
      .sort((a, b) => a.name.localeCompare(b.name, "it"));
    const items = arrayFromPayload(results[2], ["items", "objects", "materials"])
      .map((entry) => normalizeDirectoryEntry(entry, "item")).filter(Boolean);
    const locations = arrayFromPayload(results[3], ["locations", "places"])
      .map((entry) => normalizeDirectoryEntry(entry, "location")).filter(Boolean);
    const missions = arrayFromPayload(results[5], ["missions"])
      .map((entry) => normalizeDirectoryEntry(entry, "mission")).filter(Boolean);
    return { participants, items, locations, missions };
  }

  async function loadLegacy() {
    const payload = await fetchCampaignJson("sessions.json", { sessions: [] });
    const rows = arrayFromPayload(payload, ["sessions"]);
    return rows.map(normalizeLegacy);
  }

  async function resolveCanEditFallback() {
    try {
      return Boolean(await window.CriptaDiscordAuth?.isCurrentUserDm?.(window.CriptaBasePath || ""));
    } catch (_) {
      return false;
    }
  }

  async function load(options) {
    const token = authToken();
    let endpointAvailable = false;
    try {
      const payload = await window.CriptaApp.api.get("api/session-journal", {
        token: token || undefined,
        cache: false,
        query: options?.force ? { _: Date.now() } : undefined
      });
      endpointAvailable = true;
      if (Array.isArray(payload?.data)) {
        return {
          schemaVersion: 2,
          source: "kv",
          version: Number(payload.version || 0),
          sessions: payload.data.map(normalizeLegacy),
          canEdit: Boolean(payload?.permissions?.canEdit),
          needsBootstrap: false,
          bootstrapAvailable: true,
          directory: { participants: [], missions: [], items: [], locations: [] },
          directoryLoaded: false
        };
      }
    } catch (error) {
      console.info("Sessioni v2 non ancora disponibili: uso il diario statico.", error);
    }
    const sessions = await loadLegacy();
    const canEdit = await resolveCanEditFallback();
    return {
      schemaVersion: 2,
      source: "legacy",
      version: 0,
      sessions,
      canEdit,
      needsBootstrap: endpointAvailable && canEdit,
      bootstrapAvailable: endpointAvailable,
      directory: { participants: [], missions: [], items: [], locations: [] },
      directoryLoaded: false
    };
  }

  async function bootstrap(state) {
    if (!state?.needsBootstrap) return state;
    const token = authToken();
    if (!token) throw new Error("Accedi come DM per inizializzare il nuovo diario.");
    const result = await window.CriptaApp.api.post("api/session-journal/bootstrap", {
      data: state.sessions,
      sourceVersion: state.version || 0
    }, { token });
    return {
      ...state,
      source: "kv",
      version: Number(result?.version || 1),
      sessions: (Array.isArray(result?.data) ? result.data : state.sessions).map(normalizeLegacy),
      needsBootstrap: false
    };
  }

  async function upsert(session, expectedRevision) {
    const token = authToken();
    if (!token) throw new Error("Accedi come DM per salvare la sessione.");
    return window.CriptaApp.api.post("api/session-journal/upsert", {
      session,
      expectedRevision: Math.max(0, Number(expectedRevision || 0) || 0)
    }, { token });
  }

  function createEvent(seed) {
    return {
      id: "event-" + Date.now().toString(36) + "-" + stableHash(seed || Math.random()),
      type: "event",
      visibility: "public",
      title: "",
      text: ""
    };
  }

  function createSession(existing) {
    const numbers = (Array.isArray(existing) ? existing : []).map((entry) => Number(entry?.number || 0)).filter(Number.isFinite);
    const number = Math.max(0, ...numbers) + 1;
    const today = new Date().toISOString().slice(0, 10);
    return normalizeLegacy({
      journalId: "session-" + number + "-" + Date.now().toString(36),
      id: number,
      number,
      revision: 0,
      status: "draft",
      visibility: "dm",
      title: "Nuova sessione",
      dateIso: today,
      events: [createEvent("session-" + number)],
      xp: { total: 0, each: 0 },
      legacySource: null
    }, number - 1);
  }

  window.CriptaSessions = Object.freeze({
    STATUS_LABELS,
    VISIBILITY_LABELS,
    EVENT_TYPES,
    clone,
    normalize: normalizeLegacy,
    dateLabel,
    load,
    loadDirectory,
    bootstrap,
    upsert,
    createEvent,
    createSession,
    authToken
  });
})();
