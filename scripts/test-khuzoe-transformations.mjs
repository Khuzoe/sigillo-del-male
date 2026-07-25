import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  comparableFormsDocument,
  findForm,
  formHpValue,
  normalizeFormEntry,
  normalizeFormsDocument
} from "../foundry-modules/khuzoe-transformations/scripts/forms.js";
import { HP_MODES, SCHEMA_VERSION } from "../foundry-modules/khuzoe-transformations/scripts/constants.js";
import {
  revertTokenAsGM,
  transformTokenAsGM
} from "../foundry-modules/khuzoe-transformations/scripts/engine.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleRoot = path.join(root, "foundry-modules", "khuzoe-transformations");
const read = (relativePath) => fs.readFileSync(path.join(moduleRoot, relativePath), "utf8");

const normalized = normalizeFormEntry({
  id: " form-!uno ",
  name: " Forma di prova ",
  targetActorUuid: "Actor.target",
  hpMode: "invalid",
  nameMode: "invalid"
}, { now: "2026-07-25T00:00:00.000Z" });
assert.equal(normalized.id, "form-uno");
assert.equal(normalized.name, "Forma di prova");
assert.equal(normalized.hpMode, HP_MODES.FULL);
assert.equal(normalized.ownerCanUse, true);
assert.equal(normalized.playerVisible, true);

const documentValue = normalizeFormsDocument({
  revision: 4,
  entries: [
    { id: "wolf", name: "Lupo", targetActorUuid: "Actor.wolf" },
    { id: "wolf", name: "Duplicato", targetActorUuid: "Actor.other" },
    { id: "empty", name: "Senza Actor", targetActorUuid: "" }
  ]
}, { now: "2026-07-25T00:00:00.000Z" });
assert.equal(documentValue.schemaVersion, SCHEMA_VERSION);
assert.equal(documentValue.revision, 4);
assert.equal(documentValue.entries.length, 1);
assert.equal(findForm(documentValue, "wolf")?.name, "Lupo");
assert.equal(findForm(documentValue, "missing"), null);

const comparableA = comparableFormsDocument(documentValue);
const comparableB = comparableFormsDocument({
  ...documentValue,
  entries: documentValue.entries.map((entry) => ({ ...entry, updatedAt: "2099-01-01" }))
});
assert.equal(comparableA, comparableB, "I timestamp non devono creare revisioni inutili");

assert.equal(formHpValue(HP_MODES.FULL, { value: 5, max: 10 }, { value: 1, max: 40 }), 40);
assert.equal(formHpValue(HP_MODES.PERCENTAGE, { value: 5, max: 10 }, { value: 1, max: 41 }), 21);
assert.equal(formHpValue(HP_MODES.CURRENT, { value: 50, max: 80 }, { value: 1, max: 12 }), 12);
assert.equal(formHpValue(HP_MODES.CURRENT, { value: -5, max: 80 }, { value: 1, max: 12 }), 0);

const manifest = JSON.parse(read("module.json"));
assert.equal(manifest.id, "khuzoe-transformations");
assert.equal(manifest.socket, true);
assert.match(manifest.download, /khuzoe-transformations\.zip$/);

const italian = JSON.parse(read("lang/it.json"));
const english = JSON.parse(read("lang/en.json"));
assert.deepEqual(Object.keys(italian).sort(), Object.keys(english).sort(), "Le traduzioni devono avere le stesse chiavi");

