import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import vm from "node:vm";

if (!process.argv[2]) throw new Error("Specificare scripts/services/managed-actor-sync.js del modulo aggiornato.");
const installerUrl = new URL("./install-midi-roll-config.mjs", import.meta.url);
const repository = resolve(dirname(fileURLToPath(installerUrl)), "..");
const installer = await readFile(installerUrl, "utf8");
const validator = await readFile(join(repository, "integrations/cripta-wiki-sync/midi-roll-config.mjs"), "utf8");
const runtime = await readFile(join(repository, "integrations/khuzoe-automations/midi-roll-config.mjs"), "utf8");
const installedService = await readFile(process.argv[2], "utf8");
const localValidation = '                validateManagedMidiRollConfig(midiConfig, requestedActivities ?? readManagedCommandPath(item, "system.activities"));';
const legacyValidation = `                const midiApi = game.modules?.get("khuzoe-automations")?.api?.midiRollConfig;
                if (midiApi?.version !== 1) throw new Error("Integrazione tiri non disponibile: ricarica Foundry con i moduli aggiornati.");
                midiApi.validate(midiConfig, requestedActivities ?? readManagedCommandPath(item, "system.activities"));`;
assert.ok(installedService.includes(localValidation));
const oldService = installedService.replace(/^import \{ validateManagedMidiRollConfig \} from "\.\/midi-roll-config.mjs";\r?\n/m, "").replace(localValidation, legacyValidation);
const virtualModules = resolve(repository, "output/midi-installer-virtual");
const sync = join(virtualModules, "cripta-wiki-sync");
const automation = join(virtualModules, "khuzoe-automations");
const servicePath = join(sync, "scripts/services/managed-actor-sync.js");
const validatorPath = join(sync, "scripts/services/midi-roll-config.mjs");
const manifestPath = join(sync, "module.json");
const runtimePath = join(automation, "scripts/midi-roll-config.mjs");
const automationMainPath = join(automation, "scripts/main.mjs");
const files = new Map([
  [manifestPath, JSON.stringify({id: "cripta-wiki-sync", version: "0.11.4"})],
  [servicePath, oldService],
  [join(repository, "integrations/cripta-wiki-sync/midi-roll-config.mjs"), validator],
  [join(repository, "integrations/khuzoe-automations/midi-roll-config.mjs"), runtime]
]);
const writes = [], reads = [], messages = [];
let checks = 0;
const check = (value, label) => {assert.ok(value, label); checks++;};
async function run(options = ["--storage-only"]) {
  const sandbox = {
    process: {argv: ["node", "install-midi-roll-config.mjs", virtualModules, ...options]},
    console: {log: message => messages.push(message)}, resolve, join, dirname, fileURLToPath,
    async readFile(path) { reads.push(path); if (!files.has(path)) throw Object.assign(new Error("missing fixture"), {code: "ENOENT"}); return files.get(path); },
    async writeFile(path, value) {writes.push(path); files.set(path, value);},
    async copyFile(source, target) {writes.push(target); files.set(target, files.get(source));},
    async mkdir() {}
  };
  const body = installer.replace(/^import .*;\r?\n/gm, "").replaceAll("import.meta.url", JSON.stringify(installerUrl.href));
  await vm.runInNewContext(`(async () => {${body}\n})()`, sandbox);
}
await run();
check(files.get(servicePath).includes(localValidation) && !files.get(servicePath).includes(legacyValidation), "old Wiki Sync gains independent validation");
check(files.get(validatorPath) === validator, "validator is installed alongside the service");
check(JSON.parse(files.get(manifestPath)).version === "0.11.4", "newer installed version is not downgraded");
check(!reads.some(path => path.startsWith(automation)) && !writes.some(path => path.startsWith(automation)), "storage-only works with absent Automations and never reads or writes it");
check([...files.entries()].some(([path, value]) => path.includes(".maintenance") && value === oldService), "original service is backed up before replacement");
const afterInstall = writes.length;
await run();
check(writes.length === afterInstall && messages.at(-1).includes("nessuna scrittura"), "reinstall is idempotent");
files.set(manifestPath, JSON.stringify({id: "cripta-wiki-sync", version: "99.0.0"}));
await assert.rejects(() => run(), /Versione non supportata/); checks++;
check(writes.length === afterInstall, "unsupported version writes nothing");
files.set(manifestPath, JSON.stringify({id: "cripta-wiki-sync", version: "0.11.4"}));
files.set(servicePath, "Unrecognized service source");
await assert.rejects(() => run(), /Versione dei sorgenti non riconosciuta/); checks++;
check(writes.length === afterInstall, "unrecognized source writes nothing even after validation plans are collected");
files.set(servicePath, oldService);
files.set(join(automation, "module.json"), JSON.stringify({id: "khuzoe-automations", version: "0.26.2"}));
files.set(automationMainPath, "Hooks.once('ready', () => {\n  exposeNpcRulesApi();\n  registerAutomations();\n});");
await run([]);
check(JSON.parse(files.get(join(automation, "module.json"))).version === "0.26.3", "explicit full installation still updates the old runtime version");
check(files.get(automationMainPath).includes("registerMidiRollConfig();") && files.get(runtimePath) === runtime, "explicit full installation registers and installs the runtime");
check(files.get(servicePath).includes(localValidation), "full installation also uses independent Wiki Sync validation");
console.log(`Midi roll installer: ${checks} checks passed (in-memory files only).`);
