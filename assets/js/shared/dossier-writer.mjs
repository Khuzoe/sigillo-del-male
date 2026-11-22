const pending = new Set(['pending','running','icon-pending','icon-running']);
const element = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
};

function dossierExamples(blocks, original, audience, notes) {
    const visibleText = text => text.replace(/%%[\s\S]*?(?:%%|$)/g,'');
    const words = text => new Set(visibleText(text).toLocaleLowerCase('it').match(/[\p{L}\p{N}]{4,}/gu) || []);
    const terms = words([original?.title,original?.text,notes].filter(Boolean).join(' '));
    const position = original ? blocks.indexOf(original) : blocks.length;
    return blocks.map((block,index) => {
        const scope = block.type === 'secret_dossier' ? 'dm' : block.visibility;
        if (block === original || !block.text || (scope === 'dm' && audience !== 'dm')) return null;
        const excerpt = visibleText(block.text).slice(0,900);
        const matches = text => [...words(text)].filter(term=>terms.has(term)).length;
        return {example:{audience:scope,title:block.title,text:excerpt},score:3*matches(block.title)+matches(excerpt),distance:Math.abs(index-position)};
    }).filter(Boolean).sort((a,b)=>b.score-a.score || a.distance-b.distance).slice(0,8).map(entry=>entry.example);
}