const engine = read("scripts/engine.js");
const utilities = read("scripts/utils.js");
const socket = read("scripts/socket.js");
assert.doesNotMatch(engine, /sourceActor\.update\s*\(/, "L'Actor originale non deve essere aggiornato");
assert.doesNotMatch(engine, /targetActor\.update\s*\(/, "L'Actor della forma non deve essere aggiornato");
assert.match(engine, /actorLink:\s*false/, "La forma deve usare un Actor sintetico");
assert.match(engine, /original:\s*snapshot/, "Lo stato originale deve essere conservato prima della trasformazione");
assert.match(engine, /rollbackTransformation/, "Un errore durante la trasformazione deve avviare il rollback");
assert.match(engine, /game\.actors\?\.get\(tokenDocument\.actorId\)/, "L'origine deve essere l'Actor canonico del token");
assert.match(utilities, /game\.actors\?\.get\(tokenDocument\?\.actorId\)/, "L'interfaccia deve risalire all'Actor canonico");
assert.match(socket, /request\.userId !== senderUserId/, "Il GM deve validare l'identitÃƒÂ  del richiedente");

globalThis.foundry = {
  utils: {
    deepClone: (value) => structuredClone(value),
    randomID: () => "operation-id"
  }
};
globalThis.Hooks = { callAll: () => {} };

const gm = { id: "gm", isGM: true, active: true };
const sourceActor = {
  id: "source",
  uuid: "Actor.source",
  documentName: "Actor",
  name: "Origine",
  system: { attributes: { hp: { value: 20, max: 20 } } },
  prototypeToken: { width: 1, height: 1, texture: { src: "source.webp" } },
  getFlag: (moduleId, key) => moduleId === "khuzoe-transformations" && key === "forms" ? {
    schemaVersion: 1,
    revision: 1,
    entries: [{
      id: "wolf",
      name: "Forma del lupo",
      targetActorUuid: "Actor.target",
      hpMode: HP_MODES.PERCENTAGE,
      nameMode: "form",
      ownerCanUse: true,
      playerVisible: true
    }]
  } : null
};
const targetActor = {
  id: "target",
  uuid: "Actor.target",
  documentName: "Actor",
  name: "Lupo",
  system: { attributes: { hp: { value: 40, max: 40 }, ac: { value: 14 } } },
  prototypeToken: { width: 2, height: 2, texture: { src: "wolf.webp", scaleX: 1, scaleY: 1 } }
};
const worldActors = new Map([[sourceActor.id, sourceActor], [targetActor.id, targetActor]]);
const actorByUuid = new Map([[sourceActor.uuid, sourceActor], [targetActor.uuid, targetActor]]);
globalThis.fromUuidSync = (uuid) => actorByUuid.get(uuid) || null;

const scene = { id: "scene", tokens: new Map() };
const syntheticUpdates = [];
const makeSyntheticActor = (baseActor) => ({
  id: baseActor.id,
  uuid: `Scene.scene.Token.token.Actor.${baseActor.id}`,
  documentName: "Actor",
  name: baseActor.name,
  system: structuredClone(baseActor.system),
  async update(change) {
    syntheticUpdates.push(structuredClone(change));
    if (Object.hasOwn(change, "system.attributes.hp.value")) {
      this.system.attributes.hp.value = change["system.attributes.hp.value"];
    }
  }
});
const originalDelta = { system: { attributes: { hp: { value: 7, max: 20 } } }, items: [] };
const token = {
  id: "token",
  uuid: "Scene.scene.Token.token",
  documentName: "Token",
  parent: scene,
  actorId: sourceActor.id,
  actorLink: false,
  actor: makeSyntheticActor(sourceActor),
  name: "Token originale",
  width: 1,
  height: 1,
  x: 120,
  y: 240,
  elevation: 5,
  disposition: 1,
  texture: { src: "source-token.webp", scaleX: 1, scaleY: 1 },
  delta: structuredClone(originalDelta),
  flags: { "khuzoe-tokenizer": { activeVariantId: "base" } },
  getFlag(moduleId, key) {
    return this.flags?.[moduleId]?.[key];
  },
  async update(change) {
    for (const [key, value] of Object.entries(change)) {
      if (key.startsWith("flags.")) {
        const [, moduleId, flagKey] = key.split(".");
        if (!flagKey) this.flags[moduleId] = structuredClone(value);
        else {
          this.flags[moduleId] ||= {};
          this.flags[moduleId][flagKey] = structuredClone(value);
        }
        continue;
      }
      this[key] = structuredClone(value);
    }
    const baseActor = worldActors.get(this.actorId);
    this.actor = makeSyntheticActor(baseActor);
  }
};
token.actor.system.attributes.hp.value = 7;
scene.tokens.set(token.id, token);
globalThis.game = {
  user: gm,
  users: new Map([[gm.id, gm]]),
  actors: worldActors,
  scenes: new Map([[scene.id, scene]])
};

const transformed = await transformTokenAsGM(token, "wolf", gm);
assert.equal(transformed.ok, true);
assert.equal(token.actorId, targetActor.id);
assert.equal(token.actorLink, false);
assert.equal(token.name, "Forma del lupo");
assert.equal(token.texture.src, "wolf.webp");
assert.equal(token.width, 2);
assert.equal(token.height, 2);
assert.equal(token.x, 120, "La posizione non deve cambiare");
assert.equal(token.y, 240, "La posizione non deve cambiare");
assert.equal(token.elevation, 5, "L'elevazione non deve cambiare");
assert.equal(token.actor.system.attributes.hp.value, 14, "I PF percentuali devono vivere sulla copia sintetica");
assert.equal(sourceActor.system.attributes.hp.value, 20, "L'Actor originale non deve perdere PF");
assert.equal(targetActor.system.attributes.hp.value, 40, "L'Actor della forma non deve perdere PF");
assert.equal(token.flags["khuzoe-transformations"].runtime.original.actorId, sourceActor.id);

const reverted = await revertTokenAsGM(token, gm);
assert.equal(reverted.ok, true);
assert.equal(token.actorId, sourceActor.id);
assert.equal(token.actorLink, false);
assert.equal(token.name, "Token originale");
assert.equal(token.texture.src, "source-token.webp");
assert.deepEqual(token.delta, originalDelta);
assert.deepEqual(token.flags["khuzoe-tokenizer"], { activeVariantId: "base" });
assert.equal(token.flags["khuzoe-transformations"].runtime, null);
assert.equal(syntheticUpdates.length, 1, "Solo l'Actor sintetico trasformato deve ricevere l'aggiornamento PF");

console.log("Khuzoe Transformations: test di schema, trasformazione e sicurezza superati.");
