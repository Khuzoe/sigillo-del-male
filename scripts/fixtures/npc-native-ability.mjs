export const nativeAbilityProposal={
 name:"Morso necrotico",flavor:"Le fauci sottraggono energia vitale.",uses:3,recovery:"lr",
 activities:[
  {key:"bite",name:"Morso",type:"attack",activation:{type:"action",value:1},range:{value:10,units:"ft"},target:{count:1,type:"creature",area:"",size:0},attack:{kind:"melee",classification:"weapon",bonus:8},save:{ability:"con",dc:0,onSave:"none"},damage:[{formula:"2d8+5",type:"piercing"}],healing:{formula:"",type:"healing"},rules:{healing:0,conditions:[],rounds:0,expiry:"turnEnd"},next:"drain"},
  {key:"drain",name:"Sottrazione vitale",type:"save",activation:{type:"",value:0},range:{value:10,units:"ft"},target:{count:1,type:"creature",area:"",size:0},attack:{kind:"melee",classification:"weapon",bonus:0},save:{ability:"con",dc:16,onSave:"none"},damage:[{formula:"2d6",type:"necrotic"}],healing:{formula:"",type:"healing"},rules:{healing:1,conditions:["prone"],rounds:2,expiry:"turnEnd"},next:""}
 ],balance:"Danni contenuti per compensare la cura.",assumptions:["Portata in piedi."],unsupported:[],iconPrompt:"Le fauci del mostro avvolte da energia necrotica."
};
export const nativeAbilityActor={_id:"Actor12345678901",name:"Custode della cripta",type:"npc",ownership:{default:0,privateOwner:3},_stats:{modifiedTime:10},prototypeToken:{actorLink:true},
 system:{attributes:{hp:{value:20,max:90,temp:0},prof:3,ac:{flat:17}},abilities:{str:{value:20}},details:{cr:7,biography:"PRIVATE BIOGRAPHY"}},
 items:[{_id:"Item123456789012",name:"Multiattacco",type:"feat",system:{description:{value:"Due attacchi."},activities:{}},flags:{"khuzoe-automations":{midiRollConfig:{secret:"PRIVATE ROLL CONFIG"}},other:{secret:"PRIVATE FLAGS"}},effects:[]}],
 effects:[{_id:"Effect1234567890",name:"Protetto",disabled:false,system:{changes:[{key:"system.attributes.ac.bonus",mode:2,value:"1"},{key:"macro.execute",mode:0,value:"PRIVATE MACRO"}]},statuses:[],duration:{rounds:2,startTime:123},origin:"PRIVATE ORIGIN"}]
};
export const nativeAbilityVersions={nativeEditor:1,nativeAbilityCreate:1,foundry:{generation:14,version:"14.367"},system:{id:"dnd5e",version:"5.3.3"},wikiSync:"0.11.16",modules:[{id:"khuzoe-automations",version:"0.4.0"},{id:"midi-qol",version:"13.0.1"},{id:"unrelated-private-module",version:"1"}]};
