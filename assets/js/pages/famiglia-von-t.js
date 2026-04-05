function resolveImagePath(imagePath) {
            if (!imagePath) return '';
            if (imagePath.startsWith('http://') || imagePath.startsWith('https://') || imagePath.startsWith('/') || imagePath.startsWith('data:')) {
                return imagePath;
            }
            return `../assets/${imagePath}`;
        }

        document.addEventListener("DOMContentLoaded", async function() {
            const treeContainer = document.getElementById('family-tree-container');
            
            try {
                const response = await fetch('../assets/data/family_von_t.json');
                if (!response.ok) throw new Error(`File dati (${'../assets/data/family_von_t.json'}) non trovato.`);
                
                let familyData = await response.json();
                
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

            } catch (error) {
                console.error("Errore nel caricamento dell'albero genealogico:", error);
                treeContainer.innerHTML = `<p style="text-align: center; color: var(--status-dead);">Impossibile caricare i dati dell'albero genealogico.</p>`;
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
                    const personImage = person.unknown ? 'https://placehold.co/100/333/fff?text=?' : resolveImagePath(person.image);
                    const vonTClass = person.von_t ? 'von-t' : '';
                    const isLocked = Boolean(person.hidden || person.unknown || person.unnamed);
                    const baseClasses = `family-member ${vonTClass} ${isLocked ? 'family-member--locked' : ''}`.trim();

                    if (isLocked) {
                        return `
                            <div class="${baseClasses}" data-person-id="${personId}" aria-disabled="true">
                                <img src="${personImage}" alt="${personName}" class="member-image">
                                <div class="member-separator"></div>
                                <span class="member-name">${personName}</span>
                            </div>
                        `;
                    }

                    return `
                        <a href="./characters/character.html?id=${personId}" class="${baseClasses}" data-person-id="${personId}">
                            <img src="${personImage}" alt="${personName}" class="member-image">
                            <div class="member-separator"></div>
                            <span class="member-name">${personName}</span>
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
                            if(people.has(child.id)) { // Ensure child is not hidden
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
                window.addEventListener('resize', () => {
                    clearTimeout(resizeDebounce);
                    resizeDebounce = setTimeout(layoutAndDraw, 120);
                });

            }
        });
