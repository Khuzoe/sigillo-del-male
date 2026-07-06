const DEFAULT_CAMPAIGN_ID = "cripta-di-sangue";
const DEFAULT_NOTIFY_CAMPAIGNS = "cripta-di-sangue,mago-folle,oltre-il-velo";
const DISCORD_API_BASE = "https://discord.com/api/v10";
const ROME_TIMEZONE = "Europe/Rome";
const NOTIFICATION_TTL_SECONDS = 60 * 60 * 24 * 60;
const POLL_CREATED_TTL_SECONDS = 60 * 60 * 24 * 120;
const CRON_WINDOW_MINUTES = 17;

const ITALIAN_MONTHS = {
  gennaio: 1,
  febbraio: 2,
  marzo: 3,
  aprile: 4,
  maggio: 5,
  giugno: 6,
  luglio: 7,
  agosto: 8,
  settembre: 9,
  ottobre: 10,
  novembre: 11,
  dicembre: 12,
};

const ROME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: ROME_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export async function handleDiscordBotDmNotifications(event, env) {
  if (!env?.SIGILLO_KV) return;
  if (!String(env.DISCORD_BOT_TOKEN || "").trim()) return;

  const nowMs = Number.isFinite(event?.scheduledTime) ? Number(event.scheduledTime) : Date.now();
  const campaignIds = getBotCampaignIds(env);

  for (const campaignId of campaignIds) {
    try {
      await handleCampaignDmNotifications(env, campaignId, nowMs);
    } catch (error) {
      console.error("Discord bot campaign notification failed", {
        campaignId,
        message: error?.message || String(error),
      });
    }
  }
}

export function discordBotPreferencesKey(campaignId, accountId) {
  return campaignKey(campaignId, `discord-bot/preferences/${sanitizeAccountId(accountId)}`);
}

export function normalizeDiscordBotPreferences(input = {}) {
  const minutesWasProvided = Object.prototype.hasOwnProperty.call(input, "sessionReminderMinutes")
    || Object.prototype.hasOwnProperty.call(input, "advanceReminderMinutes")
    || Object.prototype.hasOwnProperty.call(input, "minutesBeforeSession");
  const rawMinutes = input.sessionReminderMinutes ?? input.advanceReminderMinutes ?? input.minutesBeforeSession;
  const parsedMinutes = Number(rawMinutes);
  const sessionReminderMinutes = Number.isFinite(parsedMinutes)
    ? clamp(Math.round(parsedMinutes), 0, 1440)
    : 60;

  const sessionAdvanceReminderEnabled = sessionReminderMinutes > 0 && booleanWithDefault(
    input.sessionAdvanceReminderEnabled ?? input.advanceReminderEnabled,
    minutesWasProvided ? sessionReminderMinutes > 0 : false
  );

  return {
    campaignId: sanitizeCampaignId(input.campaignId || ""),
    accountId: sanitizeAccountId(input.accountId || ""),
    discordId: sanitizeDiscordId(input.discordId || ""),
    dmEnabled: booleanWithDefault(input.dmEnabled, true),
    pollRemindersEnabled: booleanWithDefault(input.pollRemindersEnabled, true),
    sessionDayReminderEnabled: booleanWithDefault(input.sessionDayReminderEnabled, true),
    sessionAdvanceReminderEnabled,
    sessionReminderMinutes,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : "",
  };
}

async function handleCampaignDmNotifications(env, campaignId, nowMs) {
  const session = await loadCurrentSession(env, campaignId);
  if (!session || typeof session !== "object") return;
  if (session.disableDiscordNotifications) return;

  const numberKey = getSessionNumberKey(session);
  if (!numberKey) return;

  const [participants, votesDoc] = await Promise.all([
    loadCampaignParticipants(env, campaignId),
    loadSessionVotes(env, campaignId, numberKey),
  ]);
  if (!participants.length) return;

  const preferences = await loadPreferencesForParticipants(env, campaignId, participants);

  await notifyUnvotedPlayers(env, campaignId, session, numberKey, participants, votesDoc, preferences, nowMs);
  await notifySessionDay(env, campaignId, session, numberKey, participants, preferences, nowMs);
  await notifySessionAdvance(env, campaignId, session, numberKey, participants, preferences, nowMs);
}

