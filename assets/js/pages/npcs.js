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

        document.addEventListener("DOMContentLoaded", async function () {
            const base_path = '../assets/'; // Path from npcs.html to assets folder
            const npcListContainer = document.querySelector('.npc-list');
            if (!npcListContainer) return;

            try {
                let npcs = [];
                // IBRIDO: Se abbiamo dati statici, usiamoli.
                if (window.NPC_DATA && window.NPC_DATA.length > 0) {
                    console.log("Using static NPC data");
                    npcs = window.NPC_DATA;
                } else {
                    console.log("Fetching NPC data...");
                    npcs = await loadNpcData(base_path);
                }

                const visibleNpcs = window.WikiSpoiler
                    ? window.WikiSpoiler.filterVisible(npcs)
                    : npcs.filter(npc => !npc.hidden);

                if (visibleNpcs.length === 0) {
                    npcListContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center;">Nessun NPC disponibile.</p>';
                    return;
                }

                visibleNpcs.forEach(npc => {
                    const card = createNpcCard(npc, base_path);
                    npcListContainer.appendChild(card);
                });

            } catch (error) {
                console.error("Errore nel caricamento degli NPC:", error);
                npcListContainer.innerHTML = '<p style="color: var(--red);">Impossibile caricare la lista degli NPC.</p>';
            }
        });

        async function loadNpcData(base_path) {
            const manifest = await loadCharactersManifest(base_path);
            const npcEntries = manifest.filter(entry => (entry.type || 'npc') === 'npc');
            const characters = [];
            for (const entry of npcEntries) {
                const char = await loadCharacterYaml(entry, base_path);
                if (char) characters.push(char);
            }
            return characters;
        }

        async function loadCharactersManifest(base_path) {
            const yamlUrl = base_path + 'data/characters/index.yaml';
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

            const jsonUrl = base_path + 'data/characters/index.json';
            const jsonResp = await fetch(jsonUrl);
            if (jsonResp.ok) return jsonResp.json();

            throw new Error('Impossibile caricare il manifest dei personaggi.');
        }

        async function loadCharacterYaml(entry, base_path) {
            const filePath = entry.file || `characters/${entry.id}.yaml`;
            const yamlUrl = base_path + 'data/' + filePath;
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
            console.error(`Impossibile caricare i dati del personaggio ${entry.id}`);
            return null;
        }

        function createNpcCard(npc, base_path) {
            const statusMap = {
                vivo: { text: 'VIVO', class: 'status-vivo' },
                morto: { text: 'MORTO', class: 'status-morto' },
                ignoto: { text: 'IGNOTO', class: 'status-sconosciuto' }
            };
            const statusInfo = statusMap[npc.status] || { text: 'N/A', class: '' };

            const card = document.createElement('a');
            card.href = `./characters/character.html?id=${npc.id}`;
            card.className = 'npc-card';

            card.innerHTML = `
                <span class="npc-status-badge ${statusInfo.class}">${statusInfo.text}</span>
                <div class="npc-avatar-container">
                    <img src="${base_path}${npc.images.avatar}" alt="${npc.name}" class="npc-img-pop img-main" onerror="this.style.display='none'">
                    <img src="${base_path}${npc.images.hover}" alt="${npc.name} Reveal" class="npc-img-pop img-hover" onerror="this.style.display='none'">
                </div>
                <div class="npc-info">
                    <div class="npc-header">
                        <h3 class="npc-name">${npc.name}</h3>
                        <span class="npc-role">${npc.role}</span>
                    </div>
                    <p class="npc-desc">${npc.quote}</p>
                </div>
                <i class="fas fa-chevron-right arrow-icon"></i>
            `;
            return card;
        }
