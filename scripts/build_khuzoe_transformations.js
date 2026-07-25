const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const MODULE_DIR = path.join(ROOT, "foundry-modules", "khuzoe-transformations");
const DIST_DIR = path.join(ROOT, "dist");
const STAGE_DIR = path.join(DIST_DIR, "_khuzoe-transformations-stage");
const ZIP_PATH = path.join(DIST_DIR, "khuzoe-transformations.zip");
const DIST_MANIFEST_PATH = path.join(DIST_DIR, "khuzoe-transformations-module.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function removeIfExists(targetPath) {
  if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true, force: true });
}

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(target) : [target];
  });
}

function validateSource() {
  const errors = [];
  for (const filePath of listFiles(MODULE_DIR).filter((file) => file.endsWith(".js"))) {
    const result = spawnSync(process.execPath, ["--check", filePath], { encoding: "utf8" });
    if (result.status === 0) continue;
    errors.push(`${path.relative(ROOT, filePath)}\n${result.error?.message || result.stderr || result.stdout}`);
  }
  for (const relativePath of ["module.json", "lang/it.json", "lang/en.json"]) {
    try {
      readJson(path.join(MODULE_DIR, relativePath));
    } catch (error) {
      errors.push(`${relativePath}\n${error.message}`);
    }
  }
  if (errors.length) throw new Error(`Pacchetto non creato:\n\n${errors.join("\n\n")}`);
}

function copyModule() {
  removeIfExists(STAGE_DIR);
  fs.mkdirSync(STAGE_DIR, { recursive: true });
  fs.cpSync(MODULE_DIR, STAGE_DIR, {
    recursive: true,
    filter: (source) => ![".DS_Store", "Thumbs.db"].includes(path.basename(source))
  });
}

function writeManifest(manifest) {
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(path.join(STAGE_DIR, "module.json"), text, "utf8");
  fs.writeFileSync(DIST_MANIFEST_PATH, text, "utf8");
}

function zipStage() {
  removeIfExists(ZIP_PATH);
  const destination = ZIP_PATH.replace(/'/g, "''");
  const command = `Compress-Archive -Path '*' -DestinationPath '${destination}' -Force`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    cwd: STAGE_DIR,
    stdio: "inherit"
  });
  if (result.status !== 0) throw new Error(`Compress-Archive fallito con codice ${result.status}`);
}

function main() {
  const manifest = readJson(path.join(MODULE_DIR, "module.json"));
  if (manifest.id !== "khuzoe-transformations" || !manifest.version) {
    throw new Error("Manifest Khuzoe Transformations non valido.");
  }
  validateSource();
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
