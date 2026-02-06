/* MAPPA IMMAGINI (Cache) */
        const characterImages = {};

        // Funzione helper per parsare YAML (molto semplificata, solo per estrarre immagini)
        function extractImagesFromYaml(yamlText) {
            const avatarMatch = yamlText.match(/avatar:\s*["']?([^"'\n]+)["']?/);
            return avatarMatch ? avatarMatch[1] : null;
        }
        function isHiddenFromYaml(yamlText) {
            return /hidden:\s*true/i.test(yamlText || '');
        }

        // Carica dati giocatori e NPC per le immagini
        async function loadCharacterAssets() {
            try {
                // 1. Carica Players
                const respPlayers = await fetch('../assets/data/players.json');
                if (respPlayers.ok) {
                    const players = await respPlayers.json();
                    players.forEach(p => {
                        if (p.images && p.images.avatar) {
                            characterImages[p.id] = p.images.avatar;
                        }
                    });
                }

                // 2. Carica NPC (dall'index)
                // Nota: In produzione sarebbe meglio un singolo file JSON generato.
                // Qui facciamo fetch multiple ma sono pochi file.
                const respIndex = await fetch('../assets/data/characters/index.yaml');
                if (respIndex.ok) {
                    const text = await respIndex.text();
                    // Parsing brutale dell'index YAML per trovare i file
                    const lines = text.split('\n');
                    const entries = [];
                    let currentId = null;

                    for (let line of lines) {
                        const idMatch = line.match(/- id:\s*["']?([^"']+)["']?/);
                        if (idMatch) currentId = idMatch[1];
                        const fileMatch = line.match(/file:\s*["']?([^"']+)["']?/);
                        if (currentId && fileMatch) {
                            entries.push({ id: currentId, file: fileMatch[1] });
                            currentId = null;
                        }
                    }

                    // Fetch parallelo dei singoli file NPC
                    await Promise.all(entries.map(async (entry) => {
                        try {
                            const r = await fetch(`../assets/data/${entry.file}`);
                            if (r.ok) {
                                const t = await r.text();
                                if (window.WikiSpoiler && !window.WikiSpoiler.allowSpoilers() && isHiddenFromYaml(t)) {
                                    return;
                                }
                                const img = extractImagesFromYaml(t);
                                if (img) characterImages[entry.id] = img;
                            }
                        } catch (e) { console.warn("Failed to load generic NPC", entry.id); }
                    }));
                }

            } catch (e) {
                console.warn("Errore caricamento assets personaggi:", e);
            }
        }

        function resolveImagePath(path) {
            if (!path) return '';
            if (path.startsWith('http') || path.startsWith('data:')) return path;
            return `../assets/${path}`;
        }

        // Script per l'apertura/chiusura a fisarmonica (Accordion)
        function toggleQuest(header) {
            const card = header.parentElement;
            const body = card.querySelector('.quest-body');
            const isExpanded = card.classList.contains('expanded');

            if (isExpanded) {
                // Chiudi
                body.style.maxHeight = body.scrollHeight + 'px'; // Imposta altezza fissa prima di chiudere per transizione fluida
                requestAnimationFrame(() => {
                    body.style.maxHeight = '0px';
                    card.classList.remove('expanded');
                });
            } else {
                // Apri
                card.classList.add('expanded');
                body.style.maxHeight = body.scrollHeight + 'px';

                // Rimuovi max-height alla fine della transizione per permettere resize dinamico
                setTimeout(() => {
                    if (card.classList.contains('expanded')) {
                        body.style.maxHeight = 'none';
                    }
                }, 500);
            }
        }

        // Renderizza una subquest (o un obiettivo semplice)
        function createObjectiveHtml(quest) {
            if (window.WikiSpoiler && !window.WikiSpoiler.isVisible(quest)) return '';
            if (!window.WikiSpoiler && quest.status === 'hidden') return '';

            const isDone = quest.status === 'completed';
            const hasSubquests = quest.subquests && quest.subquests.length > 0;

            // Icona specifica personaggio
            let charIconHtml = '';
            if (quest.character_specific && characterImages[quest.character_specific]) {
                const imgPath = resolveImagePath(characterImages[quest.character_specific]);
                charIconHtml = `<img src="${imgPath}" class="quest-char-icon-small" title="Esclusiva per ${quest.character_specific}" alt="${quest.character_specific}">`;
            }

            let html = `
                <li class="objective-item ${isDone ? 'done' : ''} ${hasSubquests ? 'has-subquests' : ''}">
                    ${hasSubquests ? '' : '<div class="custom-checkbox"></div>'}
                    <div class="objective-content">
                        <span class="objective-text">
                            ${charIconHtml}
                            ${quest.title}
                        </span>
            `;

            if (quest.rewards) {
                html += `<div class="objective-reward"><i class="fas fa-gift"></i> ${quest.rewards}</div>`;
            }

            if (hasSubquests) {
                html += '<ul class="subquest-list">';
                quest.subquests.forEach(sub => {
                    html += createObjectiveHtml(sub);
                });
                html += '</ul>';
            }

            html += `
                    </div>
                </li>
            `;
            return html;
        }

        // Funzione per generare l'HTML di una singola card (Gruppo di Quest)
        function createQuestGroupCard(group) {
            if (window.WikiSpoiler && !window.WikiSpoiler.isVisible(group)) return null;
            // Filtra quest nascoste per il conteggio
            const visibleQuests = (group.quests || []).filter(q =>
                window.WikiSpoiler ? window.WikiSpoiler.isVisible(q) : q.status !== 'hidden'
            );
            if (visibleQuests.length === 0 && group.quests.length > 0) return null;

            const total = visibleQuests.length;
            const completed = visibleQuests.filter(q => q.status === 'completed').length;
            const progress = total > 0 ? (completed / total) * 100 : 0;

            let groupStatus = 'active';
            if (total > 0 && completed === total) groupStatus = 'completed';

            const objectivesHtml = visibleQuests.map(q => createObjectiveHtml(q)).join('');

            const statusMap = {
                active: { text: 'In Corso', class: 'status-active' },
                completed: { text: 'Completata', class: 'status-completed' },
                failed: { text: 'Fallita', class: 'status-failed' }
            };
            const statusInfo = statusMap[groupStatus] || { text: 'Ignoto', class: '' };

            // NPC Avatar Logic
            let npcAvatarHtml = '';
            if (group.npc_id && characterImages[group.npc_id]) {
                npcAvatarHtml = `
                    <div class="quest-npc-avatar">
                        <img src="${resolveImagePath(characterImages[group.npc_id])}" alt="${group.title}">
                    </div>
                `;
            }

            const card = document.createElement('div');
            card.className = `quest-card ${groupStatus} expanded`;
            card.innerHTML = `
                <div class="quest-header" onclick="toggleQuest(this)">
                    ${npcAvatarHtml}
                    <div class="quest-title-group">
                        <h3 class="text-gold-gradient">${group.title}</h3>
                        ${group.npc_id ? `<span class="quest-type">Incarichi di ${group.title}</span>` : ''}
                    </div>
                    <div class="mini-progress"><div class="mini-bar" style="width: ${progress}%;"></div></div>
                    <span class="quest-status ${statusInfo.class}">${statusInfo.text}</span>
                    <i class="fas fa-chevron-down expand-icon"></i>
                </div>
                <div class="quest-body" style="display: block;"> 
                    <div class="quest-content">
                        <ul class="objective-list">${objectivesHtml}</ul>
                    </div>
                </div>
            `;
            return card;
        }

        // Caricamento e renderizzazione delle missioni
        document.addEventListener("DOMContentLoaded", async function () {
            try {
                // 1. Preload images
                await loadCharacterAssets();

                // 2. Load Quests
                const response = await fetch('../assets/data/quests.json');
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const groups = await response.json();

                const mainContainer = document.getElementById('main-quests-container');
                const secondaryContainer = document.getElementById('secondary-quests-container');

                groups.forEach(group => {
                    const card = createQuestGroupCard(group);
                    if (!card) return;

                    if (group.id === 'main_quest') {
                        mainContainer.appendChild(card);
                    } else {
                        secondaryContainer.appendChild(card);
                    }
                });

            } catch (error) {
                console.error("Errore nel caricamento delle missioni:", error);
                const container = document.getElementById('main-quests-container');
                container.innerHTML = '<p style="color: var(--red);">Impossibile caricare il registro delle imprese.</p>';
            }
        });
