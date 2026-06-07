(function () {
    const state = {
        records: [],
        campaign: '',
        status: '',
        type: '',
        integrity: '',
        showArchived: false,
        search: '',
        selectedIds: new Set(),
        cleanupPlan: null,
        selectedCleanupKvIds: new Set(),
        selectedCleanupR2Keys: new Set(),
        jobsPayloads: new Map(),
        archivePayloads: new Map()
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

    const INTEGRITY_LABELS = {
        ok: 'ActorId OK',
        'site-linked': 'Solo sito con ActorId',
        'foundry-linked': 'Solo Foundry con ActorId',
        merged: 'Unito da legacy',
        partial: 'Collegamento parziale',
        legacy: 'Legacy senza ActorId',
        orphan: 'Orfano',
        archived: 'Archiviato'
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
            campaign: document.getElementById('asset-sync-campaign'),
            status: document.getElementById('asset-sync-status'),
            type: document.getElementById('asset-sync-type'),
            integrity: document.getElementById('asset-sync-integrity'),
            showArchived: document.getElementById('asset-sync-show-archived'),
            search: document.getElementById('asset-sync-search'),
            selectionCount: document.getElementById('asset-sync-selection-count'),
            selectDifferent: document.getElementById('asset-sync-select-different'),
            selectVisible: document.getElementById('asset-sync-select-visible'),
            selectProblematic: document.getElementById('asset-sync-select-problematic'),
            clearSelection: document.getElementById('asset-sync-clear-selection'),
            archiveSelected: document.getElementById('asset-sync-archive-selected'),
            queueSiteToFoundry: document.getElementById('asset-sync-queue-site-to-foundry'),
            queueFoundryToSite: document.getElementById('asset-sync-queue-foundry-to-site'),
            cleanupDryRun: document.getElementById('asset-sync-cleanup-dry-run'),
            cleanupSelectAll: document.getElementById('asset-sync-cleanup-select-all'),
            cleanupApply: document.getElementById('asset-sync-cleanup-apply'),
            cleanupPanel: document.getElementById('asset-sync-cleanup-panel'),
            message: document.getElementById('asset-sync-message')
        };
    }

    async function loadRegistry() {
        const els = getEls();
        if (els.table) {
            els.table.innerHTML = '<p class="asset-sync-state">Caricamento registry...</p>';
        }
        try {
            const campaignIds = await loadAssetSyncCampaignIds();
            const campaignPayloads = await Promise.all(campaignIds.map(loadCampaignAssetSyncPayload));
            state.jobsPayloads = new Map(campaignPayloads.map((payload) => [payload.campaignId, payload.jobs]));
            state.archivePayloads = new Map(campaignPayloads.map((payload) => [payload.campaignId, payload.archive]));
            state.records = campaignPayloads.flatMap((payload) => enrichRegistryWithSiteOverrides(
                Array.isArray(payload.registry?.data) ? payload.registry.data : [],
                {
                    campaignId: payload.campaignId,
                    itemOverrides: Array.isArray(payload.itemOverrides?.data) ? payload.itemOverrides.data : [],
                    abilityOverrides: Array.isArray(payload.abilityOverrides?.data) ? payload.abilityOverrides.data : [],
                    mediaOverrides: Array.isArray(payload.mediaOverrides?.data) ? payload.mediaOverrides.data : [],
                    archive: Array.isArray(payload.archive?.data) ? payload.archive.data : []
                }
            ));
            if (!state.campaign) {
                const currentCampaign = getCurrentCampaignId();
                const availableCampaigns = new Set(state.records.map((record) => getRecordCampaignId(record)).filter(Boolean));
                if (availableCampaigns.has(currentCampaign)) state.campaign = currentCampaign;
            }
            pruneSelection();
            populateFilters();
            render();
        } catch (error) {
            console.error('Errore caricamento asset registry:', error);
            if (els.table) {
                els.table.innerHTML = '<p class="asset-sync-state is-error">Impossibile caricare il registry asset.</p>';
            }
        }
    }

    async function loadAssetSyncCampaignIds() {
        try {
            const url = window.CriptaApp?.urls?.globalData?.('campaigns.json') || 'assets/data/campaigns.json';
            const payload = await window.CriptaApp.fetchJson(url);
            const campaigns = Array.isArray(payload?.campaigns) ? payload.campaigns : [];
            const ids = campaigns
                .filter((campaign) => campaign?.enabled !== false && campaign?.id)
                .map((campaign) => slugify(campaign.id))
                .filter(Boolean);
            return ids.length ? Array.from(new Set(ids)) : [getCurrentCampaignId()];
        } catch (error) {
            console.warn('Impossibile caricare campaigns.json per Asset Sync, uso la campagna corrente.', error);
            return [getCurrentCampaignId()];
        }
    }

    async function loadCampaignAssetSyncPayload(campaignId) {
        const [registry, itemOverrides, abilityOverrides, mediaOverrides, jobs, archive] = await Promise.all([
            loadDataCollection('asset-registry', campaignId),
            loadDataCollection('item-overrides', campaignId),
            loadDataCollection('ability-overrides', campaignId),
            loadDataCollection('media-overrides', campaignId),
            loadDataCollection('asset-sync-jobs', campaignId),
            loadDataCollection('asset-sync-archive', campaignId)
        ]);
        return { campaignId, registry, itemOverrides, abilityOverrides, mediaOverrides, jobs, archive };
    }

    async function loadDataCollection(collection, campaignId = getCurrentCampaignId()) {
        try {
            return await window.CriptaApp.api.get(`api/data/${collection}`, { campaignId, query: { _: Date.now() } });
        } catch (error) {
            console.warn(`Collection ${collection} non disponibile per diagnostica asset (${campaignId}).`, error);
            return { campaignId, data: [] };
        }
    }

    function readAuthToken() {
        return String(window.CriptaDiscordAuth?.getToken?.() || window.CriptaApp?.auth?.getToken?.() || '').trim();
    }

    function enrichRegistryWithSiteOverrides(records, overrideDocs) {
        const campaignId = overrideDocs?.campaignId || getCurrentCampaignId();
        const nextRecords = (Array.isArray(records) ? records : []).map((record) => ({ campaignId, ...record }));
        const byId = new Map(nextRecords.map((record) => [record.id, record]));
        const ensureRecord = (record) => {
            if (byId.has(record.id)) return byId.get(record.id);
            byId.set(record.id, record);
            nextRecords.push(record);
            return record;
        };

        applyItemOverrides(nextRecords, byId, ensureRecord, overrideDocs.itemOverrides, campaignId);
        applyAbilityOverrides(nextRecords, byId, ensureRecord, overrideDocs.abilityOverrides, campaignId);
        applyMediaOverrides(nextRecords, byId, ensureRecord, overrideDocs.mediaOverrides, campaignId);

        const archivedIds = buildArchiveIdSet(overrideDocs.archive);

        return dedupeCanonicalRecords(nextRecords)
            .map(refreshRecordStatus)
            .map(enrichRecordIntegrity)
            .map((record) => markArchivedRecord(record, archivedIds))
            .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
    }

    function dedupeCanonicalRecords(records) {
        const byKey = new Map();
        const output = [];
        (Array.isArray(records) ? records : []).forEach((record) => {
            const key = getCanonicalRecordKey(record);
            if (!key) {
                output.push(record);
                return;
            }
            const existing = byKey.get(key);
            if (!existing) {
                byKey.set(key, record);
                output.push(record);
                return;
            }
            const merged = mergeCanonicalRecords(existing, record);
            byKey.set(key, merged);
            const index = output.indexOf(existing);
            if (index >= 0) output[index] = merged;
        });
        return output;
    }

    function getCanonicalRecordKey(record) {
        const entityType = normalizeAssetToken(record?.entityType || '');
        const slot = normalizeAssetToken(record?.slot || '');
        const foundry = record?.foundry || {};
        const actorId = normalizeAssetId(foundry.actorId || record?.actorId || '');
        if (!entityType || !slot || !actorId) return '';
        if (entityType === 'player' || entityType === 'companion') {
            return `${entityType}:${actorId}:${slot}`;
        }
        const itemId = normalizeAssetId(foundry.itemId || record?.itemId || '');
        if (!itemId) return '';
        return `${entityType}:${actorId}:${itemId}:${slot}`;
    }

    function mergeCanonicalRecords(left, right) {
        const preferred = preferCanonicalRecord(left, right);
        const other = preferred === left ? right : left;
        return {
            ...other,
            ...preferred,
            foundry: {
                ...(other.foundry || {}),
                ...(preferred.foundry || {})
            },
            siteState: pickLatestState(left.siteState, right.siteState) || preferred.siteState || other.siteState,
            foundryState: pickLatestState(left.foundryState, right.foundryState) || preferred.foundryState || other.foundryState,
            mergedIds: Array.from(new Set([
                ...(Array.isArray(left.mergedIds) ? left.mergedIds : [left.id]),
                ...(Array.isArray(right.mergedIds) ? right.mergedIds : [right.id])
            ].filter(Boolean)))
        };
    }

    function preferCanonicalRecord(left, right) {
        const leftScore = getCanonicalRecordScore(left);
        const rightScore = getCanonicalRecordScore(right);
        return rightScore > leftScore ? right : left;
    }

    function getCanonicalRecordScore(record) {
        const entityId = normalizeAssetId(record?.entityId || '');
        const actorId = normalizeAssetId(record?.foundry?.actorId || record?.actorId || '');
        let score = 0;
        if (actorId && entityId.includes(actorId.toLowerCase())) score += 8;
        if (record?.siteState?.value) score += 4;
        if (record?.foundryState?.value) score += 2;
        if (record?.syncStatus === 'in-sync') score += 1;
        return score;
    }

    function pickLatestState(left, right) {
        if (!left?.value) return right?.value ? right : null;
        if (!right?.value) return left;
        const leftTime = Date.parse(left.updatedAt || '') || 0;
        const rightTime = Date.parse(right.updatedAt || '') || 0;
        return rightTime > leftTime ? right : left;
    }

    function applyItemOverrides(records, byId, ensureRecord, overrides, campaignId) {
        (Array.isArray(overrides) ? overrides : []).forEach((override) => {
            if (!override || typeof override !== 'object') return;
            if (override.image) {
                const record = findAssetRecord(records, override, 'item', 'image')
                    || ensureRecord(createSiteOnlyRecord(override, 'item', 'image', override.itemName || override.itemId || 'Oggetto', campaignId));
                record.siteState = buildSiteState(override.image, override.updatedAt, 'item-overrides');
            }
            if (override.description) {
                const record = findAssetRecord(records, override, 'item', 'description')
                    || ensureRecord(createSiteOnlyRecord(override, 'item', 'description', override.itemName || override.itemId || 'Oggetto', campaignId));
                record.siteState = buildSiteState(override.description, override.updatedAt, 'item-overrides');
            }
        });
    }

    function applyAbilityOverrides(records, byId, ensureRecord, overrides, campaignId) {
        (Array.isArray(overrides) ? overrides : []).forEach((override) => {
            if (!override || typeof override !== 'object') return;
            if (override.image) {
                const record = findAssetRecord(records, override, 'ability', 'image')
                    || ensureRecord(createSiteOnlyRecord(override, 'ability', 'image', override.abilityName || override.abilityId || 'Abilita', campaignId));
                record.siteState = buildSiteState(override.image, override.updatedAt, 'ability-overrides');
            }
            if (override.description) {
                const record = findAssetRecord(records, override, 'ability', 'description')
                    || ensureRecord(createSiteOnlyRecord(override, 'ability', 'description', override.abilityName || override.abilityId || 'Abilita', campaignId));
                record.siteState = buildSiteState(override.description, override.updatedAt, 'ability-overrides');
            }
        });
    }

    function applyMediaOverrides(records, byId, ensureRecord, overrides, campaignId) {
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
                    id: `${campaignId}:${entityType}:${entityId}:${normalizedSlot}`,
                    campaignId,
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

    function createSiteOnlyRecord(override, entityType, slot, label, campaignId = getCurrentCampaignId()) {
        const owner = slugify(override.characterId || override.actorId || override.characterName || override.actorName || 'personaggio');
        const entry = slugify(override.itemId || override.abilityId || override.itemName || override.abilityName || 'elemento');
        return {
            id: `${campaignId}:${entityType}:${owner}-${entry}:${slot}`,
            campaignId,
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

    function enrichRecordIntegrity(record) {
        const foundry = record?.foundry || {};
        const entityType = normalizeAssetToken(record?.entityType || '');
        const actorId = normalizeAssetId(foundry.actorId || record?.actorId || '');
        const itemId = normalizeAssetId(foundry.itemId || record?.itemId || '');
        const needsItemId = entityType === 'item' || entityType === 'ability';
        const hasRequiredIds = Boolean(actorId && (!needsItemId || itemId));
        let integrityStatus = 'ok';

        if (Array.isArray(record?.mergedIds) && record.mergedIds.length > 1) {
            integrityStatus = hasRequiredIds ? 'merged' : 'partial';
        } else if (record.syncStatus === 'site-only' && hasRequiredIds) {
            integrityStatus = 'site-linked';
        } else if (record.syncStatus === 'foundry-only' && hasRequiredIds) {
            integrityStatus = 'foundry-linked';
        } else if (!hasRequiredIds) {
            if (actorId) integrityStatus = 'partial';
            else if (record.siteState?.value) integrityStatus = 'legacy';
            else integrityStatus = 'orphan';
        }

        return {
            ...record,
            integrityStatus,
            integrityLabel: labelIntegrity(integrityStatus)
        };
    }

    function buildArchiveIdSet(archiveRecords) {
        const ids = new Set();
        (Array.isArray(archiveRecords) ? archiveRecords : []).forEach((entry) => {
            [
                entry?.assetId,
                entry?.record?.id,
                ...(Array.isArray(entry?.assetIds) ? entry.assetIds : []),
                ...(Array.isArray(entry?.record?.mergedIds) ? entry.record.mergedIds : [])
            ].forEach((id) => {
                const text = String(id || '').trim();
                if (text) ids.add(text);
            });
        });
        return ids;
    }

    function markArchivedRecord(record, archivedIds) {
        const ids = [
            record?.id,
            ...(Array.isArray(record?.mergedIds) ? record.mergedIds : [])
        ].filter(Boolean);
        const archived = ids.some((id) => archivedIds.has(id));
        if (!archived) return record;
        return {
            ...record,
            archived: true,
            integrityStatus: 'archived',
            integrityLabel: labelIntegrity('archived')
        };
    }

    function labelIntegrity(status) {
        return INTEGRITY_LABELS[status] || status || 'Sconosciuta';
    }

    function normalizeStateCompareValue(value, slot) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        if (!isImageSlot(slot)) {
            return normalizeComparableText(raw);
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

    function normalizeComparableText(value) {
        let text = String(value || '').replace(/\r\n/g, '\n');
        text = text
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
            .replace(/<li[^>]*>/gi, '\n- ')
            .replace(/<[^>]+>/g, ' ');

        const textarea = document.createElement('textarea');
        textarea.innerHTML = text;
        text = textarea.value;

        return text
            .normalize('NFKC')
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n\s+/g, '\n')
            .replace(/\n{2,}/g, '\n')
            .trim();
    }

    function getRecordCampaignId(record) {
        const explicit = String(record?.campaignId || record?.campaign || '').trim();
        if (explicit) return explicit;
        const id = String(record?.id || '').trim();
        const match = id.match(/^([^:]+):/);
        return match?.[1] || '';
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
        const selectedCampaign = state.campaign;
        const selectedStatus = state.status;
        const selectedType = state.type;
        const selectedIntegrity = state.integrity;
        const campaigns = Array.from(new Set(state.records.map((record) => getRecordCampaignId(record)).filter(Boolean))).sort();
        const statuses = Array.from(new Set(state.records.map((record) => record.syncStatus).filter(Boolean))).sort();
        const types = Array.from(new Set(state.records.map((record) => record.entityType).filter(Boolean))).sort();
        const integrities = Array.from(new Set(state.records.map((record) => record.integrityStatus).filter(Boolean))).sort();
        if (els.campaign) {
            els.campaign.innerHTML = '<option value="">Tutte</option>' + campaigns
                .map((campaign) => `<option value="${escapeHtml(campaign)}"${campaign === selectedCampaign ? ' selected' : ''}>${escapeHtml(campaign)}</option>`)
                .join('');
        }
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
        if (els.integrity) {
            els.integrity.innerHTML = '<option value="">Tutte</option>' + integrities
                .map((integrity) => `<option value="${escapeHtml(integrity)}"${integrity === selectedIntegrity ? ' selected' : ''}>${escapeHtml(labelIntegrity(integrity))}</option>`)
                .join('');
        }
        if (els.showArchived) {
            els.showArchived.checked = Boolean(state.showArchived);
        }
    }

    function getFilteredRecords() {
        const needle = normalizeText(state.search);
        return state.records.filter((record) => {
            if (state.campaign && getRecordCampaignId(record) !== state.campaign) return false;
            if (!state.showArchived && record.archived) return false;
            if (state.status && record.syncStatus !== state.status) return false;
            if (state.type && record.entityType !== state.type) return false;
            if (state.integrity && record.integrityStatus !== state.integrity) return false;
            if (!needle) return true;
            const haystack = normalizeText([
                record.id,
                record.entityType,
                record.entityId,
                record.slot,
                record.label,
                record.integrityLabel,
                record.foundryState?.value,
                record.siteState?.value,
                record.foundry?.actorName,
                record.foundry?.itemName,
                record.foundry?.uuid
            ].filter(Boolean).join(' '));
            return haystack.includes(needle);
        });
    }

    function pruneSelection() {
        const valid = new Set(state.records.map((record) => record.id));
        state.selectedIds.forEach((id) => {
            if (!valid.has(id)) state.selectedIds.delete(id);
        });
    }

    function getSelectedRecords() {
        const selected = new Set(state.selectedIds);
        return state.records.filter((record) => selected.has(record.id));
    }

    function canQueueDirection(record, direction) {
        const source = direction === 'site-to-foundry' ? record.siteState : record.foundryState;
        const target = direction === 'site-to-foundry' ? record.foundryState : record.siteState;
        if (!String(source?.value || '').trim()) return false;
        if (record.syncStatus === 'in-sync') return false;
        if (direction === 'site-to-foundry' && !record.foundry?.actorId && !record.foundry?.uuid) return false;
        return normalizeStateCompareValue(source?.value || '', record.slot) !== normalizeStateCompareValue(target?.value || '', record.slot);
    }

    async function queueSelected(direction) {
        const selected = getSelectedRecords().filter((record) => canQueueDirection(record, direction));
        if (!selected.length) {
            showMessage('Nessuna riga selezionata valida per questa direzione.', true);
            return;
        }
        const token = readAuthToken();
        if (!token) {
            showMessage('Login richiesto per creare richieste asset.', true);
            return;
        }
        const directionLabel = direction === 'site-to-foundry' ? 'Sito -> Foundry' : 'Foundry -> Sito';
        if (!window.confirm(`Creo ${selected.length} richiesta/e "${directionLabel}"? Foundry le applichera solo dal modulo.`)) return;

        try {
            const now = new Date().toISOString();
            const byCampaign = selected.reduce((acc, record) => {
                const campaignId = getRecordCampaignId(record) || getCurrentCampaignId();
                if (!acc.has(campaignId)) acc.set(campaignId, []);
                acc.get(campaignId).push(record);
                return acc;
            }, new Map());
            let created = 0;
            for (const [campaignId, records] of byCampaign.entries()) {
                const loaded = state.jobsPayloads.get(campaignId) || await loadDataCollection('asset-sync-jobs', campaignId);
                const currentJobs = Array.isArray(loaded?.data) ? loaded.data.slice() : [];
                const expectedVersion = loaded?.source === 'kv' ? (loaded.version ?? 0) : 0;
                const existingPending = new Set(currentJobs
                    .filter((job) => job?.status === 'pending')
                    .map((job) => `${job.direction}:${job.assetId}`));
                let createdForCampaign = 0;
                records.forEach((record) => {
                    const key = `${direction}:${record.id}`;
                    if (existingPending.has(key)) return;
                    existingPending.add(key);
                    currentJobs.push({
                        id: `${campaignId}:${direction}:${record.id}:${Date.now()}:${created}`,
                        campaignId,
                        direction,
                        assetId: record.id,
                        entityType: record.entityType,
                        entityId: record.entityId,
                        slot: record.slot,
                        label: record.label || record.entityId || record.id,
                        record,
                        status: 'pending',
                        createdAt: now,
                        createdBy: 'site'
                    });
                    created += 1;
                    createdForCampaign += 1;
                });
                if (!createdForCampaign) continue;
                const saved = await window.CriptaApp.api.post('api/data/asset-sync-jobs', {
                    data: currentJobs,
                    expectedVersion
                }, { token, campaignId });
                state.jobsPayloads.set(campaignId, saved);
            }
            if (!created) {
                showMessage('Le richieste selezionate erano gia in coda.', false);
                return;
            }
            showMessage(`Richieste create: ${created}. Apri Foundry e usa "Applica richieste asset".`, false);
            state.selectedIds.clear();
            render();
        } catch (error) {
            console.error('Creazione richieste asset fallita:', error);
            showMessage(error?.message || 'Impossibile creare richieste asset.', true);
        }
    }

    async function archiveSelectedRecords() {
        const selected = getSelectedRecords().filter((record) => !record.archived);
        if (!selected.length) {
            showMessage('Nessuna riga selezionata da archiviare.', true);
            return;
        }
        const token = readAuthToken();
        if (!token) {
            showMessage('Login richiesto per archiviare riferimenti asset.', true);
            return;
        }
        if (!window.confirm(`Archivio ${selected.length} riga/e dalla vista diagnostica? I dati originali non vengono cancellati.`)) return;

        try {
            const now = new Date().toISOString();
            const byCampaign = selected.reduce((acc, record) => {
                const campaignId = getRecordCampaignId(record) || getCurrentCampaignId();
                if (!acc.has(campaignId)) acc.set(campaignId, []);
                acc.get(campaignId).push(record);
                return acc;
            }, new Map());
            let archived = 0;
            for (const [campaignId, records] of byCampaign.entries()) {
                const loaded = state.archivePayloads.get(campaignId) || await loadDataCollection('asset-sync-archive', campaignId);
                const currentArchive = Array.isArray(loaded?.data) ? loaded.data.slice() : [];
                const expectedVersion = loaded?.source === 'kv' ? (loaded.version ?? 0) : 0;
                const existing = buildArchiveIdSet(currentArchive);
                let archivedForCampaign = 0;
                records.forEach((record, index) => {
                    if (existing.has(record.id)) return;
                    const assetIds = Array.from(new Set([
                        record.id,
                        ...(Array.isArray(record.mergedIds) ? record.mergedIds : [])
                    ].filter(Boolean)));
                    assetIds.forEach((id) => existing.add(id));
                    currentArchive.push({
                        id: `${campaignId}:archive:${hashString(`${record.id}:${now}:${index}`)}`,
                        campaignId,
                        assetId: record.id,
                        assetIds,
                        entityType: record.entityType || '',
                        entityId: record.entityId || '',
                        slot: record.slot || '',
                        label: record.label || record.entityId || record.id,
                        syncStatus: record.syncStatus || '',
                        integrityStatus: record.integrityStatus || '',
                        reason: record.integrityLabel || labelIntegrity(record.integrityStatus),
                        record: buildArchiveSnapshot(record),
                        archivedAt: now,
                        archivedBy: 'site'
                    });
                    archived += 1;
                    archivedForCampaign += 1;
                });
                if (!archivedForCampaign) continue;
                const saved = await window.CriptaApp.api.post('api/data/asset-sync-archive', {
                    data: currentArchive,
                    expectedVersion
                }, { token, campaignId });
                state.archivePayloads.set(campaignId, saved);
            }
            if (!archived) {
                showMessage('Le righe selezionate risultavano gia archiviate.', false);
                return;
            }
            showMessage(`Righe archiviate dalla vista: ${archived}. Puoi rivederle attivando "Mostra archiviati".`, false);
            state.selectedIds.clear();
            await loadRegistry();
        } catch (error) {
            console.error('Archivio asset sync fallito:', error);
            showMessage(error?.message || 'Impossibile archiviare le righe selezionate.', true);
        }
    }

    function buildArchiveSnapshot(record) {
        const foundry = record?.foundry || {};
        return {
            id: record?.id || '',
            mergedIds: Array.isArray(record?.mergedIds) ? record.mergedIds : [],
            campaignId: getRecordCampaignId(record),
            entityType: record?.entityType || '',
            entityId: record?.entityId || '',
            slot: record?.slot || '',
            label: record?.label || '',
            foundry: {
                actorId: foundry.actorId || '',
                actorName: foundry.actorName || '',
                itemId: foundry.itemId || '',
                itemName: foundry.itemName || '',
                uuid: foundry.uuid || ''
            },
            siteValue: record?.siteState?.value || '',
            foundryValue: record?.foundryState?.value || ''
        };
    }

    async function runCleanupDryRun() {
        const els = getEls();
        const campaignId = state.campaign || getCurrentCampaignId();
        if (els.cleanupPanel) {
            els.cleanupPanel.innerHTML = '<p class="asset-sync-state">Analisi cleanup in corso...</p>';
        }
        try {
            const token = readAuthToken();
            if (!token) {
                showMessage('Login richiesto per preparare il cleanup.', true);
                return;
            }
            const plan = await window.CriptaApp.api.get('api/asset-cleanup/dry-run', {
                campaignId,
                query: { _: Date.now() },
                token
            });
            state.cleanupPlan = plan;
            state.selectedCleanupKvIds.clear();
            state.selectedCleanupR2Keys.clear();
            renderCleanupPanel();
            showMessage('Dry-run cleanup completato. Nessun dato e stato cancellato.', false);
        } catch (error) {
            console.error('Dry-run cleanup fallito:', error);
            state.cleanupPlan = null;
            if (els.cleanupPanel) {
                els.cleanupPanel.innerHTML = '<p class="asset-sync-state is-error">Impossibile preparare il cleanup.</p>';
            }
            showMessage(error?.message || 'Impossibile preparare il cleanup.', true);
        }
    }

    async function applySelectedCleanup() {
        const plan = state.cleanupPlan;
        if (!plan) {
            showMessage('Esegui prima il dry-run cleanup.', true);
            return;
        }
        const kvIds = Array.from(state.selectedCleanupKvIds);
        const r2Keys = Array.from(state.selectedCleanupR2Keys);
        if (!kvIds.length && !r2Keys.length) {
            showMessage('Nessun candidato cleanup selezionato.', true);
            return;
        }
        const token = readAuthToken();
        if (!token) {
            showMessage('Login richiesto per applicare il cleanup.', true);
            return;
        }
        if (!window.confirm(`Elimino definitivamente ${kvIds.length} entry KV e ${r2Keys.length} file R2 selezionati? Questa azione non e annullabile.`)) return;

        try {
            const result = await window.CriptaApp.api.post('api/asset-cleanup/apply', {
                campaignId: plan.campaignId || state.campaign || getCurrentCampaignId(),
                kvIds,
                r2Keys
            }, { token, campaignId: plan.campaignId || state.campaign || getCurrentCampaignId() });
            showMessage(`Cleanup applicato. KV eliminati: ${result.deletedKv || 0}. R2 eliminati: ${result.deletedR2 || 0}.`, false);
            await loadRegistry();
            await runCleanupDryRun();
        } catch (error) {
            console.error('Cleanup apply fallito:', error);
            showMessage(error?.message || 'Impossibile applicare il cleanup.', true);
        }
    }

    function selectAllCleanupCandidates() {
        const plan = state.cleanupPlan;
        if (!plan) return;
        (Array.isArray(plan.kvCandidates) ? plan.kvCandidates : []).forEach((candidate) => {
            if (candidate?.id) state.selectedCleanupKvIds.add(candidate.id);
        });
        (Array.isArray(plan.r2Candidates) ? plan.r2Candidates : []).forEach((candidate) => {
            if (candidate?.key) state.selectedCleanupR2Keys.add(candidate.key);
        });
        renderCleanupPanel();
    }

    function renderCleanupPanel() {
        const els = getEls();
        if (!els.cleanupPanel) return;
        const plan = state.cleanupPlan;
        if (!plan) {
            els.cleanupPanel.innerHTML = '<p class="asset-sync-state">Nessun dry-run eseguito.</p>';
            renderCleanupToolbar();
            return;
        }
        const kvCandidates = Array.isArray(plan.kvCandidates) ? plan.kvCandidates : [];
        const r2Candidates = Array.isArray(plan.r2Candidates) ? plan.r2Candidates : [];
        const blockedR2 = Array.isArray(plan.blockedR2) ? plan.blockedR2 : [];
        const blockedKv = Array.isArray(plan.blockedKv) ? plan.blockedKv : [];
        els.cleanupPanel.innerHTML = `
            <div class="asset-sync-cleanup-grid">
                ${renderCleanupCard('Archivio', plan.archiveCount || 0)}
                ${renderCleanupCard('KV eliminabili', kvCandidates.length)}
                ${renderCleanupCard('R2 eliminabili', r2Candidates.length)}
                ${renderCleanupCard('Bloccati', blockedKv.length + blockedR2.length)}
            </div>
            ${renderCleanupCandidateSection('Entry KV eliminabili', kvCandidates, 'kv')}
            ${renderCleanupCandidateSection('File R2 eliminabili', r2Candidates, 'r2')}
            ${renderBlockedCleanupSection('Bloccati', blockedKv, blockedR2)}
        `;
        renderCleanupToolbar();
    }

    function renderCleanupCard(label, count) {
        return `
            <article class="asset-sync-cleanup-card">
                <strong>${escapeHtml(count)}</strong>
                <span>${escapeHtml(label)}</span>
            </article>
        `;
    }

    function renderCleanupCandidateSection(title, candidates, kind) {
        if (!candidates.length) return '';
        return `
            <section class="asset-sync-cleanup-list" aria-label="${escapeHtml(title)}">
                <h4>${escapeHtml(title)}</h4>
                ${candidates.map((candidate) => renderCleanupCandidate(candidate, kind)).join('')}
            </section>
        `;
    }

    function renderCleanupCandidate(candidate, kind) {
        const id = kind === 'kv' ? candidate.id : candidate.key;
        const checked = kind === 'kv'
            ? state.selectedCleanupKvIds.has(id)
            : state.selectedCleanupR2Keys.has(id);
        return `
            <label class="asset-sync-cleanup-row">
                <input type="checkbox" data-cleanup-kind="${escapeHtml(kind)}" data-cleanup-id="${escapeHtml(id)}"${checked ? ' checked' : ''}>
                <span>
                    <strong>${escapeHtml(candidate.label || id)}</strong>
                    <code>${escapeHtml(kind === 'kv' ? `${candidate.collection || ''} / ${candidate.slot || ''}` : candidate.key || '')}</code>
                    ${candidate.actorId ? `<small>ActorId: ${escapeHtml(candidate.actorId)}</small>` : ''}
                    ${candidate.itemId ? `<small>ItemId: ${escapeHtml(candidate.itemId)}</small>` : ''}
                </span>
            </label>
        `;
    }

    function renderBlockedCleanupSection(title, blockedKv, blockedR2) {
        const entries = [
            ...blockedKv.map((entry) => ({ ...entry, type: 'KV' })),
            ...blockedR2.map((entry) => ({ ...entry, type: 'R2' }))
        ];
        if (!entries.length) return '';
        return `
            <section class="asset-sync-cleanup-list" aria-label="${escapeHtml(title)}">
                <h4>${escapeHtml(title)}</h4>
                ${entries.slice(0, 40).map((entry) => `
                    <div class="asset-sync-cleanup-row asset-sync-cleanup-blocked">
                        <span></span>
                        <span>
                            <strong>${escapeHtml(entry.label || entry.key || entry.archiveId || 'Bloccato')}</strong>
                            <code>${escapeHtml(entry.key || entry.archiveId || '')}</code>
                            <small>${escapeHtml(entry.reason || 'Bloccato')}</small>
                            ${Array.isArray(entry.references) && entry.references.length ? `<small>Referenze: ${escapeHtml(entry.references.length)}</small>` : ''}
                        </span>
                    </div>
                `).join('')}
                ${entries.length > 40 ? `<p class="asset-sync-state">${escapeHtml(entries.length - 40)} altri bloccati non mostrati.</p>` : ''}
            </section>
        `;
    }

    function renderCleanupToolbar() {
        const els = getEls();
        const hasPlan = Boolean(state.cleanupPlan);
        const candidateCount = (state.cleanupPlan?.kvCandidates?.length || 0) + (state.cleanupPlan?.r2Candidates?.length || 0);
        const selectedCount = state.selectedCleanupKvIds.size + state.selectedCleanupR2Keys.size;
        if (els.cleanupSelectAll) els.cleanupSelectAll.disabled = !hasPlan || candidateCount === 0;
        if (els.cleanupApply) els.cleanupApply.disabled = !hasPlan || selectedCount === 0;
    }

    function showMessage(message, isError = false) {
        const els = getEls();
        if (!els.message) return;
        els.message.hidden = false;
        els.message.textContent = message;
        els.message.classList.toggle('is-error', Boolean(isError));
    }

    function renderSummary() {
        const els = getEls();
        if (!els.summary) return;
        const summaryRecords = state.records.filter((record) => {
            if (state.campaign && getRecordCampaignId(record) !== state.campaign) return false;
            if (!state.showArchived && record.archived) return false;
            return true;
        });
        const counts = summaryRecords.reduce((acc, record) => {
            const key = record.syncStatus || 'unknown';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        const problematicCount = summaryRecords.filter((record) => ['legacy', 'orphan', 'partial'].includes(record.integrityStatus)).length;
        const archivedCount = state.records.filter((record) => {
            if (state.campaign && getRecordCampaignId(record) !== state.campaign) return false;
            return record.archived;
        }).length;
        const cards = [
            ['Totale', summaryRecords.length],
            ['Legacy / Orfani', problematicCount],
            ['Archiviati', archivedCount],
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
                        <th><span class="sr-only">Seleziona</span></th>
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
        const rowClasses = [
            record.syncStatus === 'different' ? 'is-different' : '',
            record.archived ? 'is-archived' : ''
        ].filter(Boolean).join(' ');
        const rowClass = rowClasses ? ` class="${escapeHtml(rowClasses)}"` : '';
        const checked = state.selectedIds.has(record.id) ? ' checked' : '';
        return `
            <tr${rowClass}>
                <td>
                    <input type="checkbox" class="asset-sync-row-check" data-asset-sync-select="${escapeHtml(record.id)}"${checked} aria-label="Seleziona ${escapeHtml(record.label || record.entityId || record.id)}">
                </td>
                <td>
                    <span class="asset-sync-status asset-sync-status--${escapeHtml(record.syncStatus || 'unknown')}">${escapeHtml(labelStatus(record.syncStatus))}</span>
                    <span class="asset-sync-integrity asset-sync-integrity--${escapeHtml(record.integrityStatus || 'unknown')}">${escapeHtml(record.integrityLabel || labelIntegrity(record.integrityStatus))}</span>
                </td>
                <td>
                    <strong>${escapeHtml(record.label || record.entityId || record.id)}</strong>
                    <small>${escapeHtml(record.entityType || '')} / ${escapeHtml(record.entityId || '')}</small>
                    ${Array.isArray(record.mergedIds) && record.mergedIds.length > 1 ? `<small>Uniti: ${escapeHtml(record.mergedIds.length)} record</small>` : ''}
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
        renderSelectionToolbar();
        renderTable();
    }

    function renderSelectionToolbar() {
        const els = getEls();
        const count = state.selectedIds.size;
        if (els.selectionCount) {
            els.selectionCount.textContent = `${count} selezionat${count === 1 ? 'o' : 'i'}`;
        }
        [els.clearSelection, els.archiveSelected, els.queueSiteToFoundry, els.queueFoundryToSite].forEach((button) => {
            if (button) button.disabled = count === 0;
        });
    }

    window.CriptaApp.onPageReady('asset-sync', () => {
        const els = getEls();
        els.refresh?.addEventListener('click', () => loadRegistry());
        els.campaign?.addEventListener('change', () => {
            state.campaign = els.campaign.value;
            state.cleanupPlan = null;
            state.selectedCleanupKvIds.clear();
            state.selectedCleanupR2Keys.clear();
            render();
            renderCleanupPanel();
        });
        els.selectDifferent?.addEventListener('click', () => {
            getFilteredRecords()
                .filter((record) => ['different', 'site-only', 'foundry-only', 'foundry-updated', 'site-updated'].includes(record.syncStatus))
                .forEach((record) => state.selectedIds.add(record.id));
            render();
        });
        els.selectVisible?.addEventListener('click', () => {
            getFilteredRecords().forEach((record) => state.selectedIds.add(record.id));
            render();
        });
        els.selectProblematic?.addEventListener('click', () => {
            getFilteredRecords()
                .filter((record) => ['legacy', 'orphan', 'partial'].includes(record.integrityStatus))
                .forEach((record) => state.selectedIds.add(record.id));
            render();
        });
        els.clearSelection?.addEventListener('click', () => {
            state.selectedIds.clear();
            render();
        });
        els.archiveSelected?.addEventListener('click', () => archiveSelectedRecords());
        els.queueSiteToFoundry?.addEventListener('click', () => queueSelected('site-to-foundry'));
        els.queueFoundryToSite?.addEventListener('click', () => queueSelected('foundry-to-site'));
        els.cleanupDryRun?.addEventListener('click', () => runCleanupDryRun());
        els.cleanupSelectAll?.addEventListener('click', () => selectAllCleanupCandidates());
        els.cleanupApply?.addEventListener('click', () => applySelectedCleanup());
        els.cleanupPanel?.addEventListener('change', (event) => {
            const input = event.target.closest?.('[data-cleanup-kind][data-cleanup-id]');
            if (!input) return;
            const kind = input.dataset.cleanupKind;
            const id = input.dataset.cleanupId || '';
            if (!id) return;
            const target = kind === 'kv' ? state.selectedCleanupKvIds : state.selectedCleanupR2Keys;
            if (input.checked) target.add(id);
            else target.delete(id);
            renderCleanupToolbar();
        });
        els.table?.addEventListener('change', (event) => {
            const input = event.target.closest?.('[data-asset-sync-select]');
            if (!input) return;
            const id = input.dataset.assetSyncSelect || '';
            if (!id) return;
            if (input.checked) state.selectedIds.add(id);
            else state.selectedIds.delete(id);
            renderSelectionToolbar();
        });
        els.status?.addEventListener('change', () => {
            state.status = els.status.value;
            render();
        });
        els.type?.addEventListener('change', () => {
            state.type = els.type.value;
            render();
        });
        els.integrity?.addEventListener('change', () => {
            state.integrity = els.integrity.value;
            render();
        });
        els.showArchived?.addEventListener('change', () => {
            state.showArchived = Boolean(els.showArchived.checked);
            render();
        });
        els.search?.addEventListener('input', () => {
            state.search = els.search.value;
            render();
        });
        loadRegistry();
    });
})();
