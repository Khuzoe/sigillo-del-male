const SCHEMA_VERSION = 1;
const MAX_GROUPS = 24;
const MAX_CURRENCIES = 80;
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const SYSTEM_PATH = /^system(?:\.[A-Za-z0-9_-]+)+$/;
const FLAG_PATH = /^flags\.khuzoe-merchant\.wallet\.[a-z0-9][a-z0-9_-]{0,39}$/;

function response(data, status = 200, corsHeaders = {}, cacheControl = "no-store") {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": cacheControl, ...corsHeaders },
  });
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value, fallback = "", max = 120) {
  const clean = String(value || "").trim().slice(0, max);
  return clean || fallback;
}

function id(value, fallback = "") {
  const clean = String(value || "").trim().toLowerCase();
  return ID_PATTERN.test(clean) ? clean : fallback;
}

function campaignId(value) {
  return String(value || "cripta-di-sangue").trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "cripta-di-sangue";
}

function economyKey(value) {
  return `campaign:${campaignId(value)}:economy:v1`;
}

function defaultRegistry() {
  return {
    schemaVersion: 1,
    revision: 1,
    updatedAt: "",
    groups: [{
      id: "common-coins",
      name: "Conio comune",
      conversionMode: "automatic",
      baseCurrencyId: "cp",
      order: 100,
      currencies: [
        ["pp", "Platino", 1000, 50],
        ["gp", "Oro", 100, 40],
        ["ep", "Electrum", 50, 30],
        ["sp", "Argento", 10, 20],
        ["cp", "Rame", 1, 10],
      ].map(([currencyId, name, factor, order]) => ({
        id: currencyId,
        name,
        symbol: currencyId,
        factor,
        precision: 0,
        order,
        color: "#d8a94d",
        icon: "",
        active: true,
        storage: { kind: "system", path: `system.currency.${currencyId}` },
      })),
    }],
  };
}

function normalizeStorage(value, currencyId, previous = null) {
  if (previous?.path && (SYSTEM_PATH.test(previous.path) || FLAG_PATH.test(previous.path))) return previous;
  const requested = text(value?.path, `flags.khuzoe-merchant.wallet.${currencyId}`, 120);
  if (SYSTEM_PATH.test(requested)) return { kind: "system", path: requested };
  if (FLAG_PATH.test(requested)) return { kind: "flag", path: requested };
  return { kind: "flag", path: `flags.khuzoe-merchant.wallet.${currencyId}` };
}

function previousCurrencies(document) {
  return new Map((document?.registry?.groups || []).flatMap((group) => group.currencies || []).map((currency) => [currency.id, currency]));
}

function normalizeRegistry(value, previousDocument = null) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const previous = previousCurrencies(previousDocument);
  const seen = new Set();
  const groups = [];
  let currencyCount = 0;
  for (const [groupIndex, rawGroup] of (Array.isArray(source.groups) ? source.groups : []).slice(0, MAX_GROUPS).entries()) {
    const groupId = id(rawGroup?.id, `group-${groupIndex + 1}`);
    const currencies = [];
    for (const [currencyIndex, rawCurrency] of (Array.isArray(rawGroup?.currencies) ? rawGroup.currencies : []).entries()) {
      if (currencyCount >= MAX_CURRENCIES) break;
      const currencyId = id(rawCurrency?.id, `${groupId}-${currencyIndex + 1}`);
      if (!currencyId || seen.has(currencyId)) continue;
      seen.add(currencyId);
      currencyCount += 1;
      const old = previous.get(currencyId);
      currencies.push({
        id: currencyId,
        name: text(rawCurrency?.name, currencyId.toUpperCase(), 60),
        symbol: text(rawCurrency?.symbol, currencyId, 16),
        factor: Math.max(0.0001, Math.min(1_000_000_000, number(rawCurrency?.factor, 1))),
        precision: Math.max(0, Math.min(4, Math.trunc(number(rawCurrency?.precision, 0)))),
        order: Math.max(-10000, Math.min(10000, number(rawCurrency?.order, 0))),
        color: /^#[0-9a-f]{6}$/i.test(String(rawCurrency?.color || "")) ? String(rawCurrency.color) : "#d8a94d",
        icon: text(rawCurrency?.icon, "", 240),
        active: rawCurrency?.active !== false,
        storage: normalizeStorage(rawCurrency?.storage, currencyId, old?.storage),
      });
    }
    if (!currencies.length) continue;
    const requestedBase = id(rawGroup?.baseCurrencyId);
    groups.push({
      id: groupId,
      name: text(rawGroup?.name, `Gruppo ${groupIndex + 1}`, 60),
      conversionMode: rawGroup?.conversionMode === "automatic" ? "automatic" : "none",
      baseCurrencyId: currencies.some((currency) => currency.id === requestedBase)
        ? requestedBase
        : [...currencies].sort((left, right) => left.factor - right.factor)[0].id,
      order: Math.max(-10000, Math.min(10000, number(rawGroup?.order, 0))),
      currencies,
    });
  }

  // Omitted currencies are archived, never deleted implicitly. This keeps old
  // Actor balances and prices recoverable during the transition.
  for (const oldGroup of previousDocument?.registry?.groups || []) {
    const missing = (oldGroup.currencies || []).filter((currency) => !seen.has(currency.id));
    if (!missing.length) continue;
    let target = groups.find((group) => group.id === oldGroup.id);
    if (!target) {
      target = { ...oldGroup, currencies: [] };
      groups.push(target);
    }
    target.currencies.push(...missing.map((currency) => ({ ...currency, active: false })));
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    revision: Math.max(1, Math.trunc(number(source.revision, 1))),
    updatedAt: text(source.updatedAt, "", 64),
    groups: groups.length ? groups : defaultRegistry().groups,
  };
}