export function openDossierWriter({profile, hasAvatar, isEditor, campaign, token, renderChapter, apply}) {
    if (!token) throw new Error('Accedi per modificare il dossier.');
    if (document.querySelector('dialog[data-dossier-writer]')) return;
    const opener = document.activeElement;
    const dialog = element('dialog');
    dialog.className = 'npc-avatar-generator dossier-writer';
    dialog.dataset.dossierWriter = '';
    dialog.setAttribute('aria-labelledby','dossier-writer-title');
    dialog.innerHTML = `<header><div><small data-name></small><h2 id="dossier-writer-title">Da appunti a dossier</h2></div><button type="button" data-close aria-label="Chiudi">×</button></header>
        <div class="npc-avatar-generator__body"><fieldset data-inputs>
            <label>Operazione<select data-target><option value="">Organizza nuovi appunti in capitoli</option></select></label>
            <label>Visibilità<select data-audience><option value="public">Tutti i lettori del dossier</option><option value="dm">Solo DM</option></select></label>
            <details data-original hidden><summary>Leggi il capitolo attuale</summary><div></div></details>
            <label><span data-notes-label>Appunti</span><textarea data-notes rows="5" maxlength="8000"></textarea></label>
            <details data-secret><summary>Appunti riservati al DM</summary><textarea data-secret-notes rows="3" maxlength="8000" aria-label="Appunti riservati al DM"></textarea></details>
            <label class="dossier-check"><input type="checkbox" data-ideas> Suggerisci anche idee nuove da valutare</label>
            <button type="button" data-write>Prepara proposta</button>
        </fieldset><div data-results></div></div>
        <footer><span role="status" aria-live="polite"></span><button type="button" data-stop hidden>Interrompi attesa</button><button type="button" data-apply hidden>Applica alla bozza</button></footer>`;
    const el = selector => dialog.querySelector(selector);
    const target = el('[data-target]'), audience = el('[data-audience]'), results = el('[data-results]');
    const status = message => { el('[role="status"]').textContent = message; };
    const rows = [];
    let active = null;
    const urls = new Set();
    function clearResults() {
        rows.length = 0;
        for (const url of urls) URL.revokeObjectURL(url);
        urls.clear(); results.replaceChildren();
        el('[data-apply]').hidden = true;
    }
    if (profile.blocks.length) {
        const revisions = element('optgroup');
        revisions.label = 'Migliora un capitolo esistente';
        for (const block of profile.blocks) revisions.append(new Option(block.title,block.id));
        target.append(revisions);
    }
    function source() { return profile.blocks.find(block => block.id === target.value); }
    const noteDrafts = new Map();
    let noteKey;
    function configure(resetAudience = true) {
        clearResults();
        const block = source();
        audience.disabled = Boolean(block) || !isEditor;
        if (resetAudience) audience.value = block?.visibility || (isEditor ? 'public' : profile.visibility?.state || 'dm');
        const notes = el('[data-notes]'), secret = el('[data-secret-notes]');
        if (noteKey) noteDrafts.set(noteKey,[notes.value,secret.value]);
        noteKey = JSON.stringify([target.value,audience.value]);
        [notes.value,secret.value] = noteDrafts.get(noteKey) || ['',''];
        el('[data-original]').hidden = !block;
        el('[data-original] div').innerHTML = block ? renderChapter(block) : '';
        el('[data-notes-label]').textContent = block ? 'Indicazioni per la revisione (facoltative)' : 'Appunti';
        el('[data-secret]').hidden = !isEditor || audience.value !== 'public';
        status('');
    }
    target.onchange = () => configure();
    audience.onchange = () => configure(false);
    const path = 'api/managed-actors/' + encodeURIComponent(profile.worldId) + '/' + encodeURIComponent(profile.actorId) + '/dossier-ai';
    async function request(suffix, body, signal) {
        const url = new URL(window.CriptaApp.urls.api(path + suffix));
        url.searchParams.set('campaign',campaign);
        const response = await fetch(url,{method:body ? 'POST' : 'GET',cache:'no-store',
            headers:{Authorization:'Bearer ' + token,...(body ? {'Content-Type':body instanceof Blob ? body.type : 'application/json'} : {})},
            body:body instanceof Blob ? body : body ? JSON.stringify(body) : undefined,
            signal:signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000)});
        if (!response.ok) {
            const error = new Error((await response.json().catch(()=>({}))).error || 'Generatore non disponibile.');
            error.status = response.status;
            throw error;
        }
        return response;
    }
    function controls() {
        el('[data-inputs]').disabled = Boolean(active);
        results.querySelectorAll('[data-draw]').forEach(button => { button.disabled = Boolean(active); });
        el('[data-stop]').hidden = !active;
        el('[data-close]').disabled = Boolean(active);
        el('[data-apply]').disabled = Boolean(active) || !rows.some(row=>row.keep.checked);
    }
    async function generate(body, file, ready) {
        if (active) return;
        const run = {id:crypto.randomUUID(), controller:new AbortController(), started:false};
        const signal = run.controller.signal;
        active = run; controls(); status(file ? 'Caricamento riferimento…' : 'Generazione in corso…');
        try {
            if (file) body.concept = (await (await request('/concepts',file,signal)).json()).uploadId;
            signal.throwIfAborted();
            status('Generazione in corso…');
            run.started = true;
            const payload = {...body,requestId:run.id};
            // A dropped acknowledgement may already have queued a paid job.
            const submitted = request('',payload,signal).catch(error=>{
                if (signal.aborted || run.stopping || (error.status && error.status < 500)) throw error;
                return request('',payload,signal);
            });
            run.submitted = submitted;
            let {job} = await (await submitted).json();
            while (pending.has(job.status)) {
                await new Promise(resolve=>setTimeout(resolve,1200));
                signal.throwIfAborted();
                try { job = (await (await request('/'+run.id,undefined,signal)).json()).job; }
                catch (error) {
                    if (signal.aborted || (error.status && error.status < 500)) throw error;
                    status('Connessione interrotta. Riprovo a leggere la stessa proposta…');
                    await new Promise(resolve=>setTimeout(resolve,3000));
                }
            }
            if (run.stopping) return;
            if (job.status !== 'ready' || job.iconError || job.error) throw new Error(job.iconError || job.error || 'Generazione interrotta.');
            if (body.mode === 'illustration') {
                const blob = await (await request('/'+run.id+'/preview',undefined,signal)).blob();
                signal.throwIfAborted();
                ready(new File([blob],'illustrazione.webp',{type:'image/webp'}));
            } else ready(job.draft.chapters);
            status(body.mode === 'chapter' && rows.length > 1 ? rows.length + ' capitoli proposti. Scegli quali includere.' : 'Proposta pronta.');
        } catch (error) {
            if (!run.stopping) status(error.message);
        } finally {
            if (!run.stopping) { active = null; controls(); }
        }
    }
    el('[data-stop]').onclick = async () => {
        const run = active;
        if (!run || run.stopping) return;
        run.stopping = true;
        try {
            if (run.started) {
                await run.submitted.catch(()=>{});
                await request('/'+run.id+'/stop',{});
            }
            status('Attesa interrotta.');
        } catch (error) { status(error.message); }
        finally { run.controller.abort(); active = null; controls(); }
    };
    function appendChapter(chapter, original) {
        const card = element('fieldset');
        card.className = 'dossier-proposal';
        card.innerHTML = `<legend><label class="dossier-check"><input type="checkbox" data-keep checked> <span></span></label></legend>
            <div data-reading></div><div data-options></div>
            <details data-art><summary>Illustrazione facoltativa</summary>
                <label>Soggetto e indicazioni<textarea data-direction rows="2" maxlength="1500"></textarea></label>
                <label class="dossier-check"><input type="checkbox" data-avatar> Usa l’avatar come riferimento</label>
                <label>Immagine di riferimento (facoltativa)<input type="file" data-reference accept="image/png,image/jpeg,image/webp"></label>
                <label data-ref-note hidden>Come usare il riferimento<input maxlength="500"></label>
                <button type="button" data-draw>Genera illustrazione</button><img data-picture alt="Illustrazione proposta" hidden>
                <label class="dossier-check" data-include hidden><input type="checkbox"> Includi questa illustrazione</label>
            </details>`;
        results.append(card);
        const get = selector => card.querySelector(selector);
        get('legend span').textContent = chapter.audience === 'dm' ? 'Includi capitolo · Solo DM' : 'Includi capitolo · Tutti i lettori';
        const keep = get('[data-keep]');
        keep.onchange = controls;
        const row = {chapter, id:chapter.original ? original?.id : '', keep, card, file:null, choices:[]};
        rows.push(row);
        function showText() {
            row.text = [chapter.text,...row.choices.filter(choice=>choice.input.checked).map(choice=>choice.text)].join('\n\n');
            get('[data-reading]').innerHTML = renderChapter({...original,type:chapter.original ? original.type : 'lore',
                image:'',banner:'',title:chapter.title,text:row.text,visibility:chapter.audience});
        }
        if (chapter.ideas.length) get('[data-options]').append(element('strong','Idee facoltative'));
        for (const idea of chapter.ideas) {
            const label = element('label'); label.className = 'dossier-check';
            const input = element('input'); input.type = 'checkbox'; input.onchange = showText;
            label.append(input,idea); get('[data-options]').append(label); row.choices.push({input,text:idea});
        }
        showText();
        get('[data-direction]').value = chapter.visual;
        get('[data-art]').open = Boolean(chapter.visual);
        get('[data-avatar]').closest('label').hidden = !hasAvatar;
        const ref = get('[data-reference]');
        ref.onchange = () => { get('[data-ref-note]').hidden = !ref.files.length; };
        get('[data-draw]').onclick = () => {
            const direction = get('[data-direction]').value.trim();
            if (!direction) { status('Descrivi il soggetto da illustrare.'); get('[data-direction]').focus(); return; }
            const file = ref.files[0];
            if (file && (file.size > 12*1024*1024 || !['image/png','image/jpeg','image/webp'].includes(file.type))) { status('Scegli un PNG, JPEG o WebP fino a 12 MB.'); return; }
            generate({mode:'illustration',title:chapter.title,text:row.text,direction,useAvatar:get('[data-avatar]').checked,
                referenceNote:file ? get('[data-ref-note] input').value : ''},file,image=>{
                row.file = image;
                if (row.url) { URL.revokeObjectURL(row.url); urls.delete(row.url); }
                row.url = URL.createObjectURL(image); urls.add(row.url);
                get('[data-picture]').src = row.url; get('[data-picture]').hidden = false;
                get('[data-include]').hidden = false; get('[data-include] input').checked = true;
                get('[data-draw]').textContent = 'Rigenera illustrazione';
            });
        };
    }
    el('[data-write]').onclick = () => {
        const original = source();
        const notes = el('[data-notes]').value.trim();
        const secretNotes = el('[data-secret]').hidden ? '' : el('[data-secret-notes]').value.trim();
        if (!original?.text && !notes && !secretNotes) { status('Inserisci gli appunti da rielaborare.'); el('[data-notes]').focus(); return; }
        const examples = dossierExamples(profile.blocks,original,audience.value,notes);
        generate({mode:'chapter',audience:audience.value,source:original ? {title:original.title,text:original.text} : null,
            notes, secretNotes, examples, ideas:el('[data-ideas]').checked},null,chapters=>{
            clearResults();
            chapters.forEach(chapter=>appendChapter(chapter,original));
            el('[data-apply]').hidden = false;
            results.scrollIntoView({block:'nearest'});
        });
    };
    el('[data-apply]').onclick = () => {
        try {
            const selected = rows.filter(row=>row.keep.checked).map(row=>({id:row.id,title:row.chapter.title,
                text:row.text,audience:row.chapter.audience,image:row.card.querySelector('[data-include] input').checked ? row.file : null}));
            if (!selected.length) return;
            apply(selected); dialog.close();
        } catch (error) { status(error.message); }
    };
    el('[data-close]').onclick = () => dialog.close();
    dialog.addEventListener('cancel',event=>{ if (active) event.preventDefault(); });
    dialog.addEventListener('close',()=>{ clearResults(); dialog.remove(); if(opener?.isConnected) opener.focus(); },{once:true});
    el('[data-name]').textContent = profile.name;
    configure(); document.body.append(dialog); dialog.showModal(); el('[data-notes]').focus();
}
