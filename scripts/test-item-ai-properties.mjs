import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const types = {'.html':'text/html', '.mjs':'text/javascript', '.js':'text/javascript', '.css':'text/css', '.json':'application/json'};
const existing = {name:'Sigillo', description:'Infligge **1d4** danni.', charges:'2', genial:true};
const item = {id:'pergamena', name:'Pergamena', type:'Arma', summary:'Una pergamena incantata.', properties:[existing]};
const directions = 'Aggiungi un’infusione di fuoco o necrotica una volta per riposo breve. Poi consenti un attacco bonus dopo un colpo senz’armi o un attacco basato su una caratteristica diversa da Forza o Destrezza con l’azione.';
const additions = [
    {name:'Infusione', charges:'1 volta per riposo breve', description:'Infligge danni aggiuntivi del tipo scelto.', clarification:'Quanti danni aggiuntivi?', hidden:false, genial:false, negative:false},
    {name:'Attacco di seguito', charges:'Azione bonus', description:'Dopo un attacco idoneo, usa la tua azione bonus per attaccare con quest’arma.', clarification:'', hidden:false, genial:false, negative:true}
];
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH, headless:true});
try {
    for (const standalone of [false, true]) {
        const page = await browser.newPage({viewport:{width:1200,height:880}});
        const routePath = standalone ? 'tools/items-editor.html' : 'pages/oggetti.html';
        let jobs = 0, saved;
        await page.addInitScript(() => localStorage.setItem('discord_jwt', 'test'));
        await page.route('**/*', async route => {
            const req = route.request(), url = new URL(req.url()), p = url.pathname;
            const json = body => route.fulfill({json:body});
            if (p === '/auth/discord/verify') return json({user:{accountId:'dm'}});
            if (p === '/api/campaign/access') return json({permissions:{canManageCampaign:true}});
            if (p === '/api/data/items') {
                if (req.method() === 'POST') { saved = req.postDataJSON().data; return json({ok:true, count:1, version:2}); }
                return json({data:saved || [item], source:'kv', version:1});
            }
            if (p === '/api/items/generate') {
                const body = req.postDataJSON();
                assert.equal(body.mode,'item-review');
                assert.equal(body.propertyMode,standalone ? 'add' : 'auto');
                assert.equal(body.field,standalone ? 'property-0' : undefined);
                assert.equal(body.notes,directions);
                jobs++;
                return json({job:{id:body.requestId,status:'ready',draft:{edits:[],appendOnly:true,additions}}});
            }
            if (url.hostname !== 'localhost') return json({});
            const file = path.resolve(root, '.' + decodeURIComponent(p));
            assert.ok(file.startsWith(root));
            try { return await route.fulfill({body:await readFile(file),contentType:types[path.extname(file)]}); }
            catch { return route.fulfill({status:404}); }
        });
        await page.goto('http://localhost:8789/' + routePath);
        if (!standalone) {
            await page.locator('#items-config-controls-button').click();
            await page.locator('[data-item-edit="pergamena"]').click();
        }
        const form = page.locator(standalone ? '#detail-form' : '[data-item-inline-editor]');
        const rows = form.locator('[data-property-index], [data-item-property-row]');
        if (standalone) await form.locator('[data-catalog-tab="properties"]').click();
        const open = form.locator(standalone ? '[data-item-ai="description"]' : '[data-item-ai="whole"]').first();
        await open.click();
        const dialog = page.locator('dialog[open]');
        if (standalone) {
            await dialog.locator('[data-field="propertyMode"]').selectOption('add');
            assert.ok(await dialog.locator('[data-rewrite]').isDisabled());
        }
        await dialog.locator('[data-field="notes"]').fill(directions);
        await dialog.locator('[data-rewrite]').click();
        await dialog.locator('[data-new-name]').waitFor();
        assert.equal(await dialog.locator('[data-review-select] option').count(), 2);
        assert.match(await dialog.locator('[data-clarification]').innerText(), /Quanti danni/);
        await dialog.locator('[data-new-name]').fill('Infusione della pergamena');
        await dialog.locator('[data-new-tone]').selectOption('genial');
        await dialog.locator('[data-new-hidden]').check();
        await dialog.locator('[data-next]').click();
        assert.equal(await dialog.locator('[data-new-tone]').inputValue(), 'negative');
        await dialog.locator('[data-new-tone]').selectOption('normal');
        await dialog.locator('[data-close]').click();
        assert.equal(await rows.count(),1);
        await open.click();
        assert.equal(await dialog.locator('[data-new-name]').inputValue(),'Attacco di seguito');
        assert.equal(await dialog.locator('[data-new-tone]').inputValue(),'normal');
        await dialog.locator('[data-prev]').click();
        assert.equal(await dialog.locator('[data-new-tone]').inputValue(),'genial');
        assert.equal(await dialog.locator('[data-new-hidden]').isChecked(),true);
        await dialog.locator('[data-add]').click();
        await dialog.waitFor({state:'detached'});
        assert.equal(jobs,1);
        assert.equal(await rows.count(),3);
        await form.locator('[data-catalog-tab="properties"]').click();
        const row = rows.first();
        const flag = key => row.locator('[data-row-field="' + key + '"], [data-property-field="' + key + '"]');
        await flag('hidden').check();
        await flag('negative').check();
        assert.ok(!(await flag('genial').isChecked()));
        assert.match(await row.locator('[data-property-traits]').innerText(),/Negativa · Solo DM/);
        await flag('genial').check();
        assert.ok(!(await flag('negative').isChecked()));
        assert.match(await row.locator('[data-property-traits]').innerText(),/Geniale · Solo DM/);
        await flag('genial').uncheck();
        assert.equal(await row.locator('[data-property-traits]').innerText(),'Solo DM');
        await flag('genial').check();
        await flag('hidden').uncheck();
        await Promise.all([
            page.waitForResponse(res => new URL(res.url()).pathname === '/api/data/items' && res.request().method() === 'POST'),
            page.locator(standalone ? '#save-json-btn' : '[data-item-edit-action="save"]').click()
        ]);
        assert.ok(saved);
        const [original, ...created] = saved[0].properties;
        assert.equal(original.description,existing.description);
        assert.equal(original.charges,existing.charges);
        assert.equal(original.genial,true);
        assert.equal(saved[0].summary,item.summary);
        assert.deepEqual(created.map(p=>p.name),['Infusione della pergamena','Attacco di seguito']);
        assert.deepEqual(created.map(p=>p.charges),additions.map(p=>p.charges));
        assert.ok(created[0].genial && created[0].hidden);
        assert.ok(!created[1].negative && !created[1].genial && !created[1].hidden);
        assert.ok(created.every(p=>!('clarification' in p)));
        if (!standalone) {
            assert.doesNotMatch(saved[0].foundry.document.system.description.value,/Infusione della pergamena/);
            assert.match(saved[0].foundry.document.system.description.value,/property--normal"><h3><span>Attacco di seguito/);
        }
        await page.close();
    }
    console.log('OK due nuove proprietà in entrambi gli editor, anteprima, recupero e salvataggio.');
} finally { await browser.close(); }
