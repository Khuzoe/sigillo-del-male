const DEFAULT_CAMPAIGN_ID = "cripta-di-sangue";
const MAX_BATCH_ITEMS = 64;
const MAX_BODY_BYTES = 1024 * 1024;

export function normalizeCampaignItemsForSiteSave(existingData, requestedData) {
  const existing = Array.isArray(existingData) ? existingData : [];
  const requested = Array.isArray(requestedData) ? requestedData : [];
  const existingById = new Map(existing.map((item) => [campaignItemId(item), item]).filter(([id]) => id));
  const existingByFoundryItem = new Map(existing
    .map((item) => [`${sanitizeId(item?.foundry?.worldId)}:${String(item?.foundry?.itemId || "")}`, item])
    .filter(([key]) => key !== ":"));

  return requested.slice(0, 2_000).map((input) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    let id = campaignItemId(input);
    const foundryKey = `${sanitizeId(input?.foundry?.worldId)}:${String(input?.foundry?.itemId || "")}`;
    let previous = existingById.get(id) || (foundryKey !== ":" ? existingByFoundryItem.get(foundryKey) : null);
    if (previous) id = campaignItemId(previous);
    if (!id) return null;

    const next = { ...input, id };
    const previousSync = normalizeSyncState(previous?.sync);
    const foundry = normalizeSiteFoundryState(input?.foundry, previous?.foundry);
    if (foundry) next.foundry = foundry;
    else delete next.foundry;
    const changed = !previous || stableStringify(campaignItemSiteFingerprint(next)) !== stableStringify(campaignItemSiteFingerprint(previous));
    next.sync = changed
      ? {
          ...previousSync,
          managed: true,
          pendingFoundry: true,
          source: "site",
          siteRevision: Number(previousSync.siteRevision || 0) + 1,
          updatedAt: new Date().toISOString(),
        }
      : previousSync;
    return next;
  }).filter(Boolean);
}

export async function handleCampaignItemFoundrySync(request, fallbackCampaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  if (!isFoundrySecretAuthorized(request, env)) return json({ ok: false, error: "Forbidden" }, 403, corsHeaders);

  const rawText = await request.text();
  if (rawText.length > MAX_BODY_BYTES) return json({ ok: false, error: "Campaign item sync payload too large" }, 413, corsHeaders);
  let body;
  try { body = rawText ? JSON.parse(rawText) : {}; }
  catch (_) { return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders); }

  const campaignId = sanitizeCampaignId(body?.campaignId || body?.campaign || fallbackCampaignId);
  const worldId = sanitizeId(body?.worldId);
  if (!worldId) return json({ ok: false, error: "Missing worldId" }, 400, corsHeaders);
  const incoming = (Array.isArray(body?.items) ? body.items : []).slice(0, MAX_BATCH_ITEMS);
  if (!incoming.length) return json({ ok: false, error: "No campaign items supplied" }, 400, corsHeaders);

  const key = campaignDataItemsKey(campaignId);
  const stored = safeJsonParse(await env.SIGILLO_KV.get(key));
  const startingVersion = Number(stored?.version || 0);
  let data = Array.isArray(stored?.data) ? stored.data.slice() : [];
  if (!data.length) {
    const seed = Array.isArray(body?.seedData) ? body.seedData.slice(0, 2_000) : [];
    if (!seed.length) return json({ ok: false, error: "Catalog seed required before first Foundry sync", code: "CATALOG_SEED_REQUIRED" }, 409, corsHeaders);
    if (JSON.stringify(seed).length > 900 * 1024) return json({ ok: false, error: "Catalog seed too large" }, 413, corsHeaders);
    data = seed.filter((item) => item && typeof item === "object" && !Array.isArray(item));
  }

  const results = [];
  let changed = false;
  for (const entry of incoming) {
    const id = campaignItemId(entry);
    const document = normalizeFoundrySnapshot(entry?.document, worldId, campaignId);
    if (!id || !document) {
      results.push({ campaignItemId: id || "", status: "invalid" });
      continue;
    }
    const index = data.findIndex((item) => campaignItemId(item) === id
      || (String(item?.foundry?.itemId || "") === document.itemId && sanitizeId(item?.foundry?.worldId) === worldId));
    const previous = index >= 0 ? data[index] : null;
    const previousSync = normalizeSyncState(previous?.sync);
    const appliedSiteRevision = Math.max(0, Math.floor(Number(entry?.appliedSiteRevision || 0)));
    if (previousSync.pendingFoundry && appliedSiteRevision !== Number(previousSync.siteRevision || 0)) {
      results.push({ campaignItemId: id, status: "conflict", siteRevision: Number(previousSync.siteRevision || 0) });
      continue;
    }

    const previousDocument = previous?.foundry?.document || null;
    const foundryHash = document.hash;
    const unchanged = previous
      && foundryHash === String(previous?.foundry?.hash || previousSync.foundryHash || "")
      && !previousSync.pendingFoundry;
    if (unchanged) {
      results.push({ campaignItemId: id, status: "unchanged" });
      continue;
    }

    const now = new Date().toISOString();
    const next = previous ? { ...previous, id: campaignItemId(previous) || id } : buildNewCampaignItem(id, document);
    const previousNameFollowedFoundry = !previous || !previousDocument?.name || String(previous.name || "") === String(previousDocument.name || "");
    if (previousNameFollowedFoundry || previousSync.pendingFoundry) next.name = document.document.name;
    const previousImageFollowedFoundry = !previous || !previous?.image || String(previous.image || "") === String(previousDocument?.img || "");
    if ((previousImageFollowedFoundry || previousSync.pendingFoundry) && isPublicItemImage(document.document.img)) next.image = toPublicMediaPath(document.document.img);
    next.foundryType = document.document.type;
    next.foundry = {
      worldId,
      itemId: document.itemId,
      uuid: document.uuid,
      folderPath: document.folderPath,
      document: document.document,
      hash: foundryHash,
      updatedAt: now,
    };
    next.sync = {
      ...previousSync,
      managed: true,
      pendingFoundry: false,
      source: "foundry",
      revision: Number(previousSync.revision || 0) + 1,
      foundryHash,
      updatedAt: now,
    };
    data[index >= 0 ? index : data.length] = next;
    changed = true;
    results.push({ campaignItemId: next.id, status: "saved", revision: next.sync.revision });
  }

  let version = Number(stored?.version || 0);
  let updatedAt = stored?.updatedAt || null;
  if (changed) {
    const latestStored = safeJsonParse(await env.SIGILLO_KV.get(key));
    if (Number(latestStored?.version || 0) !== startingVersion) {
      return json({ ok: false, error: "Campaign items changed during Foundry sync", code: "VERSION_CONFLICT" }, 409, { ...corsHeaders, "Cache-Control": "private, no-store" });
    }
    updatedAt = new Date().toISOString();
    version += 1;
    await env.SIGILLO_KV.put(key, JSON.stringify({
      version,
      collection: "items",
      campaignId,
      updatedAt,
      updatedBy: `Foundry: ${worldId}`,
      data,
    }));
  }

  return json({ ok: true, campaignId, worldId, saved: changed, version, updatedAt, results }, 200, { ...corsHeaders, "Cache-Control": "private, no-store" });
}

