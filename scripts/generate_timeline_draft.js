const fs = require("fs");
const path = require("path");
const { parseYamlLite } = require("./lib/yaml-lite");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_CAMPAIGN_ID = "cripta-di-sangue";

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return "";
  return process.argv[index + 1];
}

function readCampaignArg() {
  const explicit = readArg("--campaign");
  if (explicit) return explicit;
  const positional = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  return positional || process.env.CAMPAIGN_ID || DEFAULT_CAMPAIGN_ID;
}

const CAMPAIGN_ID = readCampaignArg();
const CAMPAIGN_DATA_DIR = path.join(ROOT, "campaigns", CAMPAIGN_ID, "data");
const DATA_DIR = fs.existsSync(CAMPAIGN_DATA_DIR)
  ? CAMPAIGN_DATA_DIR
  : path.join(ROOT, "assets", "data");
const OUTPUT_PATH = readArg("--output")
  ? path.resolve(ROOT, readArg("--output"))
  : path.join(DATA_DIR, "timeline.draft.json");

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function readJsonIfExists(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readYamlIfExists(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return parseYamlLite(fs.readFileSync(filePath, "utf8"));
}

function normalizeCollection(payload, preferredKey = "") {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (preferredKey && Array.isArray(payload[preferredKey])) return payload[preferredKey];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.sessions)) return payload.sessions;
  return [];
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return normalizeText(value).replace(/\s+/g, "-") || "evento";
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripHtml(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, " "));
}

function splitSessionSummary(summary) {
  const html = String(summary || "");
  const paragraphs = html
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/^<p[^>]*>/i, "")
    .replace(/<\/p>$/i, "")
    .split(/\n{2,}/)
    .map((chunk) => stripHtml(chunk).replace(/\s+/g, " ").trim())
    .filter((chunk) => chunk.length >= 20);

  if (paragraphs.length) return paragraphs;
  return stripHtml(summary)
    .split(/(?<=[.!?])\s+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length >= 20);
}

