import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {managedActorKeyScope,managedActorStorageRecord,splitManagedActorText} from '../workers/main-worker/src/managed-actor-store.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),worker=resolve(root,'workers/main-worker');
const account='00de8bc44d26476f8eb863502b298136',namespace='7c63ace205664e65bd59db105d74708a',database='7cbdeb91-6194-4212-a89b-eda4fce4d58d';
const run=promisify(execFile),hash=value=>createHash('sha256').update(value).digest('hex');
const quote=value=>value==null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const option=name=>process.argv.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);

export function importManagedActorSql(manifest,values,{statements=false}={}) {
 const campaign=manifest.campaignId,at=manifest.createdAt,id=manifest.migrationId,digest=manifest.manifestSha256;
 const gate=`EXISTS(SELECT 1 FROM managed_actor_imports WHERE campaign_id=${quote(campaign)} AND migration_id=${quote(id)} AND manifest_sha256=${quote(digest)} AND state='importing')`;
 const lines=[`INSERT OR IGNORE INTO managed_actor_imports(campaign_id,migration_id,state,imported_at,document_count,manifest_sha256) VALUES(${quote(campaign)},${quote(id)},'importing',${quote(at)},${manifest.documents.length},${quote(digest)});`];
 const sqlValue=value=>{
  if(typeof value!=='string'||Buffer.byteLength(quote(value))<80000)return quote(value);
  const valueId=hash(value);
  for(let offset=0,part=0;offset<value.length;part++){
   let end=Math.min(offset+19000,value.length);if(end<value.length&&/[\uD800-\uDBFF]/.test(value[end-1]))end--;
   lines.push(`INSERT OR IGNORE INTO managed_actor_import_parts(migration_id,value_id,part,payload) SELECT ${quote(id)},${quote(valueId)},${part},${quote(value.slice(offset,end))} WHERE ${gate};`);offset=end;
  }
  return `(SELECT group_concat(payload,'') FROM (SELECT payload FROM managed_actor_import_parts WHERE migration_id=${quote(id)} AND value_id=${quote(valueId)} ORDER BY part))`;
 };
 const insert=(table,columns,items)=>{for(const item of items){const expressions=item.map(sqlValue);lines.push(`INSERT OR IGNORE INTO ${table}(${columns.join(',')}) SELECT ${expressions.join(',')} WHERE ${gate};`);}};
 for(const entry of manifest.documents){
  const raw=values.get(entry.key);assert.equal(hash(raw),entry.sha256,`Backup digest: ${entry.key}`);
  const record=managedActorStorageRecord(entry.key,raw,1,at),doc=record.document;
  assert.equal(doc.campaign,campaign,'Cross-campaign import refused');
  insert('managed_actor_documents',['campaign_id','document_key','kind','revision','present','payload','chunk_count','updated_at'],[[campaign,entry.key,doc.kind,1,1,doc.payload,doc.chunks,at]]);
  insert('managed_actor_document_chunks',['campaign_id','document_key','part','payload'],record.chunks.map(c=>[campaign,entry.key,c.part,c.payload]));
  insert('managed_actor_commands',['campaign_id','queue_key','command_id','position','actor_id','status','present','payload'],record.commands.map(c=>[campaign,entry.key,c.id,c.position,c.actor,c.status,1,c.payload]));
  const chunks=splitManagedActorText(raw);
  insert('managed_actor_kv_originals',['campaign_id','document_key','bytes','sha256','metadata','chunk_count'],[[campaign,entry.key,entry.bytes,entry.sha256,JSON.stringify({metadata:entry.metadata??null,expiration:entry.expiration??null}),chunks.length]]);
  insert('managed_actor_kv_original_chunks',['campaign_id','document_key','part','payload'],chunks.map((text,part)=>[campaign,entry.key,part,text]));
 }
 lines.push(`DELETE FROM managed_actor_import_parts WHERE migration_id=${quote(id)} AND ${gate};`);
 assert.ok(lines.every(sql=>Buffer.byteLength(sql)<100000),'Import SQL statement exceeds D1 limit');
 return statements?lines:lines.join('\n')+'\n';
}

