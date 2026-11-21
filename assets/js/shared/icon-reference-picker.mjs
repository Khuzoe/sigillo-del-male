const MAX_BYTES = 12 * 1024 * 1024;
const formats = ['image/png', 'image/jpeg', 'image/webp'];

// Uploads are private and content-addressed. Keep just their IDs and captions
// in the draft; the same files can accompany every ability in a batch.
export function mountIconReferences(root, {endpoint, token, initial, storageKey, onBusy}) {
    if (!initial) {
        try { initial = JSON.parse(sessionStorage.getItem(storageKey)); } catch { /* Storage is optional. */ }
    }
    const refs = (Array.isArray(initial) ? initial : []).slice(0, 3).filter(row => row && typeof row.note === 'string' &&
        typeof row.name === 'string' && /^[a-f0-9]{64}\.(png|jpg|webp)$/.test(row.uploadId)).map(row => ({...row}));
    const images = new Map(), controller = new AbortController();
    let locked = false, uploading = false;
    root.classList.add('icon-reference-picker');
    root.innerHTML = `<details><summary>Riferimenti visivi facoltativi <span data-ref-count></span></summary>
        <p>Ogni abilità viene valutata separatamente. L’AI può usare le immagini pertinenti o ignorarle tutte.</p>
        <div data-ref-list></div><button type="button" data-pick>Aggiungi immagini</button>
        <input type="file" multiple accept="image/png,image/jpeg,image/webp" data-files hidden>
        <small>Fino a 3 immagini PNG, JPEG o WebP, 12 MB in totale.</small><small data-feedback role="status"></small></details>`;
    const el = selector => root.querySelector(selector);
    const values = () => refs.map(row => ({...row}));
    const save = () => { try { sessionStorage.setItem(storageKey, JSON.stringify(refs)); } catch { /* The dialog retains the references. */ } };
    function controls() {
        el('[data-ref-count]').textContent = '(' + refs.length + '/3)';
        for (const input of root.querySelectorAll('textarea,button,input')) input.disabled = locked || uploading;
        el('[data-pick]').disabled = locked || uploading || refs.length >= 3;
    }
    async function request(id, file) {
        const url = new URL(endpoint);
        if (id) url.pathname += '/' + id;
        const response = await fetch(url, {method: file ? 'POST' : 'GET', cache: 'no-store',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(file ? 120000 : 30000)]),
            headers: {Authorization: 'Bearer ' + token, ...(file && {'Content-Type': file.type})}, ...(file && {body: file})});
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Riferimento non disponibile.');
        return response;
    }
    const list = el('[data-ref-list]');
    function addRow(ref, localUrl) {
        const article = document.createElement('div'); article.className = 'icon-reference-picker__row';
        const img = document.createElement('img'); img.alt = ref.name;
        const label = document.createElement('label'); label.textContent = ref.name;
        const note = document.createElement('textarea'); note.rows = 2; note.maxLength = 500; note.value = ref.note;
        note.placeholder = 'Cosa mostra e quando può essere utile'; note.setAttribute('aria-label', 'Nota per ' + ref.name);
        note.oninput = () => { ref.note = note.value; save(); }; label.append(note);
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Rimuovi';
        remove.setAttribute('aria-label', 'Rimuovi ' + ref.name);
        remove.onclick = () => {
            refs.splice(refs.indexOf(ref), 1); article.remove();
            const url = images.get(ref); if (url) URL.revokeObjectURL(url);
            images.delete(ref); save(); controls();
        };
        article.append(img, label, remove); list.append(article);
        if (localUrl) { images.set(ref, localUrl); img.src = localUrl; }
        else request(ref.uploadId).then(r => r.blob()).then(blob => {
            if (controller.signal.aborted || !refs.includes(ref)) return;
            const url = URL.createObjectURL(blob); images.set(ref, url); img.src = url;
        }).catch(error => { if (!controller.signal.aborted && refs.includes(ref)) el('[data-feedback]').textContent = error.message; });
    }
    for (const ref of refs) addRow(ref);
    el('[data-pick]').onclick = () => el('[data-files]').click();
    el('[data-files]').onchange = async event => {
        const files = Array.from(event.target.files); event.target.value = '';
        if (!files.length || locked || uploading) return;
        uploading = true; controls(); onBusy?.(true);
        try {
            if (refs.length + files.length > 3) throw new Error('Scegli al massimo tre immagini in totale.');
            if (files.some(file => !formats.includes(file.type) || !file.size)) throw new Error('Scegli immagini PNG, JPEG o WebP.');
            if ([...refs, ...files].reduce((sum, file) => sum + file.size, 0) > MAX_BYTES) throw new Error('Le immagini superano i 12 MB complessivi.');
            for (const file of files) {
                el('[data-feedback]').textContent = 'Caricamento di ' + file.name + '…';
                const url = URL.createObjectURL(file);
                try {
                    const img = new Image(); img.src = url;
                    try { await img.decode(); } catch { throw new Error('Impossibile leggere l’immagine ' + file.name + '.'); }
                    const {uploadId} = await (await request('', file)).json();
                    if (typeof uploadId !== 'string' || !/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(uploadId)) throw new Error('Caricamento non confermato.');
                    if (refs.some(r => r.uploadId === uploadId)) throw new Error('Questa immagine è già presente.');
                    controller.signal.throwIfAborted();
                    const ref = {uploadId, note: '', name: file.name.slice(0, 180), size: file.size};
                    refs.push(ref); addRow(ref, url); save();
                } catch (error) { URL.revokeObjectURL(url); throw error; }
            }
            el('[data-feedback]').textContent = '';
        } catch (error) { if (!controller.signal.aborted) el('[data-feedback]').textContent = error.message; }
        finally { uploading = false; if (!controller.signal.aborted) { controls(); onBusy?.(false); } }
    };
    controls();
    return {values, setLocked(value) { locked = value; controls(); },
        close() { controller.abort(); images.forEach(url => URL.revokeObjectURL(url)); images.clear(); }};
}
