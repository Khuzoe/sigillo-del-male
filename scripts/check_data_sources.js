const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "docs", "data-source-map.json");
const SCAN_ROOTS = [
  path.join(ROOT, "assets", "data"),
  path.join(ROOT, "campaigns"),
];
const DATA_EXTENSIONS = new Set([".json", ".yaml", ".yml", ".md"]);
const VALID_KINDS = new Set(["authoring", "authoring-import", "generated", "generated-draft", "template"]);

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function escapeRegex(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.*]/g, "\\$&");
}

function patternToRegex(pattern) {
  const parts = String(pattern || "").split("/");
  const source = parts
    .map((part) => {
      if (part === "**") return "(?:[^/]+/)*[^/]*";
      return escapeRegex(part).replace(/\\\*/g, "[^/]*");
    })
    .join("/");
  return new RegExp(`^${source}$`);
}

function patternSpecificity(pattern) {
  return String(pattern || "").replace(/\*/g, "").length;
}

function compileRules(rules) {
  return rules.map((rule, index) => ({
    ...rule,
    index,
    specificity: patternSpecificity(rule.pattern),
    regex: patternToRegex(rule.pattern),
  }));
}

function listDataFiles(dirPath, output = []) {
  if (!fs.existsSync(dirPath)) return output;
  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) return output;

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      listDataFiles(fullPath, output);
      continue;
    }
    if (DATA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      output.push(fullPath);
    }
  }
  return output;
}

function classify(relativePath, rules) {
  const matches = rules.filter((rule) => rule.regex.test(relativePath));
  if (!matches.length) return null;
  matches.sort((left, right) => {
    if (right.specificity !== left.specificity) return right.specificity - left.specificity;
    return right.index - left.index;
  });
  return matches[0];
}

function main() {
  const manifest = readJson(MANIFEST_PATH);
  const errors = [];

  if (!Array.isArray(manifest.rules)) {
    errors.push(`${rel(MANIFEST_PATH)}: campo rules mancante o non valido`);
  }

  const rules = compileRules(Array.isArray(manifest.rules) ? manifest.rules : []);
  rules.forEach((rule, index) => {
    if (!rule.pattern) errors.push(`${rel(MANIFEST_PATH)}: regola ${index + 1} senza pattern`);
    if (!VALID_KINDS.has(rule.kind)) errors.push(`${rel(MANIFEST_PATH)}: regola ${index + 1} kind non valido: ${rule.kind}`);
    if ((rule.kind === "generated" || rule.kind === "generated-draft") && rule.owner === "script" && !rule.command) {
      errors.push(`${rel(MANIFEST_PATH)}: regola ${index + 1} generated senza command`);
    }
  });

  const files = SCAN_ROOTS.flatMap((root) => listDataFiles(root)).map(rel);
  const unclassified = [];

  files.forEach((file) => {
    if (file.startsWith("campaigns/") && !file.includes("/data/")) return;
    const rule = classify(file, rules);
    if (!rule) unclassified.push(file);
  });

  if (unclassified.length) {
    errors.push([
      "File dati non classificati in docs/data-source-map.json:",
      ...unclassified.map((file) => `  - ${file}`),
    ].join("\n"));
  }

  if (errors.length) {
    console.error(errors.join("\n\n"));
    process.exit(1);
  }

  const counts = new Map();
  files.forEach((file) => {
    if (file.startsWith("campaigns/") && !file.includes("/data/")) return;
    const rule = classify(file, rules);
    if (!rule) return;
    counts.set(rule.kind, (counts.get(rule.kind) || 0) + 1);
  });

  const summary = Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, count]) => `${kind}: ${count}`)
    .join(", ");
  console.log(`Data source map OK (${summary})`);
}

main();
