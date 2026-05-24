const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const WRANGLER_CWD = path.join(ROOT, "workers", "main-worker");
const BUCKET = "khuzoe-wiki";
const JSON_FILES = [
  path.join(ROOT, "assets", "data", "items.json"),
  path.join(ROOT, "assets", "data", "bestiary.json"),
  path.join(ROOT, "assets", "data", "players.json"),
  path.join(ROOT, "assets", "data", "family_von_t.json"),
  path.join(ROOT, "assets", "data", "home-recent-npcs.json")
];
const MIGRATIONS = [
  {
    oldPrefix: "img/items/",
    mediaPrefix: "media/items/",
    localDir: path.join(ROOT, "assets", "img", "items"),
    r2Folder: "items"
  },
  {
    oldPrefix: "img/creatures/bestiary/",
    mediaPrefix: "media/creatures/bestiary/",
    localDir: path.join(ROOT, "assets", "img", "creatures", "bestiary"),
    r2Folder: "creatures/bestiary"
  }
];

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const skipUpload = args.has("--skip-upload");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function walk(value, visitor) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      value[index] = walk(entry, visitor);
    });
    return value;
  }
  if (value && typeof value === "object") {
    Object.keys(value).forEach((key) => {
      value[key] = walk(value[key], visitor);
    });
    return value;
  }
  return visitor(value);
}

function collectReferencedLocalImages(data) {
  const refs = new Map();
  walk(structuredCloneSafe(data), (value) => {
    if (typeof value !== "string") return value;
    for (const migration of MIGRATIONS) {
      if (!value.startsWith(migration.oldPrefix)) continue;
      const filename = value.slice(migration.oldPrefix.length);
      if (!filename || filename.includes("/") || !filename.toLowerCase().endsWith(".webp")) continue;
      refs.set(value, { migration, filename });
    }
    return value;
  });
  return refs;
}

function migrateImagePaths(data) {
  let changes = 0;
  const migrated = walk(data, (value) => {
    if (typeof value !== "string") return value;
    for (const migration of MIGRATIONS) {
      if (!value.startsWith(migration.oldPrefix)) continue;
      const filename = value.slice(migration.oldPrefix.length);
      if (!filename || filename.includes("/") || !filename.toLowerCase().endsWith(".webp")) return value;
      changes += 1;
      return `${migration.mediaPrefix}${filename}`;
    }
    return value;
  });
  return { migrated, changes };
}

function uploadObject(localFile, r2Key) {
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["wrangler", "r2", "object", "put", `${BUCKET}/${r2Key}`, "--file", localFile, "--remote"],
    {
      cwd: WRANGLER_CWD,
      encoding: "utf8",
      stdio: "pipe"
    }
  );

  if (result.status !== 0) {
    throw new Error([
      `Upload fallito: ${r2Key}`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join("\n"));
  }
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function main() {
  const jsonEntries = JSON_FILES.map((file) => ({ file, data: readJson(file) }));
  const refs = new Map();

  jsonEntries.forEach(({ data }) => {
    collectReferencedLocalImages(data).forEach((ref, key) => refs.set(key, ref));
  });

  const uploads = [...refs.values()].map(({ migration, filename }) => {
    const localFile = path.join(migration.localDir, filename);
    return {
      filename,
      localFile,
      r2Key: `${migration.r2Folder}/${filename}`
    };
  });

  const missing = uploads.filter((upload) => !fs.existsSync(upload.localFile));
  if (missing.length) {
    console.error("File referenziati ma mancanti:");
    missing.forEach((upload) => console.error(`  - ${path.relative(ROOT, upload.localFile)}`));
    process.exit(1);
  }

  console.log(`[media-r2] Bucket: ${BUCKET}`);
  console.log(`[media-r2] Upload previsti: ${uploads.length}`);
  uploads.forEach((upload) => {
    console.log(`  - ${path.relative(ROOT, upload.localFile)} -> ${upload.r2Key}`);
  });

  if (!dryRun && !skipUpload) {
    uploads.forEach((upload) => uploadObject(upload.localFile, upload.r2Key));
  }

  let totalChanges = 0;
  jsonEntries.forEach((entry) => {
    const { migrated, changes } = migrateImagePaths(entry.data);
    totalChanges += changes;
    if (!dryRun) writeJson(entry.file, migrated);
    console.log(`[media-r2] ${path.relative(ROOT, entry.file)}: ${changes} path aggiornati`);
  });

  if (dryRun) {
    console.log("[media-r2] Dry-run: nessun upload e nessun file modificato.");
  } else {
    console.log(`[media-r2] Migrazione completata. Path aggiornati: ${totalChanges}`);
  }
}

main();
