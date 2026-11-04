import {PrimarySpriteMesh} from './core-resize.mjs';
const moduleBase='/integrations/khuzoe-tiles-creator/scripts/';
class BaseApp{
  rendered=false;first=true;
  async _prepareContext(){return{};}async _onFirstRender(){}async _onRender(){}
  get element(){return document.getElementById('app');}
  async render(){if(this.rendering){this.again=true;return this;}this.rendering=true;try{this.rendered=true;this.element.style.display='block';const ctx=await this._prepareContext({});this.element.innerHTML='<div class="window-header"><span>Khuzoe · Tiles Creator</span><button aria-label="Chiudi finestra">×</button></div><div class="window-content">'+ctx.content+'</div>';this.element.querySelector('.window-header button').onclick=()=>this.close();await this._onRender(ctx,{});if(this.first){this.first=false;await this._onFirstRender(ctx,{});}}finally{this.rendering=false;if(this.again){this.again=false;void this.render();}}return this;}
  async minimize(){this.element.style.display='none';}async maximize(){this.element.style.display='block';}async close(){this.rendered=false;this.element.style.display='none';}
}
class Docs extends Map{[Symbol.iterator](){return this.values();}}
const compare=(a,b)=>(a.elevation||0)-(b.elevation||0)||(a.sortLayer||0)-(b.sortLayer||0)||(a.sort||0)-(b.sort||0);
const uploadedFiles=[];
window.foundry={applications:{api:{ApplicationV2:BaseApp,HandlebarsApplicationMixin:Base=>Base},apps:{FilePicker:{implementation:{browse:async()=>({}),upload:async(_type,folder,file)=>{uploadedFiles.push(file);return{path:folder+'/'+file.name};}}}}},canvas:{groups:{PrimaryCanvasGroup:{SORT_LAYERS:{SCENE:0,TILES:500},_compareObjects:compare}},primary:{PrimarySpriteMesh}}};
window.game={user:{id:'qa-gm',isGM:true,can:()=>true},world:{id:'preview-world'}};window.ui={notifications:{warn:console.warn,error:console.error}};
const app=new PIXI.Application({width:1000,height:700,backgroundColor:0x24262a,antialias:true,preserveDrawingBuffer:true});document.getElementById('scene').append(app.view);
const base=document.createElement('canvas');base.width=1000;base.height=700;const p=base.getContext('2d');p.fillStyle='#5a674b';p.fillRect(0,0,1000,700);let seed=17;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};for(let i=0;i<3000;i++){p.fillStyle=rand()>.5?'#78835b55':'#303d2d44';p.beginPath();p.arc(rand()*1000,rand()*700,rand()*5+1,0,Math.PI*2);p.fill();}p.fillStyle='#304952';p.beginPath();p.moveTo(450,0);p.bezierCurveTo(380,230,640,380,480,700);p.lineTo(630,700);p.bezierCurveTo(780,380,500,220,580,0);p.fill();p.strokeStyle='#8c9171';p.lineWidth=12;p.beginPath();p.moveTo(445,0);p.bezierCurveTo(375,230,635,380,475,700);p.stroke();p.strokeStyle='#233239';p.lineWidth=4;for(let i=0;i<100;i++){const y=rand()*700,x=490+Math.sin(y/130)*45+rand()*60;p.beginPath();p.moveTo(x,y);p.lineTo(x+15,y+2);p.stroke();}p.fillStyle='#85816d';p.fillRect(260,285,450,120);p.strokeStyle='#343c32';p.lineWidth=3;for(let row=0;row<5;row++)for(let col=0;col<18;col++){p.strokeRect(260+col*25+(row%2)*12,285+row*24,25,24);}p.fillStyle='#aaa188';p.fillRect(250,277,470,10);p.fillRect(250,404,470,10);
const rune=document.createElement('canvas');rune.width=150;rune.height=150;const r=rune.getContext('2d');r.fillStyle='#163c2d';r.fillRect(0,0,150,150);r.strokeStyle='#dbb464';r.lineWidth=8;r.strokeRect(8,8,134,134);r.beginPath();r.arc(75,75,48,0,Math.PI*2);r.stroke();r.beginPath();r.moveTo(75,30);r.lineTo(115,100);r.lineTo(35,100);r.closePath();r.stroke();
const textures={'map.webp':PIXI.Texture.from(base),'rune.webp':PIXI.Texture.from(rune)};foundry.canvas.loadTexture=async src=>textures[src];
const tiles=new Docs(),scene={id:'qa-scene00000001',_view:'qa-level00000001',backgroundColor:0x24262a,dimensions:{sceneRect:{x:0,y:0,width:1000,height:700}},tiles,_configureLevelTextures:()=>[{src:'map.webp',level:{textures:{anchorX:.5,anchorY:.5,scaleX:1,scaleY:1,fit:'fill'}},elevation:0}],createEmbeddedDocuments:async(_type,docs)=>docs.map(data=>{const tile={...data,id:data._id};tiles.set(tile.id,tile);return tile;})};
tiles.set('qa-tile000000001',{id:'qa-tile000000001',texture:{src:'rune.webp',anchorX:.5,anchorY:.5,fit:'fill',scaleX:1,scaleY:1},x:320,y:350,width:130,height:130,rotation:24,elevation:0,sort:1000,alpha:.7,viewed:true,hidden:false});
window.canvas={ready:true,scene,level:{id:scene._view,elevation:0},app,stage:app.stage};
const map=new PIXI.Sprite(textures['map.webp']);app.stage.addChild(map);const tile=new PIXI.Sprite(textures['rune.webp']);tile.position.set(320,350);tile.anchor.set(.5);tile.width=tile.height=130;tile.angle=24;tile.alpha=.7;app.stage.addChild(tile);const token=new PIXI.Graphics();token.beginFill(0xcc3333).drawCircle(560,345,24).endFill();app.stage.addChild(token);const tokenLabel=new PIXI.Text('TOKEN',{fontSize:12,fill:0xffffff});tokenLabel.position.set(538,338);app.stage.addChild(tokenLabel);
const {TilesController}=await import(moduleBase+'controller.mjs');const {configureApp,openTiles}=await import(moduleBase+'app.mjs');
let job=null,source=null,generated=null;let generationCalls=0;
const sources=new Map(),outputs=new Map(),jobs=new Map(),referenceImages=new Map();
const context={campaignId:'preview-campaign',worldId:game.world.id,sceneId:scene.id,levelId:scene._view,identityVersion:1,authenticated:true,remoteWrites:true};
const client={context,identity:()=>JSON.stringify(context),assert:()=>{},request:async(action='',body,id)=>{
  if(action==='source')return sources.get(id);if(action==='preview')return outputs.get(id);
  if(/^reference-/.test(action))return referenceImages.get(id)?.[Number(action.split('-')[1])-1];
  if(action==='stop'){const current=jobs.get(id);current.status='uncertain';return{job:{...current}};}
  if(action==='placed'){const current=jobs.get(id);current.status='placed';current.tileId=body.tileId;return{job:{...current}};}
  if(body){
    if(jobs.has(body.requestId))return{job:{...jobs.get(body.requestId)}};
    generationCalls++;source=await(await fetch(body.source)).blob();
    const references=[];for(const reference of body.references||[])references.push(await(await fetch(reference.image)).blob());referenceImages.set(body.requestId,references);
    job={id:body.requestId,parentJobId:body.parentJobId||null,context,capture:body.capture,options:body.options,details:body.details,references:(body.references||[]).map(({image,...metadata})=>metadata),status:'pending'};
    const current=job;jobs.set(job.id,job);sources.set(job.id,source);
    const original=await createImageBitmap(source),edited=document.createElement('canvas');edited.width=original.width;edited.height=original.height;
    const e=edited.getContext('2d');e.drawImage(original,0,0);const c=job.capture,f=c.frame,sx=c.width/f.width,sy=c.height/f.height;e.save();e.scale(sx,sy);e.translate(-f.x,-f.y);
    if(body.parentJobId){
      e.strokeStyle='#e96752';e.lineWidth=4;e.shadowColor='#ff392b';e.shadowBlur=7;
      for(const x of [385,665]){e.beginPath();e.moveTo(x,322);e.lineTo(x+12,342);e.lineTo(x,363);e.moveTo(x-10,342);e.lineTo(x+21,342);e.stroke();}
    }else{
      e.fillStyle='#2c424a';e.beginPath();e.moveTo(465,280);e.lineTo(510,296);e.lineTo(485,332);e.lineTo(525,370);e.lineTo(490,415);e.lineTo(590,415);e.lineTo(615,365);e.lineTo(575,320);e.lineTo(620,280);e.closePath();e.fill();e.fillStyle='#a49b82';
      for(let i=0;i<22;i++){const x=475+rand()*135,y=270+rand()*155;e.save();e.translate(x,y);e.rotate(rand()*3);e.fillRect(-8,-5,16,10);e.restore();}
    }
    e.restore();generated=await new Promise(resolve=>edited.toBlob(resolve,'image/webp',.95));outputs.set(job.id,generated);original.close();setTimeout(()=>{current.status='ready';},350);return{job:{...job}};
  }
  return{ok:true,enabled:true,referencesVersion:1,job:job?{...job}:null,quota:{used:generationCalls,limit:null}};
}};
const draftRecords=new Map();
const drafts={async get(key){return draftRecords.get(key);},async put(key,value){draftRecords.set(key,structuredClone(value));return true;},async delete(key){draftRecords.delete(key);}};
const controller=new TilesController({client,drafts});configureApp(controller);document.getElementById('open').onclick=()=>{openTiles();void controller.open();};
openTiles();
let auditedResult,auditedExport,alphaText='',exportText='';
async function auditAlpha(blob){const image=await createImageBitmap(blob);try{const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const bytes=ctx.getImageData(0,0,image.width,image.height).data;let min=255,max=0;for(let i=3;i<bytes.length;i+=4){min=Math.min(min,bytes[i]);max=Math.max(max,bytes[i]);}return `${min}–${max}`;}finally{image.close();}}
const change=async()=>{
  const result=controller.blobs.result,exported=uploadedFiles.at(-1);
  if(result&&result!==auditedResult){auditedResult=result;alphaText=` · alpha anteprima ${await auditAlpha(result)}`;}
  if(exported&&exported!==auditedExport){auditedExport=exported;exportText=` · alpha esportato ${await auditAlpha(exported)}`;}
  document.getElementById('qa').textContent=`Prova simulata · ${generationCalls} ${generationCalls===1?'chiamata simulata':'chiamate simulate'} · ${tiles.size-1} ${tiles.size===2?'tile creato':'tile creati'}${alphaText}${exportText} · nessuna scena reale`;
};
setInterval(change,1000);
