(function () {
    'use strict';
    window.CriptaAbilityIcons = {open};
    async function open({actor, token, onQueued}) {
        if (document.querySelector('[data-ability-icons]')) return;
        const app = window.CriptaApp, focus = document.activeElement;
        const base = `api/managed-actors/${encodeURIComponent(actor.worldId)}/${encodeURIComponent(actor.actorId)}/ability-icons`;
        const storageKey = `ability-icons:${app.campaigns.currentId()}:${actor.worldId}:${actor.actorId}`;
        let attempts = {}; try { attempts = JSON.parse(sessionStorage.getItem(storageKey)) || {}; } catch (_) { /* Optional storage. */ }
        const saveAttempts = () => { try { sessionStorage.setItem(storageKey, JSON.stringify(attempts)); } catch (_) { /* Optional storage. */ } };
        let data = null, closed = false, busy = false, timer;
        const selected = new Set(), previews = new Map(), controller = new AbortController();
        const dialog = document.createElement('dialog');
        dialog.className = 'npc-avatar-generator npc-ability-icons'; dialog.dataset.abilityIcons = '';
        dialog.setAttribute('aria-labelledby', 'npc-ability-icons-title');
        dialog.innerHTML = `<header><div><small>ICONE DELLE CAPACITÀ</small><h2 id="npc-ability-icons-title">Genera icone abilità</h2></div><button type="button" data-close aria-label="Chiudi">×</button></header>
            <div class="npc-avatar-generator__body"><p data-name></p><p>Sunburst 2.6 · qualità media. L’avatar salvato è il riferimento; nome e descrizione di ciascuna capacità guidano l’immagine.</p>
            <p data-status class="npc-avatar-generator__status" role="status" aria-live="polite">Caricamento…</p><div data-list class="npc-ability-icons__list"></div></div>
            <footer><span>Una chiamata immagini per capacità selezionata. Le icone cambiano solo premendo «Usa icona». Chiudere conserva le anteprime; le generazioni successive non ancora avviate si fermano.</span><div><button type="button" data-refresh>Aggiorna</button><button type="button" data-stop hidden>Interrompi attesa</button><button type="button" data-generate disabled>Genera selezionate</button></div></footer>`;
        document.body.append(dialog);
        const el = selector => dialog.querySelector(selector);
        el('[data-name]').textContent = actor.name || 'NPC';
        const status = (text, error = false) => { el('[data-status]').textContent = text; el('[data-status]').classList.toggle('is-error', error); };
        const request = async (suffix = '', body, itemId) => {
            const url = new URL(app.urls.api(base + suffix)); if (itemId) url.searchParams.set('item', itemId);
            const response = await fetch(url, {method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
                headers: {Authorization: `Bearer ${token}`, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
                ...(body === undefined ? {} : {body: JSON.stringify(body)})});
            if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || 'Impossibile contattare il generatore.'); }
            return response;
        };
        const running = job => ['icon-pending', 'icon-running'].includes(job?.status);
        const jobFor = id => data?.jobs?.find(job => job.itemId === id);
        const controls = () => {
            const active = data?.jobs?.find(running);
            el('[data-generate]').textContent = `Genera selezionate (${selected.size})`;
            el('[data-generate]').disabled = busy || !data?.enabled || !data?.canSync || !data?.hasAvatar || !!active || !selected.size;
            el('[data-refresh]').disabled = busy;
            el('[data-stop]').hidden = !active || !data?.canStop;
        };
        function button(label, action, disabled = false) {
            const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.disabled = disabled; b.addEventListener('click', action); return b;
        }
        async function preview(job) {
            const key = `${job.id}:${job.iconId}`;
            if (!previews.has(key)) {
                const blob = await (await request(`/${job.id}/preview`, undefined, job.itemId)).blob();
                if (closed) return '';
                previews.set(key, URL.createObjectURL(blob));
            }
            return previews.get(key);
        }
        async function render() {
            const list = el('[data-list]'); list.replaceChildren();
            for (const item of data.items) {
                const job = jobFor(item.id), row = document.createElement('article'); row.className = 'npc-ability-icons__row';
                const label = document.createElement('label'), check = document.createElement('input'), name = document.createElement('strong');
                check.type = 'checkbox'; check.checked = selected.has(item.id); check.disabled = busy || item.blocked || running(job);
                check.setAttribute('aria-label', `Seleziona ${item.name}`); check.addEventListener('change', () => { if (check.checked) selected.add(item.id); else selected.delete(item.id); controls(); });
                name.textContent = item.name; label.append(check, name);
                const images = document.createElement('div'); images.className = 'npc-ability-icons__images';
                if (item.img) { const img = document.createElement('img'); img.src = app.utils.resolveImageUrl(item.img); img.alt = 'Icona attuale'; images.append(img); }
                if (job?.iconId) {
                    const img = document.createElement('img'); img.alt = 'Nuova icona'; images.append(img);
                    try { img.src = await preview(job); } catch (error) { status(error.message, true); }
                    if (closed) return;
                }
                const message = document.createElement('p'); message.setAttribute('role', 'status');
                message.textContent = running(job) ? 'Generazione in corso…' : job?.status === 'accepted' ? 'Icona inviata a Foundry.' : job?.status === 'confirming' ? 'Invio da completare: usa lo stesso pulsante per riprendere.' : item.blocked ? 'Modifiche in attesa di Foundry.' : job?.iconError || job?.error || (job?.iconId ? 'Anteprima pronta.' : 'Nessuna anteprima generata.');
                const actions = document.createElement('div'); actions.className = 'npc-ability-icons__actions';
                const locked = busy || !!data.jobs.find(running) || item.blocked || !data.enabled || !data.canSync || !data.hasAvatar;
                actions.append(button(job?.iconId ? 'Rigenera icona' : 'Genera icona', () => generate([item.id]), locked || job?.status === 'confirming'));
                if (job?.iconId && job.status !== 'accepted') actions.append(button(job.status === 'confirming' ? 'Completa invio' : 'Usa icona', () => apply(item.id), busy || running(job) || item.blocked && job.status !== 'confirming'));
                row.append(label, images, message, actions); list.append(row);
            }
            if (!data.items.length) list.textContent = data.canSync ? 'Nessun attacco o capacità disponibile.' : 'Sincronizza la scheda completa da Foundry per generare le icone.';
            controls();
        }
        async function load() {
            data = await (await request()).json();
            if (!closed) {
                if (el('[data-status]').textContent === 'Caricamento…') status(data.enabled && data.canSync && data.hasAvatar ? 'Seleziona le capacità per cui generare un’icona.' : !data.enabled ? 'Generazione immagini non attiva.' : !data.canSync ? 'Sincronizza la scheda completa da Foundry.' : 'Carica e salva un avatar prima di generare le icone.');
                await render();
            }
        }
        async function refresh() {
            clearTimeout(timer);
            try {
                await load();
                if (!closed && !busy && data.jobs.some(running)) timer = setTimeout(refresh, 5000);
            } catch (error) { if (!closed) { status(error.message, true); timer = setTimeout(refresh, 10000); } }
        }
        async function generate(ids) {
            if (busy || closed) return;
            busy = true; clearTimeout(timer); await render();
            try {
                for (let index = 0; index < ids.length && !closed; index++) {
                    const id = ids[index]; attempts[id] ||= crypto.randomUUID(); saveAttempts();
                    status(`Generazione ${index + 1} di ${ids.length}. Puoi chiudere e ritrovare l’anteprima qui.`);
                    const result = await (await request('', {requestId: attempts[id]}, id)).json();
                    delete attempts[id]; saveAttempts();
                    selected.delete(id);
                    await load();
                    while (!closed && running(jobFor(id))) { await new Promise(resolve => setTimeout(resolve, 5000)); if (!closed) await load(); }
                    const completed = jobFor(id);
                    if (completed?.id !== result.job.id || !completed?.iconId || completed.iconError) throw new Error(completed?.iconError || 'Generazione interrotta. Le altre icone non sono state avviate.');
                }
                if (!closed) status('Anteprime pronte. Premi «Usa icona» per applicare quelle che preferisci.');
            } catch (error) { if (!closed) status(error.message, true); }
            finally { busy = false; if (!closed) { await render(); if (data.jobs.some(running)) timer = setTimeout(refresh, 5000); } }
        }
        async function apply(id) {
            if (busy) return;
            busy = true; clearTimeout(timer); const job = jobFor(id); await render();
            try {
                let icon = '';
                if (job.status !== 'confirming') {
                    const img = new Image(); img.src = await preview(job); await img.decode();
                    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512; canvas.getContext('2d').drawImage(img, 0, 0, 512, 512);
                    const encoded = canvas.toDataURL('image/webp', .9);
                    if (!encoded.startsWith('data:image/webp;base64,')) throw new Error('Questo browser non può salvare l’icona WebP.');
                    icon = encoded.split(',')[1];
                }
                const result = await (await request(`/${job.id}/confirm`, {icon, iconId: job.iconId}, id)).json();
                await onQueued?.(result.command); status('Icona inviata. Foundry la applicherà alla prossima sincronizzazione.');
            } catch (error) { if (!closed) status(error.message, true); }
            finally { busy = false; if (!closed) await refresh(); }
        }
        const close = () => { closed = true; clearTimeout(timer); controller.abort(); previews.forEach(url => URL.revokeObjectURL(url)); dialog.close(); dialog.remove(); focus?.focus(); };
        el('[data-close]').addEventListener('click', close);
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        el('[data-refresh]').addEventListener('click', refresh);
        el('[data-generate]').addEventListener('click', () => generate([...selected]));
        el('[data-stop]').addEventListener('click', async () => {
            const job = data.jobs.find(running); if (!job) return;
            try { await request(`/${job.id}/stop`, {attemptId:job.iconAttempt}, job.itemId); status('Attesa interrotta. La chiamata già avviata potrebbe avere un costo.'); if (!busy) await refresh(); }
            catch (error) { if (!closed) status(error.message, true); }
        });
        dialog.showModal(); await refresh();
    }
})();
