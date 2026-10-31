// Shared, deliberately small language: AI output is data, never executable macros.
export const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
export const CONDITIONS = ["blinded", "charmed", "deafened", "frightened", "incapacitated", "invisible", "paralyzed", "poisoned", "prone", "restrained", "stunned", "unconscious"];
export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const str = {type: "string"}, num = {type: "integer"};
const choice = values => ({type: "string", enum: values});
const obj = properties => ({type: "object", properties, required: Object.keys(properties), additionalProperties: false});
const damage = obj({formula: str, type: choice(DAMAGE_TYPES)});
export const ABILITY_SCHEMA = obj({
  name: str, flavor: str, mode: choice(["attack", "save", "damage", "utility"]),
  activation: choice(["action", "bonus", "reaction"]), range: num, units: choice(["ft", "m"]),
  attackKind: choice(["melee", "ranged"]), attackBonus: num, damage,
  save: obj({enabled: {type: "boolean"}, ability: choice(ABILITIES), dc: num, onSave: choice(["none", "half", "full"])}),
  extraDamage: damage,
  healing: obj({fraction: {type: "number", enum: [0, 0.5, 1]}, source: choice(["damage", "extra"])}),
  conditions: {type: "array", items: choice(CONDITIONS)}, rounds: num,
  uses: num, recovery: choice(["day", "lr", "sr"]),
  balance: str, assumptions: {type: "array", items: str}, unsupported: {type: "array", items: str}, iconPrompt: str
});

function validate(value, schema, path = "abilità") {
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !Object.hasOwn(schema.properties, k))) throw new Error(`Campi non validi: ${path}.`);
    for (const key of schema.required) validate(value[key], schema.properties[key], `${path}.${key}`);
  } else if (schema.type === "array") {
    if (!Array.isArray(value) || value.length > 12) throw new Error(`Elenco non valido: ${path}.`);
    value.forEach(v => validate(v, schema.items, path));
  } else if (schema.type === "integer" ? !Number.isInteger(value) : schema.type === "number" ? !Number.isFinite(value) : typeof value !== schema.type) throw new Error(`Valore non valido: ${path}.`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`Scelta non valida: ${path}.`);
  if (typeof value === "string" && (value.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))) throw new Error(`Testo troppo lungo o non valido: ${path}.`);
}
export function validateAbility(input) {
  validate(input, ABILITY_SCHEMA);
  const d = structuredClone(input);
  if (!d.name.trim() || d.name.length > 120) throw new Error("Inserisci un nome entro 120 caratteri.");
  // Structured output requires every field, even for mechanics that are absent.
  // Placeholder values (e.g. DC 0 without a save) must not reject a valid attack.
  // Preserve the values: enabling a mechanic later must validate it explicitly.
  for (const [active, value, min, max, label] of [
    [true, d.range, 0, 600, "Portata"],
    [d.mode === "attack", d.attackBonus, -10, 40, "Bonus attacco"],
    [d.save.enabled, d.save.dc, 1, 40, "CD"],
    [d.conditions.length > 0, d.rounds, 1, 100, "Durata"],
    [true, d.uses, 0, 20, "Utilizzi"]
  ]) {
    if (active && (value < min || value > max)) throw new Error(`${label}: valore fuori intervallo.`);
  }
  for (const part of [d.damage, d.extraDamage]) {
    part.formula = part.formula.replace(/\s/g, "").toLowerCase();
    if (part.formula && !/^(?:[1-9]|[1-3][0-9]|40)d(?:4|6|8|10|12|20)(?:[+-](?:[0-9]|[1-9][0-9]))?$|^(?:[1-9]|[1-9][0-9])$/.test(part.formula)) throw new Error("Usa danni semplici, ad esempio 2d8+4 (massimo 40 dadi e bonus 99).");
  }
  if (d.mode === "utility" && (d.damage.formula || d.extraDamage.formula || d.healing.fraction || d.save.enabled)) throw new Error("Un'attività senza tiro non può infliggere danni o curare dai danni.");
  if (d.mode !== "utility" && !d.damage.formula) throw new Error("Inserisci i danni principali.");
  if (d.mode === "save" && !d.save.enabled) throw new Error("Attiva il tiro salvezza.");
  if (["damage", "utility"].includes(d.mode) && d.save.enabled) throw new Error("Scegli il tipo Tiro salvezza per usare una CD.");
  if (Boolean(d.extraDamage.formula) !== (d.mode === "attack" && d.save.enabled)) throw new Error("Il TS dopo un attacco richiede danni aggiuntivi; i danni aggiuntivi richiedono un attacco con TS.");
  if (d.healing.fraction && d.healing.source === "extra" && !d.extraDamage.formula) throw new Error("La cura dai danni aggiuntivi richiede quei danni.");
  return d;
}
const escape = text => String(text).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
export const LABELS = {attack: "Attacco", save: "Tiro salvezza", damage: "Danni", utility: "Senza tiro", action: "Azione", bonus: "Azione bonus", reaction: "Reazione", str: "Forza", dex: "Destrezza", con: "Costituzione", int: "Intelligenza", wis: "Saggezza", cha: "Carisma", acid: "acido", bludgeoning: "contundenti", cold: "freddo", fire: "fuoco", force: "forza", lightning: "fulmine", necrotic: "necrotici", piercing: "perforanti", poison: "veleno", psychic: "psichici", radiant: "radianti", slashing: "taglienti", thunder: "tuono", blinded: "Accecato", charmed: "Affascinato", deafened: "Assordato", frightened: "Spaventato", incapacitated: "Incapacitato", invisible: "Invisibile", paralyzed: "Paralizzato", poisoned: "Avvelenato", prone: "Prono", restrained: "Trattenuto", stunned: "Stordito", unconscious: "Privo di sensi"};
export function abilitySummary(d) {
  const lines = [`${LABELS[d.activation]} · un bersaglio · ${d.range} ${d.units === "ft" ? "piedi" : "metri"}.`];
  if (d.mode === "attack") lines.push(`Attacco ${d.attackKind === "melee" ? "in mischia" : "a distanza"}: ${d.attackBonus >= 0 ? "+" : ""}${d.attackBonus} per colpire. Se colpisce: ${d.damage.formula} danni ${LABELS[d.damage.type]}.`);
  else if (d.mode === "damage") lines.push(`${d.damage.formula} danni ${LABELS[d.damage.type]}.`);
  if (d.save.enabled) {
    const part = d.mode === "attack" ? d.extraDamage : d.damage;
    lines.push(`${d.mode === "attack" ? "Dopo un colpo riuscito: " : ""}TS ${LABELS[d.save.ability]} CD ${d.save.dc}. Fallimento: ${part.formula} danni ${LABELS[part.type]}. Successo: ${d.save.onSave === "none" ? "nessun danno" : d.save.onSave === "half" ? "metà dei danni" : "danni completi"}.`);
  }
  if (d.conditions.length) lines.push(`${d.save.enabled ? "Con TS fallito" : d.mode === "attack" ? "Se colpisce" : "Sul bersaglio"}: ${d.conditions.map(c => LABELS[c]).join(", ")} per ${d.rounds} round, fino alla fine del turno.`);
  if (d.healing.fraction) lines.push(`L'utilizzatore recupera PF pari al ${d.healing.fraction * 100}% dei ${d.healing.source === "extra" ? "soli danni aggiuntivi" : "danni principali"} inflitti dopo resistenze, immunità e riduzioni (entro i PF massimi).`);
  if (d.uses) lines.push(`${d.uses} utilizzi ${d.recovery === "day" ? "al giorno" : d.recovery === "lr" ? "per riposo lungo" : "per riposo breve"}.`);
  return lines;
}

