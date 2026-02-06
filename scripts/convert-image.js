const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function parseArgs(argv) {
  const args = {
    input: "",
    output: "",
    quality: 80,
    recursive: false,
    overwrite: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--input" || token === "-i") args.input = argv[++i] || "";
    else if (token === "--output" || token === "-o") args.output = argv[++i] || "";
    else if (token === "--quality" || token === "-q") args.quality = Number(argv[++i] || "80");
    else if (token === "--recursive" || token === "-r") args.recursive = true;
    else if (token === "--overwrite") args.overwrite = true;
    else if (token === "--help" || token === "-h") args.help = true;
  }
  return args;
}

function printHelp() {
  console.log("Uso:");
  console.log("  node scripts/convert-image.js --input <file|dir> [--output <file|dir>] [--quality 80]");
  console.log("  node scripts/convert-image.js --input assets/img/items --recursive --quality 80");
  console.log("");
  console.log("Note:");
  console.log("- Preferisce il modulo 'sharp' se disponibile.");
  console.log("- Se sharp non e disponibile, prova a usare il comando 'cwebp'.");
}

function listImages(dirPath, recursive) {
  const out = [];
  const walk = (dir) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recursive) walk(fullPath);
        return;
      }
      if (/\.(png|jpe?g)$/i.test(entry.name)) out.push(fullPath);
    });
  };
  walk(dirPath);
  return out;
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function hasCommand(commandName) {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [commandName], { stdio: "ignore" });
  return result.status === 0;
}

async function convertWithSharp(sharp, inputPath, outputPath, quality) {
  await sharp(inputPath).webp({ quality }).toFile(outputPath);
}

function convertWithCwebp(inputPath, outputPath, quality) {
  const result = spawnSync("cwebp", ["-q", String(quality), inputPath, "-o", outputPath], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`cwebp fallito su ${inputPath}`);
  }
}

function getOutputPath(inputPath, outputBase, baseInputRoot) {
  const sourceDir = path.dirname(inputPath);
  const sourceName = path.basename(inputPath, path.extname(inputPath));

  if (!outputBase) return path.join(sourceDir, `${sourceName}.webp`);

  const outStat = fs.existsSync(outputBase) ? fs.statSync(outputBase) : null;
  if (outStat && outStat.isDirectory()) {
    const relative = baseInputRoot ? path.relative(baseInputRoot, sourceDir) : "";
    return path.join(outputBase, relative, `${sourceName}.webp`);
  }

  if (!outStat && !path.extname(outputBase)) {
    const relative = baseInputRoot ? path.relative(baseInputRoot, sourceDir) : "";
    return path.join(outputBase, relative, `${sourceName}.webp`);
  }

  return outputBase;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.input) {
    printHelp();
    if (!args.help) process.exitCode = 1;
    return;
  }

  const inputPath = path.resolve(args.input);
  const outputBase = args.output ? path.resolve(args.output) : "";

  if (!fs.existsSync(inputPath)) {
    console.error(`Input non trovato: ${inputPath}`);
    process.exitCode = 1;
    return;
  }

  let sharp = null;
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    sharp = require("sharp");
  } catch {
    sharp = null;
  }

  const useCwebp = !sharp && hasCommand("cwebp");
  if (!sharp && !useCwebp) {
    console.error("Nessun convertitore disponibile. Installa 'sharp' oppure 'cwebp'.");
    process.exitCode = 1;
    return;
  }

  const sources = fs.statSync(inputPath).isDirectory()
    ? listImages(inputPath, args.recursive)
    : [inputPath];

  if (sources.length === 0) {
    console.log("Nessuna immagine PNG/JPG trovata.");
    return;
  }

  let converted = 0;
  for (const source of sources) {
    const output = getOutputPath(source, outputBase, fs.statSync(inputPath).isDirectory() ? inputPath : "");
    if (!args.overwrite && fs.existsSync(output)) {
      continue;
    }
    ensureDir(output);
    if (sharp) {
      // eslint-disable-next-line no-await-in-loop
      await convertWithSharp(sharp, source, output, args.quality);
    } else {
      convertWithCwebp(source, output, args.quality);
    }
    converted += 1;
    console.log(`Convertito: ${path.relative(process.cwd(), source)} -> ${path.relative(process.cwd(), output)}`);
  }

  console.log(`Completato. File convertiti: ${converted}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
