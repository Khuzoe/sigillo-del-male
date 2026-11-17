(function () {
    'use strict';
    window.CriptaAbilityTranslations = { open };
    const running = job => ['pending', 'running'].includes(job?.status);
    const readable = value => String(value || '').replace(/<\/(?:p|div|li|h[1-6])>|<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('it');
    async function open({ actor, token, onQueued }) {
        if (document.querySelector('[data-ability-translations]')) return;
        const app = window.CriptaApp, focus = document.activeElement, controller = new AbortController();
        const base = `api/managed-actors/${encodeURIComponent(actor.worldId)}/${encodeURIComponent(actor.actorId)}/ability-translations`;
        const key = `ability-translations:${app.campaigns.currentId()}:${actor.worldId}:${actor.actorId}`;
        let attempts = {}; try { attempts = JSON.parse(sessionStorage.getItem(key)) || {}; } catch { /* Optional storage. */ }
        const saveAttempts = () => { try { sessionStorage.setItem(key, JSON.stringify(attempts)); } catch { /* Optional storage. */ } };
        let data, closed = false, busy = false, timer;
        const selected = new Set(), dialog = document.createElement('dialog');
        dialog.className = 'npc-avatar-generator ability-translations'; dialog.dataset.abilityTranslations = '';
        dialog.setAttribute('aria-labelledby', 'ability-translations-title');
        dialog.innerHTML = `<header><div><small data-actor></small><h2 id="ability-translations-title">Traduci abilità</h2></div><button type="button" data-close aria-label="Chiudi traduzioni">×</button></header>
            <div class="npc-avatar-generator__body"><p>Traduci in italiano attacchi, capacità e incantesimi. Rivedi nome e descrizione prima di applicarli.</p>
            <p data-status class="npc-avatar-generator__status" role="status" aria-live="polite">Caricamento.</p>
            <label class="ability-translations__search">Cerca abilità<input type="search" data-search placeholder="Nome della capacità" autocomplete="off"></label>
            <div class="npc-ability-icons__selection" role="group" aria-label="Selezione abilità"><span data-selection role="status"></span><div><button type="button" data-select-all disabled>Seleziona tutte le visibili</button><button type="button" data-select-none disabled>Deseleziona tutto</button></div></div>
            <div data-list class="npc-ability-icons__list"></div></div>
            <footer><span>Una richiesta AI per abilità selezionata. Si aggiornano solo nome e descrizione, dopo la tua conferma. Chiudere conserva le proposte già avviate.</span><div><button type="button" data-refresh>Aggiorna</button><button type="button" data-stop hidden>Interrompi attesa</button><button type="button" data-generate disabled>Traduci selezionate</button></div></footer>`;
        const el = selector => dialog.querySelector(selector);
        el('[data-actor]').textContent = actor.name || 'Personaggio';
        const status = (message, error = false) => { el('[data-status]').textContent = message; el('[data-status]').classList.toggle('is-error', error); };
        const request = async (suffix = '', body, itemId) => {
            const url = new URL(app.urls.api(base + suffix)); if (itemId) url.searchParams.set('item', itemId);
            const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
                headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Traduzione non disponibile.'); return result;
        };
        const jobFor = id => data?.jobs?.find(job => job.itemId === id);
        const visible = () => (data?.items || []).filter(item => normalize(item.name).includes(normalize(el('[data-search]').value)));
        const eligible = item => !item.blocked && !running(jobFor(item.id)) && jobFor(item.id)?.status !== 'confirming';
        function controls() {
            const active = data?.jobs?.find(running), available = visible().filter(eligible);
            el('[data-select-all]').disabled = busy || !available.length || available.every(item => selected.has(item.id));
            el('[data-select-none]').disabled = busy || !selected.size;
            el('[data-selection]').textContent = `${selected.size} selezionate · ${visible().length} visibili`;
            el('[data-generate]').textContent = `Traduci selezionate (${selected.size})`;
            el('[data-generate]').disabled = busy || !data?.enabled || !data?.canSync || !!active || !selected.size;
            el('[data-refresh]').disabled = busy;
            el('[data-stop]').hidden = !active || !data?.canStop;
        }
        function button(label, action, disabled) {
            const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.disabled = Boolean(disabled); node.addEventListener('click', action); return node;
        }
        function comparison(title, name, description) {
            const section = document.createElement('section'), heading = document.createElement('h4'), label = document.createElement('strong'), text = document.createElement('p');
            heading.textContent = title; label.textContent = name; text.textContent = readable(description); section.append(heading, label, text); return section;
        }
        function render() {
            if (!data || closed) return;
            const list = el('[data-list]'); list.replaceChildren();
            for (const id of selected) if (!data.items.some(item => item.id === id && eligible(item))) selected.delete(id);
            for (const item of visible()) {
                const job = jobFor(item.id), row = document.createElement('article'), label = document.createElement('label'), check = document.createElement('input'), name = document.createElement('strong');
                row.className = 'ability-translations__row npc-ability-icons__row'; check.type = 'checkbox'; check.dataset.itemId = item.id;
                check.checked = selected.has(item.id); check.disabled = busy || !eligible(item); check.setAttribute('aria-label', `Seleziona ${item.name}`);
                check.addEventListener('change', () => { if (check.checked) selected.add(item.id); else selected.delete(item.id); controls(); });
                name.textContent = item.name; label.append(check, name); row.append(label);
                const detail = document.createElement('details'), summary = document.createElement('summary'), columns = document.createElement('div');
                summary.textContent = job?.draft ? 'Confronta originale e traduzione' : 'Leggi il testo originale'; detail.open = Boolean(job?.draft && job.status !== 'accepted');
                columns.className = 'ability-translations__comparison'; columns.append(comparison('Originale', item.name, item.description));
                if (job?.draft) columns.append(comparison('Proposta in italiano', job.draft.name, job.draft.description));
                detail.append(summary, columns); row.append(detail);
                const message = document.createElement('p'); message.setAttribute('role', 'status');
                const unchanged = job?.draft && job.draft.name === item.name && job.draft.description === item.description;
                message.textContent = running(job) ? 'Traduzione in corso.' : job?.status === 'accepted' ? 'Traduzione inviata a Foundry.' : job?.status === 'confirming' ? 'Invio da completare.' : item.blocked ? 'Modifiche in attesa di Foundry.' : job?.error || (unchanged ? 'Il testo è già in italiano: nessuna modifica proposta.' : job?.draft ? 'Proposta pronta: controlla il confronto.' : 'Nessuna traduzione generata.');
                const actions = document.createElement('div'); actions.className = 'npc-ability-icons__actions';
                actions.append(button(job?.draft ? 'Ritraduci' : 'Traduci in italiano', () => generate([item.id]), busy || !data.enabled || !data.canSync || !eligible(item) || data.jobs.some(running)));
                if (job?.draft && job.status !== 'accepted' && !unchanged) actions.append(button(job.status === 'confirming' ? 'Completa invio' : 'Applica traduzione', () => apply(item.id), busy || running(job) || item.blocked && job.status !== 'confirming'));
                row.append(message, actions); list.append(row);
            }
            if (!visible().length) list.textContent = 'Nessuna capacità corrisponde alla ricerca.';
            controls();
        }
        async function load() { data = await request(); render(); }
        async function refresh() {
            clearTimeout(timer);
            try {
                await load();
                if (!closed && !busy && data.jobs.some(running)) timer = setTimeout(refresh, 5000);
            } catch (error) { if (!closed) status(error.message, true); }
        }
        async function generate(ids) {
            if (busy || closed) return;
            busy = true; clearTimeout(timer); render();
            try {
                for (let index = 0; index < ids.length && !closed; index++) {
                    const id = ids[index]; attempts[id] ||= crypto.randomUUID(); saveAttempts();
                    status(`Traduzione ${index + 1} di ${ids.length}. Puoi chiudere e ritrovare qui la proposta.`);
                    const result = await request('', { requestId: attempts[id] }, id);
                    delete attempts[id]; saveAttempts(); selected.delete(id); await load();
                    while (!closed && running(jobFor(id))) { await new Promise(resolve => setTimeout(resolve, 5000)); if (!closed) await load(); }
                    const job = jobFor(id);
                    if (closed) return;
                    if (job?.id !== result.job.id || job.status !== 'ready' || !job.draft) throw new Error(job?.error || 'Traduzione interrotta. Le altre richieste non sono state avviate.');
                }
                if (!closed) status('Proposte pronte. Rivedi il confronto e applica le traduzioni che vuoi conservare.');
            } catch (error) { if (!closed) status(error.message, true); }
            finally { busy = false; if (!closed) { render(); if (data?.jobs.some(running)) timer = setTimeout(refresh, 5000); } }
        }
        async function apply(id) {
            if (busy || closed) return;
            busy = true; clearTimeout(timer); const job = jobFor(id); render();
            try { const result = await request(`/${job.id}/confirm`, {}, id); await onQueued?.(result.command); status('Traduzione inviata. Foundry la applicherà alla prossima sincronizzazione.'); }
            catch (error) { if (!closed) status(error.message, true); }
            finally { busy = false; if (!closed) await refresh(); }
        }
        function close() { closed = true; clearTimeout(timer); controller.abort(); dialog.close(); dialog.remove(); if (focus?.isConnected) focus.focus(); }
        el('[data-close]').addEventListener('click', close); dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        el('[data-search]').addEventListener('input', render); el('[data-refresh]').addEventListener('click', refresh);
        el('[data-select-all]').addEventListener('click', () => { for (const item of visible().filter(eligible)) selected.add(item.id); render(); });
        el('[data-select-none]').addEventListener('click', () => { selected.clear(); render(); });
        el('[data-generate]').addEventListener('click', () => generate([...selected]));
        el('[data-stop]').addEventListener('click', async () => {
            const job = data.jobs.find(running); if (!job) return;
            try { await request(`/${job.id}/stop`, { attemptId: job.id }, job.itemId); status('Attesa interrotta. La richiesta già avviata potrebbe avere un costo.'); if (!busy) await refresh(); }
            catch (error) { if (!closed) status(error.message, true); }
        });
        document.body.append(dialog); dialog.showModal(); await refresh();
        if (data && !closed) status(!data.enabled ? 'Traduzione AI non attiva.' : !data.canSync ? 'Sincronizza la scheda da Foundry.' : 'Seleziona le abilità da tradurre in italiano.');
    }
})();
