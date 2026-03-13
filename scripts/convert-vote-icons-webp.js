const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const browserCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

const icons = ["yes", "no", "maybe"];

function findBrowser() {
  const browserPath = browserCandidates.find((candidate) => fs.existsSync(candidate));
  if (!browserPath) {
    throw new Error("Browser headless non trovato. Installa Chrome o Edge.");
  }
  return browserPath;
}

function convertFile(browserPath, inputPath, outputPath) {
  const mimeType = path.extname(inputPath).toLowerCase() === ".jpg" ? "jpeg" : "png";
  const inputBase64 = fs.readFileSync(inputPath).toString("base64");
  const tempPath = path.join(
    os.tmpdir(),
    `cripta-vote-icon-${path.basename(inputPath, path.extname(inputPath))}-${Date.now()}.html`
  );

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>convert</title></head>
<body>
<pre id="out"></pre>
<script>
const img = new Image();
img.onload = () => {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  document.getElementById("out").textContent = canvas.toDataURL("image/webp", 0.92);
};
img.onerror = () => {
  document.getElementById("out").textContent = "ERROR: image load failed";
};
img.src = "data:image/${mimeType};base64,${inputBase64}";
</script>
</body>
</html>`;

  fs.writeFileSync(tempPath, html, "utf8");

  let dom = "";
  try {
    dom = execFileSync(
      browserPath,
      [
        "--headless=new",
        "--disable-gpu",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=10000",
        "--dump-dom",
        tempPath,
      ],
      {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
      }
    );
  } finally {
    fs.rmSync(tempPath, { force: true });
  }

  const match = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/i);
  if (!match) {
    throw new Error(`Output DOM non valido per ${path.basename(inputPath)}`);
  }

  const dataUrl = match[1].trim();
  if (!dataUrl || dataUrl.startsWith("ERROR:")) {
    throw new Error(`Conversione fallita per ${path.basename(inputPath)}: ${dataUrl || "nessun output"}`);
  }

  const base64 = dataUrl.replace(/^data:image\/webp;base64,/, "");
  fs.writeFileSync(outputPath, Buffer.from(base64, "base64"));
}

function main() {
  const browserPath = findBrowser();
  const uiDir = path.resolve("assets/img/ui");

  icons.forEach((iconName) => {
    const pngPath = path.join(uiDir, `${iconName}.png`);
    const webpPath = path.join(uiDir, `${iconName}.webp`);
    if (!fs.existsSync(pngPath)) {
      throw new Error(`File mancante: ${pngPath}`);
    }

    convertFile(browserPath, pngPath, webpPath);
    fs.rmSync(pngPath);
    console.log(`Convertito ${path.basename(pngPath)} -> ${path.basename(webpPath)}`);
  });
}

main();
