const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const textExtensions = new Set([
  ".js",
  ".json",
  ".yaml",
  ".yml",
  ".md",
  ".html",
  ".css",
  ".txt",
  ".gitignore",
]);

const excludedDirs = new Set([
  ".git",
  "node_modules",
  ".vscode",
  "assets/img",
  "assets/data/reports",
]);
const allowedMojibakeFiles = new Set(["fixchars.js"]);

const errors = [];
const warnings = [];

function toPosix(inputPath) {
  return inputPath.replace(/\\/g, "/");
}

function relative(filePath) {
  return toPosix(path.relative(ROOT, filePath));
}

function shouldExclude(dirPath) {
  const rel = relative(dirPath);
  return [...excludedDirs].some((entry) => rel === entry || rel.startsWith(`${entry}/`));
}

function listFiles(dirPath, output = []) {
  if (shouldExclude(dirPath)) return output;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  entries.forEach((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      listFiles(fullPath, output);
      return;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (textExtensions.has(ext) || textExtensions.has(entry.name)) {
      output.push(fullPath);
    }
  });

  return output;
}

function checkFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const relPath = relative(filePath);

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    errors.push(`${relPath}: UTF-8 BOM presente`);
  }

  const text = buffer.toString("utf8");

  // Heuristic checks for common mojibake sequences.
  const mojibakePatterns = [
    /Ã[\x80-\xBF]/,
    /Â[\x80-\xBF]/,
    /â[\x80-\xBF]/,
    /\uFFFD/,
  ];
  if (
    mojibakePatterns.some((pattern) => pattern.test(text)) &&
    !allowedMojibakeFiles.has(relPath)
  ) {
    warnings.push(`${relPath}: possibili caratteri corrotti (mojibake)`);
  }

  // Block uncommon control characters except tab/newline/carriage return.
  const controlChars = text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g);
  if (controlChars && controlChars.length > 0) {
    errors.push(`${relPath}: contiene caratteri di controllo non validi`);
  }
}

function main() {
  const allFiles = listFiles(ROOT);
  allFiles.forEach(checkFile);

  if (warnings.length > 0) {
    console.log("Warnings:");
    warnings.forEach((msg) => console.log(`- ${msg}`));
    console.log("");
  }

  if (errors.length > 0) {
    console.error("Errori encoding:");
    errors.forEach((msg) => console.error(`- ${msg}`));
    process.exitCode = 1;
    return;
  }

  console.log(`Encoding check completato (${allFiles.length} file controllati).`);
}

main();
