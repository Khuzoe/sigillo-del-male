import fs from "node:fs";

const [inputPath, outputPath, reportPath] = process.argv.slice(2);
if (!inputPath || !outputPath || !reportPath) throw new Error("Missing input/output/report paths");

const specs = {
  "ceppi-del-sangue-cauterizzato": {
    lineCount: 6,
    properties: [
      ["Ferocia del Cacciatore", 2, ""],
      ["Fendente Cauterizzante", 3, ""],
      ["Morsa della Fornace", 4, "3 cariche · recupera 1d3 all'alba"],
      ["Vigore della Preda Assimilata", 5, "1 uso · recupera all'alba"],
    ],
  },
  "bendaggi-del-fato-infranto": {
    lineCount: 5,
    properties: [
      ["Passo Entropico", 2, ""],
      ["Orme della Rovina", 3, ""],
      ["Furto di Sincronia", 4, "4 cariche · recupera 1d4 a mezzanotte"],
    ],
  },
  "calzari-dell-eclissi-venatoria": {
    lineCount: 5,
    properties: [
      ["Passi dell'Eclissi", 2, ""],
      ["Balzo del Vuoto Famelico", 3, ""],
      ["Esecuzione Soffocata", 4, ""],
    ],
  },
  "carapace-del-deperimento": {
    lineCount: 5,
    properties: [
      ["Protezione Corrosa", 2, ""],
      ["Simbiosi Necrotica", 3, ""],
      ["Contagio da Impatto", 4, "4 cariche · recupera 1d4 all'alba"],
    ],
  },
  "danza-sincopata": {
    lineCount: 6,
    properties: [
      ["Lama +2", 2, ""],
      ["Fendente Dissonante", 3, ""],
      ["Furto di Ritmo", 4, "5 cariche · recupera 1d4+1 all'alba"],
      ["Recisione del Filo", 5, ""],
    ],
  },
};

const excludedIds = new Set(["anello-d-argento-dei-nocthar", "nuovo-oggetto-mrulujin"]);
const source = JSON.parse(fs.readFileSync(inputPath, "utf8"));
if (!source?.ok || source.campaignId !== "oltre-il-velo" || !Array.isArray(source.data)) {
  throw new Error("Unexpected Oltre il Velo catalog document");
}

const excludedBefore = new Map(source.data.filter((item) => excludedIds.has(item.id)).map((item) => [item.id, JSON.stringify(item)]));
const report = [];

for (const item of source.data) {
  const spec = specs[item.id];
  if (!spec) continue;
  const lines = String(item.summary || "").split(/\r?\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== spec.lineCount) throw new Error(`${item.name}: expected ${spec.lineCount} summary lines, found ${lines.length}`);

  item.summary = lines[1];
  item.properties = spec.properties.map(([name, lineIndex, charges]) => {
    const headingPattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[.:]\\s*`, "i");
    const description = lines[lineIndex].replace(headingPattern, "").trim();
    if (!description) throw new Error(`${item.name}: empty property ${name}`);
    return { name, charges, description };
  });
  report.push({ id: item.id, name: item.name, summary: item.summary, properties: item.properties.map(({ name, charges }) => ({ name, charges })) });
}

if (report.length !== Object.keys(specs).length) throw new Error(`Expected ${Object.keys(specs).length} updated items, found ${report.length}`);
for (const [id, original] of excludedBefore) {
  const current = source.data.find((item) => item.id === id);
  if (JSON.stringify(current) !== original) throw new Error(`Excluded item changed: ${id}`);
}

const payload = { campaignId: "oltre-il-velo", expectedVersion: Number(source.version), data: source.data };
fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
fs.writeFileSync(reportPath, JSON.stringify({ campaignId: payload.campaignId, expectedVersion: payload.expectedVersion, updated: report, excluded: [...excludedIds] }, null, 2) + "\n", "utf8");
