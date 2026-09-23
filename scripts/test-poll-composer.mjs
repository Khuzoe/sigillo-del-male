import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/js/shared/poll-icon-composer.js', import.meta.url), 'utf8');
const window = {};
const drawCalls = [];
let imageLoads = 0;
let failed = true;
class FakeImage {
    naturalWidth = 800;
    naturalHeight = 1600;
    set src(url) {
        imageLoads++;
        queueMicrotask(() => url.includes('missing') || (url.includes('retry') && failed) ? this.onerror() : this.onload());
    }
}
const context = { drawImage: (...args) => drawCalls.push(['draw', ...args.slice(1)]),
    save() {}, beginPath() {}, rect: (...args) => drawCalls.push(['clipRect', ...args]), clip() {}, restore() {} };
const document = {
    currentScript: { src: 'https://site.test/subsite/assets/js/shared/poll-icon-composer.js' },
    createElement: () => ({ getContext: () => context, toBlob: (callback) => callback(new Blob(['image'], { type: 'image/webp' })) })
};
vm.runInNewContext(source, { window, document, URL, Image: FakeImage, File, Blob, console });
const api = window.CriptaPollIconComposer;
const copy = (value) => JSON.parse(JSON.stringify(value));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
assert.equal(api.templateUrl('yes'), 'https://site.test/subsite/assets/img/ui/poll-templates/yes-v2.webp');
assert.throws(() => api.templateUrl('invalid'));
assert.deepEqual(copy(api.placement({ x: 300, y: -300, scale: 1 })), { x: 100, y: -100, scale: 20 });
assert.deepEqual(copy(api.placement({ x: NaN, y: Infinity, scale: NaN })), { x: 0, y: 0, scale: 100 });
const zero = api.geometry(800, 1600);
near(zero.height, api.PORTRAIT.height);
near(zero.x + zero.width / 2, api.PORTRAIT.x + api.PORTRAIT.width / 2);
near(zero.y, api.PORTRAIT.y);
const moved = api.geometry(800, 1600, { x: 25, y: -10, scale: 200 });
near(moved.width, zero.width * 2);
near(moved.x + moved.width / 2, zero.x + zero.width / 2 + api.PORTRAIT.width * .25);
near(moved.y + moved.height / 2, zero.y + zero.height / 2 - api.PORTRAIT.height * .1);
const landscape = api.geometry(1600, 800);
near(landscape.width, api.PORTRAIT.width);
assert.ok(api.PORTRAIT.y + api.PORTRAIT.height < 963, 'Portrait clipping must protect the fixed label band');
assert.throws(() => api.geometry(0, 100));
assert.match(api.markup({ state: 'yes', source: 'x" onload="unsafe' }), /src="x&quot; onload=&quot;unsafe"/);
assert.match(api.markup({ state: 'yes', source: 'x', position: { x: 10, y: -5, scale: 150 } }), /translate\(10%, -5%\) scale\(1.5\)/);
assert.doesNotMatch(api.markup({ state: 'yes', source: 'baked.webp', final: true }), /poll-icon-art|poll-templates/);
const render = api.createRenderer();
const file = await render({ state: 'yes', source: 'portrait.webp', position: { x: 25, y: -10, scale: 200 } });
assert.equal(file.type, 'image/webp');
assert.deepEqual(drawCalls[1], ['clipRect', api.PORTRAIT.x, api.PORTRAIT.y, api.PORTRAIT.width, api.PORTRAIT.height]);
assert.deepEqual(drawCalls[2], ['draw', moved.x, moved.y, moved.width, moved.height]);
assert.equal(imageLoads, 2);
await render({ state: 'yes', source: 'portrait.webp' });
assert.equal(imageLoads, 2, 'Reuse decoded originals across drafts');
await render({ state: 'yes', source: 'missing.webp', fallback: 'portrait.webp' });
await assert.rejects(render({ state: 'yes', source: 'retry.webp' }));
failed = false;
await render({ state: 'yes', source: 'retry.webp' });
console.log('Poll compositor: fixed templates, source containment, clipping, exact placement, escaping, baked images and load recovery passed.');
