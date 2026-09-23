(function () {
    const VERSION = 1;
    const SIZE = 1254;
    const PORTRAIT = { x: 26, y: 28, width: 1202, height: 930 };
    const STATES = new Set(['yes', 'maybe', 'no']);
    const assetRoot = new URL('../../img/ui/poll-templates/', document.currentScript.src).href;
    const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
    const finite = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;

    function placement(value = {}) {
        return { x: finite(value.x, 0, -100, 100), y: finite(value.y, 0, -100, 100), scale: finite(value.scale ?? 100, 100, 20, 300) };
    }

    function templateUrl(state) {
        if (!STATES.has(state)) throw new Error('Risposta non valida.');
        return `${assetRoot}${state}-v2.webp`;
    }

    function transform(value) {
        const p = placement(value);
        return `translate(${p.x}%, ${p.y}%) scale(${p.scale / 100})`;
    }

    function markup({ state, source, fallback = '', final = false, position = {} }) {
        const error = fallback && fallback !== source
            ? ` data-fallback-src="${escape(fallback)}" onerror="if(this.dataset.fallbackSrc){this.src=this.dataset.fallbackSrc;this.dataset.fallbackSrc='';}else{this.style.visibility='hidden';}"`
            : ' onerror="this.style.visibility=\'hidden\';"';
        if (final) return `<img class="availability-choice-icon" src="${escape(source)}" alt="" decoding="async" loading="lazy"${error}>`;
        const box = `left:${PORTRAIT.x / SIZE * 100}%;top:${PORTRAIT.y / SIZE * 100}%;width:${PORTRAIT.width / SIZE * 100}%;height:${PORTRAIT.height / SIZE * 100}%`;
        return `<span class="availability-choice-icon poll-icon-art" aria-hidden="true"><img class="poll-icon-art__base" src="${escape(templateUrl(state))}" alt="" decoding="async"><span class="poll-icon-art__portrait" style="${box}"><img class="poll-icon-art__source" src="${escape(source)}" alt="" decoding="async" draggable="false" style="transform:${transform(position)}"${error}></span></span>`;
    }

    function geometry(width, height, position = {}) {
        if (!(width > 0 && height > 0)) throw new Error('Immagine non valida.');
        const p = placement(position);
        const ratio = Math.min(PORTRAIT.width / width, PORTRAIT.height / height) * p.scale / 100;
        const w = width * ratio;
        const h = height * ratio;
        return { x: PORTRAIT.x + (PORTRAIT.width - w) / 2 + PORTRAIT.width * p.x / 100,
            y: PORTRAIT.y + (PORTRAIT.height - h) / 2 + PORTRAIT.height * p.y / 100, width: w, height: h };
    }

    function createRenderer() {
        const images = new Map();
        const load = (url) => {
            if (!images.has(url)) {
                const pending = new Promise((resolve, reject) => {
                    const image = new Image();
                    image.crossOrigin = 'anonymous';
                    image.onload = () => resolve(image);
                    image.onerror = () => reject(new Error('Impossibile leggere un’immagine. Ricaricala e riprova.'));
                    image.src = url;
                }).catch((error) => { images.delete(url); throw error; });
                images.set(url, pending);
            }
            return images.get(url);
        };
        return async function render({ state, source, fallback = '', position = {} }) {
            const [base, portrait] = await Promise.all([
                load(templateUrl(state)),
                load(source).catch((error) => fallback && fallback !== source ? load(fallback) : Promise.reject(error))
            ]);
            const canvas = document.createElement('canvas');
            canvas.width = SIZE;
            canvas.height = SIZE;
            const context = canvas.getContext('2d');
            context.drawImage(base, 0, 0, SIZE, SIZE);
            const rect = geometry(portrait.naturalWidth, portrait.naturalHeight, position);
            context.save();
            context.beginPath();
            context.rect(PORTRAIT.x, PORTRAIT.y, PORTRAIT.width, PORTRAIT.height);
            context.clip();
            context.drawImage(portrait, rect.x, rect.y, rect.width, rect.height);
            context.restore();
            return new Promise((resolve, reject) => {
                try {
                    canvas.toBlob((blob) => {
                        if (!blob || blob.type !== 'image/webp') { reject(new Error('Questo browser non può creare l’immagine WebP.')); return; }
                        resolve(new File([blob], `${state}-composed.webp`, { type: 'image/webp' }));
                    }, 'image/webp', 0.94);
                } catch (_) { reject(new Error('L’immagine non consente il ritaglio. Ricaricala dal computer e riprova.')); }
            });
        };
    }

    window.CriptaPollIconComposer = { VERSION, SIZE, PORTRAIT, placement, transform, templateUrl, markup, geometry, createRenderer };
})();
