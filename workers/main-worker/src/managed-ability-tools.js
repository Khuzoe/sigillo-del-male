// Ownership is resolved from the canonical Actor and authenticated account,
// never from request body flags or the public stats-edit permission.
export async function canUseAbilityTools(user, actor, campaignId, services) {
    if (!actor) return false;
    const editor = await services.isEditor(user, campaignId);
    return actor.actorType === 'npc' ? editor : ['character', 'player'].includes(actor.actorType) && (editor || await services.isOwner?.(user, actor));
}
export function managedAbilityItems(actor) {
    return (actor.definition?.items || []).filter(item => item.itemId && ['feat', 'weapon', 'spell'].includes(item.type)).map(item => ({
        _id: item.itemId, name: item.name || 'Capacità', type: item.type, img: item.definition?.img || '',
        system: { description: { value: String(item.definition?.description?.value ?? item.definition?.description ?? '') } },
        ...(item.transferId ? { flags: { 'cripta-wiki-sync': { transferId: item.transferId } } } : {})
    }));
}
export function abilityHasPendingCommand(commands, item, requestId) {
    return commands.some(c => (!requestId || c.clientRequestId !== requestId) && c.status === 'pending' && (c.nativeSheetVersion || String(c.kind).startsWith('actor-link.') || c.target?.id === item._id || c.target?.itemId === item._id || c.target?.transferId && c.target.transferId === item.flags?.['cripta-wiki-sync']?.transferId));
}