async function notifyUnvotedPlayers(env, campaignId, session, numberKey, participants, votesDoc, preferences, nowMs) {
  if (session.isScheduled) return;
  if (!Array.isArray(session.availabilityOptions) || !session.availabilityOptions.length) return;

  const createdMs = await getPollCreatedMs(env, campaignId, numberKey, session, nowMs);
  if (!shouldSendPollReminder(env, createdMs, nowMs)) return;

  const today = getRomeDateTimeParts(nowMs).date;
  const campaignName = getCampaignName(session, campaignId);
  const pollUrl = getPollUrl(env, campaignId);

  for (const participant of participants) {
    const pref = preferences.get(participant.accountId) || normalizeDiscordBotPreferences();
    if (!canReceiveDm(participant, pref) || !pref.pollRemindersEnabled) continue;
    if (hasParticipantVoted(votesDoc, session, participant)) continue;

    const markerKey = campaignKey(campaignId, `discord-bot/sent/poll-unvoted/${numberKey}/${today}/${participant.accountId}`);
    const content = [
      `Ciao ${participant.displayName}, non hai ancora votato il sondaggio della sessione ${numberKey} di ${campaignName}.`,
      `Puoi votare qui: ${pollUrl}`,
    ].join("\n");

    await sendTrackedDm(env, markerKey, participant.discordId, content);
  }
}

async function notifySessionDay(env, campaignId, session, numberKey, participants, preferences, nowMs) {
  if (!session.isScheduled) return;

  const start = parseSessionStart(session, nowMs);
  if (!start) return;

  const now = getRomeDateTimeParts(nowMs);
  const reminderHour = getDayReminderHour(env);
  if (now.date !== start.date || now.hour !== reminderHour || now.minute >= 30) return;

  const campaignName = getCampaignName(session, campaignId);
  const sessionUrl = getPollUrl(env, campaignId);
  const today = now.date;
  const timeLabel = formatSessionTime(session);

  for (const participant of participants) {
    const pref = preferences.get(participant.accountId) || normalizeDiscordBotPreferences();
    if (!canReceiveDm(participant, pref) || !pref.sessionDayReminderEnabled) continue;

    const markerKey = campaignKey(campaignId, `discord-bot/sent/session-day/${numberKey}/${today}/${participant.accountId}`);
    const content = [
      `Promemoria: oggi c'e' la sessione ${numberKey} di ${campaignName}.`,
      timeLabel ? `Orario: ${timeLabel}` : "",
      `Dettagli: ${sessionUrl}`,
    ].filter(Boolean).join("\n");

    await sendTrackedDm(env, markerKey, participant.discordId, content);
  }
}

async function notifySessionAdvance(env, campaignId, session, numberKey, participants, preferences, nowMs) {
  if (!session.isScheduled) return;

  const start = parseSessionStart(session, nowMs);
  if (!start || nowMs >= start.utcMs) return;

  const campaignName = getCampaignName(session, campaignId);
  const sessionUrl = getPollUrl(env, campaignId);
  const timeLabel = formatSessionTime(session);

  for (const participant of participants) {
    const pref = preferences.get(participant.accountId) || normalizeDiscordBotPreferences();
    if (!canReceiveDm(participant, pref) || !pref.sessionAdvanceReminderEnabled) continue;

    const minutes = clamp(Number(pref.sessionReminderMinutes), 1, 1440);
    const targetMs = start.utcMs - minutes * 60 * 1000;
    const windowEndMs = targetMs + CRON_WINDOW_MINUTES * 60 * 1000;
    if (nowMs < targetMs || nowMs >= windowEndMs) continue;

    const markerKey = campaignKey(campaignId, `discord-bot/sent/session-advance/${numberKey}/${minutes}/${participant.accountId}`);
    const content = [
      `La sessione ${numberKey} di ${campaignName} inizia tra ${minutes} minuti.`,
      timeLabel ? `Orario: ${timeLabel}` : "",
      `Dettagli: ${sessionUrl}`,
    ].filter(Boolean).join("\n");

    await sendTrackedDm(env, markerKey, participant.discordId, content);
  }
}

async function loadCurrentSession(env, campaignId) {
  const raw = await getCampaignKv(
    env.SIGILLO_KV,
    sessionCurrentKey(campaignId),
    sanitizeCampaignId(campaignId) === DEFAULT_CAMPAIGN_ID ? "session/current" : ""
  );
  return safeJsonParse(raw);
}

async function loadSessionVotes(env, campaignId, numberKey) {
  const raw = await getCampaignKv(
    env.SIGILLO_KV,
    sessionVotesKey(campaignId, numberKey),
    sanitizeCampaignId(campaignId) === DEFAULT_CAMPAIGN_ID ? `session-votes/${numberKey}` : ""
  );
  return safeJsonParse(raw) || { votes: [] };
}

