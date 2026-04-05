const fs = require("fs");
const path = require("path");
const { parseYamlLite } = require("./lib/yaml-lite");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "assets", "data");
const OUTPUT_PATH = path.join(DATA_DIR, "home-recent-npcs.json");

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

function loadNpcCharacters() {
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

      const aliases = Array.isArray(npc.aliases) && npc.aliases.length > 0
        ? npc.aliases
        : [npc.name || entry.id];

      return {
        id: npc.id || entry.id,
        name: npc.name || entry.id,
        role: npc.role || "NPC",
        avatar: npc.images?.avatar || "",
        hidden: npc.hidden === true,
        aliases: aliases.filter(Boolean),
      };
    })
    .filter(Boolean);
}

function rankNpcsByRecentSessions(npcs, sessions, windowSize = 2) {
  const recentSessions = (sessions || []).slice(-windowSize).reverse(); // newest first
  const summaries = recentSessions.map((session) => normalize(stripHtml(session.summary || "")));

  const ranked = npcs
    .map((npc) => {
      const aliasTerms = npc.aliases
        .map((alias) => normalize(alias))
        .filter((term) => term.length >= 1);

      // Keep id/name as hard fallback terms.
      const fallbackTerms = [
        normalize(npc.id.replace(/_/g, " ")),
        normalize((npc.name || "").split(" ")[0]),
      ].filter((term) => term.length >= 2);

      const uniqueTerms = [...new Set([...aliasTerms, ...fallbackTerms])];
      let score = 0;

      summaries.forEach((summary, idx) => {
        const weight = summaries.length - idx; // more weight for newest
        uniqueTerms.forEach((term) => {
          const occurrences = countTermOccurrences(summary, term);
          if (occurrences > 0) {
            score += 2 * weight * occurrences;
          }
        });
      });

      return { npc, score };
    })
    .sort((a, b) => b.score - a.score || a.npc.name.localeCompare(b.npc.name, "it"));

  return ranked;
}

function main() {
  const sessionsData = readJson(path.join(DATA_DIR, "sessions.json"));
  const sessions = Array.isArray(sessionsData.sessions) ? sessionsData.sessions : [];
  const npcs = loadNpcCharacters();
  const minItems = 3;
  let windowSize = Math.min(2, sessions.length);
  let ranked = rankNpcsByRecentSessions(npcs, sessions, windowSize);
  let scored = ranked.filter((item) => item.score > 0);

  while (scored.length < minItems && windowSize < sessions.length) {
    windowSize += 1;
    ranked = rankNpcsByRecentSessions(npcs, sessions, windowSize);
    scored = ranked.filter((item) => item.score > 0);
  }

  const selected = scored
    .slice(0, 4)
    .map((item) => ({
      id: item.npc.id,
      name: item.npc.name,
      role: item.npc.role,
      avatar: item.npc.avatar,
      hidden: item.npc.hidden === true,
      url: `pages/characters/character.html?id=${item.npc.id}`,
      score: item.score,
    }));

  const payload = {
    itemCount: selected.length,
    sessionIds: sessions.slice(-windowSize).map((s) => s.id),
    items: selected,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Lista home NPC recenti generata: ${path.relative(ROOT, OUTPUT_PATH)} (${selected.length} voci)`);
}

main();
