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
    const previousPresentationCost = campaignItemPresentationCost(previous);
    const previousFoundryCost = campaignItemCostFromDocument(previousDocument);
    const previousCostFollowedFoundry = !previous || stableStringify(previousPresentationCost) === stableStringify(previousFoundryCost);
    if (previousCostFollowedFoundry || previousSync.pendingFoundry) {
      applyCampaignItemCost(next, campaignItemCostFromDocument(document.document));
    }
    if (!previousSync.pendingFoundry && campaignItemNarrativeFollowsFoundry(previous, previousDocument)) {
      applyCampaignItemNarrative(next, campaignItemPresentationFromDocument(document.document));
    }
    applyCampaignItemMetadataFromFoundry(next, previous, previousDocument, document.document, {
      preserveSiteChanges: previousSync.pendingFoundry,
    });
    applyCampaignItemCategoryFromFoundry(next, previous, previous?.foundry, document, { preserveSiteChanges: previousSync.pendingFoundry });
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
  const flags = normalizeJsonObject(source.flags || {}, 96 * 1024);
  if (!system.valid || !effects.valid || !flags.valid) return null;
  const img = normalizeItemImage(source.img, campaignId);
  if (img === null) return null;
  const document = { name, type, img, system: system.value, effects: effects.value, flags: flags.value };
  const folderPath = String(input.folderPath || "").trim().slice(0, 300);
  return {
    worldId,
    itemId: String(input.itemId || "").trim().slice(0, 96),
    uuid: String(input.uuid || "").trim().slice(0, 180),
    folderPath,
    document,
    hash: stableHash({ document, folderPath }),
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


function campaignItemCategoryFromFolderPath(value) {
  const parts = String(value || "").split("/").map((part) => part.trim()).filter(Boolean);
  const name = parts.length ? parts[parts.length - 1].slice(0, 120) : "";
  const id = sanitizeId(name).slice(0, 80);
  if (!id || id === "cripta-wiki-items") return null;
  return { id, name };
}


function campaignItemCategoryFromSnapshot(snapshot) {
  const folder = campaignItemCategoryFromFolderPath(snapshot?.folderPath);
  const metadata = snapshot?.document?.flags?.["cripta-wiki-sync"] || {};
  const name = String(metadata.categoryName || "").trim().slice(0, 120);
  const id = sanitizeId(metadata.categoryId || name).slice(0, 80);
  const flagged = id && name ? { id, name } : null;
  if (!flagged) return folder;
  if (!folder || sanitizeId(flagged.name) === folder.id) return flagged;
  return folder;
}
function applyCampaignItemCategoryFromFoundry(next, previous, previousSnapshot, currentSnapshot, { preserveSiteChanges = false } = {}) {
  if (preserveSiteChanges) return;
  const incoming = campaignItemCategoryFromSnapshot(currentSnapshot);
  if (!incoming) return;
  const prior = campaignItemCategoryFromSnapshot(previousSnapshot);
  const previousCategoryId = sanitizeId(previous?.categoryId || previous?.category || "").slice(0, 80);
  const followedFoundry = !previous
    || !previousCategoryId
    || (prior && previousCategoryId === prior.id);
  if (!followedFoundry) return;
  next.categoryId = incoming.id;
  next.category = incoming.name;
}

function buildNewCampaignItem(id, snapshot) {
  const category = campaignItemCategoryFromSnapshot(snapshot);
  const system = snapshot.document.system || {};
  const image = isPublicItemImage(snapshot.document.img) ? toPublicMediaPath(snapshot.document.img) : "";
  const cost = campaignItemCostFromDocument(snapshot.document);
  const presentation = campaignItemPresentationFromDocument(snapshot.document);
  const legacyGold = cost?.components?.length === 1 && cost.components[0].currencyId === "gp" ? cost.components[0].amount : null;
  return {
    id,
    name: snapshot.document.name,
    type: siteTypeForFoundryType(snapshot.document.type),
    foundryType: snapshot.document.type,
    ...(category ? { categoryId: category.id, category: category.name } : {}),
    ...(image ? { image } : {}),
    ...(system.rarity ? { rarity: siteRarity(system.rarity) } : {}),
    ...(system.attunement === "required" || system.attunement === 1 || system.attunement === true ? { attunement: true } : {}),
    status: "active",
    unidentified: system.identified === false,
    ...presentation,
    ...campaignItemWeightFromSystem(system),
    ...(cost ? { cost } : {}),
    ...(legacyGold !== null ? { valueGold: legacyGold } : {}),
  };
}

function campaignItemPresentationFromDocument(document) {
  const system = document?.system && typeof document.system === "object" && !Array.isArray(document.system)
    ? document.system
    : {};
  const description = system.description;
  const html = typeof description === "string" ? description : String(description?.value || "");
  const unidentified = system.unidentified && typeof system.unidentified === "object" && !Array.isArray(system.unidentified)
    ? system.unidentified
    : {};
  const unidentifiedDescription = String(
    unidentified.description
    || (description && typeof description === "object" ? description.unidentified : "")
    || ""
  );
  const unidentifiedName = String(unidentified.name || system.unidentifiedName || "").trim();
  const narrative = parseFoundryItemDescription(html);
  return {
    summary: narrative.summary,
    properties: narrative.properties,
    ...(narrative.notes ? { notes: narrative.notes } : {}),
    ...(unidentifiedName ? { unidentifiedName } : {}),
    ...(unidentifiedDescription ? { unidentifiedDescription: foundryHtmlToText(unidentifiedDescription) } : {}),
  };
}

function parseFoundryItemDescription(value) {
  let html = String(value || "").trim();
  if (!html) return { summary: "", properties: [], notes: "" };

  const structuredSummary = firstClassBlock(html, "cripta-catalog-summary");
  const structuredProperties = allClassBlocks(html, "cripta-catalog-property").map((block) => {
    const heading = firstHeading(block);
    const chargesBlock = firstClassBlock(block, "cripta-catalog-property-charges");
    return {
      name: foundryHtmlToText(removeClassBlock(heading.html, "cripta-catalog-property-charges")),
      charges: foundryHtmlToText(chargesBlock),
      description: foundryHtmlToText(block.replace(heading.full, "")),
    };
  }).filter((property) => property.name || property.description);
  const structuredNotes = firstClassBlock(html, "cripta-catalog-notes");
  if (structuredSummary || structuredProperties.length || structuredNotes) {
    return {
      summary: foundryHtmlToText(structuredSummary),
      properties: structuredProperties,
      notes: foundryHtmlToText(structuredNotes.replace(firstHeading(structuredNotes).full, "")),
    };
  }

  let notes = "";
  const trailingNotes = html.match(/<hr\b[^>]*>\s*<p\b[^>]*>\s*<em\b[^>]*>([\s\S]*?)<\/em>\s*<\/p>\s*$/i);
  if (trailingNotes) {
    notes = foundryHtmlToText(trailingNotes[1]);
    html = html.slice(0, trailingNotes.index).trim();
  }

  const headings = [];
  const headingPattern = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match;
  while ((match = headingPattern.exec(html))) {
    headings.push({ index: match.index, end: headingPattern.lastIndex, html: match[2] });
  }
  if (!headings.length) return { summary: foundryHtmlToText(html), properties: [], notes };

  const summary = foundryHtmlToText(html.slice(0, headings[0].index));
  const properties = headings.map((heading, index) => {
    const parsedTitle = splitPropertyTitle(foundryHtmlToText(heading.html));
    const end = headings[index + 1]?.index ?? html.length;
    return {
      name: parsedTitle.name,
      charges: parsedTitle.charges,
      description: foundryHtmlToText(html.slice(heading.end, end)),
    };
  }).filter((property) => property.name || property.description);
  return { summary, properties, notes };
}
function splitPropertyTitle(value) {
  const title = String(value || "").trim();
  const match = title.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  return match
    ? { name: match[1].trim(), charges: match[2].trim() }
    : { name: title, charges: "" };
}

function firstHeading(value) {
  const match = String(value || "").match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i);
  return match ? { full: match[0], html: match[1] } : { full: "", html: "" };
}

