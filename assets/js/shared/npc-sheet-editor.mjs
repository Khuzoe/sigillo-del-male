import { nativeGet, nativeSet, nativeHas, nativeEqual, nativeDiff, nativeEditablePath, nativeNewId, nativeActivityTemplate } from "./npc-native-model.mjs";

const clone=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const labels={name:"Nome",system:"Regole di gioco",flags:"Automazioni e moduli",attributes:"Statistiche",abilities:"Caratteristiche",skills:"Competenze",traits:"Tratti e difese",details:"Identità e biografia",currency:"Monete",bonuses:"Bonus",spells:"Slot incantesimo",resources:"Risorse",description:"Descrizione",value:"Valore",max:"Massimo",temp:"Temporanei",tempmax:"Bonus ai PF massimi",formula:"Formula",hp:"Punti ferita",ac:"Classe armatura",init:"Iniziativa",movement:"Movimento",senses:"Sensi",spellcasting:"Caratteristica da incantatore",cr:"Grado sfida",alignment:"Allineamento",race:"Razza",type:"Tipo",size:"Taglia",languages:"Linguaggi",dr:"Resistenze",di:"Immunità ai danni",dv:"Vulnerabilità",ci:"Immunità alle condizioni",custom:"Personalizzato",bypasses:"Eccezioni",walk:"Camminare",fly:"Volare",swim:"Nuotare",climb:"Scalare",burrow:"Scavare",units:"Unità",hover:"Fluttuare",str:"Forza",dex:"Destrezza",con:"Costituzione",int:"Intelligenza",wis:"Saggezza",cha:"Carisma",proficient:"Competenza nei TS",check:"Prove",save:"Tiro salvezza",roll:"Tiro",bonus:"Bonus",passive:"Passiva",ability:"Caratteristica",flat:"Valore fisso",calc:"Calcolo",duration:"Durata",disabled:"Disattivato",transfer:"Trasferisci al portatore",origin:"Origine",statuses:"Condizioni",changes:"Modifiche",key:"Campo modificato",mode:"Operazione",priority:"Priorità",number:"Numero di dadi",denomination:"Dado",types:"Tipi di danno",damage:"Danni",healing:"Cura",scaling:"Incremento",activation:"Attivazione",range:"Distanza",target:"Bersagli e area",affects:"Bersagli",template:"Area",count:"Numero",width:"Larghezza",height:"Altezza",reach:"Portata",long:"Distanza massima",override:"Impostazione specifica",prompt:"Chiedi conferma",concentration:"Concentrazione",consumption:"Consumo di risorse",uses:"Utilizzi",spent:"Spesi",recovery:"Recupero",period:"Quando recupera",recharge:"Ricarica",equipped:"Equipaggiato",attuned:"Sintonizzato",attunement:"Sintonia",quantity:"Quantità",weight:"Peso",price:"Prezzo",rarity:"Rarità",level:"Livello",school:"Scuola",method:"Metodo di lancio",prepared:"Preparato",properties:"Proprietà",materials:"Componenti materiali",requirements:"Requisiti",identifier:"Identificativo",activities:"Attività",attack:"Attacco",critical:"Critico",includeBase:"Includi danno dell’arma",onSave:"Se il TS riesce",dc:"CD",calculation:"Calcolo",classification:"Categoria",parts:"Componenti",enabled:"Attivo",chat:"Testo in chat",chatFlavor:"Testo in chat",seconds:"Secondi",rounds:"Round",turns:"Turni",expiry:"Scadenza",expired:"Scaduto",startTime:"Inizio",time:"Tempo",gp:"Oro",sp:"Argento",cp:"Rame",ep:"Electrum",pp:"Platino",biography:"Biografia",acr:"Acrobazia",ani:"Addestrare animali",arc:"Arcano",ath:"Atletica",dec:"Inganno",his:"Storia",ins:"Intuizione",itm:"Intimidire",inv:"Indagare",med:"Medicina",nat:"Natura",prc:"Percezione",prf:"Intrattenere",per:"Persuasione",rel:"Religione",slt:"Rapidità di mano",ste:"Furtività",sur:"Sopravvivenza",loyalty:"Lealtà",exhaustion:"Indebolimento",tint:"Colore",showIcon:"Mostra icona",special:"Dettagli",attackMaxChance:"Probabilità massimo all’attacco (%)",damageMaxChance:"Probabilità massimo ai danni (%)"};
const activityNames={attack:"Attacco",save:"Tiro salvezza",damage:"Danni",heal:"Cura",utility:"Utilità",check:"Prova",cast:"Lancio",summon:"Evocazione",enchant:"Incantamento",forward:"Attività collegata"};
const damageNames={acid:"Acido",bludgeoning:"Contundenti",cold:"Freddo",fire:"Fuoco",force:"Forza",lightning:"Fulmine",necrotic:"Necrotici",piercing:"Perforanti",poison:"Veleno",psychic:"Psichici",radiant:"Radiosi",slashing:"Taglienti",thunder:"Tuono",healing:"Cura",temphp:"PF temporanei"};
const conditions={blinded:"Accecato",charmed:"Affascinato",deafened:"Assordato",frightened:"Spaventato",grappled:"Afferrato",incapacitated:"Incapacitato",invisible:"Invisibile",paralyzed:"Paralizzato",petrified:"Pietrificato",poisoned:"Avvelenato",prone:"Prono",restrained:"Trattenuto",stunned:"Stordito",unconscious:"Privo di sensi",exhaustion:"Indebolimento"};
const units={"":"Nessuna",inst:"Istantanea",turn:"Turni",round:"Round",second:"Secondi",seconds:"Secondi",minute:"Minuti",hour:"Ore",day:"Giorni",perm:"Permanente",spec:"Speciale",ft:"Piedi",m:"Metri",mi:"Miglia",km:"Chilometri",self:"Sé stesso",touch:"Contatto",any:"Qualsiasi"};
labels.phase="Fase";
const title=key=>labels[key]||key.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/[_-]/g," ").replace(/^./,c=>c.toUpperCase());
const optionsMap=(path,entity)=>{
 if(entity.type==="ActiveEffect"&&path==="duration.units")return{seconds:"Secondi",minutes:"Minuti",hours:"Ore",days:"Giorni",months:"Mesi",years:"Anni",rounds:"Round",turns:"Turni"};
 if(entity.type==="ActiveEffect"&&/^system\.changes\.\d+\.type$/.test(path))return{add:"Aggiungi",subtract:"Sottrai",multiply:"Moltiplica",downgrade:"Riduci al massimo",upgrade:"Alza al minimo",override:"Sostituisci",custom:"Personalizzata"};
 if(entity.type==="ActiveEffect"&&path==="duration.expiry")return{turnStart:"Inizio del turno",turnEnd:"Fine del turno",roundStart:"Inizio del round",roundEnd:"Fine del round",combatStart:"Inizio del combattimento",combatEnd:"Fine del combattimento"};
 if(/\.traits\.size$/.test(path))return{tiny:"Minuscola",sm:"Piccola",med:"Media",lg:"Grande",huge:"Enorme",grg:"Mastodontica"};
 if(/\.ac\.calc$/.test(path))return{flat:"Fissa",natural:"Armatura naturale",default:"Da equipaggiamento",custom:"Formula personalizzata",unarmoredMonk:"Difesa del monaco",unarmoredBarb:"Difesa del barbaro"};
 if(/\.method$/.test(path))return{prepared:"Preparato",innate:"Innato",atwill:"A volontà",pact:"Patto",ritual:"Rituale",spell:"Incantesimo"};
 if(/\.school$/.test(path))return{abj:"Abiurazione",con:"Evocazione",div:"Divinazione",enc:"Ammaliamento",evo:"Invocazione",ill:"Illusione",nec:"Necromanzia",trs:"Trasmutazione"};
 if(/\.activation\.type$/.test(path))return{"":"Nessuna",action:"Azione",bonus:"Azione bonus",reaction:"Reazione",legendary:"Azione leggendaria",lair:"Azione di tana",special:"Speciale",minute:"Minuto",hour:"Ora"};
 if(/\.target\.affects\.type$/.test(path))return{creature:"Creature",ally:"Alleati",enemy:"Nemici",self:"Sé stesso"};
 if(/\.target\.template\.type$/.test(path))return{"":"Nessuna area",cone:"Cono",cube:"Cubo",cylinder:"Cilindro",line:"Linea",radius:"Raggio",sphere:"Sfera"};
 if(/\.ability$|\.spellcasting$/.test(path))return{"":"Automatica",str:"Forza",dex:"Destrezza",con:"Costituzione",int:"Intelligenza",wis:"Saggezza",cha:"Carisma"};
 if(/\.units$/.test(path))return units;
 if(/\.onSave$/.test(path))return{none:"Nessun danno",half:"Metà danno",full:"Danno pieno"};
 if(/\.mode$/.test(path)&&path.includes("changes"))return{0:"Personalizzata",1:"Moltiplica",2:"Aggiungi",3:"Riduci al massimo",4:"Alza al minimo",5:"Sostituisci"};
 if(/\.skills\.[^.]+\.value$/.test(path))return{0:"Nessuna",0.5:"Metà competenza",1:"Competente",2:"Maestria"};
 if(/\.proficient$/.test(path))return{0:"No",1:"Sì"};
 if(/\.attack\.type\.value$/.test(path))return{melee:"Mischia",ranged:"Distanza"};
 if(/\.classification$/.test(path))return{"":"Automatica",weapon:"Arma",spell:"Incantesimo",unarmed:"Senz’armi"};
 if(/\.dc\.calculation$/.test(path))return{"":"Fissa (formula)",spellcasting:"Da incantatore",str:"Forza",dex:"Destrezza",con:"Costituzione",int:"Intelligenza",wis:"Saggezza",cha:"Carisma"};
 return null;
};

