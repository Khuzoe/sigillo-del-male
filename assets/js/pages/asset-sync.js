(function () {
    const state = {
        records: [],
        status: '',
        type: '',
        search: ''
    };

    const STATUS_LABELS = {
        'in-sync': 'Allineato',
        'foundry-only': 'Solo Foundry',
        'foundry-updated': 'Foundry aggiornato',
        'site-only': 'Solo Sito',
        'site-updated': 'Sito aggiornato',
        different: 'Differente',
        unlinked: 'Non collegato'
    };

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeText(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
    }

    function labelStatus(status) {
        return STATUS_LABELS[status] || status || 'Sconosciuto';
    }

    function getEls() {
        return {
            refresh: document.getElementById('asset-sync-refresh'),
            summary: document.getElementById('asset-sync-summary'),
            table: document.getElementById('asset-sync-table'),
            status: document.getElementById('asset-sync-status'),
            type: document.getElementById('asset-sync-type'),
            search: document.getElementById('asset-sync-search')
        };
    }

    async function loadRegistry() {
        const els = getEls();
        if (els.table) {
            els.table.innerHTML = '<p class="asset-sync-state">Caricamento registry...</p>';
        }
        try {
            const [registryPayload, itemOverrides, abilityOverrides, mediaOverrides] = await Promise.all([
                loadDataCollection('asset-registry'),
                loadDataCollection('item-overrides'),
                loadDataCollection('ability-overrides'),
                loadDataCollection('media-overrides')
            ]);
            state.records = enrichRegistryWithSiteOverrides(
                Array.isArray(registryPayload?.data) ? registryPayload.data : [],
                {
                    itemOverrides: Array.isArray(itemOverrides?.data) ? itemOverrides.data : [],
                    abilityOverrides: Array.isArray(abilityOverrides?.data) ? abilityOverrides.data : [],
                    mediaOverrides: Array.isArray(mediaOverrides?.data) ? mediaOverrides.data : []
                }
            );
            populateFilters();
            render();
        } catch (error) {
            console.error('Errore caricamento asset registry:', error);
            if (els.table) {
                els.table.innerHTML = '<p class="asset-sync-state is-error">Impossibile caricare il registry asset.</p>';
            }
        }
    }

    async function loadDataCollection(collection) {
        try {
            return await window.CriptaApp.api.get(`api/data/${collection}`, { query: { _: Date.now() } });
        } catch (error) {
            console.warn(`Collection ${collection} non disponibile per diagnostica asset.`, error);
            return { data: [] };
        }
    }

    function enrichRegistryWithSiteOverrides(records, overrideDocs) {
        const nextRecords = (Array.isArray(records) ? records : []).map((record) => ({ ...record }));
        const byId = new Map(nextRecords.map((record) => [record.id, record]));
        const ensureRecord = (record) => {
            if (byId.has(record.id)) return byId.get(record.id);
            byId.set(record.id, record);
            nextRecords.push(record);
            return record;
        };

        applyItemOverrides(nextRecords, byId, ensureRecord, overrideDocs.itemOverrides);
        applyAbilityOverrides(nextRecords, byId, ensureRecord, overrideDocs.abilityOverrides);
        applyMediaOverrides(nextRecords, byId, ensureRecord, overrideDocs.mediaOverrides);

        return nextRecords
            .map(refreshRecordStatus)
            .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
    }

    function applyItemOverrides(records, byId, ensureRecord, overrides) {
        (Array.isArray(overrides) ? overrides : []).forEach((override) => {
            if (!override || typeof override !== 'object') return;
            if (override.image) {
                const record = findAssetRecord(records, override, 'item', 'image')
                    || ensureRecord(createSiteOnlyRecord(override, 'item', 'image', override.itemName || override.itemId || 'Oggetto'));
                record.siteState = buildSiteState(override.image, override.updatedAt, 'item-overrides');
            }
            if (override.description) {
                const record = findAssetRecord(records, override, 'item', 'description')
                    || ensureRecord(createSiteOnlyRecord(override, 'item', 'description', override.itemName || override.itemId || 'Oggetto'));
                record.siteState = buildSiteState(override.description, override.updatedAt, 'item-overrides');
            }
        });
    }

    function applyAbilityOverrides(records, byId, ensureRecord, overrides) {
        (Array.isArray(overrides) ? overrides : []).forEach((override) => {
            if (!override || typeof override !== 'object') return;
            if (override.image) {
                const record = findAssetRecord(records, override, 'ability', 'image')
                    || ensureRecord(createSiteOnlyRecord(override, 'ability', 'image', override.abilityName || override.abilityId || 'Abilita'));
                record.siteState = buildSiteState(override.image, override.updatedAt, 'ability-overrides');
            }
            if (override.description) {
                const record = findAssetRecord(records, override, 'ability', 'description')
                    || ensureRecord(createSiteOnlyRecord(override, 'ability', 'description', override.abilityName || override.abilityId || 'Abilita'));
                record.siteState = buildSiteState(override.description, override.updatedAt, 'ability-overrides');
            }
        });
    }

    function applyMediaOverrides(records, byId, ensureRecord, overrides) {
        (Array.isArray(overrides) ? overrides : []).forEach((override) => {
            if (!override || typeof override !== 'object') return;
            const entityType = normalizeAssetToken(override.entityType || '');
            const entityId = normalizeAssetId(override.entityId || override.characterId || override.id || '');
            if (!entityType || !entityId) return;
            const images = override.images || {};
            ['avatar', 'portrait', 'token'].forEach((slot) => {
                const value = images[slot];
                if (!value) return;
                const normalizedSlot = slot === 'portrait' ? 'avatar' : slot;
                const record = findMediaAssetRecord(records, override, entityType, entityId, normalizedSlot) || ensureRecord({
                    id: `${getCurrentCampaignId()}:${entityType}:${entityId}:${normalizedSlot}`,
                    entityType,
                    entityId,
                    slot: normalizedSlot,
                    label: override.name || override.characterName || entityId,
                    syncStatus: 'site-only'
                });
                record.siteState = buildSiteState(value, override.updatedAt, 'media-overrides');
            });
        });
    }

    function findMediaAssetRecord(records, override, entityType, entityId, slot) {
        const normalizedType = normalizeAssetToken(entityType);
        const normalizedEntityId = normalizeAssetId(entityId);
        const normalizedSlot = normalizeAssetToken(slot);
        const actorId = normalizeText(override.actorId || '');
        const foundryName = normalizeText(override.foundryName || override.name || '');
        const ownerId = normalizeText(override.ownerCharacterId || override.characterId || '');

        return records.find((entry) => {
            if (normalizeAssetToken(entry.entityType) !== normalizedType) return false;
            if (normalizeAssetToken(entry.slot) !== normalizedSlot) return false;
            if (normalizeAssetId(entry.entityId) === normalizedEntityId) return true;

            const foundry = entry.foundry || {};
            if (actorId && normalizeText(foundry.actorId) === actorId) return true;
            if (!foundryName) return false;

            const entryName = normalizeText(foundry.actorName || entry.label || '');
            const entryEntity = normalizeText(entry.entityId || '');
            if (!(entryName === foundryName || entryEntity.includes(foundryName) || foundryName.includes(entryName))) return false;
            return !ownerId || entryEntity.includes(ownerId);
        }) || null;
    }

    function findAssetRecord(records, override, entityType, slot) {
        const normalizedType = normalizeAssetToken(entityType);
        const normalizedSlot = normalizeAssetToken(slot);
        return records.find((record) => {
            if (normalizeAssetToken(record.entityType) !== normalizedType) return false;
            if (normalizeAssetToken(record.slot) !== normalizedSlot) return false;
            const foundry = record.foundry || {};
            const sameActor = sameId(foundry.actorId, override.actorId)
                || sameText(foundry.actorName, override.actorName)
                || sameText(foundry.actorName, override.characterName);
            const sameEntry = sameId(foundry.itemId, override.itemId || override.abilityId)
                || sameText(foundry.itemName, override.itemName || override.abilityName);
            return sameActor && sameEntry;
        }) || null;
    }

    function createSiteOnlyRecord(override, entityType, slot, label) {
        const owner = slugify(override.characterId || override.actorId || override.characterName || override.actorName || 'personaggio');
        const entry = slugify(override.itemId || override.abilityId || override.itemName || override.abilityName || 'elemento');
        return {
            id: `${getCurrentCampaignId()}:${entityType}:${owner}-${entry}:${slot}`,
            entityType,
            entityId: `${owner}-${entry}`,
            slot,
            label,
            foundry: {
                actorId: override.actorId || '',
                actorName: override.actorName || override.characterName || '',
                itemId: override.itemId || override.abilityId || '',
                itemName: override.itemName || override.abilityName || ''
            },
            syncStatus: 'site-only'
        };
    }

    function buildSiteState(value, updatedAt, source) {
        return {
            value: String(value || '').trim(),
            hash: `site:${hashString(value)}`,
            source,
            updatedAt: String(updatedAt || '').trim()
        };
    }

    function refreshRecordStatus(record) {
        const siteValue = String(record.siteState?.value || '').trim();
        const foundryValue = String(record.foundryState?.value || '').trim();
        const siteCompareValue = normalizeStateCompareValue(siteValue, record.slot);
        const foundryCompareValue = normalizeStateCompareValue(foundryValue, record.slot);
        let syncStatus = record.syncStatus || 'unlinked';
        if (siteValue && foundryValue) syncStatus = siteCompareValue === foundryCompareValue ? 'in-sync' : 'different';
        else if (siteValue) syncStatus = 'site-only';
        else if (foundryValue) syncStatus = record.syncStatus || 'foundry-only';
        return { ...record, syncStatus };
    }

    function normalizeStateCompareValue(value, slot) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        if (!isImageSlot(slot)) {
            return raw.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
        }

        let text = raw.replace(/\\/g, '/').trim();
        try {
            const url = new URL(text);
            text = url.pathname;
        } catch (_error) {
            // Not an absolute URL; keep the original path-like value.
        }

        text = text
            .replace(/^\/+/, '')
            .replace(/^sigillo-del-male\//i, '')
            .replace(/^assets\//i, '');

        const mediaIndex = text.toLowerCase().indexOf('media/');
        if (mediaIndex >= 0) text = text.slice(mediaIndex);

        return decodeURIComponent(text)
            .replace(/\/+/g, '/')
            .toLowerCase()
            .trim();
    }

    function isImageSlot(slot) {
        return ['image', 'avatar', 'portrait', 'token', 'icon'].includes(String(slot || '').toLowerCase());
    }

    function sameId(left, right) {
        return Boolean(left && right && String(left) === String(right));
    }

    function sameText(left, right) {
        const a = normalizeText(left);
        const b = normalizeText(right);
        return Boolean(a && b && a === b);
    }

    function slugify(value) {
        return normalizeText(value)
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'elemento';
    }

    function normalizeAssetToken(value) {
        return slugify(value);
    }

    function normalizeAssetId(value) {
        return normalizeText(value)
            .replace(/[^a-z0-9:_-]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function getCurrentCampaignId() {
        return window.CriptaApp?.campaign?.getCurrentId?.()
            || new URL(window.location.href).searchParams.get('campaign')
            || 'cripta-di-sangue';
    }

    function hashString(value) {
        const text = String(value || '');
        let hash = 2166136261;
        for (let i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    function populateFilters() {
        const els = getEls();
        const selectedStatus = state.status;
        const selectedType = state.type;
        const statuses = Array.from(new Set(state.records.map((record) => record.syncStatus).filter(Boolean))).sort();
        const types = Array.from(new Set(state.records.map((record) => record.entityType).filter(Boolean))).sort();
        if (els.status) {
            els.status.innerHTML = '<option value="">Tutti</option>' + statuses
                .map((status) => `<option value="${escapeHtml(status)}"${status === selectedStatus ? ' selected' : ''}>${escapeHtml(labelStatus(status))}</option>`)
                .join('');
        }
        if (els.type) {
            els.type.innerHTML = '<option value="">Tutti</option>' + types
                .map((type) => `<option value="${escapeHtml(type)}"${type === selectedType ? ' selected' : ''}>${escapeHtml(type)}</option>`)
                .join('');
        }
    }

    function getFilteredRecords() {
        const needle = normalizeText(state.search);
        return state.records.filter((record) => {
            if (state.status && record.syncStatus !== state.status) return false;
            if (state.type && record.entityType !== state.type) return false;
            if (!needle) return true;
            const haystack = normalizeText([
                record.id,
                record.entityType,
                record.entityId,
                record.slot,
                record.label,
                record.foundryState?.value,
                record.siteState?.value,
                record.foundry?.actorName,
                record.foundry?.itemName,
                record.foundry?.uuid
            ].filter(Boolean).join(' '));
            return haystack.includes(needle);
        });
    }

    function renderSummary() {
        const els = getEls();
        if (!els.summary) return;
        const counts = state.records.reduce((acc, record) => {
            const key = record.syncStatus || 'unknown';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        const cards = [
            ['Totale', state.records.length],
            ...Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([status, count]) => [labelStatus(status), count])
        ];
        els.summary.innerHTML = cards.map(([label, count]) => `
            <article class="asset-sync-summary-card">
                <strong>${escapeHtml(count)}</strong>
                <span>${escapeHtml(label)}</span>
            </article>
        `).join('');
    }

    function renderTable() {
        const els = getEls();
        if (!els.table) return;
        const rows = getFilteredRecords();
        if (!rows.length) {
            els.table.innerHTML = '<p class="asset-sync-state">Nessun asset trovato con questi filtri.</p>';
            return;
        }
        els.table.innerHTML = `
            <table class="asset-sync-table">
                <thead>
                    <tr>
                        <th>Stato</th>
                        <th>Entita</th>
                        <th>Slot</th>
                        <th>Sito</th>
                        <th>Foundry</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(renderRow).join('')}
                </tbody>
            </table>
        `;
    }

    function renderRow(record) {
        const foundry = record.foundry || {};
        const foundryLabel = [foundry.actorName, foundry.itemName].filter(Boolean).join(' / ') || foundry.uuid || '-';
        const siteState = record.siteState || {};
        const foundryState = record.foundryState || {};
        const rowClass = record.syncStatus === 'different' ? ' class="is-different"' : '';
        return `
            <tr${rowClass}>
                <td><span class="asset-sync-status asset-sync-status--${escapeHtml(record.syncStatus || 'unknown')}">${escapeHtml(labelStatus(record.syncStatus))}</span></td>
                <td>
                    <strong>${escapeHtml(record.label || record.entityId || record.id)}</strong>
                    <small>${escapeHtml(record.entityType || '')} / ${escapeHtml(record.entityId || '')}</small>
                </td>
                <td>${escapeHtml(record.slot || '')}</td>
                <td>${renderStateCell(siteState, 'site')}</td>
                <td>
                    ${renderStateCell(foundryState, 'foundry')}
                    <div class="asset-sync-foundry-ref">
                        <span>${escapeHtml(foundryLabel)}</span>
                        ${foundry.uuid ? `<small>${escapeHtml(foundry.uuid)}</small>` : ''}
                    </div>
                </td>
            </tr>
        `;
    }

    function renderStateCell(cellState, side) {
        const value = String(cellState?.value || '').trim();
        const hash = String(cellState?.hash || '').trim();
        const updatedAt = String(cellState?.updatedAt || '').trim();
        const isEmpty = !value && !hash;
        if (isEmpty) {
            return `
                <div class="asset-sync-side asset-sync-side--empty asset-sync-side--${escapeHtml(side)}">
                    <strong>${side === 'site' ? 'Sito' : 'Foundry'}</strong>
                    <span>Non presente</span>
                </div>
            `;
        }
        return `
            <div class="asset-sync-side asset-sync-side--${escapeHtml(side)}">
                <strong>${side === 'site' ? 'Sito' : 'Foundry'}</strong>
                ${value ? `<code>${escapeHtml(value)}</code>` : '<span>Nessun valore</span>'}
                ${hash ? `<small>Hash: ${escapeHtml(hash)}</small>` : ''}
                ${updatedAt ? `<small>Aggiornato: ${escapeHtml(formatDate(updatedAt))}</small>` : ''}
            </div>
        `;
    }

    function formatDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString('it-IT', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function render() {
        renderSummary();
        renderTable();
    }

    window.CriptaApp.onPageReady('asset-sync', () => {
        const els = getEls();
        els.refresh?.addEventListener('click', () => loadRegistry());
        els.status?.addEventListener('change', () => {
            state.status = els.status.value;
            render();
        });
        els.type?.addEventListener('change', () => {
            state.type = els.type.value;
            render();
        });
        els.search?.addEventListener('input', () => {
            state.search = els.search.value;
            render();
        });
        loadRegistry();
    });
})();