function firstClassBlock(value, className) {
  return allClassBlocks(value, className)[0] || "";
}

function allClassBlocks(value, className) {
  const escaped = className.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const pattern = new RegExp("<(section|div|aside|span|small|b|strong)\\b[^>]*class=[\"'][^\"']*\\b" + escaped + "\\b[^\"']*[\"'][^>]*>([\\s\\S]*?)<\\/\\1>", "gi");
  return Array.from(String(value || "").matchAll(pattern), (match) => match[2]);
}

function removeClassBlock(value, className) {
  const escaped = className.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const pattern = new RegExp("<(span|small|b|strong)\\b[^>]*class=[\"'][^\"']*\\b" + escaped + "\\b[^\"']*[\"'][^>]*>[\\s\\S]*?<\\/\\1>", "gi");
  return String(value || "").replace(pattern, "");
}

function foundryHtmlToText(value) {
  return decodeHtmlEntities(String(value || "")
    .replace(/@(?:UUID|Compendium)\[([^\]]+)](?:\{([^}]+)})?/gi, (_match, target, label) => label || target.split(".").pop() || "Riferimento Foundry")
    .replace(/@(item|spell|feat|condition|variantrule)\[([^\]|]+)(?:\|[^\]]+)?](?:\{([^}]+)})?/gi, (_match, _kind, label, explicit) => explicit || label)
    .replace(/&Reference\[[^\]]*?=([^\]]+)]/gi, "$1")
    .replace(/\[\[\/([^\]]+)]]/g, (_match, command) => formatFoundryInlineCommand(command))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<hr\b[^>]*>/gi, "\n\n")
    .replace(/<\/(?:p|div|section|aside|li|ul|ol|table|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 24_000);
}

