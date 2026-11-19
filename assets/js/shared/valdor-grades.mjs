export const campaign = 'cripta-di-sangue';
export const treeId = 'valdor-scudo-guardiano-mrkwapaj';

// Each capture is a value in the original prose. Only the captured span is replaced.
const damage = (label, type) => [label, new RegExp('(\\d+d6)(?= (?:\\+ mod\\. Forza )?danni ' + type + ')')];
const bonus = label => [label, /(\+\d+)/];
const feats = ['Talenti Extra', /pari a (\d+)\./];
const recipes = new Map([
    ['inizio', [['Durata', /puoi restarci per ([^.<]+)\./]]],
    ['node-mrkwdj4b', [damage('Danni Fulmine', 'da fulmine')]],
    ['node-mrkwdjqe', [bonus('Classe Armatura')]],
    ['node-mrkwdk96', [bonus('Danni')]],
    ['node-mrkwdksj', [damage('Danni', 'da tuono'), ['Tiro Salvezza', /Superare il tiro (\S+) i danni/]]],
    ['node-mrkwlyg5', [feats]], ['node-mrkwm0fq', [feats]], ['node-mrl2u0d1', [feats]],
    ['node-mrkwlyuu', [['Slot Sintonia', /slot sintonia pari a (\d+)\./]]],
    ['node-mrkwlzf4', [bonus('Bonus Forza')]], ['node-mrkwm0zh', [bonus('Bonus Destrezza')]],
    ['node-mrl2u1kl', [bonus('Bonus Costituzione')]],
    ['node-mrkwlzya', [['Velocità Camminata', /(\+\d+ piedi) alla velocità/]]],
    ['node-mrl2vrvx', [['Vantaggio Migliorato', /vantaggio ad (.+?), può tirare 3d20/, true]]],
    ['node-mrkwdib6', [damage('Danni Contundenti', 'contundenti'), damage('Danni Tuono','da tuono'),
        ['Effetto sul colpo', /danni da tuono aggiuntivi\.(.*?)<\/p>$/s, true]]],
    ['node-mrkwjzm0', [bonus('Punteggio Intelligenza'), ['Sguardo Elettrico', /Intelligenza\.<\/p>([\s\S]+)$/, true]]]
]);

const conflicts = new Map([
    ['node-mrkwdhx1', ['Danni contundenti', /(?:^|\s)(\d+d6) \+ mod\. Forza danni contundenti/, 'danni contundenti']],
    ['node-mrkweb9w', ['Difesa contro il fulmine', /e (resistenza|immunità) ai danni da fulmine/i, 'resistenza velkarya']]
]);

