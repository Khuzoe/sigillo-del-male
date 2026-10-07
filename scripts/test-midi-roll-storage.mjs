import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {validateManagedMidiRollConfig} from "../integrations/cripta-wiki-sync/midi-roll-config.mjs";
import {validateMidiRollConfig} from "../integrations/khuzoe-automations/midi-roll-config.mjs";

const workerSource = await readFile(new URL("../workers/main-worker/src/index.js", import.meta.url), "utf8");
const workerValidation = workerSource.slice(workerSource.indexOf("function validManagedMidiRollConfig("), workerSource.indexOf("function stripManagedMidiRollConfig("));
assert.ok(workerValidation.startsWith("function validManagedMidiRollConfig("));
const apiSandbox = {};
vm.runInNewContext(workerValidation + "\nglobalThis.validate = validManagedMidiRollConfig;", apiSandbox);
const activities = {attack: {type: "attack"}, save: {type: "save"}, damage: {type: "damage"}, heal: {type: "heal"}};
const config = values => ({version: 1, activities: {attack: {enabled: true, attackMaxChance: 20, damageMaxChance: 50, ...values}}});
let checks = 0;
function verify(value, valid, targets = activities) {
  const label = `storage/API/runtime agree: ${JSON.stringify(value)}`;
  if (valid) {
    assert.equal(validateManagedMidiRollConfig(value, targets), value, label); checks++;
    assert.equal(validateMidiRollConfig(value, targets), value, label); checks++;
  } else {
    assert.throws(() => validateManagedMidiRollConfig(value, targets), label); checks++;
    assert.throws(() => validateMidiRollConfig(value, targets), label); checks++;
  }
  assert.equal(apiSandbox.validate(value, targets), valid, label); checks++;
}
for (const percentage of [0, 0.1, 20, 99.9, 100, null, undefined]) verify(config({attackMaxChance: percentage, damageMaxChance: percentage}), true);
verify({version: 1, activities: {}}, true);
verify({activities: {attack: {}, save: {enabled: false, damageMaxChance: 0}, damage: {damageMaxChance: 100}}}, true);
verify(config({enabled: false}), true);
for (const percentage of [-1, 101, "50", NaN, Infinity, true]) verify(config({damageMaxChance: percentage}), false);
for (const value of [
  null, [], {}, {version: 2, activities: {}}, {version: 1, activities: []},
  {version: 1, activities: {}, script: "unsafe()"}, config({when: "always"}), config({script: "unsafe()"}), config({enabled: "true"}),
  {activities: {unknown: {enabled: true}}}, {activities: {"invalid.id": {enabled: true}}}, {activities: {attack: []}},
  {activities: {save: {attackMaxChance: 50}}}, {activities: {heal: {damageMaxChance: 50}}},
  {activities: JSON.parse('{"__proto__":{"enabled":true}}')}, {activities: {constructor: {enabled: true}}}
]) verify(value, false);
const manyTargets = Object.fromEntries(Array.from({length: 33}, (_, i) => [`a${i}`, {type: "attack"}]));
verify({activities: Object.fromEntries(Object.keys(manyTargets).map(id => [id, {enabled: true}]))}, false, manyTargets);
assert.throws(() => validateManagedMidiRollConfig(config(), undefined)); checks++;
assert.throws(() => validateManagedMidiRollConfig(config(), [])); checks++;
console.log(`Midi roll storage validation: ${checks} checks passed.`);