function formatFoundryInlineCommand(value) {
  const command = String(value || "").trim();
  const dc = command.match(/\bdc=(\d+)/i)?.[1];
  if (/^save\b/i.test(command)) return dc ? "Tiro salvezza CD " + dc : "Tiro salvezza";
  if (/^(damage|heal)\b/i.test(command)) return command.replace(/^damage\b/i, "Danno").replace(/^heal\b/i, "Cura");
  return command;
}

function decodeHtmlEntities(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value || "")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Math.min(0x10ffff, Number(code) || 0)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Math.min(0x10ffff, parseInt(code, 16) || 0)))
    .replace(/&([a-z]+);/gi, (match, name) => Object.prototype.hasOwnProperty.call(named, name.toLowerCase()) ? named[name.toLowerCase()] : match);
}
function campaignItemNarrativeFollowsFoundry(item, previousDocument) {
  if (!item) return true;
  const current = campaignItemNarrativeFingerprint(item);
  if (!current.summary && !current.notes && !current.properties.length && !current.unidentifiedName && !current.unidentifiedDescription) return true;
  if (!previousDocument) return false;
  return stableStringify(current) === stableStringify(campaignItemNarrativeFingerprint(campaignItemPresentationFromDocument(previousDocument)));
}

function campaignItemNarrativeFingerprint(item) {
  return {
    summary: normalizeNarrativeText(item?.summary),
    notes: normalizeNarrativeText(item?.notes),
    unidentifiedName: normalizeNarrativeText(item?.unidentifiedName),
    unidentifiedDescription: normalizeNarrativeText(item?.unidentifiedDescription),
    properties: (Array.isArray(item?.properties) ? item.properties : []).filter((property) => property?.hidden !== true).map((property) => ({
      name: normalizeNarrativeText(property?.name),
      charges: normalizeNarrativeText(property?.charges),
      description: normalizeNarrativeText(property?.description),
    })).filter((property) => property.name || property.description),
  };
}

