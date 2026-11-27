export function skillNodePreviewScope(target, sharedCharacter) {
    const parts = target ? [target.id, target.level, target.mode] : [];
    if (sharedCharacter) parts.push(sharedCharacter.managedActor?.worldId, sharedCharacter.managedActor?.actorId || sharedCharacter.id);
    return parts;
}

export async function skillNodePreviewKey(parts) {
    const bytes = new TextEncoder().encode(JSON.stringify(parts));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
