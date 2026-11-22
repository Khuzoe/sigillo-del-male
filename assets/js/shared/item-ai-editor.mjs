import { openSkillNodeGenerator } from './skill-node-generator.mjs?v=20261122-aggiunte';
import { captureCatalogReview, catalogProposal } from './catalog-item-review.mjs?v=20261122-aggiunte';

const labels = {
    summary: 'Descrizione identificata', notes: 'Note della campagna',
    unidentifiedDescription: 'Descrizione non identificata', description: 'Proprietà'
};

export async function openItemAiEditor({button, form, item, token, campaignId, resolveImage, applyImage, onReviewApplied, appendProperties, isCurrent}) {
    if (!item || !token) throw new Error('Accedi come DM per usare gli strumenti AI.');
    const field = button.dataset.itemAi;
    const singleDescription = ['summary', 'unidentifiedDescription'].includes(field);
    const row = button.closest('[data-item-property-row], [data-property-index]');
    const rowIndex = row ? [...form.querySelectorAll('[data-item-property-row], [data-property-index]')].indexOf(row) : '';
    const review = field === 'whole' || singleDescription || row ? captureCatalogReview(form) : null;
    if (review) {
        review.canAdd = !singleDescription && !/^material[ei]?$/i.test(review.source.type);
        if (singleDescription || row) {
            review.field = row ? 'property-' + rowIndex : field;
            review.fields = review.fields.filter(entry => entry.key === review.field);
        }
    }
    const imageMode = field === 'image';
    const fieldValue = key => form.querySelector(`[data-item-field="${key}"], [data-field="${key}"]`)?.value?.trim() || '';
    const name = fieldValue('name') || item.name || 'Oggetto';
    const propertyName = row?.querySelector('[data-row-field="name"], [data-property-field="name"]')?.value;
    const input = row ? row.querySelector('textarea') : form.querySelector(`textarea[data-item-field="${field}"], textarea[data-field="${field}"]`);
    const description = imageMode ? fieldValue('summary') : input?.value || '';
    if (!review && !imageMode && !description.trim()) throw new Error('Inserisci il testo da migliorare.');
    const imageField = form.querySelector('[data-item-field="image"], [data-field="image"]');
    const currentImage = () => String(imageField ? imageField.value : item.image || '').trim();
    const imagePath = currentImage();
    const needsImage = review?.fields.some(entry => ['summary', 'unidentifiedDescription'].includes(entry.key) && !entry.original.trim());
    const icon = (imageMode || needsImage) && imagePath ? resolveImage(imagePath) : '';
    if (review) review.needsImage = needsImage;
    const targetName = imageMode ? name : propertyName || labels[field];
    const current = () => form.isConnected && button.isConnected && isCurrent();
    const auth = await window.CriptaApp.auth.verify();
    const user = auth?.user;
    const accountId = user?.accountId || user?.id || user?.sub || user?.discordId;
    if (!accountId) throw new Error('Sessione scaduta. Accedi di nuovo alla wiki.');
    if (!current()) return;
    openSkillNodeGenerator({
        catalogItem: true, review, token, campaignId, accountId, treeKey: String(item.id || name),
        treeName: imageMode || review ? name : [name, targetName].join(' · '), examples: [],
        target: {mode: review ? 'item-review' : imageMode ? 'icon' : 'refine', id: field + rowIndex, name: targetName, description, icon,
            source: JSON.stringify(review ? [review.source, icon] : [targetName, description, icon])},
        onApply: async proposal => {
            if (!current()) throw new Error('La scheda è cambiata. Riapri la proposta dall’oggetto.');
            if (review) {
                const latest = captureCatalogReview(form);
                if ((!proposal.appendOnly && needsImage && currentImage() !== imagePath) || JSON.stringify(latest.source) !== JSON.stringify(review.source)) throw new Error('La scheda è cambiata. Riapri la revisione prima di applicarla.');
                if (review.field) latest.fields = latest.fields.filter(entry => entry.key === review.field);
                const {edits, additions} = catalogProposal(latest.fields, proposal, review.canAdd);
                const properties = additions.map(({name, charges, description, hidden, negative, genial}) => ({
                    name: name.trim(), charges: charges.trim(), description: description.trim(), hidden: hidden === true,
                    genial: genial === true, negative: negative === true
                }));
                edits.forEach(({text}, i) => { latest.fields[i].input.value = text; });
                if (onReviewApplied) {
                    const {source} = captureCatalogReview(form);
                    source.properties.push(...properties);
                    onReviewApplied(source, proposal.appendOnly ? properties : null);
                } else {
                    if (properties.length) appendProperties(properties);
                    edits.forEach((_, i) => latest.fields[i].input.dispatchEvent(new Event('input', {bubbles: true})));
                }
            } else if (imageMode) {
                const result = await window.CriptaMedia.uploadBlob(proposal.image, {
                    folder: 'items', fileName: 'oggetto-' + proposal.imageId + '.webp', token, campaignId
                });
                if (!current()) throw new Error('La scheda è cambiata durante il caricamento. Riapri la proposta dall’oggetto.');
                applyImage(result.path);
            } else {
                if (input.value !== description) throw new Error('Il testo originale è cambiato. Riapri la revisione.');
                input.value = proposal.description;
                input.dispatchEvent(new Event('input', {bubbles: true}));
            }
        }
    });
}
