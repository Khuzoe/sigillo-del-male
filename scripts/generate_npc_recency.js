const fs = require("fs");
const path = require("path");
const { parseYamlLite } = require("./lib/yaml-lite");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "assets", "data");
const OUTPUT_PATH = path.join(DATA_DIR, "npc-recency.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readYaml(filePath) {
  return parseYamlLite(fs.readFileSync(filePath, "utf8"));
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(text) {
  return String(text || "").replace(/<[^>]*>/g, " ");
}

function countTermOccurrences(normalizedText, normalizedTerm) {
  if (!normalizedText || !normalizedTerm) return 0;
  const haystack = ` ${normalizedText} `;
  const needle = ` ${normalizedTerm} `;
  let count = 0;
  let cursor = 0;
  while (true) {
    const index = haystack.indexOf(needle, cursor);
    if (index === -1) break;
    count += 1;
    cursor = index + needle.length;
  }
  return count;
}

function loadNpcs() {
  const manifestPath = path.join(DATA_DIR, "characters", "index.yaml");
  const manifest = readYaml(manifestPath);
  if (!Array.isArray(manifest)) return [];

  return manifest
    .filter((entry) => (entry.type || "npc") === "npc")
    .map((entry) => {
      const filePath = path.join(DATA_DIR, entry.file || `characters/${entry.id}.yaml`);
      if (!fs.existsSync(filePath)) return null;
      const npc = readYaml(filePath);
      if (!npc || typeof npc !== "object") return null;
      if (npc.hidden === true) return null;

      const aliases = Array.isArray(npc.aliases) && npc.aliases.length > 0
        ? npc.aliases
        : [npc.name || entry.id];

      return {
        id: npc.id || entry.id,
        name: npc.name || entry.id,
        aliases: aliases.filter(Boolean),
        orderSlot: Number.isFinite(Number(npc.order_slot)) ? Number(npc.order_slot) : null,
      };
    })
    .filter(Boolean);
}

function analyzeNpcRecency(npcs, sessions) {
  const normalizedSessions = (sessions || []).map((session) => ({
    id: session.id,
    summary: normalize(stripHtml(session.summary || "")),
  }));

  return npcs
    .map((npc) => {
      const aliasTerms = npc.aliases
        .map((alias) => normalize(alias))
        .filter((term) => term.length >= 1);

      const fallbackTerms = [
        normalize(npc.id.replace(/_/g, " ")),
        normalize((npc.name || "").split(" ")[0]),
      ].filter((term) => term.length >= 2);

      const terms = [...new Set([...aliasTerms, ...fallbackTerms])];
      let lastMentionSessionId = null;
      let mentions = 0;

      normalizedSessions.forEach((session) => {
        let sessionMentions = 0;
        terms.forEach((term) => {
          sessionMentions += countTermOccurrences(session.summary, term);
        });
        if (sessionMentions > 0) {
          mentions += sessionMentions;
          lastMentionSessionId = session.id;
        }
      });

      return {
        id: npc.id,
        name: npc.name,
        order_slot: npc.orderSlot,
        lastMentionSessionId,
        mentions,
      };
    })
    .sort((a, b) => {
      const aPinned = Number.isFinite(a.order_slot);
      const bPinned = Number.isFinite(b.order_slot);
      if (aPinned && bPinned && a.order_slot !== b.order_slot) return a.order_slot - b.order_slot;
      if (aPinned !== bPinned) return aPinned ? -1 : 1;

      const aRecent = Number.isFinite(a.lastMentionSessionId) ? a.lastMentionSessionId : -1;
      const bRecent = Number.isFinite(b.lastMentionSessionId) ? b.lastMentionSessionId : -1;
      if (aRecent !== bRecent) return bRecent - aRecent;
      if (a.mentions !== b.mentions) return b.mentions - a.mentions;
      return a.name.localeCompare(b.name, "it");
    });
}

function main() {
  const sessionsData = readJson(path.join(DATA_DIR, "sessions.json"));
  const sessions = Array.isArray(sessionsData.sessions) ? sessionsData.sessions : [];
  const npcs = loadNpcs();
  const items = analyzeNpcRecency(npcs, sessions);

  const payload = {
    itemCount: items.length,
    sessionIds: sessions.map((s) => s.id),
    items,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Indice recenza NPC generato: ${path.relative(ROOT, OUTPUT_PATH)} (${items.length} voci)`);
}

main();