function shorten(value, maxLength = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength + 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 50 ? lastSpace : maxLength).trim()}...`;
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function addAlias(aliases, value, options = {}) {
  const raw = String(value || "").trim();
  if (!raw) return;
  const normalized = normalizeText(raw);
  if (!normalized) return;
  if (!options.allowShort && normalized.length < 3) return;
  aliases.add(raw);
  const parenthetical = raw.match(/\(([^)]+)\)/);
  if (parenthetical) addAlias(aliases, parenthetical[1], options);
}

function buildNameAliases(record, options = {}) {
  const aliases = new Set();
  addAlias(aliases, record?.name, options);
  addAlias(aliases, record?.title, options);
  addAlias(aliases, record?.id, options);
  addAlias(aliases, String(record?.id || "").replace(/[-_]+/g, " "), options);

  if (Array.isArray(record?.aliases)) {
    record.aliases.forEach((alias) => addAlias(aliases, alias, options));
  }

  const foundryNames = record?.foundryName || record?.foundryNames;
  if (Array.isArray(foundryNames)) {
    foundryNames.forEach((alias) => addAlias(aliases, alias, options));
  } else {
    addAlias(aliases, foundryNames, options);
  }

  addAlias(aliases, record?.mysteryName, options);
  addAlias(aliases, record?.unidentifiedName, options);

  const label = String(record?.name || record?.title || "").trim();
  const withoutVonT = label.replace(/\s+Von\s+T$/i, "").trim();
  if (withoutVonT && withoutVonT !== label) {
    addAlias(aliases, withoutVonT, { allowShort: withoutVonT.toLowerCase() === "x" });
  }

  return [...aliases];
}

function makeEntity(kind, id, label, aliases = [], extra = {}) {
  return {
    kind,
    id: String(id || slugify(label)).trim(),
    label: String(label || id || "").trim(),
    aliases: unique(aliases),
    ...extra,
  };
}

function loadCharactersFromJson() {
  const payload = readJsonIfExists(path.join(DATA_DIR, "characters.json"));
  return normalizeCollection(payload, "data")
    .filter((entry) => entry && (entry.type || "npc") !== "player")
    .map((entry) => makeEntity("character", entry.id, entry.name, buildNameAliases(entry), {
      category: entry.category || "",
    }));
}

function loadCharactersFromYaml() {
  const manifest = readYamlIfExists(path.join(DATA_DIR, "characters", "index.yaml"), []);
  if (!Array.isArray(manifest)) return [];

  return manifest
    .filter((entry) => (entry?.type || "npc") !== "player")
    .map((entry) => {
      const filePath = path.join(DATA_DIR, entry.file || `characters/${entry.id}.yaml`);
      const character = readYamlIfExists(filePath, null);
      if (!character || typeof character !== "object") return null;
      return makeEntity("character", character.id || entry.id, character.name || entry.id, buildNameAliases(character), {
        category: character.category || "",
      });
    })
    .filter(Boolean);
}

function loadCharacters() {
  const fromJson = loadCharactersFromJson();
  return fromJson.length ? fromJson : loadCharactersFromYaml();
}

function loadFamilyOnlyCharacters(existingCharacterIds) {
  const family = normalizeCollection(readJsonIfExists(path.join(DATA_DIR, "family_von_t.json"), []));
  return family
    .filter((entry) => entry?.id && !existingCharacterIds.has(String(entry.id)))
    .map((entry) => makeEntity("character", entry.id, entry.name, buildNameAliases(entry, {
      allowShort: String(entry.name || "").trim().toLowerCase() === "x von t",
    }), {
      source: "family_von_t",
    }));
}

function loadPlayers() {
  return normalizeCollection(readJsonIfExists(path.join(DATA_DIR, "players.json"), []))
    .map((entry) => makeEntity("player", entry.id, entry.name, buildNameAliases(entry), {
      active: entry.isActive !== false,
    }));
}

function flattenQuestEntries(groups) {
  const result = [];

  function visitQuest(quest, group, indexPath) {
    if (!quest || typeof quest !== "object") return;
    const id = `${group.id || slugify(group.title)}:${indexPath.join(".")}`;
    const aliases = buildNameAliases({ id, title: quest.title });
    result.push(makeEntity("quest", id, quest.title, aliases, {
      groupId: group.id || "",
      groupTitle: group.title || "",
      npcId: group.npc_id || "",
      status: quest.status || "",
    }));
    if (Array.isArray(quest.subquests)) {
      quest.subquests.forEach((subquest, index) => visitQuest(subquest, group, [...indexPath, index + 1]));
    }
  }

  normalizeCollection(groups).forEach((group, groupIndex) => {
    if (!group || typeof group !== "object") return;
    if (group.title) {
      result.push(makeEntity("quest", group.id || `group-${groupIndex + 1}`, group.title, buildNameAliases(group), {
        groupId: group.id || "",
        isGroup: true,
        npcId: group.npc_id || "",
      }));
    }
    (Array.isArray(group.quests) ? group.quests : []).forEach((quest, index) => {
      visitQuest(quest, group, [index + 1]);
    });
  });

  return result;
}

function loadQuests() {
  return flattenQuestEntries(readJsonIfExists(path.join(DATA_DIR, "quests.json"), []));
}

function loadItems() {
  const byId = new Map();
  [
    ...normalizeCollection(readJsonIfExists(path.join(DATA_DIR, "items.json"), [])),
    ...normalizeCollection(readJsonIfExists(path.join(DATA_DIR, "items_populated.json"), [])),
  ].forEach((entry) => {
    if (!entry?.id && !entry?.name) return;
    byId.set(String(entry.id || slugify(entry.name)), entry);
  });

  return [...byId.values()]
    .map((entry) => makeEntity("item", entry.id, entry.name, buildNameAliases(entry), {
      type: entry.type || "",
      rarity: entry.rarity || "",
    }));
}

function loadCreatures(existingCharacterIds) {
  return normalizeCollection(readJsonIfExists(path.join(DATA_DIR, "bestiary.json"), []))
    .filter((entry) => !entry?.sourceCharacterId || !existingCharacterIds.has(String(entry.sourceCharacterId)))
    .map((entry) => makeEntity("creature", entry.id || slugify(entry.name), entry.name, buildNameAliases(entry), {
      category: entry.category || "",
      rank: entry.rank || "",
      sourceCharacterId: entry.sourceCharacterId || "",
    }));
}

function loadLocations() {
  const locations = normalizeCollection(readJsonIfExists(path.join(DATA_DIR, "locations.json"), []));
  if (locations.length) {
    return locations.map((entry) => makeEntity("location", entry.id, entry.name || entry.title, buildNameAliases(entry), {
      category: entry.category || "",
    }));
  }

  const mapsDir = path.join(DATA_DIR, "maps");
  if (!fs.existsSync(mapsDir)) return [];
  const found = [];

  function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        return;
      }
      if (!entry.name.endsWith(".json")) return;
      const mapData = readJsonIfExists(fullPath, null);
      const points = Array.isArray(mapData?.pointsOfInterest)
        ? mapData.pointsOfInterest
        : Array.isArray(mapData?.pois)
          ? mapData.pois
          : [];
      points.forEach((point) => {
        if (!point?.title && !point?.name) return;
        found.push(makeEntity("location", point.id || slugify(point.title || point.name), point.title || point.name, buildNameAliases(point), {
          source: rel(fullPath),
        }));
      });
    });
  }

  walk(mapsDir);
  return found;
}

const LOCATION_HINTS = [
  "Cripta",
  "porta d'ingresso",
  "primo piano",
  "secondo piano",
  "terzo livello",
  "quarto piano",
  "livello inferiore",
  "Teatro",
  "laboratorio",
  "stanza di Rabberduscolanderson",
  "stanza di Karla",
  "zona nord",
  "zona sud",
  "corridoio",
  "cella",
  "caverna",
  "sarcofago",
  "giardino di Albert",
  "pozzo",
];

function termMatches(normalizedText, normalizedAlias) {
  if (!normalizedText || !normalizedAlias) return false;
  return ` ${normalizedText} `.includes(` ${normalizedAlias} `);
}

function findEntityMatches(text, entities) {
  const normalized = normalizeText(text);
  return entities
    .map((entity) => {
      const aliases = unique(entity.aliases)
        .map((alias) => ({ raw: alias, normalized: normalizeText(alias) }))
        .filter((alias) => alias.normalized)
        .sort((a, b) => b.normalized.length - a.normalized.length);
      const matched = aliases.find((alias) => termMatches(normalized, alias.normalized));
      if (!matched) return null;
      return {
        kind: entity.kind,
        id: entity.id,
        label: entity.label,
        matched: matched.raw,
      };
    })
    .filter(Boolean);
}

function groupMatchedIds(matches, kind) {
  return unique(matches.filter((match) => match.kind === kind).map((match) => match.id));
}

function findLocationHints(text) {
  const normalized = normalizeText(text);
  return LOCATION_HINTS.filter((hint) => termMatches(normalized, normalizeText(hint)));
}

const TAG_RULES = [
  { tag: "combattimento", terms: ["combattimento", "attacc", "sconfigg", "uccid", "abbatt", "ferite", "nemici", "mummie", "scheletri"] },
  { tag: "rivelazione", terms: ["scoprite", "rivela", "capite", "informazioni", "conferma", "viene a sapere"] },
  { tag: "visione", terms: ["visione", "incubo", "sogno", "spiriti"] },
  { tag: "missione", terms: ["missione", "chiede", "incaric", "trovare", "recuperare", "procur", "portare"] },
  { tag: "rituale", terms: ["rituale", "sigillo", "patto", "sangue", "sacrific"] },
  { tag: "oggetto", terms: ["oggetto", "anello", "medaglione", "libro", "pergamena", "collana", "spilla", "cuore"] },
  { tag: "esplorazione", terms: ["esplor", "procedete", "giungete", "dirigete", "corridoi", "stanza", "livello", "piano"] },
  { tag: "riposo", terms: ["ripos", "dormire", "notte", "giornata"] },
  { tag: "morte", terms: ["morte", "muore", "uccisa", "sacrifica", "svenuta", "cadavere"] },
];

function inferTags(text) {
  const normalized = normalizeText(text);
  return TAG_RULES
    .filter((rule) => rule.terms.some((term) => normalized.includes(normalizeText(term))))
    .map((rule) => rule.tag);
}

function buildTitle(text) {
  const clean = String(text || "").replace(/^Note aggiuntive:\s*/i, "Note aggiuntive: ").trim();
  const firstSentence = clean.match(/^(.+?[.!?])\s+/)?.[1] || clean;
  return shorten(firstSentence, 96);
}

function estimateConfidence(matches, tags) {
  const weightedMatches = matches.reduce((sum, match) => {
    if (match.kind === "quest" || match.kind === "item") return sum + 0.7;
    return sum + 1;
  }, 0);
  const value = 0.35 + weightedMatches * 0.08 + tags.length * 0.025;
  return Math.max(0.2, Math.min(0.95, Number(value.toFixed(2))));
}

function buildEvents(sessions, entityCatalog) {
  const entities = [
    ...entityCatalog.characters,
    ...entityCatalog.players,
    ...entityCatalog.quests,
    ...entityCatalog.items,
    ...entityCatalog.creatures,
    ...entityCatalog.locations,
  ];

  const events = [];
  sessions.forEach((session, sessionIndex) => {
    splitSessionSummary(session.summary).forEach((summary, eventIndex) => {
      const matches = findEntityMatches(summary, entities);
      const tags = inferTags(summary);
      const locationHints = findLocationHints(summary);
      const sessionId = String(session.id ?? sessionIndex + 1);

      events.push({
        id: `session-${String(sessionId).padStart(3, "0")}-event-${String(eventIndex + 1).padStart(2, "0")}`,
        draft: true,
        reviewStatus: "pending",
        source: "session",
        sourceId: sessionId,
        sessionId,
        sessionNumber: Number(session.id) || sessionIndex + 1,
        sessionDate: session.date || "",
        order: eventIndex + 1,
        title: buildTitle(summary),
        summary,
        characters: groupMatchedIds(matches, "character"),
        players: groupMatchedIds(matches, "player"),
        locations: groupMatchedIds(matches, "location"),
        locationHints,
        quests: groupMatchedIds(matches, "quest"),
        items: groupMatchedIds(matches, "item"),
        creatures: groupMatchedIds(matches, "creature"),
        tags,
        visibility: "public",
        confidence: estimateConfidence(matches, tags),
        matches,
      });
    });
  });
  return events;
}

function buildCatalog() {
  const characters = loadCharacters();
  const characterIds = new Set(characters.map((entry) => entry.id));
  const familyCharacters = loadFamilyOnlyCharacters(characterIds);
  const allCharacterIds = new Set([...characters, ...familyCharacters].map((entry) => entry.id));

  return {
    characters: [...characters, ...familyCharacters],
    players: loadPlayers(),
    quests: loadQuests(),
    items: loadItems(),
    creatures: loadCreatures(allCharacterIds),
    locations: loadLocations(),
  };
}

function main() {
  const sessionsPayload = readJsonIfExists(path.join(DATA_DIR, "sessions.json"), {});
  const sessions = normalizeCollection(sessionsPayload, "sessions");
  if (!sessions.length) {
    throw new Error(`Nessuna sessione trovata in ${rel(path.join(DATA_DIR, "sessions.json"))}`);
  }

  const catalog = buildCatalog();
  const events = buildEvents(sessions, catalog);
  const stats = {
    sessionCount: sessions.length,
    eventCount: events.length,
    unlinkedEventCount: events.filter((event) => event.matches.length === 0 && event.locationHints.length === 0).length,
    dictionary: {
      characters: catalog.characters.length,
      players: catalog.players.length,
      quests: catalog.quests.length,
      items: catalog.items.length,
      creatures: catalog.creatures.length,
      locations: catalog.locations.length,
    },
  };

  const payload = {
    version: 1,
    collection: "timelineDraft",
    campaignId: CAMPAIGN_ID,
    generatedAt: new Date().toISOString(),
    source: {
      sessions: rel(path.join(DATA_DIR, "sessions.json")),
      output: rel(OUTPUT_PATH),
    },
    stats,
    data: events,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Timeline draft generata: ${rel(OUTPUT_PATH)} (${events.length} eventi, ${stats.unlinkedEventCount} senza match)`);
}

main();
