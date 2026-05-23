const { execFileSync } = require("node:child_process");

const RASTER_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".avif"
]);

function getStagedFiles() {
  const output = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
    encoding: "utf8"
  });

  return output
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
}

function getExtension(file) {
  const match = file.toLowerCase().match(/\.[^.\/\\]+$/);
  return match ? match[0] : "";
}

const blocked = getStagedFiles().filter((file) => RASTER_IMAGE_EXTENSIONS.has(getExtension(file)));

if (blocked.length) {
  console.error("[check:webp-only] Commit bloccato: le immagini raster devono essere .webp.");
  console.error("[check:webp-only] Converti o rimuovi questi file staged:");
  blocked.forEach((file) => console.error(`  - ${file}`));
  process.exit(1);
}

console.log("[check:webp-only] OK: nessuna immagine raster non-webp staged.");
