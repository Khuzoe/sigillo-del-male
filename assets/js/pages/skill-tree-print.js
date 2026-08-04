(() => {
    const STORAGE_PREFIX = 'sigillo-skill-tree-pdf:';
    const MAX_AGE_MS = 30 * 60 * 1000;
    const root = document.querySelector('[data-print-document]');
    const printButton = document.querySelector('[data-print-pdf]');
    const closeButton = document.querySelector('[data-print-close]');
    const status = document.querySelector('[data-print-status]');
    const documentTitle = document.querySelector('[data-print-document-title]');

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const titleCase = (value) => String(value || '')
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
        .trim();

    const finiteNumber = (value, fallback = 0) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    };

    const clamp = (value, min, max) => Math.max(min, Math.min(max, finiteNumber(value, min)));

    const sanitizeRichHtml = (value) => {
        const source = String(value ?? '').trim();
        if (!source || source === '[object Object]') return '';
        const template = document.createElement('template');
        template.innerHTML = source;
        template.content.querySelectorAll('script, style, iframe, object, embed, form, input, button, textarea, select, svg').forEach((entry) => entry.remove());
        const allowed = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'H3', 'H4', 'BLOCKQUOTE']);
        template.content.querySelectorAll('*').forEach((entry) => {
            if (!allowed.has(entry.tagName)) {
                entry.replaceWith(...entry.childNodes);
                return;
            }
            Array.from(entry.attributes).forEach((attribute) => entry.removeAttribute(attribute.name));
        });
        return template.innerHTML.trim();
    };

    const normalizeConnections = (node) => (Array.isArray(node?.connections) ? node.connections : [])
        .map((entry) => {
            if (entry && typeof entry === 'object') {
                const target = String(entry.target || entry.to || entry.id || '').trim();
                return target ? { target, mode: entry.mode === 'exclusive' || entry.exclusive === true ? 'exclusive' : 'normal' } : null;
            }
            const target = String(entry ?? '').trim();
            return target ? { target, mode: 'normal' } : null;
        })
        .filter(Boolean);

    const isGroupNode = (node) => {
        const type = String(node?.type || node?.kind || node?.nodeType || '').toLowerCase();
        return type === 'group' || type === 'choice-group' || Array.isArray(node?.children);
    };

    const getLevels = (node) => {
        const levels = Array.isArray(node?.levels) && node.levels.length ? node.levels : [node];
        return levels.map((level, index) => ({
            ...level,
            title: level?.title || node?.title || `Livello ${index + 1}`,
            flavor: node?.flavor || node?.subtitle || '',
            desc: level?.desc || level?.description || (index === 0 ? node?.desc || node?.description || '' : ''),
            icon: level?.icon || node?.icon || ''
        }));
    };

    const normalizeExternalRequirements = (node) => {
        const source = Array.isArray(node?.externalRequirements)
            ? node.externalRequirements
            : (node?.externalRequirement ? [node.externalRequirement] : []);
        return source.map((entry, index) => {
            const value = typeof entry === 'string' ? { label: entry } : (entry || {});
            return {
                id: String(value.id || value.key || `external-${index + 1}`),
                label: String(value.label || value.title || value.name || `Requisito ${index + 1}`),
                target: Math.max(1, Math.round(finiteNumber(value.target ?? value.required ?? value.max, 1))),
                level: Math.max(1, Math.round(finiteNumber(value.level ?? value.unlockLevel ?? value.forLevel, 1)))
            };
        });
    };

    const nodeRuntime = (snapshot, node) => snapshot?.state?.runtime?.[String(node?.id)] || {
        state: node?.state || 'locked',
        level: 1,
        maxLevel: getLevels(node).length,
        externalProgress: {}
    };

    const stateMeta = (state) => {
        if (state === 'unlocked') return { label: 'Sbloccato', className: 'is-unlocked' };
        if (state === 'unlockable') return { label: 'Disponibile', className: 'is-unlockable' };
        return { label: 'Bloccato', className: 'is-locked' };
    };

    const resolveProgressValue = (runtime, requirement) => {
        const source = runtime?.externalProgress;
        if (source && typeof source === 'object') {
            const raw = source[requirement.id];
            if (raw && typeof raw === 'object') return clamp(raw.value ?? raw.current ?? raw.progress, 0, requirement.target);
            if (raw !== undefined) return clamp(raw, 0, requirement.target);
        }
        return 0;
    };

    const nodeProgressPercent = (node, runtime) => {
        const requirements = normalizeExternalRequirements(node);
        if (!requirements.length) return null;
        const currentLevel = Math.max(1, Math.round(finiteNumber(runtime?.level, 1)));
        const maxLevel = Math.max(currentLevel, Math.round(finiteNumber(runtime?.maxLevel, getLevels(node).length)));
        const targetLevel = runtime?.state === 'unlocked' && currentLevel < maxLevel ? currentLevel + 1 : 1;
        const active = requirements.filter((entry) => entry.level === targetLevel);
        if (!active.length) return null;
        const total = active.reduce((sum, requirement) => (
            sum + resolveProgressValue(runtime, requirement) / requirement.target
        ), 0);
        return clamp(total / active.length, 0, 1);
    };

    const nodeTitleMap = (snapshot) => new Map(
        (snapshot?.tree?.nodes || []).map((node) => [String(node.id), String(node.title || node.name || node.id)])
    );

    const renderAvatar = (payload) => {
        const source = String(payload?.character?.avatar || payload?.character?.token || '').trim();
        return source
            ? `<figure class="skill-tree-print-avatar"><img src="${escapeHtml(source)}" alt=""></figure>`
            : '<figure class="skill-tree-print-avatar is-empty"><i class="fas fa-user" aria-hidden="true"></i></figure>';
    };

    const posterNode = (snapshot, node) => {
        const runtime = nodeRuntime(snapshot, node);
        const state = stateMeta(runtime.state);
        const levels = getLevels(node);
        const level = clamp(Math.round(finiteNumber(runtime.level, 1)), 1, levels.length);
        const icon = levels[level - 1]?.icon || node.icon || '';
        const x = clamp(runtime.x ?? node.x, 2, 98);
        const y = clamp(runtime.y ?? node.y, 2, 98);
        const progress = nodeProgressPercent(node, runtime);
        const progressClass = progress === null ? '' : ' has-progress';
        const progressStyle = progress === null ? '' : `--node-progress: ${Math.round(progress * 360)}deg;`;
        if (isGroupNode(node)) {
            const radius = clamp(runtime.groupRadius ?? node.groupRadius ?? 14, 8, 42);
            return `
                <div class="skill-tree-poster-group ${state.className}" style="left:${x}%;top:${y}%;width:${radius * 2}%;" title="${escapeHtml(node.title || 'Gruppo')}">
                    <strong>${escapeHtml(node.title || 'Scelta')}</strong>
                    <small>${escapeHtml(node.subtitle || node.flavor || '')}</small>
                </div>
            `;
        }
        const levelDots = levels.length > 1
            ? `<span class="skill-tree-poster-levels">${levels.map((_, index) => `<i class="${index < level ? 'is-filled' : ''}"></i>`).join('')}</span>`
            : '';
        return `
            <div class="skill-tree-poster-node ${state.className}${node.keyNode === true || node.isKey === true ? ' is-key' : ''}${progressClass}" style="left:${x}%;top:${y}%;${progressStyle}">
                <span class="skill-tree-poster-node-image">
                    ${icon ? `<img src="${escapeHtml(icon)}" alt="">` : '<i class="fas fa-sparkles" aria-hidden="true"></i>'}
                </span>
                ${levelDots}
                <strong>${escapeHtml(node.title || node.name || node.id)}</strong>
                ${levels.length > 1 ? `<small>Livello ${level}/${levels.length}</small>` : ''}
            </div>
        `;
    };

    const renderPosterConnections = (snapshot) => {
        const nodes = snapshot?.tree?.nodes || [];
        const byId = new Map(nodes.map((node) => [String(node.id), node]));
        const lines = [];
        nodes.forEach((source) => {
            normalizeConnections(source).forEach((connection) => {
                const target = byId.get(String(connection.target));
                if (!target) return;
                const sourceRuntime = nodeRuntime(snapshot, source);
                const targetRuntime = nodeRuntime(snapshot, target);
                const x1 = clamp(sourceRuntime.x ?? source.x, 0, 100);
                const y1 = clamp(sourceRuntime.y ?? source.y, 0, 100);
                const x2 = clamp(targetRuntime.x ?? target.x, 0, 100);
                const y2 = clamp(targetRuntime.y ?? target.y, 0, 100);
                const connectionState = sourceRuntime.state === 'unlocked' && targetRuntime.state === 'unlocked'
                    ? 'is-unlocked'
                    : (targetRuntime.state === 'unlockable' ? 'is-unlockable' : 'is-locked');
                lines.push(`<line class="${connectionState}${connection.mode === 'exclusive' ? ' is-exclusive' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line>`);
            });
        });
        return `<svg class="skill-tree-poster-connections" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines.join('')}</svg>`;
    };

    const renderPoster = (payload, snapshot, treeIndex) => {
        const tree = snapshot.tree || {};
        const background = String(tree.bgImage || '').trim();
        const campaign = titleCase(payload?.campaign?.name || payload?.campaign?.id || 'Campagna');
        const nodes = tree.nodes || [];
        const unlocked = nodes.filter((node) => nodeRuntime(snapshot, node).state === 'unlocked').length;
        const available = nodes.filter((node) => nodeRuntime(snapshot, node).state === 'unlockable').length;
        const dirty = snapshot.dirty ? '<span class="skill-tree-print-draft"><i class="fas fa-pen-ruler"></i> Bozza locale</span>' : '';
        return `
            <section class="skill-tree-print-poster pdf-page" data-tree-index="${treeIndex}">
                <header class="skill-tree-print-poster-head">
                    ${renderAvatar(payload)}
                    <div>
                        <span>${escapeHtml(campaign)} &middot; Albero abilita</span>
                        <h1>${escapeHtml(snapshot.label || tree.name || tree.title || snapshot.key)}</h1>
                        <p>${escapeHtml(payload?.character?.name || 'Personaggio')}</p>
                    </div>
                    <aside>
                        ${dirty}
                        <strong>${nodes.length}</strong><small>nodi</small>
                        <strong>${unlocked}</strong><small>sbloccati</small>
                    </aside>
                </header>
                <div class="skill-tree-poster-canvas">
                    ${background ? `<img class="skill-tree-poster-background" src="${escapeHtml(background)}" alt="">` : ''}
                    <div class="skill-tree-poster-overlay"></div>
                    ${renderPosterConnections(snapshot)}
                    ${nodes.map((node) => posterNode(snapshot, node)).join('')}
                </div>
                <footer class="skill-tree-print-poster-foot">
                    <div class="skill-tree-print-legend">
                        <span><i class="is-unlocked"></i> Sbloccato</span>
                        <span><i class="is-unlockable"></i> Disponibile</span>
                        <span><i class="is-locked"></i> Bloccato</span>
                        <span><i class="is-progress"></i> Requisiti esterni</span>
                    </div>
                    <span>${available} disponibili - Generato il ${new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(payload.createdAt || Date.now()))}</span>
                </footer>
            </section>
        `;
    };

    const renderPrerequisites = (snapshot, node) => {
        const titleMap = nodeTitleMap(snapshot);
        const explicit = Array.isArray(node.requires) ? node.requires : Array.isArray(node.requirements) ? node.requirements : null;
        const incoming = [];
        if (!explicit) {
            (snapshot?.tree?.nodes || []).forEach((candidate) => {
                if (normalizeConnections(candidate).some((connection) => connection.target === String(node.id))) incoming.push(String(candidate.id));
            });
        }
        const ids = (explicit || incoming).map(String).filter(Boolean);
        if (!ids.length) return '';
        return `
            <div class="skill-tree-node-facts">
                <strong>Prerequisiti</strong>
                <span>${ids.map((id) => escapeHtml(titleMap.get(id) || id)).join(node.requiresMode === 'any' ? ' oppure ' : ', ')}</span>
            </div>
        `;
    };

    const renderExternalRequirements = (snapshot, node, runtime) => {
        const requirements = normalizeExternalRequirements(node);
        if (!requirements.length) return '';
        return `
            <section class="skill-tree-node-requirements">
                <h4>Requisiti esterni</h4>
                <div>
                    ${requirements.map((requirement) => {
                        const progress = resolveProgressValue(runtime, requirement);
                        const percent = Math.round(progress / requirement.target * 100);
                        return `
                            <article>
                                <header><strong>${escapeHtml(requirement.label)}</strong><span>Livello ${requirement.level} &middot; ${progress}/${requirement.target}</span></header>
                                <i><b style="width:${percent}%"></b></i>
                            </article>
                        `;
                    }).join('')}
                </div>
            </section>
        `;
    };

    const renderChangeNotes = (level) => {
        const notes = Array.isArray(level?.changeNotes) ? level.changeNotes : [];
        if (!notes.length) return '';
        return `
            <div class="skill-tree-level-changes">
                <strong>Cosa cambia</strong>
                ${notes.map((note) => {
                    const label = note.label || 'Modifica';
                    if (note.type === 'added') return `<span class="is-added"><b>+</b><em>${escapeHtml(label)}</em> ${escapeHtml(note.after || '')}</span>`;
                    if (note.type === 'removed') return `<span class="is-removed"><b>-</b><em>${escapeHtml(label)}</em> ${escapeHtml(note.before || '')}</span>`;
                    return `<span><em>${escapeHtml(label)}</em><del>${escapeHtml(note.before || '-')}</del><i class="fas fa-arrow-right"></i><b>${escapeHtml(note.after || '-')}</b></span>`;
                }).join('')}
            </div>
        `;
    };

    const renderNodeDetail = (snapshot, node, index) => {
        const runtime = nodeRuntime(snapshot, node);
        const meta = stateMeta(runtime.state);
        const levels = getLevels(node);
        const activeLevel = clamp(Math.round(finiteNumber(runtime.level, 1)), 1, levels.length);
        const icon = levels[activeLevel - 1]?.icon || node.icon || '';
        if (isGroupNode(node)) {
            const children = Array.isArray(node.children) ? node.children : [];
            const titles = nodeTitleMap(snapshot);
            return `
                <article class="skill-tree-node-card is-group">
                    <header>
                        <span class="skill-tree-node-index">${String(index + 1).padStart(2, '0')}</span>
                        <div><span>Gruppo di scelta</span><h3>${escapeHtml(node.title || 'Scelta')}</h3></div>
                    </header>
                    ${node.flavor ? `<p class="skill-tree-node-flavor">${escapeHtml(node.flavor)}</p>` : ''}
                    ${renderPrerequisites(snapshot, node)}
                    ${children.length ? `<div class="skill-tree-node-facts"><strong>Nodi inclusi</strong><span>${children.map((id) => escapeHtml(titles.get(String(id)) || id)).join(', ')}</span></div>` : ''}
                    ${renderExternalRequirements(snapshot, node, runtime)}
                </article>
            `;
        }
        return `
            <article class="skill-tree-node-card">
                <header>
                    <span class="skill-tree-node-index">${String(index + 1).padStart(2, '0')}</span>
                    <figure>${icon ? `<img src="${escapeHtml(icon)}" alt="">` : '<i class="fas fa-sparkles"></i>'}</figure>
                    <div>
                        <span class="skill-tree-node-state ${meta.className}">${meta.label}${levels.length > 1 ? ` &middot; Livello ${activeLevel}/${levels.length}` : ''}</span>
                        <h3>${escapeHtml(node.title || node.name || node.id)}</h3>
                    </div>
                </header>
                ${node.flavor || node.subtitle ? `<p class="skill-tree-node-flavor">${escapeHtml(node.flavor || node.subtitle)}</p>` : ''}
                ${renderPrerequisites(snapshot, node)}
                ${renderExternalRequirements(snapshot, node, runtime)}
                <div class="skill-tree-node-level-list">
                    ${levels.map((level, levelIndex) => {
                        const description = sanitizeRichHtml(level.desc);
                        return `
                            <section class="skill-tree-node-level${levelIndex + 1 === activeLevel ? ' is-current' : ''}">
                                <header><span>Livello ${levelIndex + 1}</span><strong>${escapeHtml(level.label || level.title || node.title || '')}</strong>${levelIndex + 1 === activeLevel ? '<em>Attuale</em>' : ''}</header>
                                ${renderChangeNotes(level)}
                                ${description ? `<div class="skill-tree-node-description">${description}</div>` : '<p class="skill-tree-node-empty">Nessuna descrizione per questo livello.</p>'}
                            </section>
                        `;
                    }).join('')}
                </div>
            </article>
        `;
    };

    const renderCatalog = (payload, snapshot, treeIndex) => {
        const nodes = snapshot?.tree?.nodes || [];
        const campaign = titleCase(payload?.campaign?.name || payload?.campaign?.id || 'Campagna');
        return `
            <section class="skill-tree-print-catalog" data-tree-index="${treeIndex}">
                <header class="skill-tree-print-catalog-head">
                    <div>
                        <span>${escapeHtml(campaign)} &middot; ${escapeHtml(payload?.character?.name || 'Personaggio')}</span>
                        <h2>${escapeHtml(snapshot.label || snapshot.key)}</h2>
                        <p>Schede complete dei nodi, livelli e requisiti.</p>
                    </div>
                    <strong>${nodes.length}<small>nodi</small></strong>
                </header>
                <div class="skill-tree-node-catalog">
                    ${nodes.map((node, index) => renderNodeDetail(snapshot, node, index)).join('')}
                </div>
            </section>
        `;
    };

    const renderDocument = (payload) => {
        const trees = Array.isArray(payload?.trees) ? payload.trees : [];
        if (!trees.length) throw new Error('Nessun albero presente nell esportazione.');
        const includeCatalog = payload.format !== 'poster';
        root.innerHTML = trees.map((snapshot, index) => (
            renderPoster(payload, snapshot, index)
            + (includeCatalog ? renderCatalog(payload, snapshot, index) : '')
        )).join('');
        documentTitle.textContent = `${payload.character?.name || 'Personaggio'} - ${trees.length === 1 ? trees[0].label : 'Alberi abilita'}`;
        document.title = `${payload.character?.name || 'Personaggio'} - Alberi abilita`;
    };

    const preloadDocumentAssets = async () => {
        const images = Array.from(root.querySelectorAll('img'));
        await Promise.all(images.map(async (image) => {
            if (image.complete) {
                if (!image.naturalWidth) image.closest('figure, .skill-tree-poster-node-image')?.classList.add('is-image-missing');
                return;
            }
            try {
                await Promise.race([
                    image.decode(),
                    new Promise((_, reject) => window.setTimeout(() => reject(new Error('timeout')), 12000))
                ]);
            } catch (_) {
                image.closest('figure, .skill-tree-poster-node-image')?.classList.add('is-image-missing');
            }
        }));
        try {
            await Promise.race([
                document.fonts?.ready || Promise.resolve(),
                new Promise((resolve) => window.setTimeout(resolve, 5000))
            ]);
        } catch (_) {
            // I font di fallback mantengono il documento stampabile.
        }
        await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
    };

    const renderError = (message) => {
        document.body.classList.remove('is-loading');
        document.body.classList.add('has-error');
        root.innerHTML = `
            <section class="skill-tree-print-error">
                <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
                <h1>Anteprima non disponibile</h1>
                <p>${escapeHtml(message)}</p>
                <button type="button" data-error-close>Torna alla scheda</button>
            </section>
        `;
        status.textContent = 'Impossibile preparare il documento.';
        root.querySelector('[data-error-close]')?.addEventListener('click', () => closeButton?.click());
    };

    closeButton?.addEventListener('click', () => {
        if (window.history.length > 1 && !window.opener) window.history.back();
        else window.close();
    });
    printButton?.addEventListener('click', () => window.print());

    const init = async () => {
        const exportId = new URLSearchParams(window.location.search).get('export') || '';
        if (!/^[a-z0-9-]{8,80}$/i.test(exportId)) {
            renderError('Il collegamento di esportazione non e valido. Torna alla scheda e genera una nuova anteprima.');
            return;
        }
        let payload = null;
        try {
            payload = JSON.parse(window.localStorage.getItem(`${STORAGE_PREFIX}${exportId}`) || 'null');
        } catch (_) {
            payload = null;
        }
        const createdAt = Date.parse(payload?.createdAt || '');
        if (!payload || !Number.isFinite(createdAt) || Date.now() - createdAt > MAX_AGE_MS) {
            renderError('Questa anteprima e scaduta o non appartiene a questo browser. Generane una nuova dalla scheda del personaggio.');
            return;
        }
        try {
            renderDocument(payload);
            await preloadDocumentAssets();
            document.body.classList.remove('is-loading');
            document.body.classList.add('is-ready');
            printButton.disabled = false;
            status.textContent = 'Documento pronto. Scegli Salva come PDF nella finestra di stampa.';
        } catch (error) {
            console.error('Rendering PDF albero fallito:', error);
            renderError(error?.message || String(error));
        }
    };

    init();
})();