function normalizeDocument(value, source = "kv") {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    schemaVersion: SCHEMA_VERSION,
    version: Math.max(0, Math.trunc(number(input.version, 0))),
    worldId: text(input.worldId, "", 96),
    updatedAt: input.updatedAt || null,
    updatedBy: input.updatedBy || null,
    registry: normalizeRegistry(input.registry || input.economy || input),
    source,
  };
}

async function readDocument(campaign, env) {
  const raw = await env.SIGILLO_KV.get(economyKey(campaign));
  return raw ? normalizeDocument(JSON.parse(raw), "kv") : normalizeDocument({ registry: defaultRegistry() }, "default");
}

function payload(document, campaign, canEdit) {
  return {
    ok: true,
    campaignId: campaignId(campaign),
    schemaVersion: SCHEMA_VERSION,
    version: document.version,
    worldId: document.worldId,
    updatedAt: document.updatedAt,
    updatedBy: document.updatedBy,
    source: document.source,
    registry: document.registry,
    permissions: { canEdit },
  };
}

export async function handleEconomyGet(request, campaign, env, corsHeaders, services) {
  if (!env.SIGILLO_KV) return response({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  const user = await services.getOptionalAuthenticatedUser(request, env);
  const canEdit = Boolean(user && await services.isAuthenticatedCampaignContentEditor(user, env, campaign));
  const document = await readDocument(campaign, env);
  return response(payload(document, campaign, canEdit), 200, corsHeaders, user ? "private, no-store" : "public, max-age=30, must-revalidate");
}

export async function handleEconomyPost(request, campaign, env, corsHeaders, services, ctx) {
  if (!env.SIGILLO_KV) return response({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  let body;
  try {
    body = await request.json();
  } catch {
    return response({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }
  const foundryAuthorized = services.isFoundrySyncSecretAuthorized(request, env);
  let user = null;
  if (!foundryAuthorized) {
    user = await services.requireUser(request, env, corsHeaders);
    if (user instanceof Response) return user;
    if (!await services.isAuthenticatedCampaignContentEditor(user, env, campaign)) {
      return response({ ok: false, error: "Forbidden: economy editing requires campaign editor permissions" }, 403, corsHeaders);
    }
  }

  const current = await readDocument(campaign, env);
  if (!Number.isFinite(Number(body?.expectedVersion)) || Number(body.expectedVersion) !== current.version) {
    return response({
      ok: false,
      code: "VERSION_CONFLICT",
      error: "Le valute sono cambiate online. Ricarica prima di salvare.",
      currentVersion: current.version,
      expectedVersion: Number(body?.expectedVersion),
    }, 409, corsHeaders);
  }
  const registry = normalizeRegistry(body?.registry || body?.economy, current);
  const now = new Date().toISOString();
  registry.revision = Math.max(current.registry.revision + 1, registry.revision);
  registry.updatedAt = now;
  const next = {
    schemaVersion: SCHEMA_VERSION,
    version: current.version + 1,
    worldId: text(body?.worldId, current.worldId, 96),
    updatedAt: now,
    updatedBy: foundryAuthorized ? "foundry" : services.getAuthenticatedAccountId(user, env),
    registry,
  };
  const serialized = JSON.stringify(next);
  if (serialized.length > 256 * 1024) return response({ ok: false, error: "Economy payload too large" }, 413, corsHeaders);
  await env.SIGILLO_KV.put(economyKey(campaign), serialized);
  services.scheduleFoundryLiveInvalidation(ctx, env, {
    campaignId: campaign,
    worldId: next.worldId,
    collections: ["economy"],
    reason: foundryAuthorized ? "foundry-economy-update" : "site-economy-update",
    revision: next.version,
  });
  return response(payload(normalizeDocument(next), campaign, true), 200, corsHeaders);
}

export const economyInternals = {
  defaultRegistry,
  normalizeRegistry,
  normalizeDocument,
  economyKey,
};