async function loadPreferencesForParticipants(env, campaignId, participants) {
  const map = new Map();

  for (const participant of participants) {
    const raw = await env.SIGILLO_KV.get(discordBotPreferencesKey(campaignId, participant.accountId));
    const stored = safeJsonParse(raw) || {};
    const prefs = normalizeDiscordBotPreferences({
      ...participant.notificationPreferences,
      ...stored,
      campaignId,
      accountId: participant.accountId,
      discordId: stored.discordId || participant.discordId,
    });
    map.set(participant.accountId, prefs);
  }

  return map;
}

async function loadCampaignParticipants(env, campaignId) {
  const [accounts, players] = await Promise.all([
    loadAccounts(env),
    loadCampaignPlayers(env, campaignId),
  ]);
  const accountById = new Map(accounts.map((account) => [sanitizeAccountId(account.id), account]));
  const accountByDiscordId = new Map(accounts.map((account) => [sanitizeDiscordId(account.discordId), account]).filter(([id]) => id));
  const participants = [];

  for (const player of players) {
    if (!player || typeof player !== "object") continue;
    if (player.isActive === false || player.hidden === true) continue;
    const role = String(player.campaignRole || player.role || "player").trim().toLowerCase();
    if (role && role !== "player") continue;

    const rawAccountId = sanitizeAccountId(player.accountId || "");
    const rawDiscordId = sanitizeDiscordId(player.discordId || "");
    const account = rawAccountId ? accountById.get(rawAccountId) : accountByDiscordId.get(rawDiscordId);
    const discordId = sanitizeDiscordId(rawDiscordId || account?.discordId || "");
    if (!discordId) continue;

    const accountId = sanitizeAccountId(rawAccountId || account?.id || player.id || discordId);
    if (!accountId) continue;

    participants.push({
      id: sanitizeAccountId(player.id || accountId),
      accountId,
      discordId,
      displayName: String(player.name || account?.name || accountId).trim() || accountId,
      notificationPreferences: extractInlinePreferences(player),
    });
  }

  return dedupeParticipants(participants);
}

async function loadAccounts(env) {
  const url = new URL("assets/data/users.json", getFrontendBaseUrl(env));
  const data = await fetchJson(url.toString());
  return Array.isArray(data) ? data : [];
}

async function loadCampaignPlayers(env, campaignId) {
  const cleanCampaignId = sanitizeCampaignId(campaignId);
  const path = cleanCampaignId === DEFAULT_CAMPAIGN_ID
    ? "assets/data/players.json"
    : `campaigns/${cleanCampaignId}/data/players.json`;
  const data = await fetchJson(new URL(path, getFrontendBaseUrl(env)).toString());
  if (Array.isArray(data)) return data;

  if (cleanCampaignId !== DEFAULT_CAMPAIGN_ID) {
    const fallback = await fetchJson(new URL("assets/data/players.json", getFrontendBaseUrl(env)).toString());
    return Array.isArray(fallback) ? fallback : [];
  }

  return [];
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 300 } });
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    console.error("Discord bot data fetch failed", { url, message: error?.message || String(error) });
    return null;
  }
}

async function getPollCreatedMs(env, campaignId, numberKey, session, nowMs) {
  const explicitMs = parseIsoMs(session.createdAt || session.pollCreatedAt || session.created || session.updatedAt);
  if (Number.isFinite(explicitMs)) return explicitMs;

  const key = campaignKey(campaignId, `discord-bot/poll-created/${numberKey}`);
  const existing = await env.SIGILLO_KV.get(key);
  const existingMs = parseIsoMs(existing);
  if (Number.isFinite(existingMs)) return existingMs;

  const iso = new Date(nowMs).toISOString();
  await env.SIGILLO_KV.put(key, iso, { expirationTtl: POLL_CREATED_TTL_SECONDS });
  return nowMs;
}

function shouldSendPollReminder(env, createdMs, nowMs) {
  const intervalDays = clamp(Number(env.DISCORD_BOT_POLL_REMINDER_DAYS || 2), 1, 30);
  const createdDay = localDateToOrdinal(getRomeDateTimeParts(createdMs).date);
  const nowDay = localDateToOrdinal(getRomeDateTimeParts(nowMs).date);
  const daysSinceCreation = nowDay - createdDay;
  return daysSinceCreation > 0 && daysSinceCreation % intervalDays === 0;
}

