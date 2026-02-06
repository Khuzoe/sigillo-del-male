const fs = require("fs");
const path = require("path");
const { parseYamlLite } = require("./lib/yaml-lite");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "assets", "data");
const CONTENT_DIR = path.join(ROOT, "assets", "content");
const OUTPUT_PATH = path.join(DATA_DIR, "search-index.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readYaml(filePath) {
  return parseYamlLite(fs.readFileSync(filePath, "utf8"));
}

function safeReadText(filePath) {
  if (!fs.existsSync(filePath)) return "";
  return fs.readFileSync(filePath, "utf8");
}

function collapseWhitespace(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(text) {
  return collapseWhitespace(String(text || "").replace(/<[^>]*>/g, " "));
}

function stripMarkdown(text) {
  return collapseWhitespace(
    String(text || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`[^`]*`/g, " ")
      .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
      .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
      .replace(/^[#>\-\*\d\.\s]+/gm, "")
      .replace(/[*_~]/g, "")
  );
}

function truncate(text, maxLen = 600) {
  const clean = collapseWhitespace(text);
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}...`;
}

function buildNpcItems() {
  const manifestPath = path.join(DATA_DIR, "characters", "index.yaml");
  const manifest = readYaml(manifestPath);
  if (!Array.isArray(manifest)) return [];

  return manifest
    .filter((entry) => (entry.type || "npc") === "npc")
    .map((entry) => {
      const charPath = path.join(DATA_DIR, entry.file || `characters/${entry.id}.yaml`);
      const character = readYaml(charPath);
      if (character.hidden) return null;
      const blocks = Array.isArray(character.content_blocks) ? character.content_blocks : [];

      const blockSummaries = blocks
        .filter((block) => !block.hidden)
        .map((block) => {
          const parts = [];
          if (block.title) parts.push(block.title);
          if (block.markdown) {
            const mdPath = path.join(CONTENT_DIR, block.markdown);
            parts.push(stripMarkdown(safeReadText(mdPath)));
          }
          return parts.join(" ");
        })
        .join(" ");

      const summaryText = character.summary
        ? Object.values(character.summary)
            .map((value) => String(value || ""))
            .join(" ")
        : "";

      return {
        id: `npc:${character.id}`,
        type: "npc",
        entityId: character.id,
        title: character.name || character.id,
        subtitle: character.role || "",
        url: `pages/characters/character.html?id=${character.id}`,
        tags: ["npc", character.status || "", character.type || "npc"].filter(Boolean),
        content: truncate(
          [character.quote, summaryText, blockSummaries].map((v) => String(v || "")).join(" ")
        ),
      };
    })
    .filter(Boolean);
}

function buildPlayerItems() {
  const players = readJson(path.join(DATA_DIR, "players.json"));
  if (!Array.isArray(players)) return [];

  return players
    .filter((player) => !player.hidden)
    .map((player) => ({
      id: `player:${player.id}`,
      type: "player",
      entityId: player.id,
      title: player.name || player.id,
      subtitle: player.role || "",
      url: `pages/characters/character.html?id=${player.id}&type=player`,
      tags: ["player", player.summary?.race || ""].filter(Boolean),
      content: truncate(
        [
          player.description,
          player.summary
            ? Object.values(player.summary)
                .map((value) => String(value || ""))
                .join(" ")
            : "",
        ].join(" ")
      ),
    }));
}

function collectQuestTexts(quests, out = []) {
  if (!Array.isArray(quests)) return out;
  quests.forEach((quest) => {
    if (!quest || typeof quest !== "object") return;
    if (quest.hidden || quest.status === "hidden") return;
    if (quest.title) out.push(quest.title);
    if (quest.rewards) out.push(String(quest.rewards));
    if (Array.isArray(quest.subquests)) collectQuestTexts(quest.subquests, out);
  });
  return out;
}

function buildQuestItems() {
  const groups = readJson(path.join(DATA_DIR, "quests.json"));
  if (!Array.isArray(groups)) return [];

  return groups
    .filter((group) => !group.hidden)
    .map((group) => {
      const content = truncate(collectQuestTexts(group.quests || []).join(" "));
      if (!content) return null;
      return {
        id: `quest-group:${group.id || group.title}`,
        type: "quest",
        entityId: group.id || "",
        title: group.title || "Missioni",
        subtitle: group.npc_id ? `NPC: ${group.npc_id}` : "Trama principale",
        url: "pages/missioni.html",
        tags: ["quest", group.npc_id ? "npc" : "main"].filter(Boolean),
        content,
      };
    })
    .filter(Boolean);
}

function buildSessionItems() {
  const data = readJson(path.join(DATA_DIR, "sessions.json"));
  if (!data || !Array.isArray(data.sessions)) return [];

  return data.sessions.map((session) => {
    const xpPart = session.xp
      ? `XP totali ${session.xp.total} XP ciascuno ${session.xp.each}`
      : "";
    const extra = [
      session.skillPoint ? "punto abilita" : "",
      session.levelup ? `level up ${session.levelup}` : "",
      session.reward || "",
    ].join(" ");
    return {
      id: `session:${session.id}`,
      type: "session",
      entityId: String(session.id),
      title: `Sessione ${session.id}`,
      subtitle: session.date || "",
      url: `pages/sessioni.html#session-${session.id}`,
      tags: ["session", session.skillPoint ? "skill-point" : "", session.levelup ? "levelup" : ""].filter(
        Boolean
      ),
      content: truncate(`${stripHtml(session.summary)} ${xpPart} ${extra}`),
    };
  });
}

function buildFamilyItems() {
  const entries = readJson(path.join(DATA_DIR, "family_von_t.json"));
  if (!Array.isArray(entries)) return [];

  return entries
    .filter((entry) => !entry.hidden)
    .map((entry) => ({
      id: `family:${entry.id}`,
      type: "family",
      entityId: entry.id,
      title: entry.name || entry.id,
      subtitle: "Famiglia Von T",
      url: "pages/famiglia-von-t.html",
      tags: ["family", entry.von_t ? "von-t" : ""].filter(Boolean),
      // Evita spoiler di legami familiari nella ricerca globale.
      content: truncate([entry.name, "Membro della Famiglia Von T"].join(" ")),
    }));
}

function main() {
  const items = [
    ...buildNpcItems(),
    ...buildPlayerItems(),
    ...buildQuestItems(),
    ...buildSessionItems(),
    ...buildFamilyItems(),
  ].sort((a, b) => a.title.localeCompare(b.title, "it"));

  const payload = {
    generatedAt: new Date().toISOString(),
    itemCount: items.length,
    items,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Indice ricerca generato: ${path.relative(ROOT, OUTPUT_PATH)} (${items.length} voci)`);
}

main();