export function compileAbility(input, transferId, img = "") {
  const d = validateAbility(input);
  if (d.unsupported.length) throw new Error("La proposta contiene meccaniche non automatizzate: chiedi una revisione prima di aggiungerla.");
  const primaryId = "KhzAiPrimary0001", extraId = "KhzAiFollowup001";
  const part = value => ({number: null, denomination: 0, bonus: "", types: [value.type], custom: {enabled: true, formula: value.formula}, scaling: {mode: "", number: null, formula: ""}});
  const base = (id, type, name, secondary = false) => ({
    _id: id, type, name, sort: secondary ? 1 : 0,
    activation: {type: secondary ? "" : d.activation, value: secondary ? null : 1, override: true},
    range: {value: String(d.range), units: d.units, override: true},
    target: {affects: {count: "1", type: "creature", choice: false, special: ""}, template: {count: "", contiguous: false, type: "", size: "", width: "", height: "", units: d.units}, prompt: !secondary, override: true},
    consumption: {targets: !secondary && d.uses ? [{type: "itemUses", target: "", value: "1", scaling: {mode: "", formula: ""}}] : [], scaling: {allowed: false}, spellSlot: false},
    effects: [], midiProperties: {automationOnly: secondary}
  });
  const primary = base(primaryId, d.mode, d.name);
  if (d.damage.formula) primary.damage = {includeBase: false, parts: [part(d.damage)], onSave: d.save.onSave, critical: {allow: d.mode === "attack", bonus: ""}};
  if (d.mode === "attack") primary.attack = {ability: "", bonus: String(d.attackBonus), flat: true, type: {value: d.attackKind, classification: "weapon"}, critical: {threshold: null}};
  const save = {ability: [d.save.ability], dc: {calculation: "", formula: String(d.save.dc)}};
  if (d.mode === "save") primary.save = save;
  const activities = {[primaryId]: primary};
  if (d.extraDamage.formula) {
    activities[extraId] = {...base(extraId, "save", `${d.name} · effetto aggiuntivo`, true), save,
      damage: {includeBase: false, parts: [part(d.extraDamage)], onSave: d.save.onSave, critical: {allow: false, bonus: ""}}};
    Object.assign(primary.midiProperties, {triggeredActivityId: extraId, triggeredActivityTargets: "hitTargets", triggeredActivityRollAs: "self", triggeredActivityConsume: false, triggeredActivityConfigure: false});
  }
  const rules = {version: 1, activities: {}};
  const addRule = id => rules.activities[id] ??= {healing: 0, conditions: [], rounds: d.conditions.length ? d.rounds : 1, expiry: "turnEnd"};
  if (d.conditions.length) addRule(d.extraDamage.formula ? extraId : primaryId).conditions = d.conditions;
  if (d.healing.fraction) addRule(d.healing.source === "extra" ? extraId : primaryId).healing = d.healing.fraction;
  return {name: d.name.trim(), type: "feat", img, transferId, effects: [],
    system: {type: {value: "monster", subtype: ""}, description: {value: [d.flavor, ...abilitySummary(d)].filter(Boolean).map(line => `<p>${escape(line)}</p>`).join("")},
      uses: {spent: 0, max: d.uses ? String(d.uses) : "", recovery: d.uses ? [{period: d.recovery, type: "recoverAll"}] : []}, activities},
    flags: {"khuzoe-automations": {npcRules: rules}}
  };
}
