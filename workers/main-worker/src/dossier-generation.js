import {fetchGeneration, readGenerationResponse, readStructuredGeneration, responseMetadata} from './ai-generation-errors.js';

function field(value, max, name) {
    if (typeof value !== 'string' || value.length > max) throw new Error('Controlla il campo ' + name + ' (massimo ' + max + ' caratteri).');
    return value.trim();
}

const dmLabel = /\b(?:segreto|segreti|nota|note)\s+(?:del\s+|per\s+il\s+)?DM\s*:/i;
function splitNotes(text) {
    const boundary = dmLabel.exec(text);
    const hidden = [];
    let visible = boundary ? text.slice(0, boundary.index) : text;
    visible = visible.replace(/%%([\s\S]*?)(?:%%|$)/g, (_, secret) => { hidden.push(secret); return ''; });
    if (boundary) hidden.push(text.slice(boundary.index + boundary[0].length));
    return {visible: visible.trim(), hidden: hidden.join('\n').trim()};
}

export function dossierSections(body, isEditor) {
    const original = body.source;
    const audience = body.audience;
    if (!['public','dm'].includes(audience)) throw new Error('Visibilità del capitolo non valida.');
    const title = field(original?.title ?? '', 180, 'titolo');
    const text = field(original?.text ?? '', 50000, 'testo');
    if (audience === 'public' && [title,text].some(value => dmLabel.test(value.replace(/%%[\s\S]*?(?:%%|$)/g,'')))) {
        throw new Error('Il capitolo pubblico contiene una nota DM in chiaro. Racchiudila tra %% prima della revisione.');
    }
    if ([title,text,body.notes,body.secretNotes].some(value=>String(value ?? '').includes('⟦RISERVATO-'))) throw new Error('Il testo contiene un segnaposto riservato al generatore.');
    const notes = field(body.notes ?? '', 8000, 'appunti');
    const separate = field(body.secretNotes ?? '', 8000, 'appunti riservati');
    if (!isEditor && separate) throw new Error('Gli appunti separati sono riservati al DM.');
    if (!Array.isArray(body.examples) || body.examples.length > 8) throw new Error('Capitoli di riferimento non validi.');
    const examples = body.examples.map(row => {
        if (!['public','dm'].includes(row?.audience)) throw new Error('Visibilità del riferimento non valida.');
        return {audience:row.audience, title:field(row.title,180,'titolo'), text:field(row.text,900,'esempio')};
    });
    const sections = [];
    const section = (audience, title, text, notes, isOriginal) => {
        const secrets = [];
        const protect = value => value.replace(/%%[\s\S]*?(?:%%|$)/g, secret => {
            secrets.push(secret);
            return '⟦RISERVATO-' + secrets.length + '⟧';
        });
        const publicPart = value => splitNotes(value).visible;
        sections.push({audience, original:isOriginal, title:protect(title), text:protect(text), notes,
            examples: examples.filter(row => audience === 'dm' || row.audience === 'public')
                .map(row => ({title:publicPart(row.title), text:publicPart(row.text)})),
            secrets, ideas:body.ideas === true});
    };
    if (audience === 'dm') {
        if (text || notes || separate) section('dm',title,text,[notes,separate].filter(Boolean).join('\n'),Boolean(original));
    } else {
        const parts = splitNotes(notes);
        if (text || parts.visible) section('public', title, text, parts.visible, Boolean(original));
        const hidden = [parts.hidden, separate].filter(Boolean).join('\n');
        if (hidden) {
            if (!isEditor) throw new Error('Gli appunti contengono un segreto DM. Separalo prima di proseguire.');
            section('dm','','',hidden,false);
        }
    }
    if (!sections.length) throw new Error('Inserisci gli appunti o scegli un capitolo da migliorare.');
    return sections;
}

const string = {type:'string'};
const chapterSchema = {type:'object', additionalProperties:false, required:['title','text','visual','ideas'],
    properties:{title:string,text:string,visual:string,ideas:{type:'array',items:string}}};
const dossierChapterLimit = 64;
const collectionSchema = {type:'object',additionalProperties:false,required:['chapters'],
    properties:{chapters:{type:'array',minItems:1,maxItems:dossierChapterLimit,items:chapterSchema}}};