function hasParticipantVoted(votesDoc, session, participant) {
  const voteRecords = [];
  if (Array.isArray(votesDoc?.votes)) voteRecords.push(...votesDoc.votes);
  if (Array.isArray(session?.votes)) voteRecords.push(...session.votes);
  if (Array.isArray(session?.availabilityVotes)) voteRecords.push(...session.availabilityVotes);

  return voteRecords.some((record) => recordMatchesParticipant(record, participant) && voteRecordHasSelection(record));
}

function recordMatchesParticipant(record, participant) {
  const accountId = sanitizeAccountId(record?.accountId || record?.playerId || record?.id || "");
  const discordId = sanitizeDiscordId(record?.discordId || "");
  const characterId = sanitizeAccountId(record?.characterId || record?.playerCharacterId || "");
  return accountId === participant.accountId
    || accountId === participant.id
    || characterId === participant.id
    || (discordId && discordId === participant.discordId);
}

function voteRecordHasSelection(record) {
  const direct = String(record?.value || record?.vote || record?.status || "").trim().toLowerCase();
  if (["yes", "no", "maybe"].includes(direct)) return true;

  for (const key of ["selections", "availability", "choices"]) {
    const value = record?.[key];
    if (!value || typeof value !== "object") continue;
    if (Object.values(value).some((entry) => ["yes", "no", "maybe"].includes(String(entry || "").trim().toLowerCase()))) {
      return true;
    }
  }

  return false;
}

async function sendTrackedDm(env, markerKey, discordId, content) {
  if (await env.SIGILLO_KV.get(markerKey)) return;

  const result = await sendDiscordDm(env, discordId, content);
  if (!result.ok) {
    console.error("Discord bot DM failed", {
      status: result.status,
      permanent: result.permanent,
      message: result.error || "unknown error",
    });
    if (!result.permanent) return;
  }

  await env.SIGILLO_KV.put(
    markerKey,
    JSON.stringify({ ok: result.ok, status: result.status || 0, sentAt: new Date().toISOString() }),
    { expirationTtl: NOTIFICATION_TTL_SECONDS }
  );
}

async function sendDiscordDm(env, discordId, content) {
  const token = String(env.DISCORD_BOT_TOKEN || "").trim();
  const recipientId = sanitizeDiscordId(discordId);
  if (!token || !recipientId) return { ok: false, status: 0, permanent: true, error: "missing bot token or recipient" };

  const dmResponse = await discordApiJson(token, "/users/@me/channels", {
    method: "POST",
    body: { recipient_id: recipientId },
  });
  if (!dmResponse.ok) return dmResponse;

  const channelId = sanitizeDiscordId(dmResponse.data?.id || "");
  if (!channelId) return { ok: false, status: 0, permanent: true, error: "missing dm channel id" };

  return discordApiJson(token, `/channels/${channelId}/messages`, {
    method: "POST",
    body: {
      content,
      allowed_mentions: { parse: [] },
    },
  });
}

