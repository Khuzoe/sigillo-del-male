const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const MODULE_DIR = path.join(ROOT, "module");
const DIST_DIR = path.join(ROOT, "dist");
const STAGE_DIR = path.join(DIST_DIR, "_module-stage");
const ZIP_PATH = path.join(DIST_DIR, "cripta-wiki-sync.zip");
const DIST_MANIFEST_PATH = path.join(DIST_DIR, "module.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function removeIfExists(targetPath) {
  if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true, force: true });
}

function copyModule() {
  removeIfExists(STAGE_DIR);
  fs.mkdirSync(STAGE_DIR, { recursive: true });
  fs.cpSync(MODULE_DIR, STAGE_DIR, {
    recursive: true,
    filter: (source) => {
      const name = path.basename(source);
      return ![".DS_Store", "Thumbs.db"].includes(name);
    }
  });
}

function writeManifest(manifest) {
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(path.join(STAGE_DIR, "module.json"), text, "utf8");
  fs.writeFileSync(DIST_MANIFEST_PATH, text, "utf8");
}

function zipStage() {
  removeIfExists(ZIP_PATH);
  const command = [
    "Compress-Archive",
    "-Path",
    "'*'",
    "-DestinationPath",
    `'${ZIP_PATH.replace(/'/g, "''")}'`,
    "-Force"
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    cwd: STAGE_DIR,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(`Compress-Archive fallito con codice ${result.status}`);
  }
}

function main() {
  const manifestPath = path.join(MODULE_DIR, "module.json");
  const manifest = readJson(manifestPath);
  if (!manifest.id || !manifest.version) {
    throw new Error("module/module.json deve contenere id e version.");
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });
  copyModule();
  writeManifest(manifest);
  zipStage();
  removeIfExists(STAGE_DIR);
  console.log(`Creato ${path.relative(ROOT, DIST_MANIFEST_PATH)}`);
  console.log(`Creato ${path.relative(ROOT, ZIP_PATH)}`);
  console.log(`Versione modulo: ${manifest.version}`);
}

main();
