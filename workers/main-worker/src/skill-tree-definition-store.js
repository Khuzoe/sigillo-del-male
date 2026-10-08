import { PollStorageError } from './poll-store.js';

const conflict = () => new PollStorageError('L’albero online è cambiato. Ricarica la pagina prima di salvare.', 409, 'VERSION_CONFLICT');
const invalid = () => new PollStorageError('Struttura degli alberi non valida: operazione interrotta.', 400, 'SKILL_TREE_DEFINITION_INVALID');
function treeId(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw invalid();
  const id = record.id || record.key;
  if (typeof id !== 'string' || !id.trim() || id !== id.trim() || id.length > 180) throw invalid();
  const tree = record.tree || record;
  if (!tree || typeof tree !== 'object' || !Array.isArray(tree.nodes)) throw invalid();
  return id;
}
function validate(data) {
  if (!Array.isArray(data)) throw invalid();
  const ids = data.map(treeId);
  if (new Set(ids).size !== ids.length) throw invalid();
  return ids;
}
export class SkillTreeDefinitionStore {
  constructor(env, campaignId) {
    if (!env.POLL_DB || !env.SIGILLO_KV) throw new PollStorageError('Archivio strutture D1 non configurato.');
    this.db = env.POLL_DB; this.kv = env.SIGILLO_KV; this.campaignId = campaignId;
  }
  statement(sql, ...values) { return this.db.prepare(sql).bind(...values); }
  async ensureImported() {
    if (await this.statement('SELECT 1 FROM skill_tree_definition_documents WHERE campaign_id = ?', this.campaignId).first()) return;
    const raw = await this.kv.get(`campaign:${this.campaignId}:data:skill-trees:override`);
    let doc = {version:0,data:[]};
    if (raw != null) {
      try {
        doc = JSON.parse(raw);
        if (!doc || typeof doc !== 'object' || Array.isArray(doc) || (doc.campaignId && doc.campaignId !== this.campaignId)
          || !Number.isSafeInteger(Number(doc.version || 0)) || Number(doc.version || 0) < 0) throw invalid();
        validate(doc.data);
      } catch { throw new PollStorageError('Alberi KV non validi: importazione interrotta.',500,'SKILL_TREE_DEFINITION_IMPORT_INVALID'); }
    }
    const metadata = {...doc}; delete metadata.data;
    const rows = doc.data.map((record,position)=>({id:treeId(record),position,payload:record}));
    await this.db.batch([
      this.statement(`INSERT OR IGNORE INTO skill_tree_definitions (campaign_id,tree_id,revision,position,payload)
        SELECT ?,json_extract(value,'$.id'),1,json_extract(value,'$.position'),json_extract(value,'$.payload') FROM json_each(?)
        WHERE NOT EXISTS (SELECT 1 FROM skill_tree_definition_documents WHERE campaign_id=?)`,this.campaignId,JSON.stringify(rows),this.campaignId),
      this.statement(`INSERT OR IGNORE INTO skill_tree_definition_documents (campaign_id,version,metadata,has_override,original_raw,imported_at)
        VALUES (?,?,?,?,?,?)`,this.campaignId,raw==null?0:Number(doc.version||1),JSON.stringify(metadata),raw==null?0:1,raw,new Date().toISOString())
    ]);
  }
  async readRow() {
    await this.ensureImported();
    return this.statement(`SELECT d.*, COALESCE((SELECT json_group_array(json(payload)) FROM
      (SELECT payload FROM skill_tree_definitions WHERE campaign_id=d.campaign_id AND payload IS NOT NULL ORDER BY position,tree_id)),'[]') AS data,
      COALESCE((SELECT json_group_object(tree_id,revision) FROM skill_tree_definitions WHERE campaign_id=d.campaign_id),'{}') AS revisions
      FROM skill_tree_definition_documents d WHERE campaign_id=?`,this.campaignId).first();
  }
  documentFromRow(row) {
    const metadata=JSON.parse(row.metadata);
    return {ok:true,collection:'skill-trees',campaignId:this.campaignId,source:row.has_override?'d1':'static',version:row.version,
      updatedAt:metadata.updatedAt||null,updatedBy:metadata.updatedBy||null,data:row.has_override?JSON.parse(row.data):null,treeRevisions:JSON.parse(row.revisions)};
  }
  async getDocument() { return this.documentFromRow(await this.readRow()); }
  async saveTree(record, expectedRevision, attribution) {
    const id=treeId(record);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision<0) throw conflict();
    await this.ensureImported();
    const mutation=crypto.randomUUID(),params=[this.campaignId,id,mutation];
    const cas=expectedRevision===0
      ? this.statement(`INSERT INTO skill_tree_definitions (campaign_id,tree_id,revision,position,payload,mutation_id)
          VALUES (?,?,1,COALESCE((SELECT MAX(position)+1 FROM skill_tree_definitions WHERE campaign_id=?),0),?,?)
          ON CONFLICT (campaign_id,tree_id) DO NOTHING`,this.campaignId,id,this.campaignId,JSON.stringify(record),mutation)
      : this.statement(`UPDATE skill_tree_definitions SET revision=revision+1,payload=?,mutation_id=? WHERE campaign_id=? AND tree_id=? AND revision=?`,JSON.stringify(record),mutation,this.campaignId,id,expectedRevision);
    const gate='EXISTS (SELECT 1 FROM skill_tree_definitions WHERE campaign_id=? AND tree_id=? AND mutation_id=?)';
    const results=await this.db.batch([cas,this.statement(`UPDATE skill_tree_definition_documents SET version=version+1,has_override=1,metadata=json_patch(metadata,?)
      WHERE campaign_id=? AND ${gate}`,JSON.stringify(attribution),this.campaignId,...params)]);
    if (!results[0].meta.changes) throw conflict();
    return this.getDocument();
  }
  async replaceCollection(data,expectedVersion,attribution) {
    const ids=validate(data);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion<0) throw conflict();
    const before=await this.getDocument();if(before.version!==expectedVersion)throw conflict();
    const previous=new Map((before.data||[]).map(record=>[treeId(record),record]));
    const incoming=new Map(data.map((record,index)=>[ids[index],record]));
    const changed=[...new Set([...previous.keys(),...incoming.keys()])].filter(id=>JSON.stringify(previous.get(id))!==JSON.stringify(incoming.get(id)));
    const rows=changed.map(id=>({id,position:ids.indexOf(id),payload:incoming.get(id)||null}));
    const order=ids.map((id,position)=>({id,position}));
    const mutation=crypto.randomUUID(),params=[this.campaignId,mutation];
    const gate='EXISTS (SELECT 1 FROM skill_tree_definition_documents WHERE campaign_id=? AND mutation_id=?)';
    const results=await this.db.batch([
      this.statement(`UPDATE skill_tree_definition_documents SET version=version+1,has_override=1,metadata=json_patch(metadata,?),mutation_id=? WHERE campaign_id=? AND version=?`,JSON.stringify(attribution),mutation,this.campaignId,expectedVersion),
      this.statement(`INSERT INTO skill_tree_definitions (campaign_id,tree_id,revision,position,payload,mutation_id)
        SELECT ?,json_extract(value,'$.id'),1,json_extract(value,'$.position'),json_extract(value,'$.payload'),? FROM json_each(?) WHERE ${gate}
        ON CONFLICT (campaign_id,tree_id) DO UPDATE SET revision=revision+1,position=excluded.position,payload=excluded.payload,mutation_id=excluded.mutation_id`,this.campaignId,mutation,JSON.stringify(rows),...params),
      this.statement(`UPDATE skill_tree_definitions SET position=(SELECT json_extract(value,'$.position') FROM json_each(?) WHERE json_extract(value,'$.id')=tree_id)
        WHERE campaign_id=? AND payload IS NOT NULL AND ${gate}`,JSON.stringify(order),this.campaignId,...params)
    ]);
    if (!results[0].meta.changes)throw conflict();
    return this.getDocument();
  }
  async exportCampaign() {
    const row=await this.readRow(),document=this.documentFromRow(row);
    return {schemaVersion:1,campaignId:this.campaignId,exportedAt:new Date().toISOString(),originalRaw:row.original_raw,importedAt:row.imported_at,document,
      kvDocuments:row.has_override?[{key:`campaign:${this.campaignId}:data:skill-trees:override`,value:JSON.stringify({...JSON.parse(row.metadata),campaignId:this.campaignId,collection:'skill-trees',version:document.version,data:document.data})}]:[]};
  }
}