async function discordApiJson(token, path, init = {}) {
  try {
    const response = await fetch(`${DISCORD_API_BASE}${path}`, {
      method: init.method || "GET",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await response.text();
    const data = safeJsonParse(text) || null;
    return {
      ok: response.ok,
      status: response.status,
      data,
      permanent: [400, 403, 404].includes(response.status),
      error: response.ok ? "" : (data?.message || text || `Discord HTTP ${response.status}`),
    };
  } catch (error) {
    return { ok: false, status: 0, data: null, permanent: false, error: error?.message || String(error) };
  }
}

function parseSessionStart(session, nowMs) {
  const timeMatch = String(session?.timeStart || "").match(/\b(\d{1,2}):(\d{2})\b/);
  if (!timeMatch) return null;

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  const date = parseSessionDate(session?.date, nowMs);
  if (!date) return null;

  const utcMs = romeDateTimeToUtcMs(date.year, date.month, date.day, hour, minute);
  return {
    date: formatDate(date.year, date.month, date.day),
    minutes: hour * 60 + minute,
    utcMs,
  };
}

function parseSessionDate(value, nowMs) {
  const raw = String(value || "").trim();
  const iso = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  }

  const normalized = normalizeTextForMatch(raw);
  const italian = normalized.match(/\b(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?\b/);
  if (!italian) return null;

  const now = getRomeDateTimeParts(nowMs);
  const nowYear = Number(now.date.slice(0, 4));
  const day = Number(italian[1]);
  const month = ITALIAN_MONTHS[italian[2]];
  let year = italian[3] ? Number(italian[3]) : nowYear;
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;

  if (!italian[3]) {
    const candidate = localDateToOrdinal(formatDate(year, month, day));
    const today = localDateToOrdinal(now.date);
    if (candidate < today - 183) year += 1;
  }

  return { year, month, day };
}

function romeDateTimeToUtcMs(year, month, day, hour, minute) {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let offset = getRomeOffsetMinutes(utcMs);
  utcMs -= offset * 60 * 1000;
  const correctedOffset = getRomeOffsetMinutes(utcMs);
  if (correctedOffset !== offset) {
    utcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0) - correctedOffset * 60 * 1000;
  }
  return utcMs;
}

function getRomeOffsetMinutes(utcMs) {
  const parts = getRomeDateTimeParts(utcMs);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
  return Math.round((localAsUtc - utcMs) / 60000);
}

function getRomeDateTimeParts(ms = Date.now()) {
  const parts = ROME_FORMATTER.formatToParts(new Date(ms));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(map.hour === "24" ? "0" : map.hour);
  const minute = Number(map.minute || "0");
  const year = Number(map.year || "0");
  const month = Number(map.month || "0");
  const day = Number(map.day || "0");
  return {
    year,
    month,
    day,
    hour,
    minute,
    date: formatDate(year, month, day),
    minutes: hour * 60 + minute,
  };
}

function getBotCampaignIds(env) {
  const raw = env.DISCORD_BOT_NOTIFY_CAMPAIGNS || env.SESSION_START_NOTIFY_CAMPAIGNS || DEFAULT_NOTIFY_CAMPAIGNS;
  return [...new Set(String(raw).split(/[\s,;]+/).map(sanitizeCampaignId).filter(Boolean))];
}

function getDayReminderHour(env) {
  return clamp(Number(env.DISCORD_BOT_DAY_REMINDER_HOUR || 10), 0, 23);
}

function getSessionNumberKey(session) {
  const number = Number(session?.number);
  if (Number.isInteger(number) && number > 0) return String(number);
  const fallback = sanitizeAccountId(session?.id || session?.sessionId || "");
  return fallback || "current";
}

function getCampaignName(session, campaignId) {
  return String(session?.campaignName || "").trim() || prettyCampaignId(campaignId);
}

function prettyCampaignId(campaignId) {
  return sanitizeCampaignId(campaignId)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatSessionTime(session) {
  const start = String(session?.timeStart || "").trim();
  const end = String(session?.timeEnd || "").trim();
  if (!start) return "";
  return end ? `${start} - ${end}` : start;
}

function getPollUrl(env, campaignId) {
  const url = new URL("pages/sondaggio.html", getFrontendBaseUrl(env));
  if (sanitizeCampaignId(campaignId) !== DEFAULT_CAMPAIGN_ID) {
    url.searchParams.set("campaign", sanitizeCampaignId(campaignId));
  }
  return url.toString();
}

function getFrontendBaseUrl(env) {
  const raw = String(env.FE_URL || "https://khuzoe.github.io/sigillo-del-male/").trim();
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function extractInlinePreferences(player) {
  const source = player?.discordBotPreferences || player?.notificationPreferences || player?.notifications || {};
  if (!source || typeof source !== "object") return {};
  return normalizeDiscordBotPreferences(source);
}

function canReceiveDm(participant, preferences) {
  return Boolean(participant?.discordId && preferences?.dmEnabled !== false);
}

function dedupeParticipants(participants) {
  const seen = new Set();
  const out = [];
  for (const participant of participants) {
    const key = participant.accountId || participant.discordId;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(participant);
  }
  return out;
}

function campaignKey(campaignId, key) {
  return `campaign:${sanitizeCampaignId(campaignId)}:${key}`;
}

async function getCampaignKv(kv, key, legacyKey = "") {
  const raw = await kv.get(key);
  if (raw !== null && raw !== undefined) return raw;
  if (legacyKey && legacyKey !== key) return kv.get(legacyKey);
  return raw;
}

function sessionCurrentKey(campaignId = DEFAULT_CAMPAIGN_ID) {
  return campaignKey(campaignId, "session/current");
}

function sessionVotesKey(campaignId, number) {
  return campaignKey(campaignId, `session-votes/${number}`);
}

function sanitizeCampaignId(value) {
  const campaignId = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!campaignId || campaignId.length > 64) return DEFAULT_CAMPAIGN_ID;
  return campaignId;
}

function sanitizeAccountId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function sanitizeDiscordId(value) {
  const id = String(value || "").trim();
  return /^\d{5,32}$/.test(id) ? id : "";
}

function safeJsonParse(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function booleanWithDefault(value, fallback) {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function parseIsoMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : NaN;
}

function localDateToOrdinal(date) {
  const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return NaN;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
}

function formatDate(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeTextForMatch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
