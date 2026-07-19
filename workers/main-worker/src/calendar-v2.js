const EVENT_KINDS = new Set(["event", "note", "holiday", "deadline", "mission", "travel", "session", "reminder"]);
const EVENT_VISIBILITIES = new Set(["public", "players", "dm", "owner"]);
const EVENT_STATUSES = new Set(["scheduled", "completed", "cancelled", "archived"]);

const DEFAULT_WEEKDAYS = ["Primo", "Secondo", "Terzo", "Quarto", "Quinto", "Sesto", "Settimo", "Ottavo", "Nono", "Decimo"];
const DEFAULT_MONTHS = ["Hammer", "Alturiak", "Ches", "Tarsakh", "Mirtul", "Kythorn", "Flamerule", "Eleasis", "Eleint", "Marpenoth", "Uktar", "Nightal"];

function response(data, status = 200, corsHeaders = {}, cacheControl = "no-store") {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": cacheControl, ...corsHeaders },
  });
}

function integer(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function text(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function id(value, fallback = "") {
  return String(value || "").trim().toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160) || fallback;
}

function accountId(value) {
  return id(value).slice(0, 80);
}

function campaignKey(campaignId, suffix) {
  return `campaign:${id(campaignId, "cripta-di-sangue")}:${suffix}`;
}

function calendarKey(campaignId) {
  return campaignKey(campaignId, "calendar:v2");
}

function legacyCalendarKey(campaignId) {
  return campaignKey(campaignId, "data:calendar:override");
}

function uniqueId(value, used, fallback) {
  const base = id(value, fallback);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

function normalizeDefinition(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const sourceWeekdays = Array.isArray(source.weekdays) && source.weekdays.length ? source.weekdays : DEFAULT_WEEKDAYS;
  const sourceMonths = Array.isArray(source.months) && source.months.length ? source.months : DEFAULT_MONTHS.map((name) => ({ name, days: 30 }));
  const weekdayIds = new Set();
  const monthIds = new Set();
  const weekdays = sourceWeekdays.slice(0, 32).map((entry, index) => {
    const row = typeof entry === "string" ? { name: entry } : (entry || {});
    const name = text(row.name || row.label || `Giorno ${index + 1}`, 80);
    return {
      id: uniqueId(row.id || name, weekdayIds, `weekday-${index + 1}`),
      name,
      short: text(row.short || name.slice(0, 3), 12) || String(index + 1),
    };
  });
  const months = sourceMonths.slice(0, 48).map((entry, index) => {
    const row = typeof entry === "string" ? { name: entry } : (entry || {});
    const name = text(row.name || row.label || `Mese ${index + 1}`, 80);
    return {
      id: uniqueId(row.id || name, monthIds, `month-${index + 1}`),
      name,
      days: integer(row.days, 1, 9999, 30),
    };
  });
  const time = source.timeSystem && typeof source.timeSystem === "object" ? source.timeSystem : {};
  const quickSteps = (Array.isArray(time.quickSteps) ? time.quickSteps : [
    { unit: "hour", amount: -1 },
    { unit: "minute", amount: -15 },
    { unit: "minute", amount: 15 },
    { unit: "hour", amount: 1 },
  ]).slice(0, 10).map((entry) => ({
    unit: ["minute", "hour", "day"].includes(entry?.unit) ? entry.unit : "minute",
    amount: integer(entry?.amount, -999999, 999999, 0),
  })).filter((entry) => entry.amount !== 0);
  return {
    schemaVersion: 2,
    revision: integer(source.revision, 1, Number.MAX_SAFE_INTEGER, 1),
    name: text(source.name || "Calendario di Harptos", 120),
    epochName: text(source.epochName, 24),
    firstWeekdayIndex: integer(source.firstWeekdayIndex, 0, weekdays.length - 1, 0),
    weekdays,
    months,
    timeSystem: {
      hoursPerDay: integer(time.hoursPerDay, 1, 9999, 24),
      minutesPerHour: integer(time.minutesPerHour, 1, 9999, 60),
      quickSteps: quickSteps.length ? quickSteps : [{ unit: "minute", amount: 1 }],
    },
  };
}

function legacyDate(value, definition) {
  const match = String(value || "").trim().match(/^(-?\d+)-(\d+)-(\d+)$/);
  if (!match) return null;
  const month = definition.months[integer(match[2], 1, definition.months.length, 1) - 1];
  return { year: Number(match[1]), monthId: month.id, day: Number(match[3]) };
}

function normalizeDate(value, definition, strict = false) {
  const source = typeof value === "string" ? legacyDate(value, definition) : (value || {});
  const requestedMonthId = String(source?.monthId || "");
  const monthNumber = integer(source?.month, 1, definition.months.length, 1);
  const month = definition.months.find((entry) => entry.id === requestedMonthId) || definition.months[monthNumber - 1] || definition.months[0];
  const day = Number(source?.day);
  if (strict && requestedMonthId && !definition.months.some((entry) => entry.id === requestedMonthId)) return null;
  if (strict && (!Number.isInteger(day) || day < 1 || day > month.days)) return null;
  return {
    year: integer(source?.year, -99999999, 99999999, 1492),
    monthId: month.id,
    day: integer(day, 1, month.days, 1),
  };
}

function normalizeTime(value, definition, strict = false) {
  const source = value || {};
  const hour = Number(source.hour);
  const minute = Number(source.minute);
  if (strict && (!Number.isInteger(hour) || hour < 0 || hour >= definition.timeSystem.hoursPerDay)) return null;
  if (strict && (!Number.isInteger(minute) || minute < 0 || minute >= definition.timeSystem.minutesPerHour)) return null;
  return {
    hour: integer(hour, 0, definition.timeSystem.hoursPerDay - 1, 0),
    minute: integer(minute, 0, definition.timeSystem.minutesPerHour - 1, 0),
  };
}

function normalizeClock(value, definition, strict = false) {
  const source = value && typeof value === "object" ? value : {};
  const date = normalizeDate(source.date || source.currentDate || { year: 1492, monthId: definition.months[0].id, day: 1 }, definition, strict);
  const timeValue = source.time || { hour: 0, minute: 0 };
  const time = normalizeTime(timeValue, definition, strict);
  if (!date || !time) return null;
  return {
    revision: integer(source.revision, 1, Number.MAX_SAFE_INTEGER, 1),
    date,
    time,
    updatedAt: text(source.updatedAt, 64),
    updatedBy: text(source.updatedBy, 120),
  };
}

function yearLength(definition) {
  return definition.months.reduce((sum, month) => sum + month.days, 0);
}

function dateOrdinal(dateValue, definition) {
  const date = normalizeDate(dateValue, definition);
  const monthIndex = Math.max(0, definition.months.findIndex((entry) => entry.id === date.monthId));
  return date.year * yearLength(definition)
    + definition.months.slice(0, monthIndex).reduce((sum, month) => sum + month.days, 0)
    + date.day - 1;
}

function dateFromOrdinal(value, definition) {
  const length = yearLength(definition);
  const ordinal = Math.trunc(Number(value) || 0);
  const year = Math.floor(ordinal / length);
  let remainder = ordinal - year * length;
  let month = definition.months[0];
  for (const candidate of definition.months) {
    month = candidate;
    if (remainder < candidate.days) break;
    remainder -= candidate.days;
  }
  return { year, monthId: month.id, day: remainder + 1 };
}

function shiftClock(clockValue, amount, unit, definition) {
  const clock = normalizeClock(clockValue, definition);
  const minutesPerHour = definition.timeSystem.minutesPerHour;
  const minutesPerDay = definition.timeSystem.hoursPerDay * minutesPerHour;
  const factor = unit === "day" ? minutesPerDay : unit === "hour" ? minutesPerHour : 1;
  const total = clock.time.hour * minutesPerHour + clock.time.minute + integer(amount, -999999999, 999999999, 0) * factor;
  const dayDelta = Math.floor(total / minutesPerDay);
  const withinDay = ((total % minutesPerDay) + minutesPerDay) % minutesPerDay;
  return {
    ...clock,
    date: dateFromOrdinal(dateOrdinal(clock.date, definition) + dayDelta, definition),
    time: { hour: Math.floor(withinDay / minutesPerHour), minute: withinDay % minutesPerHour },
  };
}

function normalizeMoment(value, definition, allDay, strict = false) {
  const source = value && typeof value === "object" ? value : {};
  const date = normalizeDate(source.date || source, definition, strict);
  const time = allDay ? null : normalizeTime(source.time || { hour: 0, minute: 0 }, definition, strict);
  return date && (allDay || time) ? { date, time } : null;
}

function normalizeRefs(value) {
  return (Array.isArray(value) ? value : []).slice(0, 32).map((entry) => ({
    type: text(entry?.type, 40),
    id: id(entry?.id || entry?.actorId),
    name: text(entry?.name || entry?.title, 160),
    worldId: text(entry?.worldId, 96),
    actorId: text(entry?.actorId, 96),
  })).filter((entry) => entry.id);
}

function normalizeEvent(value, definition, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const allDay = value.allDay !== false;
  const start = normalizeMoment(value.start || { date: value.date, time: value.time }, definition, allDay, options.strict);
  const end = value.end ? normalizeMoment(value.end, definition, allDay, options.strict) : null;
  if (!start || (value.end && !end)) return null;
  const eventId = id(value.id || options.fallbackId || "", options.fallbackId || "");
  if (!eventId) return null;
  const kind = String(value.kind || "event").toLowerCase();
  const visibility = String(value.visibility || "dm").toLowerCase();
  const status = String(value.status || "scheduled").toLowerCase();
  return {
    id: eventId,
    revision: integer(value.revision, 1, Number.MAX_SAFE_INTEGER, 1),
    kind: EVENT_KINDS.has(kind) ? kind : "event",
    status: EVENT_STATUSES.has(status) ? status : "scheduled",
    visibility: EVENT_VISIBILITIES.has(visibility) ? visibility : "dm",
    title: text(value.title || "Evento senza titolo", 240),
    description: text(value.description || value.text, 12000),
    allDay,
    start,
    end,
    ownerAccountId: accountId(value.ownerAccountId || value.accountId),
    ownerName: text(value.ownerName, 120),
    tags: [...new Set((Array.isArray(value.tags) ? value.tags : []).map((entry) => text(entry, 80)).filter(Boolean))].slice(0, 24),
    refs: normalizeRefs(value.refs),
    createdAt: text(value.createdAt, 64),
    createdBy: text(value.createdBy, 120),
    updatedAt: text(value.updatedAt, 64),
    updatedBy: text(value.updatedBy, 120),
    migratedFrom: value.migratedFrom && typeof value.migratedFrom === "object" ? {
      collection: text(value.migratedFrom.collection, 48),
      id: text(value.migratedFrom.id, 160),
    } : null,
  };
}

function defaultDocument() {
  const definition = normalizeDefinition({});
  return {
    schemaVersion: 2,
    version: 0,
    updatedAt: null,
    updatedBy: null,
    definition,
    clock: normalizeClock({}, definition),
    events: [],
    source: "default",
  };
}

function normalizeDocument(value, source = "kv") {
  const input = value && typeof value === "object" ? value : {};
  const definition = normalizeDefinition(input.definition);
  return {
    schemaVersion: 2,
    version: Math.max(0, Number(input.version || 0) || 0),
    updatedAt: input.updatedAt || null,
    updatedBy: input.updatedBy || null,
    definition,
    clock: normalizeClock(input.clock, definition),
    events: (Array.isArray(input.events) ? input.events : [])
      .map((entry, index) => normalizeEvent(entry, definition, { fallbackId: `event-${index + 1}` }))
      .filter(Boolean),
    source,
  };
}

function convertLegacyDocument(value) {
  const input = value && typeof value === "object" ? value : {};
  const rows = Array.isArray(input.data) ? input.data : [];
  const config = rows.find((entry) => entry?.type === "config") || {};
  const definition = normalizeDefinition({
    name: config.name,
    epochName: config.epochName,
    firstWeekdayIndex: config.firstWeekdayIndex,
    weekdays: config.weekdays,
    months: config.months,
    timeSystem: config.timeSystem,
  });
  const state = rows.find((entry) => entry?.type === "state") || {};
  const clock = normalizeClock({ date: legacyDate(state.currentDate, definition), time: state.time }, definition);
  const now = new Date().toISOString();
  const events = rows.filter((entry) => ["note", "important-day"].includes(entry?.type)).map((entry, index) => normalizeEvent({
    id: entry.id || `legacy-event-${index + 1}`,
    revision: 1,
    kind: entry.type === "important-day" ? "holiday" : "note",
    visibility: entry.type === "important-day" ? "public" : entry.visibility === "private" ? "owner" : "players",
    status: "scheduled",
    title: entry.title || (entry.type === "important-day" ? "Giorno importante" : "Nota"),
    description: entry.text || "",
    allDay: true,
    start: { date: legacyDate(entry.date, definition), time: null },
    ownerAccountId: entry.ownerAccountId,
    ownerName: entry.ownerName,
    createdAt: entry.updatedAt || now,
    updatedAt: entry.updatedAt || now,
    migratedFrom: { collection: "calendar", id: entry.id || String(index) },
  }, definition, { fallbackId: `legacy-event-${index + 1}` })).filter(Boolean);
  return {
    schemaVersion: 2,
    version: Math.max(0, Number(input.version || 0) || 0),
    updatedAt: input.updatedAt || null,
    updatedBy: input.updatedBy || null,
    definition,
    clock,
    events,
    source: "legacy",
  };
}

async function readDocument(campaignId, env) {
  const raw = await env.SIGILLO_KV.get(calendarKey(campaignId));
  if (raw) {
    const parsed = JSON.parse(raw);
    return normalizeDocument(parsed, "kv");
  }
  const legacyRaw = await env.SIGILLO_KV.get(legacyCalendarKey(campaignId));
  if (legacyRaw) return convertLegacyDocument(JSON.parse(legacyRaw));
  return defaultDocument();
}

async function saveDocument(document, campaignId, user, env, services) {
  const now = new Date().toISOString();
  const next = {
    schemaVersion: 2,
    version: Number(document.version || 0) + 1,
    updatedAt: now,
    updatedBy: services.getAuthenticatedAccountId(user, env),
    definition: document.definition,
    clock: document.clock,
    events: document.events,
  };
  const serialized = JSON.stringify(next);
  if (serialized.length > 1024 * 1024) throw new Error("Calendar payload too large");
  await env.SIGILLO_KV.put(calendarKey(campaignId), serialized);
  return normalizeDocument(next, "kv");
}

function scopedMembers(value, campaignId) {
  const cleanCampaign = id(campaignId, "cripta-di-sangue");
  const out = [];
  for (const entry of String(value || "").split(/[\r\n;]+/).map((row) => row.trim()).filter(Boolean)) {
    const separator = entry.indexOf(":");
    if (separator < 0 || id(entry.slice(0, separator)) !== cleanCampaign) continue;
    out.push(...entry.slice(separator + 1).split(/[\s,]+/).map(accountId).filter(Boolean));
  }
  return out;
}

async function isParticipant(user, campaignId, env, services, isEditor) {
  if (!user) return false;
  if (isEditor) return true;
  const currentAccountId = services.getAuthenticatedAccountId(user, env);
  if (!currentAccountId) return false;
  const claimedCampaign = id(user.campaignId);
  if (claimedCampaign && claimedCampaign === id(campaignId)) return true;
  const configured = scopedMembers(env.CAMPAIGN_MEMBER_ACCOUNT_IDS || env.CAMPAIGN_PLAYER_ACCOUNT_IDS, campaignId);
  if (configured.includes(currentAccountId)) return true;
  const raw = await env.SIGILLO_KV.get(campaignKey(campaignId, "managed-actors:index"));
  const parsed = raw ? JSON.parse(raw) : null;
  const actors = Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed) ? parsed : [];
  return actors.some((actor) => (Array.isArray(actor?.ownerAccountIds) ? actor.ownerAccountIds : [])
    .map(accountId).includes(currentAccountId));
}

async function readerFor(request, campaignId, env, services) {
  const user = await services.getOptionalAuthenticatedUser(request, env);
  const isEditor = Boolean(user && await services.isAuthenticatedCampaignContentEditor(user, env, campaignId));
  const participant = await isParticipant(user, campaignId, env, services, isEditor);
  return {
    user,
    isEditor,
    participant,
    accountId: user ? services.getAuthenticatedAccountId(user, env) : "",
  };
}

function canSeeEvent(event, reader) {
  if (event.status === "archived") return reader.isEditor;
  if (event.visibility === "public") return true;
  if (event.visibility === "players") return reader.participant || reader.isEditor;
  if (event.visibility === "dm") return reader.isEditor;
  return reader.isEditor || Boolean(reader.accountId && reader.accountId === accountId(event.ownerAccountId));
}

function canEditEvent(event, reader) {
  return reader.isEditor || Boolean(reader.accountId && reader.accountId === accountId(event.ownerAccountId));
}

function projectDocument(document, reader) {
  return {
    definition: document.definition,
    clock: document.clock,
    events: document.events.filter((event) => canSeeEvent(event, reader)).map((event) => ({
      ...event,
      canEdit: canEditEvent(event, reader),
    })),
  };
}

function documentResponse(document, campaignId, reader, corsHeaders, status = 200) {
  return response({
    ok: true,
    campaignId,
    schemaVersion: 2,
    source: document.source,
    version: document.version,
    updatedAt: document.updatedAt,
    updatedBy: document.updatedBy,
    calendar: projectDocument(document, reader),
    permissions: {
      authenticated: Boolean(reader.user),
      isParticipant: reader.participant,
      canEdit: reader.isEditor,
      canCreateNote: reader.participant || reader.isEditor,
    },
  }, status, corsHeaders, reader.user ? "private, no-store" : "public, max-age=30, must-revalidate");
}

async function bodyFrom(request, corsHeaders) {
  try {
    return await request.json();
  } catch (_) {
    return response({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }
}

function conflict(document, expectedVersion, corsHeaders) {
  if (!Number.isFinite(Number(expectedVersion)) || Number(expectedVersion) === document.version) return null;
  return response({
    ok: false,
    code: "VERSION_CONFLICT",
    error: "Il calendario ? cambiato online. Ricarica prima di salvare.",
    currentVersion: document.version,
    expectedVersion: Number(expectedVersion),
  }, 409, corsHeaders);
}

async function writerFor(request, campaignId, env, services, corsHeaders) {
  const user = await services.requireUser(request, env, corsHeaders);
  if (user instanceof Response) return user;
  const isEditor = await services.isAuthenticatedCampaignContentEditor(user, env, campaignId);
  const participant = await isParticipant(user, campaignId, env, services, isEditor);
  if (!participant && !isEditor) return response({ ok: false, error: "Forbidden: campaign access required" }, 403, corsHeaders);
  return { user, isEditor, participant, accountId: services.getAuthenticatedAccountId(user, env) };
}

export async function handleCalendarGet(request, campaignId, env, corsHeaders, services) {
  if (!env.SIGILLO_KV) return response({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  try {
    const reader = await readerFor(request, campaignId, env, services);
    return documentResponse(await readDocument(campaignId, env), campaignId, reader, corsHeaders);
  } catch (error) {
    return response({ ok: false, error: `Calendar read failed: ${error.message || error}` }, 500, corsHeaders);
  }
}

export async function handleLegacyCalendarGet(request, campaignId, env, corsHeaders, services) {
  if (!env.SIGILLO_KV) return response({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  const raw = await env.SIGILLO_KV.get(legacyCalendarKey(campaignId));
  if (!raw) return response({ ok: true, collection: "calendar", campaignId, source: "static", data: null }, 200, corsHeaders);
  const document = JSON.parse(raw);
  const reader = await readerFor(request, campaignId, env, services);
  const data = (Array.isArray(document.data) ? document.data : []).filter((entry) => {
    if (entry?.type !== "note") return true;
    if (entry.visibility === "private") return reader.isEditor || accountId(entry.ownerAccountId) === reader.accountId;
    return reader.participant || reader.isEditor;
  });
  return response({
    ok: true,
    collection: "calendar",
    campaignId,
    source: "kv",
    version: document.version || 1,
    updatedAt: document.updatedAt || null,
    updatedBy: document.updatedBy || null,
    data,
  }, 200, corsHeaders, reader.user ? "private, no-store" : "public, max-age=30, must-revalidate");
}

export async function handleCalendarEventUpsert(request, campaignId, env, corsHeaders, services) {
  if (!env.SIGILLO_KV) return response({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  const body = await bodyFrom(request, corsHeaders);
  if (body instanceof Response) return body;
  const writer = await writerFor(request, campaignId, env, services, corsHeaders);
  if (writer instanceof Response) return writer;
  const document = await readDocument(campaignId, env);
  const versionConflict = conflict(document, body.expectedVersion, corsHeaders);
  if (versionConflict) return versionConflict;
  const incomingId = id(body.event?.id) || `event-${crypto.randomUUID()}`;
  const index = document.events.findIndex((event) => event.id === incomingId);
  const existing = index >= 0 ? document.events[index] : null;
  const expectedRevision = Number(body.expectedRevision || 0);
  if (existing && expectedRevision !== existing.revision) {
    return response({ ok: false, code: "REVISION_CONFLICT", error: "Questo evento ? stato modificato da un altro utente.", currentRevision: existing.revision }, 409, corsHeaders);
  }
  if (!writer.isEditor && existing && accountId(existing.ownerAccountId) !== writer.accountId) {
    return response({ ok: false, error: "Forbidden: this note belongs to another user" }, 403, corsHeaders);
  }
  const now = new Date().toISOString();
  const raw = {
    ...body.event,
    id: incomingId,
    revision: existing ? existing.revision + 1 : 1,
    kind: writer.isEditor ? body.event?.kind : "note",
    visibility: writer.isEditor
      ? body.event?.visibility
      : body.event?.visibility === "players" ? "players" : "owner",
    ownerAccountId: writer.isEditor ? body.event?.ownerAccountId || existing?.ownerAccountId || writer.accountId : writer.accountId,
    ownerName: body.event?.ownerName || existing?.ownerName || text(writer.user.global_name || writer.user.username || writer.accountId, 120),
    status: body.event?.status === "archived" ? "scheduled" : body.event?.status,
    createdAt: existing?.createdAt || now,
    createdBy: existing?.createdBy || writer.accountId,
    updatedAt: now,
    updatedBy: writer.accountId,
  };
  const normalized = normalizeEvent(raw, document.definition, { fallbackId: incomingId, strict: true });
  if (!normalized) return response({ ok: false, error: "Data o ora dell'evento non valida per questo calendario." }, 400, corsHeaders);
  if (normalized.end) {
    const startOrdinal = dateOrdinal(normalized.start.date, document.definition);
    const endOrdinal = dateOrdinal(normalized.end.date, document.definition);
    const minutesPerHour = document.definition.timeSystem.minutesPerHour;
    const startTime = normalized.allDay ? 0 : normalized.start.time.hour * minutesPerHour + normalized.start.time.minute;
    const endTime = normalized.allDay ? 0 : normalized.end.time.hour * minutesPerHour + normalized.end.time.minute;
    if (endOrdinal < startOrdinal || (endOrdinal === startOrdinal && endTime < startTime)) {
      return response({ ok: false, error: "La fine non puo precedere l'inizio." }, 400, corsHeaders);
    }
  }
  const events = existing
    ? document.events.map((event, eventIndex) => eventIndex === index ? normalized : event)
    : [...document.events, normalized];
  const saved = await saveDocument({ ...document, events }, campaignId, writer.user, env, services);
  return documentResponse(saved, campaignId, writer, corsHeaders, existing ? 200 : 201);
}

export async function handleCalendarEventArchive(request, campaignId, env, corsHeaders, services) {
  const body = await bodyFrom(request, corsHeaders);
  if (body instanceof Response) return body;
  const writer = await writerFor(request, campaignId, env, services, corsHeaders);
  if (writer instanceof Response) return writer;
  const document = await readDocument(campaignId, env);
  const versionConflict = conflict(document, body.expectedVersion, corsHeaders);
  if (versionConflict) return versionConflict;
  const eventId = id(body.eventId);
  const index = document.events.findIndex((event) => event.id === eventId);
  if (index < 0) return response({ ok: false, error: "Evento non trovato" }, 404, corsHeaders);
  const existing = document.events[index];
  if (!writer.isEditor && accountId(existing.ownerAccountId) !== writer.accountId) {
    return response({ ok: false, error: "Forbidden: this note belongs to another user" }, 403, corsHeaders);
  }
  if (Number(body.expectedRevision || 0) !== existing.revision) {
    return response({ ok: false, code: "REVISION_CONFLICT", error: "Questo evento ? stato modificato da un altro utente." }, 409, corsHeaders);
  }
  const now = new Date().toISOString();
  const archived = { ...existing, status: "archived", revision: existing.revision + 1, updatedAt: now, updatedBy: writer.accountId };
  const events = document.events.map((event, eventIndex) => eventIndex === index ? archived : event);
  const saved = await saveDocument({ ...document, events }, campaignId, writer.user, env, services);
  return documentResponse(saved, campaignId, writer, corsHeaders);
}

export async function handleCalendarClockPost(request, campaignId, env, corsHeaders, services) {
  const body = await bodyFrom(request, corsHeaders);
  if (body instanceof Response) return body;
  const writer = await writerFor(request, campaignId, env, services, corsHeaders);
  if (writer instanceof Response) return writer;
  if (!writer.isEditor) return response({ ok: false, error: "Forbidden: only the campaign DM can change time" }, 403, corsHeaders);
  const document = await readDocument(campaignId, env);
  const versionConflict = conflict(document, body.expectedVersion, corsHeaders);
  if (versionConflict) return versionConflict;
  if (Number(body.expectedRevision || 0) !== document.clock.revision) {
    return response({ ok: false, code: "REVISION_CONFLICT", error: "La data della campagna e gia cambiata." }, 409, corsHeaders);
  }
  let clock;
  if (body.delta && typeof body.delta === "object") {
    clock = shiftClock(document.clock, body.delta.amount, body.delta.unit, document.definition);
  } else {
    clock = normalizeClock(body.clock, document.definition, true);
  }
  if (!clock) return response({ ok: false, error: "Data o ora non valida per questo calendario." }, 400, corsHeaders);
  clock = {
    ...clock,
    revision: document.clock.revision + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: writer.accountId,
  };
  const saved = await saveDocument({ ...document, clock }, campaignId, writer.user, env, services);
  return documentResponse(saved, campaignId, writer, corsHeaders);
}

export async function handleCalendarConfigPost(request, campaignId, env, corsHeaders, services) {
  const body = await bodyFrom(request, corsHeaders);
  if (body instanceof Response) return body;
  const writer = await writerFor(request, campaignId, env, services, corsHeaders);
  if (writer instanceof Response) return writer;
  if (!writer.isEditor) return response({ ok: false, error: "Forbidden: only the campaign DM can configure the calendar" }, 403, corsHeaders);
  const document = await readDocument(campaignId, env);
  const versionConflict = conflict(document, body.expectedVersion, corsHeaders);
  if (versionConflict) return versionConflict;
  const definition = normalizeDefinition({ ...body.definition, revision: document.definition.revision + 1 });
  const clock = normalizeClock({ ...(body.clock || document.clock), revision: document.clock.revision + 1 }, definition, true);
  if (!clock) return response({ ok: false, error: "La data corrente non ? valida con la nuova configurazione." }, 400, corsHeaders);
  const invalidEventIds = document.events
    .filter((event) => !normalizeEvent(event, definition, { fallbackId: event.id, strict: true }))
    .map((event) => event.id)
    .slice(0, 30);
  if (invalidEventIds.length) {
    return response({
      ok: false,
      code: "CONFIG_INVALIDATES_EVENTS",
      error: "La nuova configurazione renderebbe non validi alcuni eventi.",
      eventIds: invalidEventIds,
    }, 409, corsHeaders);
  }
  const events = document.events.map((event) => normalizeEvent(event, definition, { fallbackId: event.id, strict: true }));
  const now = new Date().toISOString();
  clock.updatedAt = now;
  clock.updatedBy = writer.accountId;
  const saved = await saveDocument({ ...document, definition, clock, events }, campaignId, writer.user, env, services);
  return documentResponse(saved, campaignId, writer, corsHeaders);
}
