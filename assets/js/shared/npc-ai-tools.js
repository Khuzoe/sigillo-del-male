(function () {
    'use strict';
    const groups = [
        { id: 'dossier', name: 'Dossier', tools: [
            { id: 'dossier', name: 'Da appunti a dossier', icon: 'fa-book-open', description: 'Organizza gli appunti in capitoli o rivedi un capitolo esistente.' }
        ] },
        { id: 'images', name: 'Immagini', tools: [
            { id: 'avatar', name: 'Genera avatar', icon: 'fa-image-portrait', description: 'Crea una nuova immagine a partire dall’avatar attuale.', needsAvatar: true },
            { id: 'token', name: 'Genera token', icon: 'fa-chess-pawn', description: 'Dall’avatar crea un ritratto circolare con esterno trasparente.', needsAvatar: true },
            { id: 'card', name: 'Genera card', icon: 'fa-id-card', description: 'Crea una fascia panoramica per Foundry dall’avatar e dal nome del personaggio.', needsAvatar: true },
            { id: 'poses', name: 'Genera pose idle e hover', icon: 'fa-person-rays', description: 'Anima il ritratto nella lista NPC. Puoi partire dall’idle già presente.' },
            { id: 'icons', name: 'Genera icone abilità', icon: 'fa-images', description: 'Scegli le capacità e prepara le loro icone.', needsAvatar: true }
        ] },
        { id: 'abilities', name: 'Abilità', tools: [
            { id: 'translate-abilities', name: 'Traduci abilità', icon: 'fa-language', description: 'Traduci in italiano nomi e descrizioni, conservando le regole.' },
            { id: 'create-ability', name: 'Crea abilità', icon: 'fa-burst', description: 'Descrivi un nuovo attacco, incantesimo o tratto.' },
            { id: 'edit-ability', name: 'Modifica abilità', icon: 'fa-pen-to-square', description: 'Scegli una capacità esistente e descrivi cosa cambiare.' }
        ] },
        { id: 'sheet', name: 'Scheda NPC', tools: [
            { id: 'sheet', name: 'Modifica scheda NPC', icon: 'fa-scroll', description: 'Modifica statistiche, capacità ed effetti, oppure traduci la scheda.' },
            { id: 'suggestions', name: 'Suggerisci miglioramenti', icon: 'fa-lightbulb', description: 'Consulta l’analisi salvata o trova nuove idee da avatar e scheda.' }
        ] },
        { id: 'loot', name: 'Bottino', tools: [
            { id: 'drop', name: 'Genera bottino', icon: 'fa-gem', description: 'Prepara oggetti e ricompense per questo NPC.' }
        ] }
    ];
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('it');
    const abilityTypes = { feat: 'Capacità', weapon: 'Attacco', spell: 'Incantesimo' };
    function toolsFor(actor, { unsaved = false, saving = false, canWriteDossier = false } = {}) {
        const npcEditor = actor?.actorType === 'npc' && actor.permissions?.isEditor === true;
        const playerTools = ['character', 'player'].includes(actor?.actorType) && (actor.permissions?.isOwner === true || actor.permissions?.isEditor === true);
        if (!npcEditor && !playerTools && !canWriteDossier) return [];
        const pendingSheet = actor.sync?.commands?.some(command => command.nativeSheetVersion && command.status === 'pending');
        const abilities = (actor.definition?.items || []).filter(item => item.itemId && abilityTypes[item.type]);
        return groups.map(group => ({ ...group, tools: group.tools.filter(tool => tool.id === 'dossier' ? canWriteDossier : npcEditor || (playerTools && ['avatar', 'token', 'card', 'icons', 'translate-abilities'].includes(tool.id))).map(tool => ({ ...tool,
            reason: saving ? 'Attendi il completamento del salvataggio.' : tool.id === 'dossier' ? '' : unsaved ? 'Salva o annulla prima le modifiche alla scheda.'
                : pendingSheet && !['avatar', 'token', 'card', 'poses', 'drop'].includes(tool.id) ? 'Modifica della scheda in attesa di Foundry.'
                : tool.needsAvatar && !actor.media?.avatar?.path ? 'Carica e salva prima un avatar nella sezione Media.'
                : tool.id === 'edit-ability' && !abilities.length ? 'Nessuna capacità disponibile da modificare.' : ''
        })) })).filter(group => group.tools.length);
    }
    function abilityChoices(actor, query = '', blockedItemIds = []) {
        const terms = normalize(query).split(/\s+/).filter(Boolean), blocked = new Set(blockedItemIds);
        return (actor.definition?.items || []).filter(item => item.itemId && abilityTypes[item.type])
            .filter(item => terms.every(term => normalize(`${item.name} ${abilityTypes[item.type]}`).includes(term)))
            .map(item => ({ id: item.itemId, name: item.name || 'Capacità', type: abilityTypes[item.type], blocked: blocked.has(item.itemId) }))
            .sort((a, b) => a.name.localeCompare(b.name, 'it', { numeric: true, sensitivity: 'base' }));
    }
    function open(options) {
        const { actor, onAction, blockedItemIds = [], error = '' } = options;
        const catalog = toolsFor(actor, options);
        if (!catalog.length || document.querySelector('[data-npc-ai-tools]')) return;
        const allTools = catalog.flatMap(group => group.tools), firstReason = allTools[0].reason;
        const commonReason = firstReason && allTools.every(tool => tool.reason === firstReason) ? firstReason : '';
        const focus = document.activeElement, dialog = document.createElement('dialog');
        dialog.className = 'npc-avatar-generator npc-ai-tools'; dialog.dataset.npcAiTools = '';
        dialog.setAttribute('aria-labelledby', 'npc-ai-tools-title');
        dialog.innerHTML = `<header><div><small data-ai-actor></small><h2 id="npc-ai-tools-title">Strumenti AI</h2></div><button type="button" data-close aria-label="Chiudi strumenti AI">×</button></header>
            <div class="npc-avatar-generator__body"><p class="npc-ai-tools__intro">Scegli uno strumento per questo personaggio.</p><p id="npc-ai-tools-notice" data-ai-notice role="status" hidden></p><p data-ai-error role="alert" hidden></p>
            <div data-ai-catalog class="npc-ai-tools__catalog"></div>
            <section data-ai-abilities hidden><button type="button" data-ai-back class="npc-ai-tools__back">← Tutti gli strumenti</button><h3>Quale abilità vuoi modificare?</h3><label class="npc-ai-tools__search">Cerca abilità<input type="search" data-ai-search placeholder="Nome o tipo di capacità" autocomplete="off"></label><div data-ai-ability-list class="npc-ai-tools__ability-list"></div></section></div>
            <footer><span>Ogni strumento ti permette di rivedere la proposta prima di applicarla.</span><button type="button" data-ai-done>Chiudi</button></footer>`;
        const el = selector => dialog.querySelector(selector);
        el('[data-ai-actor]').textContent = actor.name || 'Personaggio';
        el('[data-ai-notice]').hidden = !commonReason; el('[data-ai-notice]').textContent = commonReason;
        el('[data-ai-error]').hidden = !error; el('[data-ai-error]').textContent = error;
        let closed = false;
        function close() { if (closed) return; closed = true; dialog.close(); dialog.remove(); if (focus?.isConnected) focus.focus(); }
        async function launch(action, item) {
            close();
            try { await onAction(action, item); }
            catch (failure) { if (focus?.isConnected) open({ ...options, error: failure.message || 'Impossibile aprire lo strumento. Riprova.' }); }
        }
        function renderAbilities() {
            const root = el('[data-ai-ability-list]'); root.replaceChildren();
            const choices = abilityChoices(actor, el('[data-ai-search]').value, blockedItemIds);
            for (const item of choices) {
                const button = document.createElement('button'), name = document.createElement('strong'), detail = document.createElement('span');
                button.type = 'button'; button.disabled = item.blocked;
                name.textContent = item.name; detail.textContent = item.blocked ? `${item.type} · Modifiche in attesa di Foundry` : item.type;
                button.append(name, detail); button.addEventListener('click', () => launch('edit-ability', { id: item.id, name: item.name })); root.append(button);
            }
            if (!choices.length) { const empty = document.createElement('p'); empty.textContent = 'Nessuna capacità corrisponde alla ricerca.'; root.append(empty); }
        }
        for (const group of catalog) {
            const section = document.createElement('section'), heading = document.createElement('h3'), list = document.createElement('div');
            heading.textContent = group.name; list.className = 'npc-ai-tools__grid';
            for (const tool of group.tools) {
                const button = document.createElement('button'), icon = document.createElement('i'), content = document.createElement('span'), name = document.createElement('strong'), description = document.createElement('span');
                button.type = 'button'; button.className = 'npc-ai-tools__tool'; button.dataset.aiTool = tool.id; button.disabled = Boolean(tool.reason);
                if (commonReason) button.setAttribute('aria-describedby', 'npc-ai-tools-notice');
                icon.className = `fas ${tool.icon}`; icon.setAttribute('aria-hidden', 'true'); name.textContent = tool.name; description.textContent = tool.description;
                content.append(name, description);
                if (tool.reason && !commonReason) { const reason = document.createElement('em'); reason.textContent = tool.reason; content.append(reason); }
                button.append(icon, content); button.addEventListener('click', () => {
                    if (tool.id !== 'edit-ability') { launch(tool.id); return; }
                    el('[data-ai-catalog]').hidden = true; el('[data-ai-abilities]').hidden = false; renderAbilities(); el('[data-ai-search]').focus();
                }); list.append(button);
            }
            section.append(heading, list); el('[data-ai-catalog]').append(section);
        }
        el('[data-ai-back]').addEventListener('click', () => { el('[data-ai-abilities]').hidden = true; el('[data-ai-catalog]').hidden = false; el('[data-ai-tool="edit-ability"]').focus(); });
        el('[data-ai-search]').addEventListener('input', renderAbilities);
        el('[data-close]').addEventListener('click', close); el('[data-ai-done]').addEventListener('click', close);
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        document.body.append(dialog); dialog.showModal();
        return { close };
    }
    window.CriptaNpcAiTools = { open, toolsFor, abilityChoices };
})();