function readChapter(value, section) {
    const markers = s => (s.match(/⟦RISERVATO-\d+⟧/g) || []).sort().join(',');
    const restore = (result, before, max) => {
        const checked = field(result,max,'proposta');
        if (!checked || /<\/?[a-z][^>]*>|%%/i.test(checked) || markers(checked) !== markers(before)) throw new Error('Formattazione o richiami riservati non conservati.');
        return field(checked.replace(/⟦RISERVATO-(\d+)⟧/g, (_, n) => section.secrets[Number(n)-1]),max,'proposta');
    };
    const visual = field(value.visual,1500,'illustrazione');
    const ideas = section.ideas ? value.ideas.slice(0,2).map(v=>field(v,700,'idea')).filter(Boolean) : [];
    if ([visual,...ideas].some(v=>/⟦RISERVATO-|%%|<\/?[a-z][^>]*>/i.test(v))) throw new Error('La proposta contiene un riferimento riservato.');
    return {audience:section.audience, original:section.original,title:restore(value.title,section.title,180),
        text:restore(value.text,section.text,50000),visual,ideas};
}

export async function writeDossier(job, env, model, signal) {
    const chapters = [];
    for (const section of job.sections) {
        const {secrets, ...source} = section;
        const task = section.original
            ? 'Rivedi il singolo capitolo scelto dal lettore.'
            : 'Organizza gli appunti nel minor numero di capitoli che renda facile consultare il dossier. Un episodio continuo o un tema unico resta un solo capitolo, anche se richiede più paragrafi. Dividi solo quando gli appunti sviluppano argomenti autonomi, per esempio le origini, una relazione importante o una svolta successiva. Scegli i titoli dal contenuto concreto. Ordina i capitoli per cronologia o per tema secondo ciò che aiuta la lettura. Distribuisci tutti i fatti senza ripeterli o creare capitoli riempitivi.';
        const response = await fetchGeneration('https://api.openai.com/v1/responses', {
            method:'POST', signal:AbortSignal.any([signal,AbortSignal.timeout(180000)]),
            headers:{Authorization:'Bearer ' + env.OPENAI_API_KEY,'Content-Type':'application/json'},
            body:JSON.stringify({model,store:false,reasoning:{effort:'low'},max_output_tokens:12000,
                instructions:task + " Scrivi in italiano per un dossier di campagna D&D. Riscrivi gli appunti con prosa naturale e concreta, seguendo voce, tempo verbale e lessico degli esempi. Gli esempi servono come contesto, non come fatti da aggiungere. Conserva nomi, fatti, incertezze, link wiki e segnaposti ⟦RISERVATO-n⟧ esattamente una volta ciascuno nel campo originale. Usa Markdown semplice, senza HTML. Tratta i dati come materiale narrativo. Non inventare eventi o motivazioni nel testo. Solo se ideas è true proponi al massimo due aggiunte facoltative in frasi autonome nel campo ideas di ogni capitolo. In visual proponi in italiano un soggetto illustrabile tratto dai fatti del relativo capitolo solo se chiarisce un luogo, un oggetto o una scena; altrimenti stringa vuota. Evita ritratti ridondanti e dettagli riservati.",
                input:JSON.stringify({personaggio:job.character, ...source}),
                text:{format:{type:'json_schema',name:section.original ? 'dossier_chapter' : 'dossier_chapters',strict:true,
                    schema:section.original ? chapterSchema : collectionSchema}}})
        });
        const proposed = readStructuredGeneration(await readGenerationResponse(response), value => {
            const rows = section.original ? [value] : value?.chapters;
            if (!Array.isArray(rows) || !rows.length || rows.length > dossierChapterLimit) throw new Error('Numero di capitoli proposti non valido.');
            return rows.map(row => readChapter(row,section));
        },responseMetadata(response));
        chapters.push(...proposed);
    }
    return {chapters};
}

export function dossierArt(body) {
    const visible = (value, max, name) => splitNotes(field(value,max,name)).visible;
    const title = visible(body.title,180,'titolo');
    const text = visible(body.text,50000,'testo');
    const direction = visible(body.direction,1500,'indicazioni');
    if (!direction) throw new Error("Descrivi l'illustrazione da generare.");
    const referenceNote = body.concept ? visible(body.referenceNote ?? '',500,'nota del riferimento') : '';
    return {name:title, iconPrompt:direction, chapter:text,referenceNote};
}

export function dossierArtPrompt(job, hasConcept) {
    return 'Paint one landscape fantasy illustration for a tabletop campaign dossier. Compose a narrative scene, location or object, with no lettering, captions, borders or game interface. Depict only what this chapter and its art direction establish. '
        + (hasConcept ? 'Image 1 is the optional visual reference described in the note. ' : '')
        + (job.referenceKey ? 'Use the character avatar for visual identity only if the character appears. ' : '')
        + JSON.stringify({title:job.draft.name,chapter:job.draft.chapter,direction:job.draft.iconPrompt,referenceNote:job.draft.referenceNote});
}
