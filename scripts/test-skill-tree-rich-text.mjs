import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, readdir} from 'node:fs/promises';
import {dirname, join, relative, sep} from 'node:path';
import {createRequire} from 'node:module';

// Install Playwright or provide PLAYWRIGHT_MODULE and a browser channel for local QA.
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = await readFile(new URL('../assets/js/shared/character-skill-tree.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/css/pages/character-skill-tree.css', import.meta.url), 'utf8');
const instrumented = source.replace(/\}\)\(\);\s*$/, `window.richTextTest = {
    normalizeSkillLevelStoredHtml, rememberSkillRichTextSelection, applySkillRichTextCommand,
    renderSkillRichTextToolbar
}; })();`);
const browser = await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? {channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL} : {})});
try {
    const page = await browser.newPage();
    await page.setContent('<style>*{box-sizing:border-box}ul,ol{list-style:none;padding:0}body{margin:0;background:#17151c;color:#eee;--gold:#d4af37;--text-muted:#aaa;--font-ui:Arial}</style><main class="player-skill-tree-card is-simple-skill-editor"><div id="field" class="player-skill-simple-field player-skill-simple-description player-skill-level-row"><span>Descrizione</span><div class="player-skill-level-rich-editor" contenteditable="true" role="textbox" aria-label="Descrizione"></div></div><div class="player-skill-info-desc"></div><div class="player-skill-simple-preview-desc"></div></main>');
    await page.addStyleTag({content:css});
    await page.addScriptTag({content:instrumented});
    await page.evaluate(() => {
        const editor = document.querySelector('[contenteditable]');
        editor.insertAdjacentHTML('beforebegin', window.richTextTest.renderSkillRichTextToolbar());
        const field = document.querySelector('#field');
        field.addEventListener('mousedown', e => { if(e.target.closest('[data-skill-level-rich-command]')) e.preventDefault(); });
        field.addEventListener('click', e => {const button=e.target.closest('[data-skill-level-rich-command]');if(button)window.richTextTest.applySkillRichTextCommand(editor,button.dataset.skillLevelRichCommand);});
    });
    async function select(html, selector = null) {
        await page.evaluate(({html,selector}) => {
            const editor=document.querySelector('[contenteditable]');editor.innerHTML=html;
            const target=selector?editor.querySelector(selector):editor;
            const range=document.createRange();range.selectNodeContents(target);
            const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
            editor.focus();window.richTextTest.rememberSkillRichTextSelection(editor);
        },{html,selector});
    }
    const command=name=>page.getByRole('button',{name,exact:true}).click();
    const editor=page.getByRole('textbox',{name:'Descrizione'});
    const sanitized=await page.evaluate(() => window.richTextTest.normalizeSkillLevelStoredHtml('<h4 style="font-size:80px" onclick="alert(1)">Base</h4><!--StartFragment--><blockquote class="injected"><h4>Durante Abbraccio</h4><p><strong>Effetto.</strong> Testo</p><ul><li>Uno</li></ul></blockquote><script>alert(1)</script>'));
    assert.equal(sanitized,'<h4>Base</h4><blockquote><h4>Durante Abbraccio</h4><p><strong>Effetto.</strong> Testo</p><ul><li>Uno</li></ul></blockquote>');
    console.log('OK headings and callouts round-trip while scripts, attributes and clipboard comments are removed');

    await select('<p>Primo effetto</p><p>Secondo effetto</p>');await command('Elenco puntato');
    assert.equal(await editor.locator('ul > li').count(),2);
    assert.deepEqual(await editor.locator('li').allTextContents(),['Primo effetto','Secondo effetto']);
    assert.equal(await editor.locator('ul').evaluate(e=>getComputedStyle(e).listStyleType),'disc');
    assert.equal(await editor.locator('li').first().evaluate(e=>getComputedStyle(e).display),'list-item');
    await command('Elenco numerato');assert.equal(await editor.locator('ol > li').count(),2);
    assert.equal(await editor.locator('ol').evaluate(e=>getComputedStyle(e).listStyleType),'decimal');
    await command('Elenco numerato');assert.equal(await editor.locator('ol, ul').count(),0);assert.equal(await editor.locator('p').count(),2);
    console.log('OK multi-paragraph lists, visible markers, list-type switching and restoring paragraphs preserve text');

    await select('<p>Base invariata</p><p>Effetto potenziato</p>');await command('Riquadro');
    assert.equal(await editor.locator('blockquote > p').count(),2);
    await command('Riquadro');assert.equal(await editor.locator('blockquote').count(),0);
    assert.deepEqual(await editor.locator('p').allTextContents(),['Base invariata','Effetto potenziato']);
    await select('<p>Durante Abbraccio di Ginevra</p>');await command('Titolo');assert.equal(await editor.locator('h4').innerText(),'Durante Abbraccio di Ginevra');
    await command('Testo');assert.equal(await editor.locator('h4').count(),0);assert.equal(await editor.locator('p').innerText(),'Durante Abbraccio di Ginevra');
    console.log('OK callout and heading toggles preserve text');

    await select('<blockquote><h4>Durante Abbraccio</h4><p>Beneficio uno</p><p>Beneficio due</p></blockquote>');
    await page.evaluate(() => {
        const editor=document.querySelector('[contenteditable]'),p=editor.querySelectorAll('p'),range=document.createRange();
        range.setStartBefore(p[0]);range.setEndAfter(p[1]);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);window.richTextTest.rememberSkillRichTextSelection(editor);
    });
    await command('Elenco puntato');assert.equal(await editor.locator('blockquote > ul > li').count(),2);assert.equal(await editor.locator('blockquote > h4').count(),1);
    const stored=await editor.evaluate(e=>window.richTextTest.normalizeSkillLevelStoredHtml(e.innerHTML));
    assert.match(stored,/<blockquote><h4>Durante Abbraccio<\/h4><ul><li>Beneficio uno/);
    await page.evaluate(stored=>document.querySelectorAll('.player-skill-info-desc,.player-skill-simple-preview-desc').forEach(e=>{e.innerHTML=stored;}),stored);
    for(const selector of ['.player-skill-info-desc','.player-skill-simple-preview-desc']) {
        assert.equal(await page.locator(selector+' ul').evaluate(e=>getComputedStyle(e).listStyleType),'disc');
        assert.equal(await page.locator(selector+' blockquote').evaluate(e=>getComputedStyle(e).borderLeftWidth),'3px');
    }
    console.log('OK nested callout lists survive save/reopen and match reader/preview styles');

    await page.setViewportSize({width:390,height:844});
    assert(await editor.evaluate(e=>e.getBoundingClientRect().width>e.parentElement.getBoundingClientRect().width*.9),'Description must use the full field width rather than a column of the advanced editor');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Editor toolbar must fit a phone viewport');
    console.log('OK guided description uses the full field width and toolbar fits at 390 px');

    await page.route('https://wiki.test/tree', route => route.fulfill({contentType:'text/html', body:'<!doctype html><main></main>'}));
    await page.goto('https://wiki.test/tree');
    await page.addStyleTag({content:css});
    await page.addScriptTag({content:source});
    const rules = '<p>Tramite *dispel magic* subisci **10 danni**, anche se *dispel magic* fallisce.</p>'
        + '<h4>Progressi della trasformazione</h4><ul><li>Conservi <em>volo</em>.</li></ul>'
        + '<p>2 * 3 * 4, 2*3*4, \\*letterale\\*, *spaiato</p>'
        + '<p>*Bonus <strong>+3</strong> al tiro*. *&lt;img src=x&gt;*</p>';
    await page.evaluate(desc => {
        const trees = {lila:{name:'Albero di Lila',nodes:[{id:'dup',title:'Duplicità',x:50,y:50,
            desc, flavor:'Noi due siamo *legate*.'}]}};
        const card = window.CriptaCharacterSkillTree.buildCards({id:'lila'}, trees, {
            skillsMemoryCache:trees, skillTreeCurrentUserIsDm:true, getCurrentCampaignId:()=> 'test'
        });
        document.querySelector('main').append(card);
    }, rules);
    await page.locator('.player-skill-node[data-node-id="dup"]').dispatchEvent('mouseenter');
    const reader = page.locator('.player-skill-info-desc');
    const expectedEmphasis = ['dispel magic','dispel magic','volo','Bonus +3 al tiro','<img src=x>'];
    const hasColoredItalic = element => {
        const style = getComputedStyle(element);
        return style.fontStyle === 'italic' && style.color !== getComputedStyle(element.parentElement).color;
    };
    assert.deepEqual(await reader.locator('em').allTextContents(), expectedEmphasis);
    assert.ok(await reader.locator('em').first().evaluate(hasColoredItalic));
    assert.equal(await reader.locator('em strong').textContent(), '+3');
    assert.equal(await reader.locator('p').nth(1).textContent(), '2 * 3 * 4, 2*3*4, *letterale*, *spaiato');
    assert.equal(await reader.locator('img').count(), 0);
    assert.equal(await reader.locator('h4').evaluate(e=>getComputedStyle(e).borderBlockStartWidth), '1px');
    assert.equal(await page.locator('.player-skill-info-flavor em').textContent(), 'legate');
    await page.locator('[data-skill-edit-toggle]').click();
    const input = page.locator('[contenteditable][data-node-base-field="desc"]');
    assert.match(await input.textContent(), /\*dispel magic\*/);
    const preview = page.locator('[data-skill-simple-preview-desc]');
    assert.deepEqual(await preview.locator('em').allTextContents(), expectedEmphasis);
    assert.ok(await preview.locator('em').first().evaluate(hasColoredItalic));
    await input.fill('Lanci *scudo*.');
    assert.equal(await preview.locator('em').textContent(), 'scudo');
    assert.equal(await input.textContent(), 'Lanci *scudo*.');
    console.log('OK stored asterisks, rich text and live edits render safely in the node card and its preview');

    await page.route('**/character-skill-tree.css*', route => route.fulfill({contentType:'text/css', body:css}));
    const iconFile = require.resolve('../assets/img/skill_trees/skill_valdor_mano_tonante.webp');
    const previewFile = require.resolve('../assets/img/skill_trees/skill_valdor_risonanza_tonante.webp');
    let missingAssignedIcon = false;
    await page.route('**/assigned.webp', route => route.fulfill(missingAssignedIcon
        ? {contentType:'text/html', body:'<html>Immagine non disponibile</html>'} : {contentType:'image/webp', path:iconFile}));
    await page.goto('https://wiki.test/tree');
    await page.addScriptTag({content:source});
    await page.addScriptTag({path:require.resolve('../assets/js/shared/skill-tree-sheet.js')});
    await page.addScriptTag({path:require.resolve('../assets/js/shared/managed-player-extensions.js')});
    await page.evaluate(() => {
        const desc = '<p>Risveglio</p>';
        let revision = 1;
        let tree = {id:'lila', name:'Albero di Lila', nodes:[{id:'dup', title:'Duplicità', x:50, y:50, desc, baseDesc:desc, flavor:'Una voce, due ombre.', icon:'https://wiki.test/assigned.webp',
            levels:[{desc}, {desc:'<p>Potere</p><p>Un effetto aggiuntivo.</p>'}]}]};
        window.CriptaApp = {auth:{getToken:()=>'test'}, urls:{api:path => new URL(path, location.origin).href}, api:{
            get: async (path, options) => {
                if (path !== 'api/skill-trees/sheet' || options.query.id !== 'lila') throw new Error('Unexpected collection read: ' + path);
                return {trees:{ok:true,version:revision,data:[structuredClone(tree)],treeRevisions:{lila:revision}},
                    progress:{ok:true,version:0,data:[],stateRevisions:{}}};
            },
            post: async (path, body) => {
                if (path !== 'api/data/skill-trees') throw new Error('Unexpected save: ' + path);
                if (body.expectedTreeRevision !== revision || body.responseMode !== 'revision') throw new Error('Expected a versioned single-tree save');
                tree = structuredClone(body.tree);
                revision++;
                return {saved:true,version:revision,treeId:tree.id,treeRevision:revision};
            }
        }};
        window.savedNode = (index = 0) => tree.nodes[index];
        window.openTree = () => window.CriptaManagedPlayerExtensions.mount(
            {skillTrees:document.querySelector('main')}, {ownerCharacterId:'lila', permissions:{isEditor:true}}
        );
        return window.openTree();
    });
    const save = page.getByRole('button', {name:'Salva albero', exact:true});
    async function formatFirstWord(field, format) {
        await field.locator('p').first().dblclick({position:{x:5, y:8}});
        const selection = await page.evaluate(() => getSelection().toString().trim());
        assert.ok(selection && !/\s/.test(selection), 'Select a single word through the editor');
        await command(format);
        assert.ok(await save.isEnabled(), 'Formatting alone enables Save');
        await save.click();
        assert.ok(await save.isDisabled(), 'The saved format is the new clean state');
    }
    await page.locator('[data-skill-edit-toggle]').click();
    assert.ok(await save.isDisabled());
    await formatFirstWord(input, 'Titolo');
    const baseHeading = '<h4>Risveglio</h4>';
    const savedNode = await page.evaluate(() => window.savedNode());
    assert.equal(savedNode.desc, baseHeading);
    assert.equal(savedNode.baseDesc, baseHeading);
    assert.equal(savedNode.levels[0].desc, baseHeading);
    assert.equal(await input.innerHTML(), baseHeading);

    await page.locator('[data-skill-simple-toggle]').click();
    await page.locator('[data-skill-level-editor-tab="1"]').click();
    const upgrade = page.locator('[contenteditable][data-node-level-field="desc"]');
    await formatFirstWord(upgrade, 'Riquadro');
    const levelHtml = '<blockquote><p>Potere</p></blockquote><p>Un effetto aggiuntivo.</p>';
    assert.equal(await page.evaluate(() => window.savedNode().levels[1].desc), levelHtml);
    await page.evaluate(() => window.openTree());
    await page.locator('.player-skill-node[data-node-id="dup"]').dispatchEvent('mouseenter');
    assert.equal(await reader.locator('h4').textContent(), 'Risveglio');
    await page.locator('[data-skill-edit-toggle]').click();
    await page.locator('[data-skill-level-editor-tab="1"]').click();
    assert.equal(await upgrade.innerHTML(), levelHtml);
    assert.ok(await save.isDisabled());
    console.log('OK formatting-only edits in guided and advanced mode survive save and reopening from the managed actor sheet');

    for (const file of ['skill-node-generator.mjs', 'catalog-item-review.mjs', 'skill-node-preview-key.mjs', 'skill-tree-review.mjs', 'skill-tree-icon-pack.mjs', 'icon-reference-picker.mjs']) {
        await page.route('**/' + file + '*', route => route.fulfill({
            path:require.resolve('../assets/js/shared/' + file), contentType:'text/javascript'
        }));
    }
    const proposal = {name:'Eco', flavor:'La seconda ombra risponde.', description:'Ottieni vantaggio alla prova.', questions:[]};
    const icons = new Map();
    const oldIcon = {id:'e3ae8249-32de-4567-b923-9e19fab091b8', name:'Risveglio', description:'Il bersaglio si risveglia.'};
    let imageRequests = 0, reviewRequests = 0;
    let generationRequest;
    await page.route('**/generate-node/*/preview?*', route => route.fulfill({contentType:'image/webp', path:previewFile}));
    await page.route('**/api/skill-trees/generate-node?*', route => {
        if (route.request().method() === 'GET') {
            const params = new URL(route.request().url()).searchParams;
            if (params.has('icons')) {
                const slots = params.get('icons').split(',').map(pair => pair.split('.')[0]);
                return route.fulfill({json:{previews:Object.fromEntries(slots.filter(slot => icons.has(slot)).map(slot => [slot, icons.get(slot)]))}});
            }
            const previous = icons.get(params.get('previewSlot')) || (params.get('legacy') === 'tree' ? oldIcon : null);
            return route.fulfill({json:{preview:previous}});
        }
        generationRequest = route.request().postDataJSON();
        if (generationRequest.mode === 'tree-review') {
            reviewRequests++;
            const proposals = generationRequest.targets.map(({key}) => ({key, description:'', visual:'Un simbolo.'}));
            return route.fulfill({json:{job:{id:generationRequest.requestId, status:'ready', draft:{proposals, visualStyle:'Pergamena'}}}});
        }
        if (generationRequest.mode === 'icon') {
            imageRequests++;
            icons.set(generationRequest.previewSlot, {id:generationRequest.requestId, name:generationRequest.name});
            return route.fulfill({json:{job:{id:generationRequest.requestId, status:'ready', iconId:generationRequest.requestId}}});
        }
        return route.fulfill({json:{job:{id:generationRequest.requestId, status:'ready', draft:proposal}}});
    });
    const generate = page.getByRole('button', {name:'Genera nodo', exact:true});
    await generate.click();
    const dialog = page.getByRole('dialog', {name:'Genera nodo'});
    await dialog.getByRole('img', {name:'Ultima icona generata'}).waitFor();
    assert.ok(await dialog.getByText('Ultima icona generata · Risveglio').isVisible());
    assert.equal(imageRequests, 0);
    await dialog.getByLabel('Appunti del DM').fill('La seconda ombra risponde. Ottieni vantaggio alla prova.');
    await dialog.getByRole('button', {name:'Riscrivi in stile D&D 5e'}).click();
    const subtitle = dialog.getByLabel('Sottotitolo (facoltativo)', {exact:true});
    await subtitle.waitFor();
    assert.equal(generationRequest.examples[0].flavor, 'Una voce, due ombre.');
    assert.equal(await subtitle.inputValue(), proposal.flavor);
    assert.equal(await dialog.getByLabel('Descrizione', {exact:true}).inputValue(), proposal.description);
    const editedFlavor = 'Dal buio risponde un sussurro.';
    await subtitle.fill(editedFlavor);
    await dialog.getByRole('button', {name:'Chiudi'}).click();
    await generate.click();
    assert.equal(await subtitle.inputValue(), editedFlavor);
    await dialog.getByRole('button', {name:"Aggiungi all'albero"}).click();
    await save.click();
    const added = await page.evaluate(() => window.savedNode(1));
    assert.equal(added.title, proposal.name);
    assert.equal(added.flavor, editedFlavor);
    assert.equal(added.desc, '<p>' + proposal.description + '</p>');
    assert.equal(added.icon, '', 'Viewing an earlier preview does not attach it to a new node');
    console.log('OK generated node subtitles can be edited, recovered and saved independently of the rules');

    const openIcon = page.locator('[data-skill-action="regenerate-node-icon"]');
    await openIcon.click();
    const iconDialog = page.getByRole('dialog', {name:'Genera icona'});
    await iconDialog.getByRole('button', {name:'Genera icona', exact:true}).click();
    await iconDialog.locator('[data-preview]').waitFor();
    await iconDialog.getByRole('button', {name:'Chiudi'}).click();
    await page.evaluate(() => sessionStorage.clear());
    await openIcon.click();
    await iconDialog.locator('[data-preview]').waitFor();
    assert.ok(await iconDialog.locator('[data-add]').isEnabled());
    assert.equal(imageRequests, 1, 'Reopening in a fresh session should only read the preview');
    await iconDialog.getByRole('button', {name:'Chiudi'}).click();
    await generate.click();
    await dialog.getByRole('button', {name:'Riprendi proposta'}).click();
    assert.equal(await dialog.getByLabel('Nome del nodo').inputValue(), oldIcon.name);
    assert.equal(await dialog.getByLabel('Descrizione', {exact:true}).inputValue(), oldIcon.description);
    assert.ok(await dialog.locator('[data-preview]').isVisible());
    assert.ok(await dialog.getByRole('button', {name:"Aggiungi all'albero"}).isEnabled());
    assert.equal(imageRequests, 1);
    console.log('OK unconfirmed icons reappear from server history without starting another generation');
    await dialog.getByRole('button', {name:'Chiudi'}).click();
    await page.locator('[data-editor-scope="settings"]').click();
    const openReview = page.getByRole('button', {name:'Rivedi tutto l’albero con AI'});
    await openReview.click();
    const review = page.getByRole('dialog', {name:'Revisione AI dell’albero'});
    const assigned = review.getByRole('img', {name:'Icona attuale · Duplicità · Grado 1', exact:true});
    await assigned.waitFor();
    assert.equal(await assigned.getAttribute('src'), 'https://wiki.test/assigned.webp');
    assert.equal(await review.getByRole('img', {name:'Icona del grado base · Duplicità · Grado 2'}).getAttribute('src'), await assigned.getAttribute('src'));
    const eco = review.locator('.skill-tree-review__row').filter({has:page.getByRole('heading', {name:'Eco', exact:true})});
    await eco.getByRole('img', {name:'Ultima icona generata · Eco'}).waitFor();
    assert.ok(await eco.getByText('Nessuna icona').isVisible());
    assert.equal(await eco.getByRole('checkbox', {name:'Applica icona'}).isChecked(), false);
    const downloadPack = review.getByRole('button', {name:'Scarica pacchetto icone'});
    async function checkDownload(expected) {
        const [download] = await Promise.all([page.waitForEvent('download'), downloadPack.click()]);
        assert.equal(download.suggestedFilename(), 'icone-albero-di-lila.zip');
        const path = await download.path();
        // Read the actual browser download with the platform's archive reader.
        const dir = await mkdtemp(join(dirname(path), 'icons-'));
        if (process.platform === 'win32') execFileSync('tar', ['-xf', path, '-C', dir]);
        else execFileSync('unzip', ['-q', path, '-d', dir]);
        const extracted = await readdir(dir, {recursive:true, withFileTypes:true});
        const names = extracted.filter(e => e.isFile()).map(e => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'));
        assert.deepEqual(names.sort(), [...expected].sort());
        for (const name of expected) {
            assert.deepEqual(await readFile(join(dir, name)), await readFile(name.startsWith('attuali/') ? iconFile : previewFile));
        }
    }
    const currentFile = 'attuali/n1g1-duplicità-grado-1.webp', proposedFile = 'proposte-ai/n2g1-eco.webp';
    await checkDownload([currentFile, proposedFile]);
    missingAssignedIcon = true;
    await checkDownload([proposedFile]);
    assert.match(await review.locator('[data-download-status]').textContent(), /Impossibile includere Duplicità · Grado 1/);
    missingAssignedIcon = false;
    await checkDownload([currentFile, proposedFile]);
    assert.ok(await save.isDisabled());
    assert.equal(await eco.getByRole('checkbox', {name:'Applica icona'}).isChecked(), false);
    assert.equal(imageRequests, 1);
    assert.equal(reviewRequests, 0);
    console.log('OK ZIP download, partial download and retry preserve assigned and unconfirmed images without generating or applying changes');

    await page.evaluate(() => { window.CriptaMedia = {uploadBlob:async () => ({path:'https://wiki.test/assigned.webp'})}; });
    await eco.getByRole('checkbox', {name:'Applica icona'}).check();
    await review.getByRole('button', {name:'Conferma nella bozza (1)'}).click();
    await review.waitFor({state:'hidden'});
    await save.click();
    assert.equal((await page.evaluate(() => window.savedNode(1))).icon, 'https://wiki.test/assigned.webp');
    assert.equal(reviewRequests, 0);

    const ecoSlot = [...icons.keys()][0];
    await openReview.click();
    await review.getByLabel('Testi delle abilità').uncheck();
    await review.getByLabel('Icone delle abilità').check();
    await review.getByRole('button', {name:'Prepara proposte'}).click();
    await review.getByRole('button', {name:'Conferma nella bozza (2)'}).waitFor();
    assert.equal(reviewRequests, 1);
    assert.equal(imageRequests, 3);
    assert.equal(icons.get(ecoSlot).id, generationRequest.requestId);
    assert.equal(await eco.getByRole('img', {name:'Icona proposta · Eco'}).count(), 1);
    await checkDownload([currentFile, 'proposte-ai/n1g1-duplicità-grado-1.webp', 'attuali/n2g1-eco.webp', proposedFile]);
    assert.equal(imageRequests, 3);
    assert.equal(reviewRequests, 1);
    console.log('OK whole-tree review shows assigned, inherited and archived icons before generation and shares new previews by node and grade');
} finally { await browser.close(); }
