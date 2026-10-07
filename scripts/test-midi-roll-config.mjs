import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import vm from "node:vm";
import {validateMidiRollConfig, midiFace, configureMidiRolls, midiMapRandomFace, midiClone, registerMidiRollConfig} from "../integrations/khuzoe-automations/midi-roll-config.mjs";

let checks = 0;
const equal = (a, b, label) => {assert.deepEqual(a, b, label); checks++;};
const rule = (values = {}) => ({version: 1, activities: {bite: {enabled: true, attackMaxChance: 20, damageMaxChance: 50, ...values}}});
const activity = values => ({subject: {id: "bite", type: "attack", item: {_source: {flags: {"khuzoe-automations": {midiRollConfig: rule(values)}}}}}});
const activities = {bite: {type: "attack"}};
for (const value of [0, .1, 20, 50, 100, null, undefined]) {
  assert.doesNotThrow(() => validateMidiRollConfig(rule({attackMaxChance: value}), activities)); checks++;
}
for (const bad of [-1, 101, "50", NaN, Infinity, true]) {
  assert.throws(() => validateMidiRollConfig(rule({damageMaxChance: bad}), activities)); checks++;
}
for (const bad of [{activities: {missing: {enabled: true}}}, rule({when: "always"}), rule({enabled: "true"}), {activities: JSON.parse('{"__proto__":{}}')}]) {
  assert.throws(() => validateMidiRollConfig(bad, activities)); checks++;
}
for (const faces of [4, 6, 8, 10, 12, 20]) {
  const counts = Array(faces).fill(0);
  const samples = (faces - 1) * 2000;
  for (let i = 0; i < samples; i++) counts[midiFace(faces, 50, (i + .5) / samples) - 1]++;
  equal(counts.at(-1), samples / 2, `d${faces}: exact maximum probability`);
  equal(counts.slice(0, -1), Array(faces - 1).fill(1000), `d${faces}: other faces are uniform`);
  equal(midiFace(faces, 100, .999999), faces, "100% boundary");
  equal(midiFace(faces, 0, 0), 1, "0% lower boundary");
  equal(midiFace(faces, 0, .999999), faces - 1, "0% never produces maximum");
}

// Execute the installed v14 DiceTerm/Die implementations, including their modifiers.
const foundryRoot = process.argv[2];
if (!foundryRoot) throw new Error("Specificare la directory Foundry DEV TEST per verificare i dadi nativi v14.");
let uniforms = [];
const context = vm.createContext({console, Roll: class Roll {}, deepClone: structuredClone,
  game: {settings: {get: () => ({})}, user: {hasPermission: () => true}},
  CONFIG: {Dice: {randomUniform: () => {assert.ok(uniforms.length, "unexpected random draw"); return uniforms.shift();}, fulfillment: {defaultMethod: "digital", methods: {digital: {}}}}}
});
vm.runInContext('Math.clamp = (n,a,b) => Math.max(a, Math.min(b,n)); Number.isNumeric = n => n !== "" && Number.isFinite(Number(n));', context);
for (const [file, name] of [["term", "RollTerm"], ["dice", "DiceTerm"], ["die", "Die"]]) {
  const source = await readFile(join(foundryRoot, "App/resources/app/client/dice/terms", file + ".mjs"), "utf8");
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, "").replace("export default class", "class") + `\nglobalThis.${name} = ${name};`, context);
}
const Die = context.Die;
const originalMap = Die.prototype.mapRandomFace;
Die.prototype.mapRandomFace = function(u) {return midiMapRandomFace.call(this, originalMap.bind(this), u);};
const root = (dice, values = {}, kind = "damage") => {
  const roll = {dice, options: {}};
  configureMidiRolls([roll], activity(values), kind);
  dice.forEach(die => {die._root = roll;});
  return roll;
};
async function evaluate(die, random) {uniforms = random; await die.evaluate(); return die;}
let die = new Die({faces: 6, number: 2});
root([die]); await evaluate(die, [.2, .75]);
equal(die.total + 4, 13, "2d6 + 4 uses final faces (6 + 3), unchanged numeric bonus");
equal(Array.from(die.results, r => r.result), [6, 3], "animation receives definitive results");
equal(JSON.stringify(die.toJSON()).includes("midiRollConfig"), false, "private configuration is absent from serialized dice");
die = new Die({faces: 6, number: 2}); die.alter(2); root([die], {damageMaxChance: 100});
await evaluate(die, [.1, .3, .6, .9]); equal(die.total, 24, "critical dice follow the same distribution");
for (const [modifier, expected] of [["kh", 20], ["kl", 15]]) {
  die = new Die({faces: 20, number: 2, modifiers: [modifier]}); root([die], {}, "attack");
  await evaluate(die, [.1, .8]); equal(die.total, expected, modifier + " is applied after generation");
}
die = new Die({faces: 6, modifiers: ["r1"]}); root([die]); await evaluate(die, [.5, .2]);
equal(die.total, 6, "rerolled die also uses configured distribution"); equal(die.results[0].rerolled, true, "native reroll history preserved");
die = new Die({faces: 6}); const original = root([die], {damageMaxChance: 100});
const cloneDie = new Die({faces: 6}); const cloned = midiClone.call(original, () => ({dice: [cloneDie], options: {}})); cloneDie._root = cloned;
await evaluate(cloneDie, [.9]); equal(cloneDie.total, 6, "Roll.reroll clone retains its own policy");
die = new Die({faces: 6}); root([die], {enabled: false}); await evaluate(die, [.9]); equal(die.total, 1, "disabled config is a normal die");
die = new Die({faces: 6}); die._root = {dice: [die]}; await evaluate(die, [.9]); equal(die.total, 1, "unrelated roll is unchanged");
die = new Die({faces: 4}); root([die], {attackMaxChance: 100}, "attack"); await evaluate(die, [.9]); equal(die.total, 1, "attack bonus d4 is not weighted");
die = new Die({faces: 6}); root([die], {damageMaxChance: 100}); uniforms = []; await die.evaluate({minimize: true}); equal(die.total, 1, "explicit minimize remains authoritative");
die = new Die({faces: 6}); root([die], {damageMaxChance: 0}); uniforms = []; await die.evaluate({maximize: true}); equal(die.total, 6, "explicit maximize remains authoritative");
const first = new Die({faces: 6}), second = new Die({faces: 6});
root([first], {damageMaxChance: 100}); root([second], {damageMaxChance: 0});
uniforms = [.99, .99]; await Promise.all([first.evaluate(), second.evaluate()]);
equal([first.total, second.total], [6, 5], "concurrent rolls cannot exchange policies");
let hooks = [], wrappers = [];
globalThis.Hooks = {on: (name, handler) => hooks.push([name, handler])};
globalThis.libWrapper = {register: (...args) => wrappers.push(args)};
globalThis.game = {modules: new Map([["khuzoe-automations", {}]])};
registerMidiRollConfig(); registerMidiRollConfig();
equal(hooks.length, 2, "hooks register once"); equal(wrappers.length, 2, "wrappers register once");
equal(game.modules.get("khuzoe-automations").api.midiRollConfig.version, 1, "sync capability advertised");
console.log(`Midi roll configuration: ${checks} checks passed (native Foundry v14 dice).`);