function normalizeFoundrySnapshot(input, worldId, campaignId) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const source = input.document;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const name = String(source.name || "").trim().slice(0, 180);
  const type = String(source.type || "").trim().toLowerCase().slice(0, 48);
  if (!name || !type) return null;
  const system = normalizeJsonObject(source.system || {}, 320 * 1024);
  const effects = normalizeJsonArray(source.effects || [], 96 * 1024);
  if (!system.valid || !effects.valid) return null;
  const img = normalizeItemImage(source.img, campaignId);
  if (img === null) return null;
  const document = { name, type, img, system: system.value, effects: effects.value };
  return {
    worldId,
    itemId: String(input.itemId || "").trim().slice(0, 96),
    uuid: String(input.uuid || "").trim().slice(0, 180),
    folderPath: String(input.folderPath || "").trim().slice(0, 300),
    document,
    hash: stableHash(document),
  };
}

function normalizeSiteFoundryState(input, previous) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : previous;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const result = {
    worldId: sanitizeId(previous?.worldId || source.worldId),
    itemId: String(previous?.itemId || source.itemId || "").trim().slice(0, 96),
    uuid: String(previous?.uuid || source.uuid || "").trim().slice(0, 180),
    folderPath: String(previous?.folderPath || source.folderPath || "").trim().slice(0, 300),
    document: source.document && typeof source.document === "object" && !Array.isArray(source.document)
      ? source.document
      : previous?.document,
    hash: String(previous?.hash || source.hash || "").trim().slice(0, 128),
    updatedAt: previous?.updatedAt || source.updatedAt || null,
  };
  return result.document ? result : null;
}

function campaignItemSiteFingerprint(item) {
  if (!item || typeof item !== "object") return null;
  const { sync: _sync, foundry: _foundry, ...presentation } = item;
  return { presentation, foundryDocument: item?.foundry?.document || null };
}