async function main(){
 const mode=process.argv[2],campaign=option('campaign')||'cripta-di-sangue';
 assert.match(campaign,/^[a-z0-9_-]+$/);
 const folder=resolve(option('folder')||resolve(root,'output/npc-d1',new Date().toISOString().replaceAll(':','-')));
 await mkdir(folder,{recursive:true});
 const cached=resolve(root,'output/npm-cache/_npx/2fea031b5bd76b2e/node_modules/wrangler/bin/wrangler.js');
 let cli=option('cli');if(!cli){try{await access(cached);cli=cached;}catch{cli=resolve(worker,'node_modules/wrangler/bin/wrangler.js');}}
 async function wrangler(args){const result=await run(process.execPath,[cli,...args],{cwd:worker,windowsHide:true,encoding:'utf8',maxBuffer:100*1024*1024,
  env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:resolve(folder,'wrangler.log')}});return result.stdout;}
 let credentials;
 async function cf(path,{method='GET',body}={}){
  // This tool has no code path capable of mutating a KV key.
  if(path.includes('/storage/kv/')&&method!=='GET')throw Error('KV writes are forbidden in the migration tool');
  credentials??=JSON.parse(await wrangler(['auth','token','--json']));
  const headers={'Content-Type':'application/json'};
  if(credentials.token)headers.Authorization=`Bearer ${credentials.token}`;else{headers['X-Auth-Key']=credentials.key;headers['X-Auth-Email']=credentials.email;}
  const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)throw Error(`Cloudflare ${method} ${path.split('?')[0]}: HTTP ${response.status}`);
  return response;
 }
 async function query(sql,params=[]){
  // Remote writes happen only through the separately reviewed import SQL file.
  assert.match(sql.trim(),/^SELECT\b/i,'Only read queries are allowed here');
  const json=await(await cf(`/d1/database/${database}/query`,{method:'POST',body:{sql,params}})).json();
  assert.equal(json.success,true,JSON.stringify(json.errors));assert.equal(json.result[0].success,true);return json.result[0].results;
 }
 async function keys(){
  let cursor='',result=[];
  do{const response=await(await cf(`/storage/kv/namespaces/${namespace}/keys?prefix=${encodeURIComponent(`campaign:${campaign}:managed-actor`)}&limit=1000${cursor?'&cursor='+encodeURIComponent(cursor):''}`)).json();
   assert.equal(response.success,true);result.push(...response.result);cursor=response.result_info?.cursor||'';
  }while(cursor);
  const category=`campaign:${campaign}:npc-categories`;
  const categories=await(await cf(`/storage/kv/namespaces/${namespace}/keys?prefix=${encodeURIComponent(category)}&limit=1000`)).json();assert.equal(categories.success,true);
  result.push(...categories.result.filter(item=>item.name===category));
  for(const item of result)assert.equal(managedActorKeyScope(item.name)?.campaignId,campaign,'Unknown key in managed Actor namespace');
  return result.sort((a,b)=>a.name.localeCompare(b.name));
 }
 const readKv=async key=>(await cf(`/storage/kv/namespaces/${namespace}/values/${encodeURIComponent(key)}`)).text();
 async function concurrent(items,fn){let next=0;const result=new Array(items.length);await Promise.all(Array.from({length:Math.min(6,items.length)},async()=>{while(next<items.length){const i=next++;result[i]=await fn(items[i],i);}}));return result;}
 const readBackup=async()=>{const manifest=JSON.parse(await readFile(resolve(folder,'manifest.json'),'utf8'));assert.equal(manifest.campaignId,campaign);assert.equal(hash(stable(manifest.documents)),manifest.manifestSha256,'Backup manifest integrity');
  const values=new Map();for(const item of manifest.documents){const raw=await readFile(resolve(folder,item.file),'utf8');assert.equal(hash(raw),item.sha256,`Backup digest: ${item.key}`);assert.equal(Buffer.byteLength(raw),item.bytes);values.set(item.key,raw);}return {manifest,values};};
 if(mode==='inventory'||mode==='backup'){
  const listed=await keys();
  if(mode==='inventory'){
   const index=JSON.parse(await readKv(`campaign:${campaign}:managed-actors:index`));
   const types={};for(const actor of index.data||[])types[actor.actorType||'unknown']=(types[actor.actorType||'unknown']||0)+1;
   const counts={};for(const item of listed){const kind=managedActorKeyScope(item.name).kind;counts[kind]=(counts[kind]||0)+1;}
   await writeFile(resolve(folder,'inventory.json'),JSON.stringify({campaign,keys:listed,types},null,2));
   console.log(JSON.stringify({folder,campaign,documents:listed.length,counts,types}));return;
  }
  const documents=await concurrent(listed,async(item,i)=>{const raw=await readKv(item.name),file=`${String(i).padStart(4,'0')}.json`;
   managedActorStorageRecord(item.name,raw);await writeFile(resolve(folder,file),raw,{flag:'wx'});
   return {key:item.name,file,bytes:Buffer.byteLength(raw),sha256:hash(raw),metadata:item.metadata??null,expiration:item.expiration??null};});
  const manifest={schemaVersion:1,campaignId:campaign,migrationId:crypto.randomUUID(),createdAt:new Date().toISOString(),documents};
  manifest.manifestSha256=hash(stable(documents));
  await writeFile(resolve(folder,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
  await wrangler(['d1','export','khuzoe-wiki','--remote','--output',resolve(folder,'d1-before.sql')]);
  console.log(JSON.stringify({folder,campaign,documents:documents.length,bytes:documents.reduce((n,item)=>n+item.bytes,0),maxDocumentBytes:Math.max(...documents.map(item=>item.bytes)),manifestSha256:manifest.manifestSha256}));
 }else if(mode==='api-baseline'||mode==='api-verify'){
  const {manifest,values}=await readBackup(),base='https://sigillo-api.khuzoe.workers.dev';
  if(mode==='api-baseline'){
   const paths=[`/api/managed-actors?campaign=${campaign}`,`/api/managed-actors?campaign=${campaign}&view=directory`,`/api/npc-categories?campaign=${campaign}`,
    ...['mago-folle','oltre-il-velo'].filter(id=>id!==campaign).map(id=>`/api/managed-actors/migration-probe/not-an-actor?campaign=${id}`)];
   for(const item of manifest.documents){if(managedActorKeyScope(item.key).kind!=='profile')continue;const profile=JSON.parse(values.get(item.key));
    if(profile.visibility?.state!=='public'||profile.lifecycle?.state==='archived')continue;
    const [,worldId,actorId]=item.key.split(':').slice(2);paths.push(`/api/managed-actors/${worldId}/${actorId}/profile?campaign=${campaign}`);
   }
   const snapshots=[];for(const path of paths){const response=await fetch(base+path,{headers:{'Cache-Control':'no-cache'}});snapshots.push({path,status:response.status,data:await response.json()});}
   assert.equal(snapshots[0].status,200,'Public NPC index available');
   await writeFile(resolve(folder,'api-before.json'),JSON.stringify(snapshots,null,2),{flag:'wx'});console.log(JSON.stringify({folder,apiSnapshots:snapshots.length,statuses:snapshots.map(s=>s.status)}));
  }else{
   const snapshots=JSON.parse(await readFile(resolve(folder,'api-before.json'),'utf8')),expectedD1=new Set((option('d1-campaigns')||campaign).split(',').filter(Boolean));
   for(const snapshot of snapshots){const response=await fetch(base+snapshot.path,{headers:{'Cache-Control':'no-cache'}});assert.equal(response.status,snapshot.status,snapshot.path);const current=await response.json();if(snapshot.path.includes(`campaign=${campaign}`))assert.deepEqual(current,snapshot.data,snapshot.path);
    if(snapshot.path.includes(`campaign=${campaign}`))assert.equal(response.headers.get('X-Managed-Actor-Storage'),'d1','Pilot reads D1');else{const target=new URL(base+snapshot.path).searchParams.get('campaign');assert.equal(response.headers.get('X-Managed-Actor-Storage')==='d1',expectedD1.has(target),'Campaign storage matches the configured rollout');}}
   const report={at:new Date().toISOString(),campaign,apiSnapshots:snapshots.length,equivalent:true,pilotSource:'d1',otherCampaignsSource:option('d1-campaigns')?'configured':'kv',d1Campaigns:[...expectedD1]};
   await writeFile(resolve(folder,`api-verification-${Date.now()}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }
 }else if(mode==='plan'){
  const {manifest,values}=await readBackup(),sql=importManagedActorSql(manifest,values);
  await writeFile(resolve(folder,'import.sql'),sql,{flag:'wx'});
  console.log(JSON.stringify({folder,statements:sql.split('\n').length-1,bytes:Buffer.byteLength(sql)}));
 }else if(mode==='import'){
  const {manifest,values}=await readBackup();
  assert.equal(await readFile(resolve(folder,'import.sql'),'utf8'),importManagedActorSql(manifest,values),'Import SQL must match the verified backup exactly');
  const existing=await query('SELECT * FROM managed_actor_imports WHERE campaign_id=?',[campaign]);
  if(existing.length)assert.ok(existing[0].state==='importing'&&existing[0].migration_id===manifest.migrationId&&existing[0].manifest_sha256===manifest.manifestSha256,'Existing D1 campaign cannot be replaced');
  else assert.equal((await query('SELECT COUNT(*) AS n FROM managed_actor_documents WHERE campaign_id=?',[campaign]))[0].n,0,'Existing D1 records cannot be replaced');
  await wrangler(['d1','execute','khuzoe-wiki','--remote','--file',resolve(folder,'import.sql'),'--yes']);
  console.log(JSON.stringify({folder,imported:manifest.documents.length,state:'importing'}));
 }else if(mode==='verify'||mode==='verify-kv'||mode==='activate'){
  const {manifest,values}=await readBackup(),imported=(await query('SELECT * FROM managed_actor_imports WHERE campaign_id=?',[campaign]))[0];
  assert.equal(imported?.migration_id,manifest.migrationId);assert.equal(imported?.manifest_sha256,manifest.manifestSha256);
  const stored=await query('SELECT document_key,kind,revision,present,payload,chunk_count FROM managed_actor_documents WHERE campaign_id=? ORDER BY document_key',[campaign]);
  if(mode!=='verify-kv')assert.equal(stored.length,manifest.documents.length,'D1 document count');
  for(const item of mode==='verify-kv'?[]:manifest.documents){
   const row=stored.find(row=>row.document_key===item.key);assert.ok(row);assert.equal(row.present,1);
   let raw=row.payload;
   if(row.chunk_count){const chunks=await query('SELECT part,payload FROM managed_actor_document_chunks WHERE campaign_id=? AND document_key=? ORDER BY part',[campaign,item.key]);assert.equal(chunks.length,row.chunk_count);raw=chunks.map((c,i)=>{assert.equal(c.part,i);return c.payload;}).join('');}
   let current=JSON.parse(raw);
   if(['commands','create-requests'].includes(row.kind)){const commands=await query('SELECT payload FROM managed_actor_commands WHERE campaign_id=? AND queue_key=? AND present=1 ORDER BY position,command_id',[campaign,item.key]);current[row.kind==='commands'?'commands':'requests']=commands.map(entry=>JSON.parse(entry.payload));}
   assert.deepEqual(current,JSON.parse(values.get(item.key)),`D1 live data: ${item.key}`);
  }
  const originals=await query('SELECT * FROM managed_actor_kv_originals WHERE campaign_id=?',[campaign]);assert.equal(originals.length,manifest.documents.length);
  const originalChunks=await query('SELECT document_key,part,payload FROM managed_actor_kv_original_chunks WHERE campaign_id=? ORDER BY document_key,part',[campaign]);
  for(const item of manifest.documents){const original=originals.find(row=>row.document_key===item.key);assert.equal(original.sha256,item.sha256);assert.equal(original.bytes,item.bytes);assert.deepEqual(JSON.parse(original.metadata),{metadata:item.metadata??null,expiration:item.expiration??null});
   const chunks=originalChunks.filter(row=>row.document_key===item.key);assert.equal(chunks.length,original.chunk_count);assert.equal(chunks.map((chunk,i)=>{assert.equal(chunk.part,i);return chunk.payload;}).join(''),values.get(item.key));}
  const liveKeys=await keys();assert.deepEqual(liveKeys.map(item=>item.name),manifest.documents.map(item=>item.key),'KV key set preserved');
  for(const item of manifest.documents){const current=liveKeys.find(key=>key.name===item.key);assert.deepEqual(current.metadata??null,item.metadata??null,`KV metadata: ${item.key}`);assert.equal(current.expiration??null,item.expiration??null,`KV expiration: ${item.key}`);}
  await concurrent(manifest.documents,async item=>assert.equal(hash(await readKv(item.key)),item.sha256,`Original KV bytes: ${item.key}`));
  const report={at:new Date().toISOString(),campaign,documents:stored.length,kvByteIdentical:true,kvMetadataIdentical:true,d1Equivalent:mode==='verify-kv'?null:true,originalBackupByteIdentical:true,manifestSha256:manifest.manifestSha256};
  await writeFile(resolve(folder,`verification-${Date.now()}.json`),JSON.stringify(report,null,2));
  if(mode==='activate'){
   assert.equal(imported.state,'importing');
   const sql=`UPDATE managed_actor_imports SET state='ready',verified_at=${quote(report.at)} WHERE campaign_id=${quote(campaign)} AND migration_id=${quote(manifest.migrationId)} AND state='importing';\n`;
   await writeFile(resolve(folder,'activate.sql'),sql,{flag:'wx'});
   await wrangler(['d1','execute','khuzoe-wiki','--remote','--file',resolve(folder,'activate.sql'),'--yes']);report.state='ready';
  }
  console.log(JSON.stringify(report));
 }else throw Error('Use inventory, backup, api-baseline, api-verify, plan, import, verify, verify-kv or activate');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
