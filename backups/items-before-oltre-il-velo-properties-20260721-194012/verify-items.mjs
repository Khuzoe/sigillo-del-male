import fs from "node:fs";

const folder = new URL("./", import.meta.url);
const before = JSON.parse(fs.readFileSync(new URL("oltre-il-velo-items-response.json", folder), "utf8"));
const intended = JSON.parse(fs.readFileSync(new URL("oltre-il-velo-items-update-payload.json", folder), "utf8"));
const after = JSON.parse(fs.readFileSync(new URL("oltre-il-velo-items-after-response.json", folder), "utf8"));
const updatedIds = new Set([
  "ceppi-del-sangue-cauterizzato",
  "bendaggi-del-fato-infranto",
  "calzari-dell-eclissi-venatoria",
  "carapace-del-deperimento",
  "danza-sincopata",
]);
const excludedIds = new Set(["anello-d-argento-dei-nocthar", "nuovo-oggetto-mrulujin"]);
const index = (items) => new Map(items.map((item) => [item.id, item]));
const beforeById = index(before.data);
const intendedById = index(intended.data);
const afterById = index(after.data);

if (after.version !== before.version + 1) throw new Error("Unexpected version increment");
if (beforeById.size !== 7 || afterById.size !== 7) throw new Error("Item count changed");
if ([...beforeById.keys()].some((id) => !afterById.has(id))) throw new Error("An item id disappeared");

for (const id of excludedIds) {
  if (JSON.stringify(beforeById.get(id)) !== JSON.stringify(afterById.get(id))) throw new Error(`Excluded item changed: ${id}`);
}

for (const id of updatedIds) {
  const original = beforeById.get(id);
  const expected = intendedById.get(id);
  const current = afterById.get(id);
  if (!original || !expected || !current) throw new Error(`Missing updated item: ${id}`);
  if (current.summary !== expected.summary) throw new Error(`Summary mismatch: ${id}`);
  if (JSON.stringify(current.properties) !== JSON.stringify(expected.properties)) throw new Error(`Property mismatch: ${id}`);
  if (JSON.stringify(current.foundry) !== JSON.stringify(original.foundry)) throw new Error(`Foundry snapshot changed unexpectedly: ${id}`);
  if (current.sync?.pendingFoundry !== true || current.sync?.source !== "site") throw new Error(`Foundry pending flag missing: ${id}`);
  if (!current.properties.length || current.properties.some((property) => !property.name || !property.description)) throw new Error(`Invalid properties: ${id}`);
}

console.log(JSON.stringify({ ok: true, beforeVersion: before.version, afterVersion: after.version, total: after.data.length, updated: updatedIds.size, excludedUnchanged: excludedIds.size }, null, 2));
