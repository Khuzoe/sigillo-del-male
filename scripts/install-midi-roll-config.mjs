import {readFile, writeFile, mkdir, copyFile} from "node:fs/promises";
import {resolve, join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

// Patch the installed 0.11.x contract, preserving subsequent fixes and versions.
// --storage-only updates Wiki Sync without touching Khuzoe Automations.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.argv[2]) throw new Error("Specificare la directory Data/modules di Foundry DEV TEST.");
const modules = resolve(process.argv[2]);
const storageOnly = process.argv.includes("--storage-only");
if (process.argv.slice(3).some(arg => arg !== "--storage-only")) throw new Error("Opzione non riconosciuta.");
const automation = join(modules, "khuzoe-automations");
const sync = join(modules, "cripta-wiki-sync");
const plans = [];
async function edit(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before.replace(/\r\n/g, "\n"));
  if (after !== before.replace(/\r\n/g, "\n")) plans.push({path, before, after});
}
function replace(source, before, after) {
  if (source.includes(after)) return source;
  if (source.split(before).length !== 2) throw new Error("Versione dei sorgenti non riconosciuta: nessun file è stato modificato.");
  return source.replace(before, after);
}
const manifestPlans = [[sync, ["0.11.0", "0.11.1", "0.11.2", "0.11.3", "0.11.4", "0.11.5", "0.11.6"], "0.11.0", "0.11.1"]];
if (!storageOnly) manifestPlans.push([automation, ["0.26.2", "0.26.3"], "0.26.2", "0.26.3"]);
for (const [directory, versions, oldVersion, version] of manifestPlans) {
  await edit(join(directory, "module.json"), text => {
    const manifest = JSON.parse(text);
    if (!versions.includes(manifest.version)) throw new Error(`Versione non supportata per ${manifest.id}: ${manifest.version}`);
    return manifest.version === oldVersion ? text.replace(/("version"\s*:\s*")[^"]+/, `$1${version}`) : text;
  });
}
if (!storageOnly) await edit(join(automation, "scripts/main.mjs"), text => {
  const line = 'import {registerMidiRollConfig} from "./midi-roll-config.mjs";';
  if (!text.includes(line)) text = line + "\n" + text;
  return replace(text, '  exposeNpcRulesApi();\n  registerAutomations();', '  exposeNpcRulesApi();\n  registerMidiRollConfig();\n  registerAutomations();');
});
await edit(join(sync, "scripts/services/managed-actor-sync.js"), text => {
  const validatorImport = 'import { validateManagedMidiRollConfig } from "./midi-roll-config.mjs";';
  if (!text.includes(validatorImport)) text = validatorImport + "\n" + text;
  const legacyValidation = `                const midiApi = game.modules?.get("khuzoe-automations")?.api?.midiRollConfig;
                if (midiApi?.version !== 1) throw new Error("Integrazione tiri non disponibile: ricarica Foundry con i moduli aggiornati.");
                midiApi.validate(midiConfig, requestedActivities ?? readManagedCommandPath(item, "system.activities"));`;
  const localValidation = '                validateManagedMidiRollConfig(midiConfig, requestedActivities ?? readManagedCommandPath(item, "system.activities"));';
  if (text.includes(legacyValidation)) text = replace(text, legacyValidation, localValidation);
  text = replace(text,
    '            let requestedEffects = update.effects;\n            const requestedRules',
    `            let requestedEffects = update.effects;
            const midiConfig = foundry.utils.getProperty(update, "flags.khuzoe-automations.midiRollConfig");
            if (midiConfig !== undefined) {
                validateManagedMidiRollConfig(midiConfig, requestedActivities ?? readManagedCommandPath(item, "system.activities"));
            }
            const requestedRules`);
  text = replace(text,
    '    if (path === "effects" && documentValue?.documentName === "Item") return getManagedItemEffects(documentValue);',
    '    if (path === "flags.khuzoe-automations.midiRollConfig") return foundry.utils.deepClone(documentValue.flags?.["khuzoe-automations"]?.midiRollConfig ?? {version: 1, activities: {}});\n    if (path === "effects" && documentValue?.documentName === "Item") return getManagedItemEffects(documentValue);');
  text = replace(text,
    'npcRules: game.modules?.get("khuzoe-automations")?.api?.npcRules?.version ?? 0, fields',
    'npcRules: game.modules?.get("khuzoe-automations")?.api?.npcRules?.version ?? 0, midiRollConfig: game.modules?.get("khuzoe-automations")?.api?.midiRollConfig?.version ?? 0, fields');
  text = replace(text,
    '"khuzoe-automations": {npcRules: foundry.utils.deepClone(flags["khuzoe-automations"]?.npcRules ?? {version: 1, activities: {}})}',
    '"khuzoe-automations": {npcRules: foundry.utils.deepClone(flags["khuzoe-automations"]?.npcRules ?? {version: 1, activities: {}}), midiRollConfig: foundry.utils.deepClone(flags["khuzoe-automations"]?.midiRollConfig ?? {version: 1, activities: {}})}');
  return text;
});
const moduleFiles = [["integrations/cripta-wiki-sync/midi-roll-config.mjs", join(sync, "scripts/services/midi-roll-config.mjs")]];
if (!storageOnly) moduleFiles.push(["integrations/khuzoe-automations/midi-roll-config.mjs", join(automation, "scripts/midi-roll-config.mjs")]);
for (const [sourcePath, targetPath] of moduleFiles) {
  const source = await readFile(join(root, sourcePath), "utf8");
  let previous;
  try { previous = await readFile(targetPath, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (source !== previous) plans.push({path: targetPath, before: previous, after: source});
}
if (plans.length) {
  const backup = join(storageOnly ? sync : automation, ".maintenance", "midi-roll-config", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(backup, {recursive: true});
  for (const [index, plan] of plans.entries()) {
    if (plan.before !== undefined) await copyFile(plan.path, join(backup, `${index}-${plan.path.split(/[\\/]/).at(-1)}`));
  }
  for (const plan of plans) await writeFile(plan.path, plan.after);
  console.log(`Aggiornati ${plans.length} file. Backup: ${backup}`);
} else console.log("Integrazione già aggiornata; nessuna scrittura.");
