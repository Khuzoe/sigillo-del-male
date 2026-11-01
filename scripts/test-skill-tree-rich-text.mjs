import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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
} finally { await browser.close(); }
