// Text-only translation contract, shared by generation and confirmation.
export const ABILITY_TRANSLATION_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['name', 'description'],
    properties: { name: { type: 'string' }, description: { type: 'string' } }
};
const plain = value => value.replace(/<[^>]*>/g, ' ');
const matches = (value, pattern) => value.match(pattern) || [];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function preservedText(before, after) {
    // Preserve markup verbatim: the model cannot introduce links, handlers or
    // change existing attributes. Foundry references and rolls are opaque data.
    const markup = value => matches(value, /<[^>]*>/g);
    const entities = value => matches(value, /&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]+);/gi);
    const tokens = value => matches(value, /@[A-Za-z]+\[[^\]]*\]|\[\[[\s\S]*?\]\]|&Reference\[[^\]]*\]/g);
    const numbers = value => matches(plain(value), /\d+(?:[.,]\d+)?/g).map(n => n.replace(',', '.'));
    const dice = value => matches(plain(value), /\b\d*d\d+(?:\s*[+-]\s*\d+)?\b/gi).map(n => n.replace(/\s/g, '').toLowerCase());
    for (const extract of [markup, entities, tokens, numbers, dice]) {
        if (!same(extract(before), extract(after))) throw new Error('La traduzione deve conservare numeri, formule, collegamenti e formattazione.');
    }
    const roles = value => [
        /\b(?:DC|CD)\s*(\d+)/gi, /\b(?:AC|CA)\s*(\d+)/gi,
        /(\d+(?:[.,]\d+)?)\s*(?:feet|foot|ft\b|piedi|piede)/gi,
        /(\d+(?:[.,]\d+)?)\s*(?:meters?|metri|metro)\b/gi
    ].map(pattern => [...plain(value).matchAll(pattern)].map(m => m[1].replace(',', '.')));
    if (!same(roles(before), roles(after))) throw new Error('La traduzione deve conservare CD, CA e distanze nel loro contesto.');
}
export function validateAbilityTranslation(input, source) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'description,name') throw new Error('La traduzione può contenere solo nome e descrizione.');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 180 || typeof input.description !== 'string' || input.description.length > 24000 || (source.description.trim() && !input.description.trim())) throw new Error('Nome o descrizione della traduzione non validi.');
    preservedText(source.name, input.name); preservedText(source.description, input.description);
    return { name: input.name, description: input.description };
}