function normalizeSyncState(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    managed: source.managed === true,
    pendingFoundry: source.pendingFoundry === true,
    source: ["site", "foundry"].includes(source.source) ? source.source : "",
    siteRevision: Math.max(0, Math.floor(Number(source.siteRevision || 0))),
    revision: Math.max(0, Math.floor(Number(source.revision || 0))),
    foundryHash: String(source.foundryHash || "").slice(0, 128),
    updatedAt: source.updatedAt || null,
  };
}

function buildNewCampaignItem(id, snapshot) {
  const system = snapshot.document.system || {};
  const image = isPublicItemImage(snapshot.document.img) ? toPublicMediaPath(snapshot.document.img) : "";
  return {
    id,
    name: snapshot.document.name,
    type: siteTypeForFoundryType(snapshot.document.type),
    foundryType: snapshot.document.type,
    ...(image ? { image } : {}),
    ...(system.rarity ? { rarity: siteRarity(system.rarity) } : {}),
    ...(system.attunement === "required" || system.attunement === 1 || system.attunement === true ? { attunement: true } : {}),
    status: system.identified === false ? "unidentified" : "identified",
    summary: "",
    properties: [],
  };
}

function siteTypeForFoundryType(type) {
  return ({ weapon: "Arma", equipment: "Oggetto meraviglioso", consumable: "Consumabile", tool: "Strumento", loot: "Bottino", container: "Contenitore" })[type] || "Oggetto meraviglioso";
}

function siteRarity(value) {
  return ({ common: "Comune", uncommon: "Non comune", rare: "Raro", veryRare: "Molto raro", legendary: "Leggendario", artifact: "Artefatto" })[String(value || "")] || String(value || "");
}

function normalizeItemImage(value, campaignId) {
  const clean = String(value || "").trim().slice(0, 1_000);
  if (!clean) return "";
  if (clean.includes("..")) return null;
  if (/^media\/campaigns\/[a-z0-9_-]+\/items\/[A-Za-z0-9_./%+@-]+\.(png|jpe?g|webp|gif)$/i.test(clean)) return clean;
  if (new RegExp(`^https://sigillo-api\\.khuzoe\\.workers\\.dev/media/campaigns/${campaignId}/items/`, "i").test(clean)) return clean;
  if (/^(icons|systems|modules|worlds)\/[A-Za-z0-9_./%+@-]+\.(png|jpe?g|webp|gif|svg)$/i.test(clean)) return clean;
  return null;
}

function isPublicItemImage(value) {
  return /^media\//i.test(String(value || "")) || /^https:\/\//i.test(String(value || ""));
}

function toPublicMediaPath(value) {
  const clean = String(value || "").trim();
  const marker = clean.indexOf("/media/");
  return marker >= 0 ? clean.slice(marker + 1) : clean;
}

function normalizeJsonObject(value, maxBytes) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, value: null };
  const clean = sanitizeJsonValue(value);
  return JSON.stringify(clean).length <= maxBytes ? { valid: true, value: clean } : { valid: false, value: null };
}

function normalizeJsonArray(value, maxBytes) {
  if (!Array.isArray(value)) return { valid: false, value: null };
  const clean = sanitizeJsonValue(value);
  return JSON.stringify(clean).length <= maxBytes ? { valid: true, value: clean } : { valid: false, value: null };
}

function sanitizeJsonValue(value, depth = 0) {
  if (depth > 16 || value === null || value === undefined) return null;
  if (typeof value === "string") return value.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+\s*=\s*(["']).*?\1/gi, "").slice(0, 48_000);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 512).map((entry) => sanitizeJsonValue(entry, depth + 1));
  if (typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value).slice(0, 512)
    .filter(([key]) => !["__proto__", "prototype", "constructor"].includes(key))
    .map(([key, entry]) => [String(key).slice(0, 128), sanitizeJsonValue(entry, depth + 1)]));
}

function campaignItemId(value) {
  return sanitizeId(value?.campaignItemId || value?.id || value?.name);
}

function campaignDataItemsKey(campaignId) {
  return `campaign:${sanitizeCampaignId(campaignId)}:data:items:override`;
}

function sanitizeCampaignId(value) {
  const id = sanitizeId(value);
  return id || DEFAULT_CAMPAIGN_ID;
}

function sanitizeId(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);
}

function isFoundrySecretAuthorized(request, env) {
  const expected = String(env.INVENTORY_SYNC_SECRET || "").trim();
  const supplied = String(request.headers.get("X-Cripta-Inventory-Secret") || request.headers.get("X-Inventory-Sync-Secret") || "").trim();
  return Boolean(expected && supplied && supplied === expected);
}

function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function stableHash(value) {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function safeJsonParse(value) {
  try { return JSON.parse(value); } catch (_) { return null; }
}

function json(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}