function normalizeNarrativeText(value) {
  return String(value || "").replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function applyCampaignItemNarrative(item, presentation) {
  item.summary = String(presentation?.summary || "");
  item.properties = Array.isArray(presentation?.properties) ? presentation.properties : [];
  if (presentation?.notes) item.notes = String(presentation.notes);
  else delete item.notes;
  if (presentation?.unidentifiedName) item.unidentifiedName = String(presentation.unidentifiedName);
  else delete item.unidentifiedName;
  if (presentation?.unidentifiedDescription) item.unidentifiedDescription = String(presentation.unidentifiedDescription);
  else delete item.unidentifiedDescription;
}
function campaignItemMetadataFromDocument(document) {
  const system = document?.system && typeof document.system === "object" && !Array.isArray(document.system) ? document.system : {};
  return {
    type: siteTypeForFoundryType(document?.type),
    rarity: system.rarity ? siteRarity(system.rarity) : "",
    attunement: system.attunement === "required" || system.attunement === 1 || system.attunement === true,
    unidentified: system.identified === false,
    weight: campaignItemWeightFromSystem(system).weight ?? "",
  };
}

function campaignItemWeightFromSystem(system) {
  const weight = system?.weight && typeof system.weight === "object" && !Array.isArray(system.weight)
    ? system.weight.value
    : system?.weight;
  return weight === undefined || weight === null || weight === "" ? {} : { weight };
}

function applyCampaignItemMetadataFromFoundry(next, previous, previousDocument, currentDocument, { preserveSiteChanges = false } = {}) {
  if (preserveSiteChanges) return;
  const incoming = campaignItemMetadataFromDocument(currentDocument);
  const prior = previousDocument ? campaignItemMetadataFromDocument(previousDocument) : {};
  for (const field of ["type", "rarity", "attunement", "unidentified", "weight"]) {
    const currentValue = previous?.[field];
    const followedFoundry = !previous || currentValue === undefined || currentValue === "" || stableStringify(currentValue) === stableStringify(prior[field]);
    if (!followedFoundry) continue;
    if (incoming[field] === "" || incoming[field] === undefined) delete next[field];
    else next[field] = incoming[field];
  }
}
function campaignItemPresentationCost(item) {
  const components = normalizeCostComponents(item?.cost?.components);
  if (components.length) return { components };
  const legacyGold = Number(item?.valueGold);
  return legacyGold > 0 ? { components: [{ currencyId: "gp", amount: legacyGold }] } : null;
}

function campaignItemCostFromDocument(document) {
  const flagCost = document?.flags?.["khuzoe-merchant"]?.cost;
  const flagComponents = normalizeCostComponents(flagCost?.components);
  if (flagComponents.length) return { components: flagComponents };
  const system = document && typeof document === "object" && !Array.isArray(document) ? document.system : null;
  const price = system && typeof system === "object" && !Array.isArray(system) ? system.price : null;
  if (price && typeof price === "object" && !Array.isArray(price)) {
    if (Number(price.value) > 0) {
      const currencyId = normalizeCurrencyId(price.denomination || "gp");
      return currencyId ? { components: [{ currencyId, amount: Number(price.value) }] } : null;
    }
    const components = normalizeCostComponents(Object.entries(price).map(([currencyId, amount]) => ({ currencyId, amount })));
    return components.length ? { components } : null;
  }
  return Number(price) > 0 ? { components: [{ currencyId: "gp", amount: Number(price) }] } : null;
}

function normalizeCostComponents(value) {
  return (Array.isArray(value) ? value : []).map((entry) => ({
    currencyId: normalizeCurrencyId(entry?.currencyId),
    amount: Number(entry?.amount),
  })).filter((entry) => entry.currencyId && Number.isFinite(entry.amount) && entry.amount > 0)
    .sort((left, right) => left.currencyId.localeCompare(right.currencyId));
}

function normalizeCurrencyId(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,47}$/.test(id) ? id : "";
}

function applyCampaignItemCost(item, cost) {
  if (!cost?.components?.length) {
    delete item.cost;
    delete item.valueGold;
    return;
  }
  item.cost = cost;
  if (cost.components.length === 1 && cost.components[0].currencyId === "gp") item.valueGold = cost.components[0].amount;
  else delete item.valueGold;
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
