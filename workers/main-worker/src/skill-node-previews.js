import {skillNodePreviewKey} from '../../../assets/js/shared/skill-node-preview-key.mjs';

const migrationKey = 'skill-icon-history-v1';
const hashPattern = /^[a-f0-9]{64}$/;

export function validPreviewSlot(value) {
    return typeof value === 'string' && hashPattern.test(value);
}

function previewKey(context, slot) {
    return 'skill-icon:' + JSON.stringify([context.campaignId, context.accountId, context.tree, slot]);
}

function isReadyIcon(job) {
    return job?.kind === 'skill-node-icon' && job.context?.purpose === 'skill-node'
        && job.status === 'ready' && job.iconId && !job.iconError;
}

async function rememberPreview(storage, job) {
    // Older jobs kept the submitted name and rules, but no node or level ID.
    const slots = job.previewSlot ? [job.previewSlot] : ['legacy-tree',
        'legacy-' + await skillNodePreviewKey([job.iconContext?.name || '', job.iconContext?.description || ''])];
    for (const slot of slots) {
        const key = previewKey(job.context, slot);
        const previous = await storage.get(key);
        if (!previous || job.createdAt > previous.createdAt || (job.createdAt === previous.createdAt && job.id > previous.id)) {
            await storage.put(key, {id:job.id, name:job.iconContext?.name || job.draft.name, createdAt:job.createdAt});
        }
    }
}

// Keep the last successful image when a newer attempt is pending, stopped or failed.
export function saveGenerationResult(storage, job) {
    if (!isReadyIcon(job)) return storage.put('job:' + job.id, job);
    return storage.transaction(async tx => {
        await tx.put('job:' + job.id, job);
        await rememberPreview(tx, job);
    });
}

export async function lastSkillNodePreview(storage, context, slot, legacy) {
    const result = await listSkillNodePreviews(storage, context, [{slot, legacy}]);
    if (result.scanning) return result;
    let preview = result.previews[slot];
    if (preview && legacy === 'tree') {
        const job = await storage.get('job:' + preview.id);
        preview = {...preview, description:job?.iconContext?.description || '', flavor:job?.previewFlavor || ''};
    }
    return {preview:preview || null};
}

export async function listSkillNodePreviews(storage, context, targets) {
    const previews = {};
    const missing = [];
    for (const {slot, legacy} of targets) {
        const preview = await storage.get(previewKey(context, slot));
        if (preview) previews[slot] = preview;
        else if (legacy) missing.push({slot, legacy});
    }
    if (missing.length) {
        if (!await indexArchivedPreviews(storage)) return {scanning:true};
        for (const {slot, legacy} of missing) {
            const preview = await storage.get(previewKey(context, 'legacy-' + legacy));
            if (preview) previews[slot] = preview;
        }
    }
    return {previews};
}

async function indexArchivedPreviews(storage) {
    // Index historical jobs once, in bounded pages shared by all lookups.
    // Chunked sheet jobs and other accounts' documents never leave the store.
    const cursor = await storage.get(migrationKey);
    if (cursor !== 'done') {
        const page = await storage.list({prefix:'job:', limit:64, ...(cursor ? {startAfter:cursor} : {})});
        await storage.transaction(async tx => {
            for (const job of page.values()) {
                if (isReadyIcon(job) && !job.previewSlot) await rememberPreview(tx, job);
            }
            await tx.put(migrationKey, page.size < 64 ? 'done' : [...page.keys()].at(-1));
        });
        if (page.size === 64) return false;
    }
    return true;
}
