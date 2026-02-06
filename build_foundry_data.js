const fs = require("fs");
const path = require("path");
const { parseYamlLite } = require("./scripts/lib/yaml-lite");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "assets", "data");
const CONTENT_DIR = path.join(ROOT, "assets", "content");
const OUTPUT_FILE = path.join(DATA_DIR, "foundry.json");
const BASE_URL = "https://khuzoe.github.io/sigillo-del-male/";

function ensureDirForFile(filePath) {
  const outDir = path.dirname(filePath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readYaml(filePath) {
  return parseYamlLite(fs.readFileSync(filePath, "utf8"));
}

function normalizePath(inputPath) {
  if (!inputPath || typeof inputPath !== "string") return null;
  if (inputPath.startsWith("http://") || inputPath.startsWith("https://")) return inputPath;
  if (inputPath.startsWith("assets/")) return `${BASE_URL}${inputPath}`;
  return `${BASE_URL}assets/${inputPath}`;
}

function parseMarkdownToHtml(markdownText) {
  if (!markdownText) return "";
  const lines = markdownText.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  const inline = (text) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>");

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      return;
    }

    if (/^###\s+/.test(line)) {
      closeList();
      out.push(`<h3>${inline(line.replace(/^###\s+/, ""))}</h3>`);
      return;
    }
    if (/^##\s+/.test(line)) {
      closeList();
      out.push(`<h2>${inline(line.replace(/^##\s+/, ""))}</h2>`);
      return;
    }
    if (/^#\s+/.test(line)) {
      closeList();
      out.push(`<h1>${inline(line.replace(/^#\s+/, ""))}</h1>`);
      return;
    }

    if (/^- /.test(line)) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(line.replace(/^- /, ""))}</li>`);
      return;
    }

    closeList();
    if (/^>\s?/.test(line)) {
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
      return;
    }
    out.push(`<p>${inline(line)}</p>`);
  });

  closeList();
  return out.join("\n");
}

function hydrateContentBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];

  return blocks.map((block) => {
    if (!block || typeof block !== "object") return block;
    const out = { ...block };

    if (out.image) out.image = normalizePath(out.image);

    if (out.markdown) {
      const markdownPath = path.join(CONTENT_DIR, out.markdown);
      if (fs.existsSync(markdownPath)) {
        const md = fs.readFileSync(markdownPath, "utf8");
        out.markdownText = parseMarkdownToHtml(md);
      } else {
        out.markdownText = "";
        console.warn(`[WARN] Markdown mancante: assets/content/${out.markdown}`);
      }
    }

    return out;
  });
}

function normalizeCharacter(character) {
  const out = { ...character };
  if (out.images && typeof out.images === "object") {
    out.images = {
      avatar: normalizePath(out.images.avatar),
      hover: normalizePath(out.images.hover),
      portrait: normalizePath(out.images.portrait),
    };
  }
  out.content_blocks = hydrateContentBlocks(out.content_blocks);
  if (!Array.isArray(out.relationships)) out.relationships = [];
  return out;
}

function loadNpcCharacters() {
  const manifestPath = path.join(DATA_DIR, "characters", "index.yaml");
  if (!fs.existsSync(manifestPath)) return [];

  const manifest = readYaml(manifestPath);
  if (!Array.isArray(manifest)) return [];

  const characters = [];
  manifest
    .filter((entry) => (entry.type || "npc") === "npc")
    .forEach((entry) => {
      const filePath = path.join(DATA_DIR, entry.file || `characters/${entry.id}.yaml`);
      if (!fs.existsSync(filePath)) {
        console.warn(`[WARN] NPC mancante nel manifest: ${entry.id}`);
        return;
      }
      try {
        const character = readYaml(filePath);
        if (character && character.id) {
          characters.push(normalizeCharacter(character));
        }
      } catch (err) {
        console.error(`[ERR] Errore parse NPC ${entry.id}:`, err.message);
      }
    });

  return characters;
}

function loadPlayers() {
  const filePath = path.join(DATA_DIR, "players.json");
  if (!fs.existsSync(filePath)) return [];
  const players = readJson(filePath);
  if (!Array.isArray(players)) return [];

  return players.map((player) => {
    const out = { ...player };
    if (out.images && typeof out.images === "object") {
      out.images = {
        avatar: normalizePath(out.images.avatar),
        hover: normalizePath(out.images.hover),
        portrait: normalizePath(out.images.portrait),
      };
    }
    return out;
  });
}

function loadSkills() {
  const filePath = path.join(DATA_DIR, "skills.json");
  if (!fs.existsSync(filePath)) return {};
  const skills = readJson(filePath);
  if (!skills || typeof skills !== "object") return {};

  Object.keys(skills).forEach((characterId) => {
    const tree = skills[characterId];
    if (!tree || typeof tree !== "object") return;
    if (tree.bgImage) tree.bgImage = normalizePath(`img/skill_trees/${tree.bgImage}`);
    if (Array.isArray(tree.nodes)) {
      tree.nodes = tree.nodes.map((node) => {
        if (!node || typeof node !== "object") return node;
        if (!node.icon) return node;
        return { ...node, icon: normalizePath(`img/skill_trees/${node.icon}`) };
      });
    }
  });

  return skills;
}

function loadSessions() {
  const filePath = path.join(DATA_DIR, "sessions.json");
  if (!fs.existsSync(filePath)) return {};
  return readJson(filePath);
}

function build() {
  console.log("Building Foundry data...");
  const payload = {
    characters: loadNpcCharacters(),
    players: loadPlayers(),
    skills: loadSkills(),
    sessions: loadSessions(),
  };

  ensureDirForFile(OUTPUT_FILE);
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Done: ${path.relative(ROOT, OUTPUT_FILE)}`);
  console.log(`- Characters: ${payload.characters.length}`);
  console.log(`- Players: ${payload.players.length}`);
  console.log(`- Sessions: ${Array.isArray(payload.sessions.sessions) ? payload.sessions.sessions.length : 0}`);
}

build();