const clean = value => String(value ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();
const strip = html => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

function makeTemplate(node, recipe) {
    const levels = node.levels;
    const texts = levels.map((l,i) => clean(i === 0 ? node.baseDesc || node.desc || l.desc : l.desc || l.description));
    if (texts.some(s => !s || /[⟦⟧]/.test(s))) return null;
    const fields = recipe.map(([label,,rich]) => ({label,values:[], ...(rich ? {rich:true} : {})}));
    const templates = texts.map((text, grade) => {
        let html = text;
        for (const [i,[,pattern,rich]] of recipe.entries()) {
            const matcher = new RegExp(pattern.source, pattern.flags + 'dg');
            const hits = [...html.matchAll(matcher)];
            if (hits.length !== 1) return null;
            const [start,end] = hits[0].indices[1];
            const value = html.slice(start,end);
            if (!rich && /[<&>]/.test(value)) return null;
            fields[i].values[grade] = value;
            html = html.slice(0,start) + '⟦' + i + '⟧' + html.slice(end);
        }
        return html;
    });
    const html = templates[0];
    if (html == null || !templates.every(s => s === html)) return null;
    // Compare the complete HTML, including every paragraph and inline format.
    if (!texts.every((s,i) => html.replace(/⟦(\d+)⟧/g, (_,f) => fields[f].values[i]) === s)) return null;
    const model = {html,fields};
    const originalNotes = levels.map(l => l.changeNotes || []);
    const fold = text => String(text || '').trim().toLowerCase();
    const same = (a,b) => fold(a) === fold(b);
    const matches = originalNotes.every((notes,i) => {
        const changed = fields.filter(f => i && f.values[i] !== f.values[i-1]);
        return changed.length === notes.length && changed.every(f => notes.some(n =>
            n.type === 'changed' && same(n.label,f.label) && same(n.before,strip(f.values[i-1])) && same(n.after,strip(f.values[i]))));
    });
    if (!matches) model.originalNotes = structuredClone(originalNotes);
    return model;
}

export function prepareValdorGrades(record) {
    const adapted = structuredClone(record);
    const tree = adapted.tree || adapted;
    if (adapted.id !== treeId || tree.ownerCharacterId !== 'valdor' || !Array.isArray(tree.nodes)) throw Error('Albero o proprietario diverso da Valdor.');
    if (new Set(tree.nodes.map(n=>n.id)).size !== tree.nodes.length) throw Error('Identificativi dei nodi duplicati.');
    const added = [], individual = [], unchanged = [];
    for (const node of tree.nodes) {
        if ((node.levels?.length || 0) < 2 || Object.hasOwn(node,'gradeTemplate')) { unchanged.push(node.id); continue; }
        const recipe = recipes.get(node.id);
        const model = recipe && makeTemplate(node,recipe);
        if (model) { node.gradeTemplate = model; added.push(node.id); continue; }
        // Distinct texts and unresolved DM notes remain authoritative for these grades.
        node.gradeTemplate = {mode:'individual'};
        const conflict = conflicts.get(node.id);
        if (conflict) {
            const [label, pattern, noteLabel] = conflict;
            const index = 2;
            const level = node.levels[index];
            const literal = String(level?.desc || '').match(pattern)?.[1];
            const note = level?.changeNotes?.find(n => n.label?.toLowerCase() === noteLabel);
            if (literal && note?.after && !note.after.toLowerCase().includes(literal.toLowerCase())) {
                node.gradeTemplate.review = {grade:index + 1,label,text:literal,note:note.after,noteId:note.id};
            }
        }
        individual.push(node.id);
    }
    const restored = structuredClone(adapted);
    const inserted = new Set([...added, ...individual]);
    for (const n of (restored.tree || restored).nodes) if (inserted.has(n.id)) delete n.gradeTemplate;
    if (JSON.stringify(restored) !== JSON.stringify(record)) throw Error('La verifica di conservazione del documento non è riuscita.');
    return {adapted,added,individual,unchanged};
}

export async function migrateOnline({read, save, backup}) {
    const current = await read('skill-trees');
    function entry(doc) {
        if (doc?.source !== 'd1' || doc.campaignId !== campaign || !Array.isArray(doc.data) ||
            !Number.isSafeInteger(doc.treeRevisions?.[treeId]) || doc.treeRevisions[treeId] < 1) throw Error('Definizione D1 o revisione di Valdor non disponibile.');
        const records = doc.data.filter(r => r.id === treeId);
        if (records.length !== 1) throw Error('Albero di Valdor non identificabile.');
        return records[0];
    }
    const original = entry(current), revision = current.treeRevisions[treeId];
    const result = prepareValdorGrades(original);
    if (!result.added.length && !result.individual.length) return {revision, changed:false};
    const states = await read('skill-tree-states');
    if (states?.source !== 'd1' || states.campaignId !== campaign || !Array.isArray(states.data)) throw Error('Progressi di Valdor non verificabili.');
    await backup({campaign,treeId,revision,original,states:states.data.filter(s=>s.treeKey === treeId)});
    let writeError;
    try { await save({tree:result.adapted,expectedTreeRevision:revision}); }
    catch (error) { writeError = error; }
    const after = await read('skill-trees');
    if (JSON.stringify(entry(after)) !== JSON.stringify(result.adapted) || after.treeRevisions[treeId] !== revision+1) {
        throw writeError || Error('Il documento riletto non coincide con la conversione. La copia originale è disponibile.');
    }
    return {revision:revision+1,changed:true};
}
