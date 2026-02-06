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

function validateCoreJsonFiles() {
  const files = [
    "players.json",
    "quests.json",
    "sessions.json",
    "skills.json",
    "family_von_t.json",
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

    if (!isObject(character.images)) {
      pushError(`${rel(charFile)}: campo "images" non valido`);
    } else {
      ["avatar", "hover", "portrait"].forEach((key) => {
        const imgPath = character.images[key];
        assert(imgPath, `${rel(charFile)}: images.${key} mancante`);
        if (imgPath && !/^https?:\/\//.test(imgPath)) {
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

        if (block.image && !/^https?:\/\//.test(block.image)) {
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
      if (!image) return;
      const imagePath = path.join(ASSETS_DIR, image);
      if (!fileExists(imagePath)) {
        pushError(`${rel(playersPath)}: ${player.id} immagine non trovata -> assets/${image}`);
      }
    });
  });

  return playersById;
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

function validateSessions() {
  const sessionsPath = path.join(DATA_DIR, "sessions.json");
  const data = readJson(sessionsPath);
  if (!isObject(data)) {
    pushError(`${rel(sessionsPath)}: radice non valida`);
    return;
  }

  if (!isObject(data.nextSession)) {
    pushError(`${rel(sessionsPath)}: nextSession non valido`);
  } else {
    ["number", "date", "timeStart", "timeEnd", "isScheduled"].forEach((key) => {
      if (!(key in data.nextSession)) {
        pushError(`${rel(sessionsPath)}: nextSession.${key} mancante`);
      }
    });
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
      }
    }
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
  validateQuests(new Set(npcById.keys()), new Set(playersById.keys()));
  validateSessions();
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
