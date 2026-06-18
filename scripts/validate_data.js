const fs = require("fs");
const path = require("path");
const { parseYamlLite } = require("./lib/yaml-lite");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "assets", "data");
const CONTENT_DIR = path.join(ROOT, "assets", "content");
const ASSETS_DIR = path.join(ROOT, "assets");

const errors = [];
const warnings = [];

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function pushError(message) {
  errors.push(message);
}

function pushWarning(message) {
  warnings.push(message);
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function isExternalAssetPath(value) {
  return /^(https?:|data:|blob:|media\/|\/media\/)/i.test(String(value || ""));
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  try {
    return JSON.parse(readText(filePath));
  } catch (err) {
    pushError(`${rel(filePath)}: JSON non valido (${err.message})`);
    return null;
  }
}

function readJsonIfExists(filePath, fallback = null) {
  if (!fileExists(filePath)) return fallback;
  return readJson(filePath);
}

function readYaml(filePath) {
  try {
    return parseYamlLite(readText(filePath));
  } catch (err) {
    pushError(`${rel(filePath)}: YAML non valido (${err.message})`);
    return null;
  }
}

function assert(condition, message) {
  if (!condition) pushError(message);
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function slugify(value, fallback = "media") {
  const slug = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function getMediaSlug(entity, fallback = "media") {
  return slugify(
    entity?.mediaSlug
      || entity?.media_slug
      || entity?.mediaId
      || entity?.media_id
      || entity?.folderSlug
      || entity?.folder_slug
      || entity?.id
      || entity?.name
      || fallback,
    fallback
  );
}

function getCollectionData(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function listCampaignDataDirs() {
  const campaignsDir = path.join(ROOT, "campaigns");
  if (!fs.existsSync(campaignsDir)) return [];
  return fs.readdirSync(campaignsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => ({
      campaignId: entry.name,
      dataDir: path.join(campaignsDir, entry.name, "data"),
    }))
    .filter((entry) => fs.existsSync(entry.dataDir));
}

function extractCampaignCharacterMedia(pathValue) {
  const match = String(pathValue || "").match(/^media\/campaigns\/([^/]+)\/characters\/([^/]+)\/([^/]+)\.webp$/i);
  if (!match) return null;
  return {
    campaignId: match[1],
    mediaSlug: match[2],
    variant: match[3],
  };
}

function validateCoreJsonFiles() {
  const files = [
    "players.json",
    "quests.json",
    "sessions.json",
    "next-session.json",
    "skills.json",
    "family_von_t.json",
    "items.json",
  ];

  files.forEach((name) => {
    const filePath = path.join(DATA_DIR, name);
    if (!fileExists(filePath)) {
      pushError(`${rel(filePath)}: file mancante`);
      return;
    }
    readJson(filePath);
  });
}

function validateCharacters(playersById) {
  const manifestPath = path.join(DATA_DIR, "characters", "index.yaml");
  if (!fileExists(manifestPath)) {
    pushError(`${rel(manifestPath)}: manifest personaggi mancante`);
    return { npcById: new Map(), markdownRefs: new Set() };
  }

  const manifest = readYaml(manifestPath);
  if (!Array.isArray(manifest)) {
    pushError(`${rel(manifestPath)}: deve contenere una lista`);
    return { npcById: new Map(), markdownRefs: new Set() };
  }

  const npcById = new Map();
  const markdownRefs = new Set();

  manifest.forEach((entry, idx) => {
    if (!isObject(entry)) {
      pushError(`${rel(manifestPath)}: voce ${idx + 1} non valida`);
      return;
    }

    const entryId = entry.id;
    const entryType = entry.type || "npc";
    const relativeFile = entry.file || `characters/${entryId}.yaml`;
    const charFile = path.join(DATA_DIR, relativeFile);

    assert(entryId, `${rel(manifestPath)}: voce ${idx + 1} senza id`);
    assert(fileExists(charFile), `${rel(charFile)}: file personaggio mancante`);
    if (!entryId || !fileExists(charFile)) return;

    const character = readYaml(charFile);
    if (!isObject(character)) {
      pushError(`${rel(charFile)}: struttura personaggio non valida`);
      return;
    }

    if (npcById.has(entryId)) {
      pushError(`${rel(manifestPath)}: id duplicato "${entryId}"`);
    }
    npcById.set(entryId, character);

    assert(
      character.id === entryId,
      `${rel(charFile)}: id "${character.id}" diverso dal manifest "${entryId}"`
    );
    assert(character.name, `${rel(charFile)}: campo "name" mancante`);
    assert(character.role, `${rel(charFile)}: campo "role" mancante`);
    assert(
      (character.type || "npc") === entryType,
      `${rel(charFile)}: type "${character.type}" diverso da manifest "${entryType}"`
    );

    if ("order_slot" in character && character.order_slot !== null) {
      const slot = Number(character.order_slot);
      if (!Number.isInteger(slot) || slot <= 0) {
        pushWarning(`${rel(charFile)}: order_slot dovrebbe essere un intero positivo o null`);
      }
    }

    if (!isObject(character.images)) {
      pushError(`${rel(charFile)}: campo "images" non valido`);
    } else {
      ["avatar", "hover", "portrait"].forEach((key) => {
        const imgPath = character.images[key];
        assert(imgPath, `${rel(charFile)}: images.${key} mancante`);
        if (imgPath && !isExternalAssetPath(imgPath)) {
          const resolved = path.join(ASSETS_DIR, imgPath);
          if (!fileExists(resolved)) {
            pushError(`${rel(charFile)}: immagine non trovata -> assets/${imgPath}`);
          }
        }
      });
    }

    if (!Array.isArray(character.content_blocks)) {
      pushError(`${rel(charFile)}: content_blocks deve essere una lista`);
    } else {
      character.content_blocks.forEach((block, blockIdx) => {
        if (!isObject(block)) {
          pushError(`${rel(charFile)}: content_blocks[${blockIdx}] non valido`);
          return;
        }

        if (block.markdown) {
          const mdPath = path.join(CONTENT_DIR, block.markdown);
          markdownRefs.add(rel(mdPath));
          if (!fileExists(mdPath)) {
            pushError(`${rel(charFile)}: markdown mancante -> assets/content/${block.markdown}`);
          }
        }

        if (block.image && !isExternalAssetPath(block.image)) {
          const imagePath = path.join(ASSETS_DIR, block.image);
          if (!fileExists(imagePath)) {
            pushError(`${rel(charFile)}: image non trovata -> assets/${block.image}`);
          }
        }

        if (block.icon && typeof block.icon === "string" && !block.icon.startsWith("fa-")) {
          pushWarning(`${rel(charFile)}: icona sospetta "${block.icon}" in content_blocks[${blockIdx}]`);
        }
      });
    }

    if (Array.isArray(character.relationships)) {
      character.relationships.forEach((relationship, relIdx) => {
        if (!relationship || !relationship.id) {
          pushError(`${rel(charFile)}: relationships[${relIdx}] senza id`);
        }
      });
    }
  });

  const validEntityIds = new Set([...npcById.keys(), ...playersById.keys()]);
  npcById.forEach((character, characterId) => {
    const relationships = Array.isArray(character.relationships) ? character.relationships : [];
    relationships.forEach((relationship) => {
      if (!validEntityIds.has(relationship.id)) {
        pushWarning(
          `assets/data/characters/${characterId}.yaml: relazione verso "${relationship.id}" non trovata`
        );
      }
    });
  });

  return { npcById, markdownRefs };
}

function validatePlayers() {
  const playersPath = path.join(DATA_DIR, "players.json");
  const players = readJson(playersPath);
  const playersById = new Map();
  if (!Array.isArray(players)) {
    pushError(`${rel(playersPath)}: deve essere una lista`);
    return playersById;
  }

  players.forEach((player, idx) => {
    if (!isObject(player)) {
      pushError(`${rel(playersPath)}: entry ${idx + 1} non valida`);
      return;
    }
    if (!player.id) {
      pushError(`${rel(playersPath)}: entry ${idx + 1} senza id`);
      return;
    }
    if (playersById.has(player.id)) {
      pushError(`${rel(playersPath)}: id duplicato "${player.id}"`);
      return;
    }
    playersById.set(player.id, player);

    if (!isObject(player.images)) {
      pushError(`${rel(playersPath)}: ${player.id} ha images non valido`);
      return;
    }

    ["avatar", "hover", "portrait"].forEach((key) => {
      const image = player.images[key];
      assert(image, `${rel(playersPath)}: ${player.id} senza images.${key}`);
      if (!image || isExternalAssetPath(image)) return;
      const imagePath = path.join(ASSETS_DIR, image);
      if (!fileExists(imagePath)) {
        pushError(`${rel(playersPath)}: ${player.id} immagine non trovata -> assets/${image}`);
      }
    });
  });

  return playersById;
}

function validateFamilyTreeFile(filePath, options = {}) {
  if (!fileExists(filePath)) return;
  const family = readJson(filePath);
  if (!Array.isArray(family)) {
    pushError(`${rel(filePath)}: deve contenere una lista`);
    return;
  }

  const ids = new Set();
  family.forEach((person, index) => {
    const context = `${rel(filePath)}[${index}]`;
    if (!isObject(person)) {
      pushError(`${context}: entry non valida`);
      return;
    }
    if (!person.id) {
      pushError(`${context}: id mancante`);
      return;
    }
    if (ids.has(person.id)) pushError(`${context}: id duplicato "${person.id}"`);
    ids.add(person.id);
  });

  const validCharacterIds = options.validCharacterIds || new Set();
  const campaignId = options.campaignId || "cripta-di-sangue";

  family.forEach((person, index) => {
    if (!isObject(person) || !person.id) return;
    const context = `${rel(filePath)}[${index}:${person.id}]`;
    ["parents", "spouses", "children"].forEach((key) => {
      const refs = person[key];
      if (refs === undefined) return;
      if (!Array.isArray(refs)) {
        pushError(`${context}: ${key} deve essere una lista`);
        return;
      }
      refs.forEach((refId) => {
        if (!ids.has(refId)) pushError(`${context}: ${key} punta a "${refId}", non presente nell'albero`);
      });
    });

    const characterId = String(person.characterId || person.character_id || "").trim();
    if (characterId && validCharacterIds.size && !validCharacterIds.has(characterId)) {
      pushWarning(`${context}: characterId "${characterId}" non trovato nei personaggi della campagna`);
    }

    const hover = person.images?.hover || "";
    const parsedHover = extractCampaignCharacterMedia(hover);
    if (parsedHover) {
      const expectedSlug = getMediaSlug({ ...person, id: characterId || person.id }, "npc");
      if (parsedHover.campaignId !== campaignId) {
        pushError(`${context}: images.hover usa campaign "${parsedHover.campaignId}" invece di "${campaignId}"`);
      }
      if (parsedHover.mediaSlug !== expectedSlug) {
        pushError(`${context}: images.hover usa cartella "${parsedHover.mediaSlug}" invece di mediaSlug "${expectedSlug}"`);
      }
      if (parsedHover.variant !== "hover") {
        pushError(`${context}: images.hover punta a variante "${parsedHover.variant}"`);
      }
    }
  });
}

function validateMediaManifestForCampaign(campaignId, dataDir) {
  const manifestPath = path.join(dataDir, "media-manifest.json");
  if (!fileExists(manifestPath)) {
    pushWarning(`${rel(dataDir)}: media-manifest.json mancante; esegui npm run build:media-manifest`);
    return;
  }

  const manifest = readJson(manifestPath);
  if (!isObject(manifest)) {
    pushError(`${rel(manifestPath)}: struttura non valida`);
    return;
  }
  if (manifest.collection !== "media-manifest") {
    pushError(`${rel(manifestPath)}: collection deve essere "media-manifest"`);
  }
  if (manifest.campaignId !== campaignId) {
    pushError(`${rel(manifestPath)}: campaignId "${manifest.campaignId}" diverso da "${campaignId}"`);
  }

  const characters = getCollectionData(readJsonIfExists(path.join(dataDir, "characters.json"), []));
  const players = getCollectionData(readJsonIfExists(path.join(dataDir, "players.json"), []));
  validateMediaManifestCollection(manifestPath, manifest.entities?.characters, characters, campaignId, "characters", "npc");
  validateMediaManifestCollection(manifestPath, manifest.entities?.players, players, campaignId, "players", "player");
}

function validateMediaManifestCollection(manifestPath, entries, sourceEntities, campaignId, collectionName, kind) {
  const context = `${rel(manifestPath)}.entities.${collectionName}`;
  if (!isObject(entries)) {
    pushError(`${context}: sezione mancante o non valida`);
    return;
  }

  const sourceById = new Map(
    sourceEntities
      .filter((entity) => isObject(entity) && entity.id)
      .map((entity) => [String(entity.id), entity])
  );
  const manifestIds = new Set(Object.keys(entries));
  const mediaSlugs = new Map();

  sourceById.forEach((entity, id) => {
    if (!manifestIds.has(id)) pushError(`${context}: manca entry per "${id}"`);
  });
  manifestIds.forEach((id) => {
    if (!sourceById.has(id)) pushWarning(`${context}.${id}: entry senza sorgente dati corrispondente`);
  });

  Object.entries(entries).forEach(([id, entry]) => {
    if (!isObject(entry)) {
      pushError(`${context}.${id}: entry non valida`);
      return;
    }
    const source = sourceById.get(id) || entry;
    const expectedSlug = getMediaSlug(source, kind === "player" ? "personaggio" : "npc");
    if (entry.mediaSlug !== expectedSlug) {
      pushError(`${context}.${id}: mediaSlug "${entry.mediaSlug}" diverso da "${expectedSlug}"`);
    }
    if (mediaSlugs.has(entry.mediaSlug)) {
      pushWarning(`${context}.${id}: mediaSlug duplicato con "${mediaSlugs.get(entry.mediaSlug)}"`);
    } else {
      mediaSlugs.set(entry.mediaSlug, id);
    }

    const expectedPaths = kind === "player"
      ? {
          idle: `media/campaigns/${campaignId}/players/${expectedSlug}-idle.webp`,
          hover: `media/campaigns/${campaignId}/players/${expectedSlug}-hover.webp`,
          token: `media/campaigns/${campaignId}/players/${expectedSlug}-token.webp`,
          avatar: `media/campaigns/${campaignId}/players/${expectedSlug}-avatar.webp`,
        }
      : {
          idle: `media/campaigns/${campaignId}/characters/${expectedSlug}/idle.webp`,
          hover: `media/campaigns/${campaignId}/characters/${expectedSlug}/hover.webp`,
          token: `media/campaigns/${campaignId}/characters/${expectedSlug}/token.webp`,
          avatar: `media/campaigns/${campaignId}/characters/${expectedSlug}/avatar.webp`,
        };

    Object.entries(expectedPaths).forEach(([variant, expectedPath]) => {
      if (entry.canonical?.[variant] !== expectedPath) {
        pushError(`${context}.${id}: canonical.${variant} deve essere "${expectedPath}"`);
      }
    });
  });
}

function validateCampaignData() {
  listCampaignDataDirs().forEach(({ campaignId, dataDir }) => {
    const characters = getCollectionData(readJsonIfExists(path.join(dataDir, "characters.json"), []));
    const characterIds = new Set(characters.map((character) => String(character?.id || "")).filter(Boolean));
    validateFamilyTreeFile(path.join(dataDir, "family_von_t.json"), {
      campaignId,
      validCharacterIds: characterIds,
    });
    validateMediaManifestForCampaign(campaignId, dataDir);
  });
}

function validateQuests(validNpcIds, validPlayerIds) {
  const questsPath = path.join(DATA_DIR, "quests.json");
  const questsData = readJson(questsPath);
  if (!Array.isArray(questsData)) {
    pushError(`${rel(questsPath)}: deve essere una lista`);
    return;
  }

  const statuses = new Set(["active", "in_progress", "completed", "failed", "hidden"]);
  const validateQuest = (quest, contextPath) => {
    if (!isObject(quest)) {
      pushError(`${contextPath}: quest non valida`);
      return;
    }
    if (!quest.title) pushError(`${contextPath}: title mancante`);
    if (!quest.status) pushWarning(`${contextPath}: status mancante`);
    if (quest.status && !statuses.has(quest.status)) {
      pushWarning(`${contextPath}: status non riconosciuto "${quest.status}"`);
    }
    if (quest.character_specific && !validPlayerIds.has(quest.character_specific)) {
      pushWarning(`${contextPath}: character_specific "${quest.character_specific}" non trovato`);
    }

    if (Array.isArray(quest.subquests)) {
      quest.subquests.forEach((sub, idx) => validateQuest(sub, `${contextPath}.subquests[${idx}]`));
    }
  };

  questsData.forEach((group, groupIdx) => {
    const context = `${rel(questsPath)}[${groupIdx}]`;
    if (!isObject(group)) {
      pushError(`${context}: gruppo missioni non valido`);
      return;
    }
    if (!group.id) pushError(`${context}: id mancante`);
    if (!group.title) pushError(`${context}: title mancante`);
    if (group.npc_id && !validNpcIds.has(group.npc_id)) {
      pushWarning(`${context}: npc_id "${group.npc_id}" non trovato`);
    }

    if (!Array.isArray(group.quests)) {
      pushError(`${context}: quests deve essere una lista`);
      return;
    }
    group.quests.forEach((quest, questIdx) => validateQuest(quest, `${context}.quests[${questIdx}]`));
  });
}

function validateMagicItems() {
  const itemsPath = path.join(DATA_DIR, "items.json");
  const items = readJson(itemsPath);
  if (!Array.isArray(items)) {
    pushError(`${rel(itemsPath)}: deve essere una lista`);
    return;
  }

  const ids = new Set();
  const validTypes = new Set([
    "Arma",
    "Armatura",
    "Anello",
    "Bacchetta",
    "Bastone",
    "Bottino",
    "Materiali",
    "Oggetto meraviglioso",
    "Pergamena",
    "Pozione",
    "Scudo",
    "Verga",
  ]);
  const validRarities = new Set([
    "Comune",
    "Non comune",
    "Raro",
    "Epico",
    "Molto raro",
    "Leggendario",
    "Artefatto",
    "Sconosciuta",
  ]);

  items.forEach((item, idx) => {
    const context = `${rel(itemsPath)}[${idx}]`;
    if (!isObject(item)) {
      pushError(`${context}: entry non valida`);
      return;
    }
    assert(item.id, `${context}: id mancante`);
    assert(item.name, `${context}: name mancante`);
    assert(item.image, `${context}: image mancante`);
    if (item.id) {
      if (ids.has(item.id)) pushError(`${context}: id duplicato "${item.id}"`);
      ids.add(item.id);
    }
    if (item.image && !isExternalAssetPath(item.image)) {
      const imagePath = path.join(ASSETS_DIR, item.image);
      if (!fileExists(imagePath)) {
        pushError(`${context}: immagine non trovata -> assets/${item.image}`);
      }
    }
    if (item.type && !validTypes.has(item.type)) {
      pushWarning(`${context}: tipo oggetto non standard "${item.type}"`);
    }
    if (item.rarity && !validRarities.has(item.rarity)) {
      pushWarning(`${context}: rarita non standard "${item.rarity}"`);
    }
    if ("attunement" in item && typeof item.attunement !== "boolean") {
      pushError(`${context}: attunement deve essere booleano`);
    }
    if (item.icon && typeof item.icon === "string" && !item.icon.startsWith("fa-")) {
      pushWarning(`${context}: icona sospetta "${item.icon}"`);
    }
    if (item.properties && !Array.isArray(item.properties)) {
      pushError(`${context}: properties deve essere una lista`);
    } else if (Array.isArray(item.properties)) {
      item.properties.forEach((property, propIdx) => {
        const propContext = `${context}.properties[${propIdx}]`;
        if (typeof property === "string") return;
        if (!isObject(property)) {
          pushError(`${propContext}: proprieta non valida`);
          return;
        }
        if (!property.name && !property.description) {
          pushWarning(`${propContext}: proprieta senza nome e descrizione`);
        }
      });
    }
  });
}

function validateSessions() {
  const sessionsPath = path.join(DATA_DIR, "sessions.json");
  const data = readJson(sessionsPath);
  if (!isObject(data)) {
    pushError(`${rel(sessionsPath)}: radice non valida`);
    return;
  }

  if (!Array.isArray(data.sessions)) {
    pushError(`${rel(sessionsPath)}: sessions deve essere una lista`);
    return;
  }

  const forbiddenKeys = new Set([
    "cliffhanger",
    "evento_trama",
    "eventoTrama",
    "session_type",
    "sessionType",
    "tipo",
  ]);

  let lastId = 0;
  data.sessions.forEach((session, idx) => {
    const ctx = `${rel(sessionsPath)}.sessions[${idx}]`;
    if (!isObject(session)) {
      pushError(`${ctx}: sessione non valida`);
      return;
    }
    if (typeof session.id !== "number") pushError(`${ctx}: id deve essere numerico`);
    if (!session.date) pushError(`${ctx}: date mancante`);
    if (!session.summary) pushError(`${ctx}: summary mancante`);
    if (session.id <= lastId) pushWarning(`${ctx}: id non crescente (${session.id})`);
    lastId = Math.max(lastId, session.id || 0);

    Object.keys(session).forEach((key) => {
      if (forbiddenKeys.has(key)) {
        pushError(`${ctx}: campo non consentito "${key}"`);
      }
    });

    if ("xp" in session) {
      if (!isObject(session.xp)) {
        pushError(`${ctx}: xp deve essere un oggetto`);
      } else {
        ["total", "each"].forEach((key) => {
          if (!(key in session.xp)) {
            pushError(`${ctx}: xp.${key} mancante`);
          }
        });
        if ("bonus" in session.xp) {
          if (!Array.isArray(session.xp.bonus)) {
            pushError(`${ctx}: xp.bonus deve essere una lista`);
          } else {
            session.xp.bonus.forEach((bonus, bonusIdx) => {
              const bonusCtx = `${ctx}: xp.bonus[${bonusIdx}]`;
              if (!isObject(bonus)) {
                pushError(`${bonusCtx} non valido`);
                return;
              }
              if (!bonus.name) pushError(`${bonusCtx}: name mancante`);
              if (!("amount" in bonus)) pushError(`${bonusCtx}: amount mancante`);
            });
          }
        }
      }
    }
  });
}

function validateNextSession() {
  const nextSessionPath = path.join(DATA_DIR, "next-session.json");
  const data = readJson(nextSessionPath);
  if (!isObject(data)) {
    pushError(`${rel(nextSessionPath)}: radice non valida`);
    return;
  }

  ["number", "date", "timeStart", "timeEnd", "isScheduled", "availabilityOptions"].forEach((key) => {
    if (!(key in data)) {
      pushError(`${rel(nextSessionPath)}: ${key} mancante`);
    }
  });

  if (typeof data.number !== "number") {
    pushError(`${rel(nextSessionPath)}: number deve essere numerico`);
  }

  if (typeof data.isScheduled !== "boolean") {
    pushError(`${rel(nextSessionPath)}: isScheduled deve essere boolean`);
  }

  if (!Array.isArray(data.availabilityOptions)) {
    pushError(`${rel(nextSessionPath)}: availabilityOptions deve essere una lista`);
    return;
  }

  data.availabilityOptions.forEach((option, idx) => {
    const ctx = `${rel(nextSessionPath)}.availabilityOptions[${idx}]`;
    if (!isObject(option)) {
      pushError(`${ctx}: opzione non valida`);
      return;
    }

    ["id", "label", "time"].forEach((key) => {
      if (!option[key]) {
        pushError(`${ctx}: ${key} mancante`);
      }
    });
  });
}

function validateUnreferencedMarkdown(markdownRefs) {
  const markdownFiles = [];
  const walk = (dir) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        return;
      }
      if (entry.name.endsWith(".md")) markdownFiles.push(fullPath);
    });
  };
  walk(CONTENT_DIR);

  markdownFiles.forEach((mdPath) => {
    const relative = rel(mdPath);
    if (!markdownRefs.has(relative)) {
      pushWarning(`${relative}: markdown non referenziato da content_blocks`);
    }
  });
}

function main() {
  validateCoreJsonFiles();

  const playersById = validatePlayers();
  const { npcById, markdownRefs } = validateCharacters(playersById);
  validateFamilyTreeFile(path.join(DATA_DIR, "family_von_t.json"), {
    campaignId: "cripta-di-sangue",
    validCharacterIds: new Set(npcById.keys()),
  });
  validateCampaignData();
  validateQuests(new Set(npcById.keys()), new Set(playersById.keys()));
  validateMagicItems();
  validateSessions();
  validateNextSession();
  validateUnreferencedMarkdown(markdownRefs);

  if (warnings.length > 0) {
    console.log("Warnings:");
    warnings.forEach((warning) => console.log(`- ${warning}`));
    console.log("");
  }

  if (errors.length > 0) {
    console.error("Errori di validazione:");
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }

  console.log("Validazione completata: nessun errore bloccante.");
}

main();
