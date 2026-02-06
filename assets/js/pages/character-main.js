function parseYamlLite(yamlText) {
            const text = yamlText.replace(/^\uFEFF/, '');
            const lines = text.split(/\r?\n/);

            const firstNonEmpty = lines.find(l => {
                const t = l.trim();
                return t !== '' && !t.startsWith('#');
            });
            const isArrayRoot = firstNonEmpty ? firstNonEmpty.trim().startsWith('- ') : true;

            const root = isArrayRoot ? [] : {};
            const stack = [{ type: isArrayRoot ? 'array' : 'object', value: root, indent: -1 }];

            const parseScalar = (v) => {
                const val = v.trim();
                if (val === '[]') return [];
                if (val === '{}') return {};
                if (val === 'null') return null;
                if (val === 'true' || val === 'false') return val === 'true';
                if (/^-?\d+(\.\d+)?$/.test(val)) return Number(val);
                if (val.startsWith('"') && val.endsWith('"')) {
                    try { return JSON.parse(val); } catch (_) { return val.slice(1, -1); }
                }
                if (val.startsWith('\'') && val.endsWith('\'')) return val.slice(1, -1);
                if (val.startsWith('- ')) return [parseScalar(val.slice(2))];
                return val;
            };

            const nextNonEmpty = (idx) => {
                for (let i = idx + 1; i < lines.length; i++) {
                    const raw = lines[i];
                    const trimmed = raw.trim();
                    if (trimmed === '' || trimmed.startsWith('#')) continue;
                    const indent = raw.match(/^ */)[0].length;
                    return { indent, trimmed };
                }
                return null;
            };

            lines.forEach((raw, idx) => {
                const trimmed = raw.trim();
                if (trimmed === '' || trimmed.startsWith('#')) return;
                const indent = raw.match(/^ */)[0].length;
                while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
                    stack.pop();
                }
                const parent = stack[stack.length - 1];

                if (trimmed.startsWith('- ')) {
                    if (parent.type !== 'array') throw new Error('YAML: elemento lista fuori contesto');
                    const entryText = trimmed.slice(2).trim();
                    let item;
                    let pushItem = false;

                    if (entryText === '') {
                        item = {};
                        pushItem = true;
                    } else {
                        const m = entryText.match(/^([^:]+):\s*(.*)$/);
                        if (m) {
                            const key = m[1].trim();
                            const valStr = m[2];
                            item = {};
                            if (valStr === '') {
                                const next = nextNonEmpty(idx);
                                const container = next && next.indent > indent && next.trimmed.startsWith('-') ? [] : {};
                                item[key] = container;
                                pushItem = true;
                                stack.push({ type: Array.isArray(container) ? 'array' : 'object', value: container, indent });
                            } else {
                                item[key] = parseScalar(valStr);
                                pushItem = true;
                            }
                        } else {
                            item = parseScalar(entryText);
                        }
                    }
                    parent.value.push(item);
                    if (pushItem && typeof item === 'object' && item !== null && !Array.isArray(item)) {
                        stack.push({ type: 'object', value: item, indent });
                    }
                    return;
                }

                if (parent.type !== 'object') throw new Error('YAML: chiave fuori contesto');
                const match = trimmed.match(/^([^:]+):\s*(.*)$/);
                if (!match) throw new Error('YAML: riga non valida');
                const key = match[1].trim();
                const valStr = match[2];

                if (valStr === '') {
                    const next = nextNonEmpty(idx);
                    const container = next && next.indent > indent && next.trimmed.startsWith('-') ? [] : {};
                    parent.value[key] = container;
                    stack.push({ type: Array.isArray(container) ? 'array' : 'object', value: container, indent });
                } else {
                    const value = parseScalar(valStr);
                    parent.value[key] = value;
                    if (typeof value === 'object' && value !== null) {
                        stack.push({ type: Array.isArray(value) ? 'array' : 'object', value, indent });
                    }
                }
            });

            return root;
        }

        function renderMarkdown(md, options = {}) {
            const context = options.context || null;
            if (!md) return '';
            const inline = (text) => {
                const escaped = text
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                return escaped
                    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\*(.+?)\*/g, '<em>$1</em>')
                    .replace(/`(.+?)`/g, '<code>$1</code>');
            };

            const lines = md.replace(/\r\n?/g, '\n').split('\n');
            const out = [];
            let i = 0;
            while (i < lines.length) {
                if (/^\s*$/.test(lines[i])) { i++; continue; }

                // Subtitle as a single italic line at start (image_box, etc.)
                if (context === 'image_box' && i === 0) {
                    const m = lines[i].trim().match(/^\*(.+)\*$/);
                    if (m) {
                        out.push(`<p class="doc-subtitle">${inline(m[1])}</p>`);
                        i++; continue;
                    }
                }

                if (/^###\s+/.test(lines[i])) {
                    out.push(`<h4 class="doc-heading">${inline(lines[i].replace(/^###\s+/, ''))}</h4>`);
                    i++; continue;
                }
                if (/^##\s+/.test(lines[i])) {
                    out.push(`<h3 class="doc-heading">${inline(lines[i].replace(/^##\s+/, ''))}</h3>`);
                    i++; continue;
                }
                if (/^#\s+/.test(lines[i])) {
                    out.push(`<h2 class="doc-heading">${inline(lines[i].replace(/^#\s+/, ''))}</h2>`);
                    i++; continue;
                }

                if (/^>\s?/.test(lines[i])) {
                    const quote = [];
                    while (i < lines.length && /^>\s?/.test(lines[i])) {
                        quote.push(lines[i].replace(/^>\s?/, ''));
                        i++;
                    }
                    const rawQuote = quote.join('\n').trim();
                    const quoteText = inline(rawQuote).replace(/\n/g, '<br>');
                    out.push(`<div class="document-quote"><i class="fas fa-feather-alt"></i><span>${quoteText}</span></div>`);
                    continue;
                }

                if (/^- /.test(lines[i])) {
                    const items = [];
                    while (i < lines.length && /^- /.test(lines[i])) {
                        items.push(lines[i].replace(/^- /, ''));
                        i++;
                    }
                    const lis = items.map(t => `<li>${inline(t)}</li>`).join('');
                    out.push(`<ul class="doc-list">${lis}</ul>`);
                    continue;
                }

                const para = [];
                while (i < lines.length && !/^\s*$/.test(lines[i])) {
                    para.push(lines[i]);
                    i++;
                }
                const paraClass = context === 'image_box' ? ' class="doc-paragraph"' : '';
                out.push(`<p${paraClass}>${inline(para.join(' '))}</p>`);
            }
            return out.join('\n');
        }

        async function loadCharactersManifest() {
            const yamlUrl = '../../assets/data/characters/index.yaml';
            try {
                const resp = await fetch(yamlUrl);
                if (resp.ok) {
                    const text = await resp.text();
                    const parsed = parseYamlLite(text);
                    if (Array.isArray(parsed)) return parsed;
                }
            } catch (err) {
                console.warn('Impossibile leggere manifest YAML, provo JSON:', err);
            }

            const jsonUrl = '../../assets/data/characters/index.json';
            const jsonResp = await fetch(jsonUrl);
            if (jsonResp.ok) return jsonResp.json();
            throw new Error('Impossibile caricare il manifest dei personaggi.');
        }

        async function loadCharacterYaml(entry) {
            const base = '../../assets/data/';
            const filePath = entry.file || `characters/${entry.id}.yaml`;
            const yamlUrl = base + filePath;
            try {
                const resp = await fetch(yamlUrl);
                if (resp.ok) {
                    const text = await resp.text();
                    const parsed = parseYamlLite(text);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
                }
            } catch (err) {
                console.warn(`Impossibile leggere YAML per ${entry.id}, provo JSON:`, err);
            }

            const jsonUrl = yamlUrl.replace(/\\.yaml$/, '.json');
            const jsonResp = await fetch(jsonUrl);
            if (jsonResp.ok) return jsonResp.json();
            throw new Error(`Impossibile caricare i dati del personaggio ${entry.id}`);
        }

        async function loadPlayersData() {
            const resp = await fetch('../../assets/data/players.json');
            if (!resp.ok) throw new Error(`File dati players (${resp.status}) non trovato.`);
            return resp.json();
        }

        async function hydrateContentBlocks(character) {
            if (!character || !Array.isArray(character.content_blocks)) return;
            const base = '../../assets/content/';
            await Promise.all(character.content_blocks.map(async (block) => {
                if (!block.markdown) return;
                const url = base + block.markdown;
                try {
                    const resp = await fetch(url);
                    const md = resp.ok ? await resp.text() : '';
                    block.markdownText = md;
                    block.markdownHtml = md ? renderMarkdown(md, { context: block.type }) : `<p>Impossibile caricare ${block.markdown}</p>`;
                } catch (err) {
                    console.warn(`Errore nel caricare ${block.markdown}:`, err);
                    block.markdownHtml = `<p>Impossibile caricare ${block.markdown}</p>`;
                }
            }));
        }

        async function loadQuestsData() {
            try {
                const resp = await fetch('../../assets/data/quests.json');
                if (resp.ok) return resp.json();
            } catch (e) {
                console.warn("Impossibile caricare quests.json", e);
            }
            return [];
        }

        document.addEventListener("DOMContentLoaded", async function () {
            const container = document.getElementById('character-content-container');
            const charNameEl = document.getElementById('char-name');
            const charRoleEl = document.getElementById('char-role');

            const params = new URLSearchParams(window.location.search);
            const charId = params.get('id');
            const charType = params.get('type') || 'npc'; // Default to 'npc'

            if (!charId) {
                displayError("ID del personaggio non specificato.");
                return;
            }

            try {
                let character = null;
                let allCharacters = [];

                // Load Quests Data separately
                const questsData = await loadQuestsData();
                const npcQuests = questsData.find(g => g.npc_id === charId);

                // IBRIDO: Se abbiamo dati statici, usiamoli.
                if (window.NPC_DATA && window.NPC_DATA.length > 0) {
                    console.log("Using static NPC data for character details");
                    allCharacters = window.NPC_DATA;
                    character = allCharacters.find(c => c.id === charId);
                } else {
                    // Fallback Fetch Logic
                    let characters;
                    if (charType === 'player') {
                        characters = await loadPlayersData();
                    } else {
                        const manifest = await loadCharactersManifest();
                        const npcEntries = manifest.filter(entry => (entry.type || 'npc') === 'npc');
                        characters = [];
                        for (const entry of npcEntries) {
                            const char = await loadCharacterYaml(entry);
                            if (char) characters.push(char);
                        }
                    }
                    allCharacters = characters;
                    character = characters.find(c => c.id === charId);

                    // Fetch Markdown content if not static
                    await hydrateContentBlocks(character);
                }

                if (!character) {
                    displayError(`Personaggio con ID '${charId}' non trovato.`);
                    return;
                }
                if (window.WikiSpoiler && !window.WikiSpoiler.allowSpoilers() && !window.WikiSpoiler.isVisible(character)) {
                    displayError(`Personaggio con ID '${charId}' non trovato.`);
                    return;
                }

                // If using static data, we might need to convert markdownText to HTML on the fly
                // because build script only loads text.
                if (character.content_blocks) {
                    character.content_blocks.forEach(block => {
                        if (block.markdownText && !block.markdownHtml) {
                            block.markdownHtml = renderMarkdown(block.markdownText, { context: block.type });
                        }
                    });
                }

                renderCharacterPage(character, allCharacters, npcQuests);

            } catch (error) {
                console.error("Errore nel caricamento del personaggio:", error);
                displayError("Impossibile caricare i dati del personaggio.");
            }

            function displayError(message) {
                charNameEl.textContent = "Errore";
                container.innerHTML = `<p style="text-align: center; color: var(--status-dead);">${message}</p>`;
            }

            function resolveImagePath(imagePath) {
                if (!imagePath) return '';
                // Check if the path is already absolute or starts with a protocol
                if (imagePath.startsWith('http://') || imagePath.startsWith('https://') || imagePath.startsWith('/') || imagePath.startsWith('data:')) {
                    return imagePath;
                }
                // Prepend the base path for relative asset images
                return `../../assets/${imagePath}`;
            }

            function renderRelationships(relationships, allCharacters) {
                const card = document.createElement('div');
                card.className = 'content-card';

                const relationshipsHtml = relationships.map(rel => {
                    const relatedChar = allCharacters.find(c => c.id === rel.id);
                    if (!relatedChar) return '';
                    if (window.WikiSpoiler && !window.WikiSpoiler.allowSpoilers() && !window.WikiSpoiler.isVisible(relatedChar)) return '';

                    return `
                        <a href="?id=${relatedChar.id}" class="npc-card">
                            <div class="npc-avatar-container">
                                <img src="${resolveImagePath(relatedChar.images.avatar)}" alt="${relatedChar.name}" class="npc-img-pop img-main" onerror="this.style.display='none'">
                                <img src="${resolveImagePath(relatedChar.images.hover)}" alt="${relatedChar.name} Reveal" class="npc-img-pop img-hover" onerror="this.style.display='none'">
                            </div>
                            <div class="npc-info">
                                <div class="npc-header">
                                    <h3 class="npc-name">${relatedChar.name}</h3>
                                </div>
                                <div class="npc-footer">
                                    <span class="npc-desc">${rel.description}</span>
                                    <span class="npc-role">${relatedChar.role}</span>
                                </div>
                            </div>
                            <i class="fas fa-chevron-right arrow-icon"></i>
                        </a>
                    `;
                }).filter(Boolean).join('');

                card.innerHTML = `
                    <h3><i class="fas fa-users"></i> Legami</h3>
                    <div class="npc-list">
                        ${relationshipsHtml}
                    </div>
                `;
                return card;
            }

            function renderCharacterPage(character, allCharacters, npcQuests) {
                // Set page title and header
                document.title = `${character.name} | Cripta di Sangue`;
                charNameEl.textContent = character.name;
                charRoleEl.textContent = character.role;

                // Build the main grid structure
                const grid = document.createElement('div');
                grid.className = 'char-grid';

                // Build left (lore) and right (image/stats) columns
                // Build left (lore) and right (image/stats) columns
                const leftCol = document.createElement('div');
                leftCol.className = 'left-col';

                const visibleBlocks = (character.content_blocks || []).filter(block => !block.hidden);

                if (visibleBlocks.length > 0) {
                    visibleBlocks.forEach(block => {
                        leftCol.appendChild(renderContentBlock(block));
                    });
                } else {
                    // Display a placeholder if content_blocks is empty or doesn't exist
                    const placeholder = document.createElement('div');
                    placeholder.className = 'content-card';
                    placeholder.innerHTML = '<h3><i class="fas fa-scroll"></i> Storia</h3><p>Dettagli sulla storia di questo personaggio non ancora disponibili.</p>';
                    leftCol.appendChild(placeholder);
                }

                // Render relationships if they exist
                // MOVED TO getRightColumnHtml
                // if(character.relationships && character.relationships.length > 0) {
                //     leftCol.appendChild(renderRelationships(character.relationships, allCharacters));
                // }

                const rightCol = document.createElement('div');
                rightCol.className = 'right-col';
                rightCol.innerHTML = getRightColumnHtml(character, allCharacters, npcQuests);

                grid.appendChild(leftCol);
                grid.appendChild(rightCol);
                container.appendChild(grid);
                // After rendering everything, initialize modal logic
                initializeImageModal();
            }

            function getRightColumnHtml(character, allCharacters, npcQuests) {
                const summary = character.summary || {};

                // --- CALCOLO ANNO DI NASCITA E ETA' ---
                // --- CALCOLO ANNO DI NASCITA E ETA' ---
                const CURRENT_YEAR = 2026;
                let periodLabel = "Anno di Nascita";
                let periodValue = "Non disponibile";
                let age = "Non disponibile";

                // Parsing Period field (expected format: "Birth-Death" or "Birth")
                if (summary.period) {
                    const parts = summary.period.toString().split('-');
                    const bYear = parseInt(parts[0].trim());

                    if (!isNaN(bYear)) {
                        periodValue = bYear; // Default to just birth year

                        // Calculate Age
                        if (parts.length > 1 && parts[1].trim() !== '') {
                            // Dead: Age = Death - Birth
                            const dYear = parseInt(parts[1].trim());
                            if (!isNaN(dYear)) {
                                age = `${dYear - bYear} anni`;
                                // UPDATE: Use range for label and value if dead
                                periodLabel = "Nascita - Morte";
                                periodValue = `${bYear} - ${dYear}`;
                            }
                        } else {
                            // Alive/Unknown Death: Age = Current - Birth
                            age = `${CURRENT_YEAR - bYear} anni`;
                        }
                    } else {
                        // Fallback if period is just text (e.g. "Sconosciuto")
                        periodValue = summary.period;
                    }
                }

                // --- ALTRI CAMPI ---
                // Height is already combined in YAML usually ("1.62m | 9kg")
                const heightWeight = summary.height || "Non disponibile";


                const statsHtml = `
                    <div class="stat-box">
                        <span class="stat-label">${periodLabel}</span>
                        <span class="stat-value">${periodValue}</span>
                    </div>
                    <div class="stat-box">
                        <span class="stat-label">Età</span>
                        <span class="stat-value">${age}</span>
                    </div>
                    <div class="stat-box">
                        <span class="stat-label">Altezza | Peso</span>
                        <span class="stat-value">${heightWeight}</span>
                    </div>
                `;

                // Render Quests if available
                let questsHtml = '';
                if (npcQuests && npcQuests.quests && npcQuests.quests.length > 0) {
                    const visibleQuests = npcQuests.quests.filter(q => q.status !== 'hidden');
                    if (visibleQuests.length > 0) {
                        const questsList = visibleQuests.map(q => {
                            const isCompleted = q.status === 'completed';
                            return `
                            <div class="quest-item">
                                <span class="quest-text" style="${isCompleted ? 'opacity: 0.7;' : ''}">${q.title}</span>
                                <span class="quest-status ${isCompleted ? 'status-completed' : 'status-inprogress'}">
                                    <i class="fas ${isCompleted ? 'fa-check-circle' : 'fa-clock'}"></i>
                                    ${isCompleted ? 'COMPLETA' : 'IN CORSO'}
                                </span>
                            </div>
                           `;
                        }).join('');

                        questsHtml = `
                        <div class="content-card questline-card" style="margin-top: 2rem;">
                            <h3><i class="fas fa-scroll"></i> Missioni</h3>
                            <div class="quest-category">
                                ${questsList}
                            </div>
                             <div style="margin-top: 1rem; text-align: center;">
                                <a href="../missioni.html" class="button-gold-outline" style="font-size: 0.8rem;">Vedi Registro Completo</a>
                            </div>
                        </div>
                        `;
                    }
                }

                // Causa del Decesso (Solo se presente)
                let causeOfDeathHtml = '';
                if (summary.cause_of_death) {
                    causeOfDeathHtml = `
                        <div style="padding: 1rem; text-align: center; border-top: 1px solid rgba(255,255,255,0.1);">
                            <span class="stat-label" style="margin-bottom: 5px;">Causa del Decesso</span>
                            <span style="color: var(--accent-primary); font-family: 'Cinzel';">${summary.cause_of_death}</span>
                        </div>
                    `;
                }

                return `
                    <div class="image-card">
                        <img src="${resolveImagePath(character.images.portrait)}" class="char-portrait" onerror="this.src='https://placehold.co/400x500/111/333?text=No+Image'">
                        <div class="stats-grid">${statsHtml}</div>
                        ${causeOfDeathHtml}
                    </div>
                    ${questsHtml}
                    ${character.relationships && character.relationships.length > 0 ? renderRelationships(character.relationships, allCharacters).outerHTML : ''}
                `;
            }

            function renderContentBlock(block) {
                const card = document.createElement('div');
                card.className = 'content-card';
                if (block.type) {
                    card.classList.add(`content-card--${block.type}`);
                }
                const wrapMarkdown = (html, extraClass = '') => {
                    if (!html) return '';
                    const className = extraClass ? `chapter-content ${extraClass}` : 'chapter-content';
                    return `<div class="${className}">${html}</div>`;
                };

                // Use a switch to handle different block types
                switch (block.type) {
                    case 'lore':
                        card.innerHTML = `<h3><i class="fas ${block.icon || 'fa-book-open'}"></i> ${block.title}</h3>${wrapMarkdown(block.markdownHtml)}`;
                        break;

                    case 'secret_dossier':
                        // This block is initially commented out or hidden in the original file. 
                        // For the template, we can render it directly or add a mechanism to reveal it.
                        // For now, let's render it styled as a secret.
                        card.classList.add('secret'); // You can style this class
                        card.innerHTML = `
                        <h3><i class="fas fa-user-secret"></i> ${block.title}</h3>
                        <div class="secret-dossier">
                            <div class="secret-badge">${block.badge}</div>
                            <div class="dossier-content">
                                <img src="${resolveImagePath(block.image)}" class="elena-img" onerror="this.style.display='none'">
                                ${wrapMarkdown(block.markdownHtml, 'chapter-content--compact')}
                            </div>
                        </div>`;
                        break;

                    case 'banner_box':
                        card.innerHTML = `
                             <div class="banner-header">
                                 <img src="${resolveImagePath(block.banner)}" class="banner-img" alt="${block.title}">
                             </div>
                             <div class="banner-body">
                                 <h3><i class="fas ${block.icon || 'fa-flag'}"></i> ${block.title}</h3>
                                 ${wrapMarkdown(block.markdownHtml)}
                             </div>
                         `;
                        break;

                    case 'custom_box':
                        if (block.borderColor) {
                            card.style.borderColor = block.borderColor;
                        }
                        card.innerHTML = `<h3><i class="fas ${block.icon || 'fa-box'}"></i> ${block.title}</h3>${wrapMarkdown(block.markdownHtml)}`;
                        break;

                    case 'image_box':
                        const docTags = (block.tags || []).map(tag => `<span class="doc-tag">${tag}</span>`).join('');

                        card.classList.add('document-card');
                        card.innerHTML = `
                        <div class="document-header">
                            <div class="doc-label"><i class="fas ${block.icon || 'fa-book-dead'}"></i> ${block.title}</div>
                            <div class="document-tags">${docTags}</div>
                        </div>
                        <div class="document-body">
                            <div class="document-image">
                                 <img src="${resolveImagePath(block.image)}" alt="${block.title}" class="doc-image-popup" onerror="this.style.display='none'">
                                ${block.image_caption ? `<p class="document-caption">${block.image_caption}</p>` : ''}
                            </div>
                            <div class="document-content">
                                ${wrapMarkdown(block.markdownHtml, 'chapter-content--compact')}
                            </div>
                        </div>`;
                        break;

                    default:
                        // Default handler for unknown block types
                        card.innerHTML = `<h3>${block.title || 'Informazioni'}</h3>${wrapMarkdown(block.markdownHtml || block.content || '')}`;
                }
                return card;
            }
        });
