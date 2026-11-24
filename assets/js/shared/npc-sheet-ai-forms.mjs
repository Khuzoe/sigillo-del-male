import {NPC_AI_ACTIVITY_TYPES,NPC_ABILITY_KEYS} from './npc-ai-values.mjs?v=20261124-bonuses';

export const NPC_SHEET_ITEM_TYPES = Object.freeze(['feat','spell','weapon','equipment','consumable','tool','loot','container']);
export const NPC_SHEET_ACTIVITY_ITEMS = Object.freeze(['feat','spell','weapon','equipment','consumable','tool']);
const text = {type:'string'};
const choice = values => ({type:'string',enum:values});
const distance = {type:['number','null'],minimum:0};
const activity = {type:'string',pattern:'^[A-Za-z0-9_-]+$'};
const dice = {
  number:{type:'integer',minimum:1},denomination:{type:'integer',enum:[4,6,8,10,12,20]},
  bonus:text,damageType:choice(['acid','bludgeoning','cold','fire','force','lightning','necrotic','piercing','poison','psychic','radiant','slashing','thunder'])
};
const damagePart = v => ({entries:[
  {key:'number',value:v.number},{key:'denomination',value:v.denomination},
  {key:'bonus',value:v.bonus},{key:'types',value:[v.damageType]}
]});
const set = (path,value) => ({path,op:'set',value});
const object = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});

// Each form sets only the named fields. Context, structured output and the
// compiler all use this catalog. Native IDs, flags and derived data stay out.
const forms = {
  abilityBonus: {
    target:'Actor', fields:{ability:choice(NPC_ABILITY_KEYS),roll:choice(['check','save']),formula:text},
    changes:v=>[set(`system.abilities.${v.ability}.bonuses.${v.roll}`,v.formula)]
  },
  weaponDistance: {
    target:'weapon', fields:{field:choice(['value','long','reach']),distance},
    changes:v=>[set('system.range.'+v.field,v.distance)]
  },
  spellPreparation: {
    target:'spell', fields:{prepared:{type:'integer',enum:[0,1,2]}},
    changes:v=>[set('system.prepared',v.prepared)]
  },
  spellMethod: {
    target:'spell', fields:{method:choice(['atwill','innate','ritual','pact','spell'])},
    changes:v=>[set('system.method',v.method)]
  },
  activityType: {
    target:'activity', fields:{activity,type:choice(NPC_AI_ACTIVITY_TYPES)},
    changes:v=>[set(`system.activities.${v.activity}.type`,v.type)]
  },
  activityRange: {
    target:'activity', fields:{activity,units:choice(['ft','mi','m','km']),formula:text},
    changes:v=>[set(`system.activities.${v.activity}.range.units`,v.units),set(`system.activities.${v.activity}.range.value`,v.formula)]
  },
  activityRangeMode: {
    target:'activity', fields:{activity,mode:choice(['self','touch','spec','any'])},
    changes:v=>[set(`system.activities.${v.activity}.range.units`,v.mode),set(`system.activities.${v.activity}.range.value`,'')]
  },
  newActivityDamage: {
    target:'activity',createOnly:true,fields:{activity,...dice},
    changes:v=>[set(`system.activities.${v.activity}.damage.parts`,[damagePart(v)])]
  },
  newWeaponDamage: {
    target:'weapon',createOnly:true,fields:dice,
    changes:v=>[set('system.damage.base',damagePart(v))]
  },
  newActivitySave: {
    target:'activity',createOnly:true,fields:{activity,ability:choice(NPC_ABILITY_KEYS),dc:{type:'integer',minimum:0}},
    changes:v=>[set(`system.activities.${v.activity}.save.ability`,[v.ability]),set(`system.activities.${v.activity}.save.dc.calculation`,''),
      set(`system.activities.${v.activity}.save.dc.formula`,String(v.dc))]
  }
};

export const NPC_SHEET_FORM_TARGETS=Object.fromEntries(Object.entries(forms).map(([name,form])=>[name,
  form.createOnly?'create:'+form.target:form.target]));

export function npcSheetChangeSchema(nativeChange) {
  return {anyOf:[...Object.entries(forms).map(([name,form])=>object({[name]:object(form.fields)})),nativeChange]};
}

function validValue(value,rule) {
  if (rule.enum) return rule.enum.includes(value);
  if (rule.type === 'string') return typeof value === 'string' && (!rule.pattern || new RegExp(rule.pattern).test(value));
  if (rule.type === 'integer') return Number.isSafeInteger(value) && value >= rule.minimum;
  return (value === null && rule.type.includes('null')) || Number.isFinite(value) && value >= rule.minimum;
}

export function npcSheetFormChanges(operation,itemType) {
  if (!Array.isArray(operation.changes) || operation.changes.length > 512) throw new Error('Elenco di modifiche non valido.');
  return operation.changes.flatMap(change=>{
    if (!change || typeof change !== 'object' || Array.isArray(change)) throw new Error('Campo della proposta non valido.');
    const keys=Object.keys(change);
    const name=keys.find(key=>Object.hasOwn(forms,key));
    if (!name) {
      if (typeof change.path !== 'string') throw new Error('Campo guidato della proposta sconosciuto.');
      return [change]; // Native fields, including previously archived proposals.
    }
    const {target,createOnly,fields,changes}=forms[name],input=change[name];
    const supported=operation.targetType==='Actor' ? target==='Actor'
      : operation.targetType==='Item' && (target===itemType || target==='activity' && NPC_SHEET_ACTIVITY_ITEMS.includes(itemType));
    if (!supported) throw new Error(`Il campo guidato ${name} non è disponibile su ${itemType||operation.targetType}.`);
    if (createOnly && operation.operation!=='create') throw new Error(`Usa ${name} solo per un nuovo oggetto.`);
    if (keys.length!==1 || !input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length!==Object.keys(fields).length) throw new Error(`Modulo ${name} incompleto o con campi inattesi.`);
    for (const [key,rule] of Object.entries(fields)) {
      if (!Object.hasOwn(input,key) || !validValue(input[key],rule)) throw new Error(`Valore non valido per ${name}.${key}.`);
    }
    return changes(input);
  });
}
