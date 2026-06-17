function resolveImagePath(imagePath) {
    const value = String(imagePath || '').trim();
    if (!value) return '';
    if (/^(https?:|data:|blob:)/i.test(value)) return value;
    if (value.startsWith('media/')) return window.CriptaApp.urls.api(value);
    if (value.startsWith('/media/')) return window.CriptaApp.urls.api(value.slice(1));
    if (value.startsWith('/')) return value;
    if (value.startsWith('assets/')) return `../${value}`;
    return `../assets/${value}`;
}

function appendAssetVersion(url, version) {
    const stamp = String(version || '').trim();
    if (!url || !stamp || /^(data:|blob:)/i.test(url)) return url;
    try {
        const nextUrl = new URL(url, window.location.href);
        nextUrl.searchParams.set('v', stamp);
        return nextUrl.toString();
    } catch (_error) {
        return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(stamp)}`;
    }
}

const UNKNOWN_FAMILY_IMAGE = 'https://placehold.co/100/333/fff?text=?';
const FAMILY_CAMPAIGN_ID = 'cripta-di-sangue';

window.CriptaApp.onPageReady("famiglia-von-t", async function () {
    const pageScope = window.CriptaApp.createPageScope("famiglia-von-t");
    const treeContainer = document.getElementById('family-tree-container');
    const birthOrderContainer = document.getElementById('family-birth-order');

    try {
        const familyDataUrl = window.CriptaApp?.urls?.data?.('family_von_t.json') || '../assets/data/family_von_t.json';
        const response = await fetch(familyDataUrl);
        if (!response.ok) throw new Error(`File dati (${familyDataUrl}) non trovato.`);

        let familyData = await response.json();
        familyData = await applyCharacterHoverImages(familyData);

        const visibleRows = (window.WikiSpoiler && !window.WikiSpoiler.allowSpoilers())
            ? familyData.filter(p => window.WikiSpoiler.isVisible(p))
            : familyData;
        const visibleIds = new Set(visibleRows.map(p => p.id));
        let visibleFamilyData = familyData.filter(p => visibleIds.has(p.id));

        // Clean up references to hidden members
        visibleFamilyData.forEach(person => {
            if (person.parents) {
                person.parents = person.parents.filter(id => visibleIds.has(id));
            }
            if (person.spouses) {
                person.spouses = person.spouses.filter(id => visibleIds.has(id));
            }
            if (person.children) {
                person.children = person.children.filter(id => visibleIds.has(id));
            }
        });

        renderFamilyTree(visibleFamilyData); // Call renderFamilyTree with filtered data
        renderBirthOrder(visibleFamilyData);

    } catch (error) {
        console.error("Errore nel caricamento dell'albero genealogico:", error);
        treeContainer.innerHTML = `<p style="text-align: center; color: var(--status-dead);">Impossibile caricare i dati dell'albero genealogico.</p>`;
        if (birthOrderContainer) {
            birthOrderContainer.innerHTML = '';
        }
    }

    function escapeHtml(value) {
        return window.CriptaApp.utils.escapeHtml(value);
    }

    function parseYamlScalar(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        if (raw.startsWith('"') && raw.endsWith('"')) {
            try {
                return JSON.parse(raw);
            } catch (_error) {
                return raw.slice(1, -1);
            }
        }
        if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1);
        return raw;
    }

    function parseCharactersManifest(yamlText) {
        const entries = [];
        let current = null;

        String(yamlText || '').split(/\r?\n/).forEach(rawLine => {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) return;

            if (line.startsWith('- ')) {
                if (current) entries.push(current);
                current = {};
                const firstPair = line.slice(2).match(/^([^:]+):\s*(.*)$/);
                if (firstPair) current[firstPair[1].trim()] = parseYamlScalar(firstPair[2]);
                return;
            }

            if (!current) return;
            const pair = line.match(/^([^:]+):\s*(.*)$/);
            if (pair) current[pair[1].trim()] = parseYamlScalar(pair[2]);
        });

        if (current) entries.push(current);
        return entries;
    }

    function extractCharacterHoverImage(yamlText) {
        const lines = String(yamlText || '').split(/\r?\n/);
        let imagesIndent = null;

        for (const rawLine of lines) {
            const trimmed = rawLine.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const indent = rawLine.match(/^ */)[0].length;

            if (imagesIndent !== null && indent <= imagesIndent) imagesIndent = null;
            if (trimmed === 'images:') {
                imagesIndent = indent;
                continue;
            }
            if (imagesIndent === null || indent <= imagesIndent) continue;

            const hover = trimmed.match(/^hover:\s*(.*)$/);
            if (hover) return parseYamlScalar(hover[1]);
        }

        return '';
    }

    function collectHoverImagesFromCharacters(characters, ids) {
        const images = new Map();
        (Array.isArray(characters) ? characters : []).forEach(character => {
            const id = String(character?.id || character?.entityId || '').trim();
            if (!id || !ids.has(id)) return;
            const hoverImage = character?.images?.hover || character?.hoverImage || character?.imageHover || '';
            if (hoverImage) {
                images.set(id, {
                    path: hoverImage,
                    updatedAt: character?.updatedAt || character?.images?.updatedAt || ''
                });
            }
        });
        return images;
    }

    async function loadCharacterHoverImages(familyData) {
        const ids = new Set((familyData || []).map(person => String(person.id || '').trim()).filter(Boolean));
        if (!ids.size) return new Map();
        let hoverImages = new Map();

        try {
            const payload = await window.CriptaApp?.api?.get?.('api/data/characters', {
                query: {
                    campaign: FAMILY_CAMPAIGN_ID,
                    campaignId: FAMILY_CAMPAIGN_ID
                }
            });
            hoverImages = collectHoverImagesFromCharacters(payload?.data, ids);
        } catch (error) {
            console.warn('KV characters non disponibile per le immagini Von T, provo YAML statico.', error);
        }

        const missingIds = new Set([...ids].filter(id => !hoverImages.has(id)));
        if (!missingIds.size) return hoverImages;

        try {
            const manifestUrl = window.CriptaApp?.urls?.data?.('characters/index.yaml') || '../assets/data/characters/index.yaml';
            const manifestResponse = await fetch(manifestUrl);
            if (!manifestResponse.ok) return hoverImages;

            const manifest = parseCharactersManifest(await manifestResponse.text())
                .filter(entry => missingIds.has(String(entry.id || '').trim()) && entry.file);

            const pairs = await Promise.all(manifest.map(async entry => {
                try {
                    const characterUrl = window.CriptaApp?.urls?.data?.(entry.file) || `../assets/data/${entry.file}`;
                    const response = await fetch(characterUrl);
                    if (!response.ok) return null;
                    const hoverImage = extractCharacterHoverImage(await response.text());
                    return hoverImage ? [String(entry.id), { path: hoverImage, updatedAt: '' }] : null;
                } catch (_error) {
                    return null;
                }
            }));

            pairs.filter(Boolean).forEach(([id, image]) => hoverImages.set(id, image));
            return hoverImages;
        } catch (error) {
            console.warn('Impossibile leggere le immagini hover dei personaggi Von T.', error);
            return hoverImages;
        }
    }

    async function applyCharacterHoverImages(familyData) {
        const hoverImages = await loadCharacterHoverImages(familyData);
        if (!hoverImages.size) return familyData;

        return familyData.map(person => {
            const hoverImage = hoverImages.get(String(person.id || ''));
            if (!hoverImage?.path) return person;
            return {
                ...person,
                hoverImage: hoverImage.path,
                imageUpdatedAt: hoverImage.updatedAt || person.updatedAt || '',
                imageFallback: person.image || ''
            };
        });
    }

    function getPersonImage(person) {
        if (person.unknown && !person.showImageWhenUnknown) return UNKNOWN_FAMILY_IMAGE;
        return appendAssetVersion(resolveImagePath(person.hoverImage || person.images?.hover || getPersonCanonicalImagePath(person, 'hover') || person.image), person.imageUpdatedAt);
    }

    function buildImageFallbackAttributes(person) {
        if (person.unknown && !person.showImageWhenUnknown) return '';
        const fallback = resolveImagePath(person.imageFallback || person.images?.idle || person.image || '');
        if (!fallback) return '';
        return ` data-fallback-src="${escapeHtml(fallback)}" onerror="this.src=this.dataset.fallbackSrc || ''; this.onerror=null;"`;
    }

    function getPersonDisplayName(person) {
        return person.unnamed ? '???' : person.name;
    }

    function getPersonCharacterId(person) {
        return String(person?.characterId || person?.character_id || person?.id || '').trim();
    }

    function getPersonMediaSlug(person) {
        const id = getPersonCharacterId(person);
        if (typeof window.CriptaApp?.utils?.slugify === 'function') return window.CriptaApp.utils.slugify(id);
        return id
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function getPersonCanonicalImagePath(person, variant = 'hover') {
        const slug = getPersonMediaSlug(person);
        return slug ? `media/campaigns/${FAMILY_CAMPAIGN_ID}/characters/${slug}/${variant}.webp` : '';
    }

    function getPersonCharacterHref(person) {
        const url = new URL('./characters/character.html', window.location.href);
        url.searchParams.set('id', getPersonCharacterId(person));
        url.searchParams.set('type', 'npc');
        url.searchParams.set('campaign', FAMILY_CAMPAIGN_ID);
        return url.toString();
    }

    function getBirthOrderValue(person, index) {
        return Number.isFinite(Number(person.birthOrder)) ? Number(person.birthOrder) : index + 1;
    }

    function renderBirthOrder(data) {
        if (!birthOrderContainer) return;

        const vonTMembers = data
            .map((person, index) => ({ person, index }))
            .filter(entry => entry.person.von_t)
            .sort((a, b) => getBirthOrderValue(b.person, b.index) - getBirthOrderValue(a.person, a.index));

        if (!vonTMembers.length) {
            birthOrderContainer.innerHTML = '';
            return;
        }

        const oldestOrder = Math.min(...vonTMembers.map(entry => getBirthOrderValue(entry.person, entry.index)));
        const newestOrder = Math.max(...vonTMembers.map(entry => getBirthOrderValue(entry.person, entry.index)));

        const listHtml = vonTMembers.map(({ person, index }) => {
            const order = getBirthOrderValue(person, index);
            const personName = getPersonDisplayName(person);
            const image = getPersonImage(person);
            const isLocked = Boolean(person.hidden || person.unknown || person.unnamed);
            const meta = order === newestOrder ? 'Ultima Foglia' : order === oldestOrder ? 'Patto Stipulato' : `Nascita #${order}`;
            const rank = vonTMembers.findIndex(entry => entry.person.id === person.id) + 1;
            const content = `
                        <span class="birth-rank">${String(rank).padStart(2, '0')}</span>
                        <img src="${escapeHtml(image)}" alt="${escapeHtml(personName)}" class="birth-avatar"${buildImageFallbackAttributes(person)}>
                        <span class="birth-copy">
                            <span class="birth-name">${escapeHtml(personName)}</span>
                            <span class="birth-meta">${escapeHtml(meta)}</span>
                        </span>
                    `;

            if (isLocked) {
                return `<li><div class="birth-card birth-card--locked">${content}</div></li>`;
            }

            return `<li><a href="${escapeHtml(getPersonCharacterHref(person))}" class="birth-card">${content}</a></li>`;
        }).join('');

        birthOrderContainer.innerHTML = `
                    <details class="birth-order-panel">
                        <summary class="birth-order-header">
                            <span class="birth-order-header-copy">
                                <span class="eyebrow">Cronologia Von T</span>
                                <span class="birth-order-title">Ordine di nascita</span>
                                <span class="birth-order-subtitle">Dal membro piu recente al capostipite della stirpe.</span>
                            </span>
                            <span class="birth-order-toggle">
                                <span>${vonTMembers.length} ${vonTMembers.length === 1 ? 'voce' : 'voci'}</span>
                                <i class="fas fa-chevron-down" aria-hidden="true"></i>
                            </span>
                        </summary>
                        <ol class="birth-order-list">${listHtml}</ol>
                    </details>
                `;
    }

    function renderFamilyTree(data) {
        const people = new Map(data.map(p => [p.id, p]));
        const connectionsToDraw = [];
        const getParentUnitId = (parent1Id, parent2Id = null) => `parent-unit-${parent1Id}${parent2Id ? `-${parent2Id}` : ''}`;

        // Helper to create a member node
        const createMemberNode = (personId) => {
            const person = people.get(personId);
            if (!person) return '';

            const personName = person.unnamed ? '???' : person.name;
            const personImage = getPersonImage(person);
            const fallbackAttributes = buildImageFallbackAttributes(person);
            const vonTClass = person.von_t ? 'von-t' : '';
            const isLocked = Boolean(person.hidden || person.unknown || person.unnamed);
            const baseClasses = `family-member ${vonTClass} ${isLocked ? 'family-member--locked' : ''}`.trim();

            if (isLocked) {
                return `
                            <div class="${escapeHtml(baseClasses)}" data-person-id="${escapeHtml(personId)}" aria-disabled="true">
                                <img src="${escapeHtml(personImage)}" alt="${escapeHtml(personName)}" class="member-image"${fallbackAttributes}>
                                <div class="member-separator"></div>
                                <span class="member-name">${escapeHtml(personName)}</span>
                            </div>
                        `;
            }

            return `
                        <a href="${escapeHtml(getPersonCharacterHref(person))}" class="${escapeHtml(baseClasses)}" data-person-id="${escapeHtml(personId)}">
                            <img src="${escapeHtml(personImage)}" alt="${escapeHtml(personName)}" class="member-image"${fallbackAttributes}>
                            <div class="member-separator"></div>
                            <span class="member-name">${escapeHtml(personName)}</span>
                        </a>
                    `;
        };

        // Helper to render a parent unit (single person or spouse unit) and their children's connectors
        const renderParentUnitWithConnectors = (parent1, parent2 = null, children = []) => {
            let unitHtml = `<div class="family-unit-wrapper">`;
            let unitContent;
            const parentUnitId = getParentUnitId(parent1.id, parent2 ? parent2.id : null);

            if (parent2) { // Spouse unit
                unitContent = `
                            <div class="family-unit spouse-unit" id="${parentUnitId}" data-parent1-id="${parent1.id}" data-parent2-id="${parent2.id}">
                                ${createMemberNode(parent1.id)}
                                ${createMemberNode(parent2.id)}
                            </div>
                        `;
                connectionsToDraw.push({ fromId: parent1.id, toId: parent2.id, type: 'spouse' });
            } else { // Single parent
                unitContent = `
                            <div class="family-unit" id="${parentUnitId}" data-parent1-id="${parent1.id}">
                                ${createMemberNode(parent1.id)}
                            </div>
                        `;
            }
            unitHtml += unitContent;

            if (children && children.length > 0) {
                children.forEach(child => {
                    if (people.has(child.id)) { // Ensure child is not hidden
                        connectionsToDraw.push({ fromId: parentUnitId, toId: child.id, type: 'parent-child' });
                    }
                });
            }
            unitHtml += `</div>`;
            return unitHtml;
        };

        let treeHtml = `<div class="family-tree">`;
        const allGenerationsData = [];

        // --- Generation 0: Yuris and Leonora (Founders) ---
        const yuris = people.get('yuris');
        const leonora = people.get('leonora');

        if (yuris && leonora) {
            allGenerationsData.push({
                id: 'generation-0',
                members: [
                    { type: 'couple', p1: yuris, p2: leonora, children: (yuris.children || []).map(id => people.get(id)).filter(Boolean) }
                ]
            });
        }

        // --- Generation 1: Children of Yuris and Leonora (and their spouses) ---
        const gen1_members_data = [];
        if (yuris && yuris.children && yuris.children.length > 0) {
            yuris.children.forEach(childId => {
                const child = people.get(childId);
                if (child) {
                    if (child.spouses && child.spouses.length > 0) {
                        const spouse = people.get(child.spouses[0]);
                        if (spouse) {
                            gen1_members_data.push({ type: 'couple', p1: child, p2: spouse, children: (child.children || []).map(id => people.get(id)).filter(Boolean) });
                        } else {
                            gen1_members_data.push({ type: 'single', p1: child, children: (child.children || []).map(id => people.get(id)).filter(Boolean) });
                        }
                    } else {
                        gen1_members_data.push({ type: 'single', p1: child, children: (child.children || []).map(id => people.get(id)).filter(Boolean) });
                    }
                }
            });
            if (gen1_members_data.length > 0) {
                allGenerationsData.push({
                    id: 'generation-1',
                    members: gen1_members_data
                });
            }
        }

        // --- Generation 2: Grandchildren ---
        const gen2_branches_data = [];
        if (gen1_members_data.length > 0) {
            gen1_members_data.forEach(parentData => {
                const parentUnitId = getParentUnitId(
                    parentData.p1.id,
                    parentData.type === 'couple' && parentData.p2 ? parentData.p2.id : null
                );
                gen2_branches_data.push({
                    parentUnitId,
                    parentType: parentData.type,
                    children: (parentData.children || []).filter(Boolean)
                });
            });
        }

        allGenerationsData.forEach(gen => {
            treeHtml += `<div class="generation ${gen.id}">`;
            gen.members.forEach(member => {
                if (member.type === 'couple') {
                    treeHtml += renderParentUnitWithConnectors(member.p1, member.p2, member.children);
                } else {
                    treeHtml += renderParentUnitWithConnectors(member.p1, null, member.children);
                }
            });
            treeHtml += `</div>`;
        });

        if (gen2_branches_data.some(branch => branch.children.length > 0)) {
            treeHtml += `<div class="generation generation-2 generation-children-by-branch">`;
            gen2_branches_data.forEach(branch => {
                treeHtml += `<div class="generation-branch" data-parent-unit-id="${branch.parentUnitId}" data-parent-type="${branch.parentType}">`;
                branch.children.forEach(grandchild => {
                    treeHtml += renderParentUnitWithConnectors(grandchild, null, []);
                });
                treeHtml += `</div>`;
            });
            treeHtml += `</div>`;
        }

        treeHtml += `</div>`;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = treeHtml;

        Array.from(treeContainer.children).forEach(child => {
            if (child.id !== 'family-tree-spouses-svg' && child.id !== 'family-tree-children-svg') {
                child.remove();
            }
        });

        while (tempDiv.firstChild) {
            treeContainer.appendChild(tempDiv.firstChild);
        }

        const familyTreeElement = treeContainer.querySelector('.family-tree');
        const spouseLinesSVG = document.getElementById('family-tree-spouses-svg');
        const childLinesSVG = document.getElementById('family-tree-children-svg');

        const toPercent = (valuePx, startPx, sizePx) => ((valuePx - startPx) / sizePx) * 100;

        const drawConnectionLine = (targetSVG, x1, y1, x2, y2) => {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', `${x1}%`);
            line.setAttribute('y1', `${y1}%`);
            line.setAttribute('x2', `${x2}%`);
            line.setAttribute('y2', `${y2}%`);
            line.setAttribute('stroke', 'var(--gold-dim)');
            line.setAttribute('stroke-width', '0.3%');
            line.setAttribute('class', 'family-connection-line');
            targetSVG.appendChild(line);
        };

        const drawConnectionDot = (targetSVG, x, y) => {
            const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('class', 'family-connection-dot');
            dot.setAttribute('cx', `${x}%`);
            dot.setAttribute('cy', `${y}%`);
            dot.setAttribute('r', '0.5%');
            dot.setAttribute('fill', 'var(--gold)');
            targetSVG.appendChild(dot);
        };

        function drawLine(startElement, endElement, type) {
            if (!startElement || !endElement || !familyTreeElement) return;

            const treeRect = familyTreeElement.getBoundingClientRect();
            const startRect = startElement.getBoundingClientRect();
            const endRect = endElement.getBoundingClientRect();

            if (type === 'spouse') {
                const startIsLeft = startRect.left <= endRect.left;
                const startEdgeX = startIsLeft ? (startRect.left + startRect.width) : startRect.left;
                const endEdgeX = startIsLeft ? endRect.left : (endRect.left + endRect.width);
                const y = (startRect.top + startRect.height / 2 + endRect.top + endRect.height / 2) / 2;
                const x1 = toPercent(startEdgeX, treeRect.left, treeRect.width);
                const y1 = toPercent(y, treeRect.top, treeRect.height);
                const x2 = toPercent(endEdgeX, treeRect.left, treeRect.width);
                const y2 = y1;
                drawConnectionLine(spouseLinesSVG, x1, y1, x2, y2);
            }
        }

        const drawParentChildrenBranch = (parentElement, childElements) => {
            if (!parentElement || !childElements.length || !familyTreeElement) return;

            const treeRect = familyTreeElement.getBoundingClientRect();
            const parentRect = parentElement.getBoundingClientRect();
            const parentX = toPercent(parentRect.left + parentRect.width / 2, treeRect.left, treeRect.width);
            const parentY = toPercent(parentRect.bottom, treeRect.top, treeRect.height);

            const childPoints = childElements.map(childEl => {
                const childRect = childEl.getBoundingClientRect();
                return {
                    x: toPercent(childRect.left + childRect.width / 2, treeRect.left, treeRect.width),
                    y: toPercent(childRect.top, treeRect.top, treeRect.height)
                };
            });

            if (!childPoints.length) return;

            drawConnectionDot(childLinesSVG, parentX, parentY);

            childPoints.forEach(child => {
                drawConnectionLine(childLinesSVG, parentX, parentY, child.x, child.y);
                drawConnectionDot(childLinesSVG, child.x, child.y);
            });
        };

        const syncGenerationBranchWidths = () => {
            const branches = treeContainer.querySelectorAll('.generation-children-by-branch .generation-branch');
            branches.forEach(branch => {
                const parentUnitId = branch.getAttribute('data-parent-unit-id');
                if (!parentUnitId) return;
                const parentUnit = treeContainer.querySelector(`#${parentUnitId}`);
                if (!parentUnit) return;
                branch.style.width = `${parentUnit.getBoundingClientRect().width}px`;
            });
        };

        const syncSvgBoundsToTree = () => {
            if (!familyTreeElement) return;
            const left = familyTreeElement.offsetLeft;
            const top = familyTreeElement.offsetTop;
            const width = familyTreeElement.offsetWidth;
            const height = familyTreeElement.offsetHeight;

            [spouseLinesSVG, childLinesSVG].forEach(svg => {
                svg.style.left = `${left}px`;
                svg.style.top = `${top}px`;
                svg.style.width = `${width}px`;
                svg.style.height = `${height}px`;
            });
        };

        const drawAllConnections = () => {
            spouseLinesSVG.innerHTML = '';
            childLinesSVG.innerHTML = '';
            const parentChildGroups = new Map();

            connectionsToDraw.forEach(conn => {
                let startElement, endElement;
                if (conn.type === 'spouse') {
                    startElement = treeContainer.querySelector(`[data-person-id="${conn.fromId}"]`);
                    endElement = treeContainer.querySelector(`[data-person-id="${conn.toId}"]`);
                    drawLine(startElement, endElement, 'spouse');
                } else if (conn.type === 'parent-child') {
                    if (!parentChildGroups.has(conn.fromId)) {
                        parentChildGroups.set(conn.fromId, []);
                    }
                    parentChildGroups.get(conn.fromId).push(conn.toId);
                }
            });

            parentChildGroups.forEach((childIds, parentUnitId) => {
                const parentElement = treeContainer.querySelector(`#${parentUnitId}`);
                const uniqueChildIds = [...new Set(childIds)];
                const childElements = uniqueChildIds
                    .map(childId => treeContainer.querySelector(`[data-person-id="${childId}"]`))
                    .filter(Boolean);
                drawParentChildrenBranch(parentElement, childElements);
            });

            // Keep dots always above all lines by moving them at the end of each SVG.
            [spouseLinesSVG, childLinesSVG].forEach(svg => {
                svg.querySelectorAll('.family-connection-dot').forEach(dot => svg.appendChild(dot));
            });
        };

        const layoutAndDraw = () => {
            syncGenerationBranchWidths();
            syncSvgBoundsToTree();
            drawAllConnections();
        };

        requestAnimationFrame(() => {
            requestAnimationFrame(layoutAndDraw);
        });

        familyTreeElement.querySelectorAll('.member-image').forEach(img => {
            if (!img.complete) {
                img.addEventListener('load', layoutAndDraw, { once: true });
                img.addEventListener('error', layoutAndDraw, { once: true });
            }
        });

        let resizeDebounce;
        pageScope.listen(window, 'resize', () => {
            clearTimeout(resizeDebounce);
            resizeDebounce = setTimeout(layoutAndDraw, 120);
        });

    }
});