export function mountNpcSheetEditor({root,source,panes,onDirty,onCommands,post,getSource,savePage,descriptionHtml,descriptionValue,resolveMedia,deleteEntity,iconEditor,draftMode=false,creationMode=draftMode,onDraftChange,onEditWithAi,initialTarget,textOnly=false}) {
 const entities=source.entities.map(entity=>({...entity,base:clone(entity.data),draft:clone(entity.initialDraft||entity.data),queued:false}));
 const slots=[],bindings=new Map(),state={busy:false,requestId:null,readOnly:false},permissions=source.permissions;
 const changed=entity=>!nativeEqual(entity.base,entity.draft);
 const belongs=(entity,categories)=>categories.includes(entity.category)||(entity.itemType==="weapon"&&categories.includes("inventory"));
 const editable=(entity,path)=>nativeEditablePath(entity.type,path,{...permissions,activityReadOnly:entity.activityReadOnly});
 const invalidControl=()=>slots.map(slot=>slot.shell.querySelector(':invalid:not(:disabled)')).find(Boolean);
 const dirty=()=>entities.some(changed)||Boolean(invalidControl());
 const update=()=>{state.requestId=null;onDirty?.(dirty());for(const slot of slots)updateStatus(slot);if(draftMode)onDraftChange?.();};
 const findPending=entity=>source.commands?.find(command=>command.status==="pending" && (command.nativeSheetVersion|| (command.nativeEditorVersion?command.target?.id===entity.target.id&&command.target?.itemId===entity.target.itemId:entity.type==="Actor"?command.kind==="actor.update":entity.type==="Item"?command.target?.itemId===entity.target.id:command.target?.effectId===entity.target.id)));
 const locked=entity=>entity.readOnly||state.readOnly||entity.queued||Boolean(findPending(entity));
 const make=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
 const button=(text,action,cls="")=>{const b=make("button",`npc-sheet-button ${cls}`,text);b.type="button";b.addEventListener("click",action);return b;};
 const set=(entity,path,value,remove=false)=>{nativeSet(entity.draft,path,value,remove);if(creationMode&&path==="system.uses.max")for(const activity of Object.values(entity.draft.system.activities||{}))activity.consumption.targets=value&&activity.activation.type?[{type:"itemUses",target:"",value:"1",scaling:{mode:""}}]:[];for(const input of bindings.get(`${entity.key}:${path}`)||[]){if(!input.isConnected)continue;if(input.type==="checkbox")input.checked=Boolean(value);else if(document.activeElement!==input)input.value=value===null&&input.tagName==="SELECT"?"__null":value??"";}if(path.endsWith('.custom.enabled'))for(const slot of slots)for(const node of slot.detail.querySelectorAll('[data-npc-custom-for]'))if(node.dataset.npcCustomFor===path)node.hidden=!value;update();};
 function field(entity,path,label=title(path.split(".").at(-1)),value=nativeGet(entity.draft,path)) {
  const wrapper=make("label","npc-sheet-field"),caption=make("span","",label);wrapper.append(caption);
  const id=`npc-field-${nativeNewId()}`;caption.id=id;
  let map=optionsMap(path,entity);let input;
  if(creationMode&&/\.attack\.type\.classification$/.test(path))map={weapon:"Arma",spell:"Incantesimo",unarmed:"Senz’armi"};
  if(creationMode&&/\.activation\.type$/.test(path)){map={...map};delete map.minute;delete map.hour;}
  if(creationMode&&/\.range\.units$/.test(path))map={ft:"Piedi",m:"Metri",self:"Sé stesso",touch:"Contatto"};
  if(creationMode&&/\.target\.template\.units$/.test(path))map={ft:"Piedi",m:"Metri"};
  if(map && (typeof value!=="object"||value===null)) {
   input=make("select");const choices={...map};if(value!==null&&!Object.hasOwn(choices,String(value)))choices[value]=String(value);
   if(value===null)choices["__null"]= "Automatica";
   for(const [key,text]of Object.entries(choices)){const option=make("option","",text);option.value=key;input.append(option);}input.value=value===null?"__null":String(value??"");
   input.addEventListener("change",()=>set(entity,path,input.value==="__null"?null:typeof value==="number"?Number(input.value):input.value));
  } else if(typeof value==="boolean") {
   wrapper.classList.add("is-switch");input=make("input");input.type="checkbox";input.checked=value;input.addEventListener("change",()=>set(entity,path,input.checked));
  } else {
   const isLong=typeof value==="string"&&(/description|biography|macroData\.command/.test(path)||value.length>140);
   const numeric=typeof value==="number"||(value===null&&/\.(number|denomination|rounds|turns|seconds|quantity|level|prepared|flat|cr)$|\.hp\.(value|max|temp|tempmax|dt)$|\.duration\.value$/.test(path));
   input=make(isLong?"textarea":"input");if(input.tagName==="INPUT")input.type=numeric?"number":"text";
   if(input.type==="number")input.step="any";if(isLong)input.rows=4;
   input.value=value??"";if(value===null)input.placeholder="Automatico";
   input.addEventListener("input",()=>{
    if(input.type==="number" && !input.validity.valid)return;
    const next=numeric?(input.value===""?null:Number(input.value)):value===null?(input.value===""?null:input.value):input.value;
    set(entity,path,next);
   });
  }
  input.setAttribute("aria-labelledby",id);input.dataset.npcField=path;
  if(/\.changes\.\d+\.key$/.test(path)) {
   const suggestions=make("datalist");suggestions.id=id+"-options";
   for(const [value,label]of [["system.attributes.ac.bonus","Bonus alla CA"],["system.attributes.movement.walk","Velocità di movimento"],["system.bonuses.mwak.attack","Bonus agli attacchi in mischia"],["system.bonuses.mwak.damage","Bonus ai danni in mischia"],["system.bonuses.spell.dc","Bonus alla CD degli incantesimi"],["system.attributes.hp.tempmax","Bonus ai PF massimi"]]){const option=make("option","",label);option.value=value;suggestions.append(option);}input.setAttribute("list",suggestions.id);wrapper.append(suggestions);
  }
  const bindingKey=`${entity.key}:${path}`;if(!bindings.has(bindingKey))bindings.set(bindingKey,new Set());bindings.get(bindingKey).add(input);
  input.disabled=!editable(entity,path)||locked(entity);
  if(input.disabled && /system\.attributes\.hp\.(value|temp)$/.test(path))wrapper.append(make("small","","Gestiti sui singoli token"));
  wrapper.append(input);return wrapper;
 }
 function group(label,open=false) {const node=make("details","npc-sheet-group");node.open=open;node.append(make("summary","",label));const body=make("div","npc-sheet-group-body");node.append(body);return{node,body};}
 function tree(entity,path,label,depth=0,forceOpen) {
  const value=nativeGet(entity.draft,path);
  if(value===null||typeof value!=="object")return field(entity,path,label,value);
  if(!Array.isArray(value)&&Object.keys(value).some(key=>key.includes('.'))) {
   const section=group(label),area=make('textarea');area.rows=8;area.value=JSON.stringify(value,null,2);area.setAttribute('aria-label',label+' · mappa avanzata');area.disabled=locked(entity)||!editable(entity,path);
   section.body.append(make('p','npc-sheet-muted','Questo gruppo usa chiavi speciali del modulo. Mantieni i nomi esistenti.'),area);
   area.addEventListener('input',()=>{try{const next=JSON.parse(area.value);if(!next||typeof next!=='object'||Array.isArray(next))throw new Error();area.setCustomValidity('');set(entity,path,next);}catch{area.setCustomValidity('Inserisci una mappa JSON valida.');onDirty?.(true);for(const slot of slots)updateStatus(slot);}});return section.node;
  }
  const section=group(`${label}${Array.isArray(value)?` · ${value.length}`:""}`,forceOpen??depth===0),body=section.body;body.classList.toggle("is-array",Array.isArray(value));
   const keys=Object.keys(value).filter(key=>!["_id","_stats"].includes(key)&&!(creationMode&&key==="override"));
  if(!keys.length)body.append(make("p","npc-sheet-muted","Nessun elemento"));
  keys.forEach(key=>{
   const childPath=`${path}.${key}`;if(["system.source","system.advancement","system.sourceItem"].includes(childPath))return;
   const child=tree(entity,childPath,Array.isArray(value)?`Voce ${Number(key)+1}`:title(key),depth+1);
   if(child) {
    if(Array.isArray(value)) {
     const row=make("div","npc-sheet-array-row");row.append(child);
     const remove=button("Rimuovi",()=>{const next=clone(nativeGet(entity.draft,path));next.splice(Number(key),1);set(entity,path,next);replace();},"is-subtle");remove.disabled=locked(entity)||!editable(entity,path);row.append(remove);body.append(row);
    } else body.append(child);
   }
  });
   if(editable(entity,path) && !locked(entity) && !creationMode) {
   const add=button(Array.isArray(value)?"+ Aggiungi voce":"+ Aggiungi campo",()=>{
    const form=make("div","npc-sheet-add-field");let keyInput;
    if(!Array.isArray(value)){keyInput=make("input");keyInput.placeholder="Nome del campo";keyInput.setAttribute("aria-label","Nome del campo");form.append(keyInput);}
    const type=make("select");type.setAttribute("aria-label","Tipo di valore");for(const [key,text] of Object.entries({text:"Testo",number:"Numero",boolean:"Sì / No",object:"Gruppo",array:"Elenco",null:"Automatico"})){const option=make("option","",text);option.value=key;type.append(option);}form.append(type);
    form.append(button("Aggiungi",()=>{
     const initial={text:"",number:0,boolean:false,object:{},array:[],null:null}[type.value];
     if(Array.isArray(value)){const next=clone(nativeGet(entity.draft,path));const template=path.endsWith(".changes")?{key:"system.attributes.ac.bonus",type:"add",value:"1",phase:"initial",priority:20}:path.endsWith(".recovery")?{period:"lr",type:"recoverAll"}:undefined;next.push(next.length?clone(next.at(-1)):template??initial);set(entity,path,next);}
     else {const key=keyInput.value.trim();if(!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)||Object.hasOwn(value,key)){keyInput.setCustomValidity("Scegli un nome nuovo senza spazi o punti.");keyInput.reportValidity();return;}try{const nextPath=`${path}.${key}`;if(!nativeEditablePath(entity.type,nextPath,permissions))throw new Error();set(entity,nextPath,initial);}catch{keyInput.setCustomValidity("Questo campo è riservato.");keyInput.reportValidity();return;}}
     replace();
    }),button("Annulla",()=>form.remove(),"is-subtle"));add.after(form);keyInput?.focus();
   },"is-subtle");body.append(add);
  }
  const replace=()=>{const fresh=tree(entity,path,label,depth,section.node.open);section.node.replaceWith(fresh);};
  let wasOpen=section.node.open;
  section.node.addEventListener("toggle",()=>{const open=section.node.open,changed=open!==wasOpen;wasOpen=open;if(!section.node.isConnected||!open||!changed)return;const fresh=tree(entity,path,label,depth,true);section.node.replaceWith(fresh);});
  return section.node;
 }
 function fields(entity,paths,body) {const grid=make("div","npc-sheet-fields");for(const entry of paths){const[path,label]=Array.isArray(entry)?entry:[entry,undefined];if(nativeHas(entity.draft,path))grid.append(field(entity,path,label));}if(grid.childElementCount)body.append(grid);}
 function description(entity,body) {
  const path=entity.type==="ActiveEffect"?"description":"system.description.value";
  if(!nativeHas(entity.draft,path))return;
  const section=group("Descrizione",true),toolbar=make("div","npc-sheet-format");
  const editor=make("div","npc-sheet-richtext");editor.contentEditable=String(!locked(entity));editor.setAttribute("role","textbox");editor.setAttribute("aria-label","Descrizione");editor.setAttribute("aria-multiline","true");editor.innerHTML=descriptionHtml(nativeGet(entity.draft,path)||"");
  for(const [text,command]of [["Grassetto","bold"],["Corsivo","italic"],["Elenco","insertUnorderedList"]]){const b=button(text,()=>{editor.focus();document.execCommand(command);editor.dispatchEvent(new Event("input"));},"is-subtle");b.addEventListener("mousedown",event=>event.preventDefault());b.disabled=locked(entity);toolbar.append(b);}
  editor.addEventListener("input",()=>set(entity,path,descriptionValue(editor)));
  editor.addEventListener("paste",event=>{event.preventDefault();document.execCommand("insertText",false,event.clipboardData.getData("text/plain"));});
  section.body.append(toolbar,editor);body.append(section.node);
 }
 function damage(entity,path,body,healing=false) {
  const section=group(healing?"Cura":"Danni",true);
  const render=()=>{
   section.body.replaceChildren();const parts=healing?[nativeGet(entity.draft,path)]:nativeGet(entity.draft,path)||[];
   parts.forEach((part,index)=>{
    const prefix=healing?path:`${path}.${index}`,row=make("div","npc-sheet-damage");
    fields(entity,[[`${prefix}.number`,"Dadi"],[`${prefix}.denomination`,"Facce"],[`${prefix}.bonus`,"Bonus o formula"]],row);
     row.append(chips(entity,`${prefix}.types`,creationMode?Object.fromEntries(Object.entries(damageNames).filter(([key])=>healing?["healing","temphp"].includes(key):!["healing","temphp"].includes(key))):damageNames));
    if(nativeHas(entity.draft,`${prefix}.custom.enabled`)){fields(entity,[[`${prefix}.custom.enabled`,"Formula personalizzata"]],row);const formula=field(entity,`${prefix}.custom.formula`,"Formula personalizzata",nativeGet(entity.draft,`${prefix}.custom.formula`)||"");formula.dataset.npcCustomFor=`${prefix}.custom.enabled`;formula.hidden=!nativeGet(entity.draft,`${prefix}.custom.enabled`);row.append(formula);}
    if(!healing){const remove=button("Rimuovi danno",()=>{const next=clone(nativeGet(entity.draft,path));next.splice(index,1);set(entity,path,next);render();},"is-subtle");remove.disabled=locked(entity);row.append(remove);}section.body.append(row);
   });
   if(!healing){const add=button("+ Aggiungi danno",()=>{const parts=clone(nativeGet(entity.draft,path)||[]);parts.push({number:1,denomination:6,bonus:"",types:[],custom:{enabled:false},scaling:{mode:"",number:1}});set(entity,path,parts);render();},"is-subtle");add.disabled=locked(entity);section.body.append(add);}
  };render();body.append(section.node);
 }
 function chips(entity,path,choices) {
  const shell=make("div","npc-sheet-chips"),values=nativeGet(entity.draft,path)||[];
  shell.setAttribute("aria-label",title(path.split(".").at(-1)));
  for(const [value,text] of Object.entries({...choices,...Object.fromEntries(values.filter(v=>!Object.hasOwn(choices,v)).map(v=>[v,v]))})){const b=button(text,()=>{const current=nativeGet(entity.draft,path)||[];set(entity,path,current.includes(value)?current.filter(v=>v!==value):[...current,value]);b.setAttribute("aria-pressed",String(!current.includes(value)));},"is-chip");b.setAttribute("aria-pressed",String(values.includes(value)));b.disabled=locked(entity);shell.append(b);}return shell;
 }
 function activities(entity,body) {
  if(entity.activityReadOnly){body.append(make("p","npc-sheet-notice","Questa capacità contiene attività con identificativi duplicati. Le altre informazioni sono modificabili; per cambiare le meccaniche, correggi prima le attività in Foundry."));return;}
   const section=group("Attività",true),nav=make("div","npc-sheet-activity-nav"),content=make("div");let selected=entity.selectedActivity&&entity.draft.system.activities?.[entity.selectedActivity]?entity.selectedActivity:Object.keys(entity.draft.system.activities||{})[0];
  const render=()=>{
   nav.replaceChildren();content.replaceChildren();const all=entity.draft.system.activities||{};
    for(const [id,activity]of Object.entries(all)){const b=button(activity.name||activityNames[activity.type]||activity.type,()=>{selected=id;entity.selectedActivity=id;render();});b.setAttribute("aria-pressed",String(id===selected));nav.append(b);}
   const add=make("select");add.setAttribute("aria-label","Aggiungi attività");add.innerHTML='<option value="">+ Nuova attività</option>'+["attack","save","damage","heal","utility"].map(key=>`<option value="${key}">${activityNames[key]}</option>`).join("");add.disabled=locked(entity);
    add.addEventListener("change",()=>{if(!add.value)return;const activity=nativeActivityTemplate(add.value,activityNames[add.value]);if(creationMode&&entity.draft.system.uses.max)activity.consumption.targets=[{type:"itemUses",target:"",value:"1",scaling:{mode:""}}];set(entity,`system.activities.${activity._id}`,activity);selected=activity._id;entity.selectedActivity=selected;render();});nav.append(add);
   if(!selected||!all[selected]){content.append(make("p","npc-sheet-muted","Aggiungi un’attività per definire cosa accade quando usi questa capacità."));return;}
   const activity=all[selected],prefix=`system.activities.${selected}`;
    if(activity.type==="attack") {
     const label=make("label","npc-sheet-field"),select=make("select");label.append(make("span","","Dopo un colpo riuscito"));select.setAttribute("aria-label","Dopo un colpo riuscito");
     for(const [id,name]of [["","Nessuna attività aggiuntiva"],...Object.entries(all).filter(([id])=>id!==selected).map(([id,value])=>[id,value.name||activityNames[value.type]])]){const option=make("option","",name);option.value=id;select.append(option);}
     select.value=activity.midiProperties?.triggeredActivityId||"";select.disabled=locked(entity);select.addEventListener("change",()=>{
      const path=`${prefix}.midiProperties`,midi=clone(nativeGet(entity.draft,path)||{});
      for(const key of ["triggeredActivityId","triggeredActivityTargets","triggeredActivityRollAs","triggeredActivityConsume","triggeredActivityConfigure"])delete midi[key];
      if(select.value){Object.assign(midi,{triggeredActivityId:select.value,triggeredActivityTargets:"hitTargets",triggeredActivityRollAs:"self",triggeredActivityConsume:false,triggeredActivityConfigure:false});const next=`system.activities.${select.value}`;set(entity,`${next}.activation`,{type:"",value:0,override:true});set(entity,`${next}.consumption.targets`,[]);if(nativeGet(entity.draft,`${next}.damage`))set(entity,`${next}.damage.critical`,{allow:false,bonus:""});}
      set(entity,path,Object.keys(midi).length?midi:undefined,!Object.keys(midi).length);
     });label.append(select);content.append(label);
    }
   if(!nativeHas(entity.draft,`${prefix}.name`))content.append(field(entity,`${prefix}.name`,"Nome attività",""));
    const followUp=creationMode&&Object.values(all).some(value=>value.midiProperties?.triggeredActivityId===selected);
    fields(entity,[[`${prefix}.name`,"Nome attività"],...(!followUp?[[`${prefix}.activation.type`,"Azione"],[`${prefix}.activation.value`,"Costo azioni"],...(!creationMode?[[`${prefix}.activation.override`,"Attivazione specifica"]]:[])]:[])],content);
    if(followUp)content.append(make("p","npc-sheet-muted","Si attiva dopo un colpo riuscito, senza un’altra azione o utilizzo."));
    if(activity.attack){const s=group("Attacco",true);fields(entity,[[`${prefix}.attack.type.value`,"Tipo di attacco"],`${prefix}.attack.type.classification`,...(creationMode?[[`${prefix}.attack.bonus`,"Bonus finale per colpire"]]:[`${prefix}.attack.ability`,`${prefix}.attack.bonus`,`${prefix}.attack.flat`])],s.body);content.append(s.node);}
    if(activity.save){const s=group("Tiro salvezza",true);s.body.append(chips(entity,`${prefix}.save.ability`,Object.fromEntries(["str","dex","con","int","wis","cha"].map(key=>[key,labels[key]]))));fields(entity,[...(!creationMode?[`${prefix}.save.dc.calculation`]:[]),[`${prefix}.save.dc.formula`,"CD"],`${prefix}.damage.onSave`],s.body);content.append(s.node);}
   if(activity.damage?.parts)damage(entity,`${prefix}.damage.parts`,content);
   if(activity.healing)damage(entity,`${prefix}.healing`,content,true);
   const rules=group("Effetti dell’attività"),rulePath=`flags.khuzoe-automations.npcRules`,rule=nativeGet(entity.draft,`${rulePath}.activities.${selected}`)||{};
   const changeRule=(key,value)=>{const config=clone(nativeGet(entity.draft,rulePath)||{version:1,activities:{}});config.activities[selected]={healing:0,conditions:[],rounds:1,expiry:"turnEnd",...config.activities[selected],[key]:value};set(entity,rulePath,config);};
   const healing=make("label","npc-sheet-field");healing.append(make("span","","Cura in base ai danni inflitti"));const healingSelect=make("select");healingSelect.setAttribute("aria-label","Cura in base ai danni inflitti");healingSelect.innerHTML='<option value="0">Nessuna cura</option><option value="0.5">Metà dei danni</option><option value="1">Tutti i danni</option>';healingSelect.value=String(rule.healing||0);healingSelect.disabled=locked(entity)||!["attack","save","damage"].includes(activity.type);healingSelect.addEventListener("change",()=>changeRule("healing",Number(healingSelect.value)));healing.append(healingSelect);rules.body.append(healing);
   if(source.capabilities?.healingTypes===1){const filter=group("Quali danni curano");filter.body.append(make("p","npc-sheet-muted","Nessun tipo selezionato: tutti i danni. Seleziona uno o più tipi per limitare la cura."));const choices=make("div","npc-sheet-chips");for(const [value,text]of Object.entries(damageNames).filter(([key])=>!["healing","temphp"].includes(key))){const b=button(text,()=>{const current=nativeGet(entity.draft,`${rulePath}.activities.${selected}.healingTypes`)||[];changeRule("healingTypes",current.includes(value)?current.filter(key=>key!==value):[...current,value]);b.setAttribute("aria-pressed",String(!current.includes(value)));},"is-chip");b.setAttribute("aria-pressed",String((rule.healingTypes||[]).includes(value)));b.disabled=locked(entity)||!['attack','save','damage'].includes(activity.type);choices.append(b);}filter.body.append(choices);rules.body.append(filter.node);}
   rules.body.append(make("span","npc-sheet-muted","Condizioni da applicare al bersaglio"));
   const statusChips=make("div","npc-sheet-chips");for(const [value,text]of Object.entries(conditions).filter(([key])=>key!=="exhaustion")){const b=button(text,()=>{const current=nativeGet(entity.draft,`${rulePath}.activities.${selected}.conditions`)||[];changeRule("conditions",current.includes(value)?current.filter(key=>key!==value):[...current,value]);b.setAttribute("aria-pressed",String(!current.includes(value)));},"is-chip");b.setAttribute("aria-pressed",String((rule.conditions||[]).includes(value)));b.disabled=locked(entity)||!["attack","save","damage","utility"].includes(activity.type);statusChips.append(b);}rules.body.append(statusChips);
   const duration=make("div","npc-sheet-fields"),roundsLabel=make("label","npc-sheet-field");roundsLabel.append(make("span","","Durata delle condizioni (round)"));const rounds=make("input");rounds.type="number";rounds.min="0";rounds.max="100";rounds.value=rule.rounds??1;rounds.setAttribute("aria-label","Durata delle condizioni in round");rounds.disabled=locked(entity);rounds.addEventListener("change",()=>{if(rounds.reportValidity())changeRule("rounds",Number(rounds.value));});roundsLabel.append(rounds);duration.append(roundsLabel);
   const expiryLabel=make("label","npc-sheet-field");expiryLabel.append(make("span","","Scadenza"));const expiry=make("select");expiry.setAttribute("aria-label","Scadenza delle condizioni");expiry.innerHTML='<option value="turnEnd">Fine del turno</option><option value="turnStart">Inizio del turno</option>';expiry.value=rule.expiry||"turnEnd";expiry.disabled=locked(entity);expiry.addEventListener("change",()=>changeRule("expiry",expiry.value));expiryLabel.append(expiry);duration.append(expiryLabel);rules.body.append(duration);content.append(rules.node);
   if(permissions.isAdmin && ["attack","save","damage"].includes(activity.type)) {
    const admin=group("Probabilità dei dadi"),path="flags.khuzoe-automations.midiRollConfig";
    for(const [key,label]of [["attackMaxChance","Massimo sul dado d’attacco (%)"],["damageMaxChance","Massimo sui dadi di danno (%)"]]) {
     if(key==="attackMaxChance"&&activity.type!=="attack")continue;
     const row=make("label","npc-sheet-field");row.append(make("span","",label));const input=make("input");input.type="number";input.min="0";input.max="100";input.step="any";input.value=nativeGet(entity.draft,`${path}.activities.${selected}.${key}`)??"";input.placeholder="Probabilità normale";input.setAttribute("aria-label",label);input.disabled=locked(entity);
     input.addEventListener("change",()=>{if(!input.reportValidity())return;const config=clone(nativeGet(entity.draft,path)||{version:1,activities:{}});config.activities[selected]={...config.activities[selected],enabled:true,[key]:input.value===""?null:Number(input.value)};set(entity,path,config);});row.append(input);admin.body.append(row);
    }content.append(admin.node);
   }
    for(const [key,label]of [["range","Distanza"],["target","Bersagli e area"],["duration","Durata"],["uses","Utilizzi"],["consumption","Consumo di risorse"]])if(activity[key]&&!(creationMode&&["duration","uses","consumption"].includes(key)))content.append(tree(entity,`${prefix}.${key}`,label,1));
    if(!creationMode){const advanced=group("Altri dettagli dell’attività");advanced.body.append(tree(entity,prefix,"Tutte le impostazioni",1));content.append(advanced.node);}
   const remove=button("Rimuovi attività",()=>{if(!window.confirm("Rimuovere questa attività dalla bozza?"))return;set(entity,prefix,undefined,true);if(creationMode)for(const [id,value]of Object.entries(entity.draft.system.activities))if(value.midiProperties?.triggeredActivityId===selected)set(entity,`system.activities.${id}.midiProperties`,undefined,true);for(const key of ["npcRules","midiRollConfig"]){const path=`flags.khuzoe-automations.${key}`,config=nativeGet(entity.draft,path);if(config?.activities?.[selected]){const next=clone(config);delete next.activities[selected];set(entity,path,next);}}selected=Object.keys(entity.draft.system.activities)[0];render();},"is-danger");remove.disabled=locked(entity);content.append(remove);
  };render();section.body.append(nav,content);body.append(section.node);
 }
 function renderEntity(slot,entity) {
  for(const [key,set]of bindings){for(const input of set)if(!input.isConnected)set.delete(input);if(!set.size)bindings.delete(key);}
  slot.current=entity;const body=slot.detail;body.replaceChildren();
  if(!entity){body.append(make("div","npc-sheet-empty","Nessun elemento in questa sezione."));return;}
  const header=make("div","npc-sheet-entity-heading"),titles=make("div");titles.append(make("span","npc-sheet-eyebrow",entity.parentName?`Effetto · ${entity.parentName}`:entity.type==="Actor"?"Scheda del personaggio":({feat:"Capacità",weapon:"Arma",spell:"Incantesimo",equipment:"Equipaggiamento",consumable:"Consumabile",loot:"Oggetto"}[entity.itemType])||"Effetto"),make("h3","",entity.draft.name));

  if(entity.img){const src=resolveMedia(entity.img);if(src){const img=make("img");img.src=src;img.alt="";img.loading="lazy";header.append(img);}}header.append(titles);body.append(header);
  if(entity.type==="Item"&&onEditWithAi&&!draftMode){const ai=button("✦ Modifica con AI",()=>onEditWithAi(entity),"is-ai");ai.disabled=locked(entity);header.append(ai);}
   const pending=findPending(entity);if(!draftMode&&locked(entity))body.append(make("p","npc-sheet-notice","Modifiche inviate. Attendi Foundry e aggiorna la scheda per continuare su questo elemento."));
  const issue=source.commands?.find(c=>c.nativeEditorVersion&&c.target?.id===entity.target.id&&["failed","conflict"].includes(c.status));if(issue)body.append(make("p","npc-sheet-notice is-error",issue.error||"La modifica richiede una verifica."));
  fields(entity,["name"],body);
  if(textOnly){
   if(entity.type==='Actor')fields(entity,['system.details.biography.value','system.details.biography.public'],body);
   else{description(entity,body);if(entity.type==='Item'){fields(entity,['system.description.chat','system.description.unidentified'],body);for(const [id,activity]of Object.entries(entity.draft.system.activities||{})){const section=group(activity.name||'Testi dell’attività');fields(entity,[[`system.activities.${id}.name`,'Nome attività'],[`system.activities.${id}.description.value`,'Descrizione'],[`system.activities.${id}.description.chatFlavor`,'Testo in chat']],section.body);if(section.body.childElementCount)body.append(section.node);}}}
  }else if(entity.type==="Actor") {
   const s=group("In breve",true);fields(entity,[["system.attributes.hp.value","PF attuali"],["system.attributes.hp.max","PF massimi"],["system.attributes.hp.temp","PF temporanei"],["system.attributes.hp.formula","Dadi vita"],["system.attributes.ac.flat","CA"],["system.attributes.ac.calc","Tipo di CA"],["system.details.cr","Grado sfida"],["system.attributes.init.bonus","Bonus iniziativa"],["system.traits.size","Taglia"],["system.attributes.spellcasting","Incantatore"]],s.body);body.append(s.node);
   const abilities=group("Caratteristiche",true);for(const key of ["str","dex","con","int","wis","cha"]){const card=make("div","npc-sheet-ability");card.append(make("strong","",labels[key]));fields(entity,[`system.abilities.${key}.value`,`system.abilities.${key}.proficient`],card);abilities.body.append(card);}abilities.body.classList.add("npc-sheet-abilities");body.append(abilities.node);
   const defenses=group("Resistenze e immunità");for(const [key,label]of [["dr","Resistenze ai danni"],["di","Immunità ai danni"],["dv","Vulnerabilità ai danni"],["ci","Immunità alle condizioni"]])if(nativeHas(entity.draft,`system.traits.${key}`)){const section=group(label);section.body.append(chips(entity,`system.traits.${key}.value`,key==="ci"?conditions:Object.fromEntries(Object.entries(damageNames).filter(([key])=>!["healing","temphp"].includes(key)))));fields(entity,[[`system.traits.${key}.custom`,"Altri dettagli"]],section.body);if(nativeHas(entity.draft,`system.traits.${key}.bypasses`))section.body.append(tree(entity,`system.traits.${key}.bypasses`,"Eccezioni",1));defenses.body.append(section.node);}body.append(defenses.node);
   for(const [key,label]of [["attributes.movement","Movimento"],["attributes.senses","Sensi"],["traits.languages","Linguaggi"],["skills","Competenze"],["spells","Slot incantesimo"],["details","Identità e biografia"],["currency","Monete"],["resources","Risorse"],["bonuses","Bonus"]])if(nativeHas(entity.draft,`system.${key}`))body.append(tree(entity,`system.${key}`,label,1));
  } else if(entity.type==="Item") {
   const common=group("Impostazioni",true);fields(entity,creationMode?[["system.uses.max","Utilizzi massimi (vuoto = illimitati)"]]:["system.level","system.school","system.method","system.prepared","system.quantity","system.equipped","system.attuned","system.uses.max","system.uses.spent"],common.body);
   if(creationMode){const label=make("label","npc-sheet-field"),select=make("select");label.append(make("span","","Recupero utilizzi"));select.setAttribute("aria-label","Recupero utilizzi");for(const [value,text]of [["lr","Riposo lungo"],["sr","Riposo breve"],["day","Ogni giorno"]]){const option=make("option","",text);option.value=value;select.append(option);}select.value=entity.draft.system.uses.recovery[0]?.period||"lr";select.disabled=locked(entity);select.addEventListener("change",()=>set(entity,"system.uses.recovery",[{period:select.value,type:"recoverAll"}]));label.append(select);common.body.append(label);}
   body.append(common.node);description(entity,body);
   if(entity.draft.system.activities)activities(entity,body);
    for(const key of ["range","target","activation","duration","uses","materials","properties","weight","price","damage"])if(nativeHas(entity.draft,`system.${key}`)&&!creationMode)body.append(tree(entity,`system.${key}`,title(key),1));
  } else {
   fields(entity,["disabled","transfer","showIcon","tint"],body);
   if(nativeHas(entity.draft,"statuses")){const s=group("Condizioni",true);s.body.append(chips(entity,"statuses",conditions));body.append(s.node);}
   if(nativeHas(entity.draft,"duration"))body.append(tree(entity,"duration","Durata",0));
   const changesPath=nativeHas(entity.draft,"system.changes")?"system.changes":"changes";
   if(nativeHas(entity.draft,changesPath))body.append(tree(entity,changesPath,"Modifiche applicate",0));
   description(entity,body);
  }
   if(!creationMode&&!textOnly){const advanced=group("Avanzato · tutti i campi");advanced.body.append(make("p","npc-sheet-muted","I campi dei moduli mantengono i loro nomi originali. Modifica solo le impostazioni che conosci."));
   for(const key of Object.keys(entity.draft))advanced.body.append(tree(entity,key,title(key),1));body.append(advanced.node);}
  const tools=make("div","npc-sheet-entity-tools");
  if(entity.type==="Item" && iconEditor){tools.append(button("Cambia icona",()=>iconEditor(entity)));}
  if(entity.type!=="Actor"&&(!draftMode||entity.type==="ActiveEffect")&&(!entity.target.itemId||draftMode)&&deleteEntity){const b=button("Elimina elemento",()=>deleteEntity(entity),"is-danger");b.disabled=locked(entity);tools.append(b);}
  const reset=button("Annulla modifiche all’elemento",()=>{entity.draft=clone(entity.base);update();renderEntity(slot,entity);renderList(slot);},"is-subtle");reset.disabled=locked(entity);tools.append(reset);body.append(tools);updateStatus(slot);
 }
 function renderList(slot) {
  slot.list.replaceChildren();const query=slot.search.value.toLocaleLowerCase("it"),visible=entities.filter(e=>belongs(e,slot.categories)&&(!slot.filter||e.category===slot.filter)&&(e.name+" "+(e.parentName||"")).toLocaleLowerCase("it").includes(query));
  for(const entity of visible){const b=button("",()=>{renderEntity(slot,entity);renderList(slot);},"npc-sheet-entity");b._npcEntity=entity;b.append(make("span","npc-sheet-entity-name",entity.draft.name||entity.name));b.setAttribute("aria-current",String(slot.current===entity));if(entity.img){const src=resolveMedia(entity.img);if(src){const img=make("img");img.src=src;img.alt="";img.loading="lazy";b.prepend(img);}}const duplicates=entities.filter(e=>e.name===entity.name&&e.category===entity.category),copy=duplicates.length>1?` · Copia ${duplicates.indexOf(entity)+1}`:"";const meta=make("small","",(entity.parentName||({feat:"Capacità",weapon:"Arma",spell:"Incantesimo",equipment:"Equipaggiamento",consumable:"Consumabile",loot:"Oggetto"}[entity.itemType])||"Scheda")+copy);b.append(meta);if(changed(entity))b.append(make("span","npc-sheet-dot","●"));slot.list.append(b);}
  if(!visible.length)slot.list.append(make("p","npc-sheet-muted","Nessun risultato."));
 }
 function updateStatus(slot) {
   for(const node of slot.list.children){const entity=node._npcEntity;if(!entity)continue;node.querySelector('.npc-sheet-entity-name').textContent=entity.draft.name||entity.name;const dot=node.querySelector('.npc-sheet-dot');if(changed(entity)&&!dot)node.append(make('span','npc-sheet-dot','●'));if(!changed(entity)&&dot)dot.remove();}
   const count=entities.filter(changed).length,invalid=invalidControl();slot.status.textContent=invalid?'Controlla il campo segnalato':draftMode?(state.readOnlyLabel||(count?"Bozza modificata":state.draftSaved?"Bozza salvata":"Proposta da rivedere")):count?`${count} ${count===1?"elemento modificato":"elementi modificati"}`:"Tutte le modifiche sono salvate";
  slot.save.disabled=state.busy||(!count&&!invalid)||!source.canApply;
 }
 for(const {node,categories,label}of panes) {
   const shell=make("section",`npc-sheet-editor${draftMode?" is-proposal":""}`),heading=make("header","npc-sheet-heading"),titleGroup=make("div");titleGroup.append(make("span","npc-sheet-eyebrow",draftMode?(creationMode?"Nuova capacità":"Modifica proposta"):"Modifica NPC"),make("h2","",label));const status=make("span","npc-sheet-status");status.setAttribute("role","status");heading.append(titleGroup,status);shell.append(heading);
  if(!source.canApply)shell.append(make("p","npc-sheet-notice","La scheda completa è disponibile. Per inviare le modifiche, ricarica Foundry con Wiki Sync aggiornato."));
   const workspace=make("div","npc-sheet-workspace"),rail=make("aside","npc-sheet-rail"),search=make("input");if(draftMode&&entities.length===1||categories.length===1&&categories[0]==="stats")workspace.classList.add("is-single");search.type="search";search.placeholder="Cerca nella scheda…";search.setAttribute("aria-label","Cerca elementi");rail.append(search);
  const slot={shell,categories,filter:null,search,list:make("div","npc-sheet-list"),detail:make("div","npc-sheet-detail"),status};slots.push(slot);
  if(categories.length>1){const filters=make("div","npc-sheet-filters");for(const [key,text]of [[null,"Tutte"],["stats","Statistiche"],["abilities","Capacità"],["spells","Incantesimi"],["inventory","Inventario"],["effects","Effetti"]].filter(([key])=>key===null||categories.includes(key))){const b=button(text,()=>{slot.filter=key;filters.querySelectorAll("button").forEach(other=>other.setAttribute("aria-pressed",String(other===b)));renderList(slot);},"is-chip");b.setAttribute("aria-pressed",String(key===null));filters.append(b);}rail.append(filters);}
  rail.append(slot.list);workspace.append(rail,slot.detail);shell.append(workspace);
   const footer=make("footer","npc-sheet-footer"),review=button("Rivedi modifiche",()=>reviewChanges(shell));slot.save=button("Salva modifiche",()=>Promise.resolve(savePage?savePage():save()).catch(error=>{slot.message.textContent=error.message;}),"is-primary");slot.message=make("span","npc-sheet-message");slot.message.setAttribute("role","status");footer.append(slot.message,button("Aggiorna scheda",()=>refresh().catch(error=>{slot.message.textContent=error.message;})),review,slot.save);if(!draftMode)shell.append(footer);node.prepend(shell);
  search.addEventListener("input",()=>renderList(slot));renderEntity(slot,entities.find(e=>e.target.id===initialTarget&&belongs(e,categories))||entities.find(e=>belongs(e,categories)));renderList(slot);
 }
 function reviewChanges(shell) {
  shell.querySelector(".npc-sheet-review")?.remove();const panel=make("div","npc-sheet-review");panel.append(make("h3","","Modifiche da inviare"));
  for(const entity of entities.filter(changed)){panel.append(make("h4","",entity.draft.name));let patches;try{patches=nativeDiff(entity.base,entity.draft,entity.type,permissions);}catch(error){panel.append(make("p","",error.message));continue;}const list=make("ul");for(const patch of patches){const li=make("li");li.append(make("strong","",patch.path.split(".").map(title).join(" › ")));const value=value=>typeof value==="object"?JSON.stringify(value):String(value??"Automatico");li.append(make("span","",`${patch.baseExists?value(patch.baseValue):"Non impostato"} → ${patch.op==="delete"?"Rimosso":value(patch.value)}`));list.append(li);}panel.append(list);}
  if(!dirty())panel.append(make("p","","Nessuna modifica."));panel.append(button("Chiudi",()=>panel.remove()));shell.querySelector(".npc-sheet-heading").after(panel);panel.scrollIntoView({block:"nearest"});
 }
 async function save() {
  if(draftMode)throw new Error("Conferma la capacità dalla proposta AI.");if(state.busy)return;if(!source.canApply)throw new Error("Ricarica Foundry con Wiki Sync aggiornato.");
  for(const slot of slots){const invalid=slot.shell.querySelector(":invalid");if(invalid){invalid.reportValidity();throw new Error("Controlla i valori inseriti.");}}
  const selected=entities.filter(changed);if(!selected.length)return;
  const changes=selected.map(entity=>({target:entity.target,patches:nativeDiff(entity.base,entity.draft,entity.type,permissions)}));
  state.busy=true;slots.forEach(updateStatus);state.requestId ||= crypto.randomUUID();
  try {
   const result=await post({version:source.version,requestId:state.requestId,changes});
   for(const entity of selected){entity.base=clone(entity.draft);entity.queued=true;}
   onCommands?.(result.commands||[]);for(const slot of slots){slot.message.textContent="Inviato. Foundry applicherà le modifiche alla prossima sincronizzazione.";renderEntity(slot,slot.current);renderList(slot);}onDirty?.(false);
  } finally {state.busy=false;slots.forEach(updateStatus);}
 }
 async function refresh() {
  if(state.busy||!getSource)return;
  state.busy=true;slots.forEach(updateStatus);
  try {
   const latest=(await getSource()).data;source.commands=latest.commands;source.canApply=latest.canApply;
   // Preserve unsent drafts and their original baselines, including conflicts.
   // Only clean entities adopt the newly synchronized native source.
   for(const incoming of latest.entities){const entity=entities.find(e=>e.key===incoming.key);if(entity){if(!changed(entity)){entity.data=clone(incoming.data);entity.base=clone(incoming.data);entity.draft=clone(incoming.data);entity.name=incoming.name;entity.queued=false;}}else entities.push({...incoming,base:clone(incoming.data),draft:clone(incoming.data),queued:false});}
   for(let index=entities.length-1;index>=0;index--)if(!latest.entities.some(e=>e.key===entities[index].key)&&!changed(entities[index]))entities.splice(index,1);
   for(const slot of slots){const current=entities.find(e=>e.key===slot.current?.key)||entities.find(e=>belongs(e,slot.categories));renderEntity(slot,current);renderList(slot);slot.message.textContent="Scheda aggiornata. Le modifiche non inviate sono conservate.";}
  } finally{state.busy=false;slots.forEach(updateStatus);}
 }
  return {dirty,save,getDraft:()=>clone(entities[0]?.draft),isValid:()=>!invalidControl(),markDraftSaved:()=>{if(!draftMode)return;for(const entity of entities)entity.base=clone(entity.draft);state.draftSaved=true;slots.forEach(updateStatus);},setReadOnly:(value,label="")=>{state.readOnlyLabel=label;if(state.readOnly===Boolean(value)){slots.forEach(updateStatus);return;}state.readOnly=Boolean(value);for(const slot of slots)renderEntity(slot,slot.current);},show:paneId=>{if(invalidControl())return;for(const slot of slots)if(slot.shell.parentElement.id===paneId){renderEntity(slot,slot.current);renderList(slot);}},validate:()=>{const invalid=invalidControl();if(invalid){root._managedNpcReveal?.(invalid);invalid.reportValidity();throw new Error('Controlla il valore del campo segnalato.');}for(const entity of entities.filter(changed))nativeDiff(entity.base,entity.draft,entity.type,permissions);},entities};
}
