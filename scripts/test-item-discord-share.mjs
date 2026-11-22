import assert from "node:assert/strict";
import {readFile, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const items = JSON.parse(await readFile(path.join(root, "campaigns/cripta-di-sangue/data/items.json")));
const circlet = items.find(item => item.id === "diadema-adamantino");
const rich = {id: "rich", name: "Prova", type: "Oggetto meraviglioso", properties: [
    {name: "Dono", genial: true, description: "**Forza** e *astuzia*.\n\n3. Primo\n4. Secondo\n  - Interno"},
    {name: "Debito", negative: true, description: "La magia ha un prezzo."},
    {name: "SEGRETO", hidden: true, description: "Privato"}
]};
const unknown = {...rich, id: "unidentified", unidentified: true, unidentifiedName: "Pietra liscia",
    unidentifiedDescription: "Una pietra nera.", summary: "SEGRETO", hidden: true};
const types = {".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".css": "text/css",
    ".webp": "image/webp", ".json": "application/json"};
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH});
try {
    const page = await browser.newPage({viewport: {width: 1200, height: 930}, colorScheme: "light"});
    let uploaded;
    await page.addInitScript(() => {
        localStorage.setItem("discord_jwt", "test");
        const original = CanvasRenderingContext2D.prototype.fillText;
        window.paintedWords = [];
        CanvasRenderingContext2D.prototype.fillText = function(word, ...args) {
            window.paintedWords.push([word, this.font]);
            return original.call(this, word, ...args);
        };
    });
    await page.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url()), pathname = url.pathname;
        const json = value => route.fulfill({json: value});
        if (pathname === "/auth/discord/verify") return json({user: {accountId: "dm"}});
        if (pathname === "/api/campaign/access") return json({permissions: {canManageCampaign: true}});
        if (pathname === "/api/data/items") return json({data: [circlet, rich, unknown], source: "kv", version: 1});
        if (pathname === "/api/discord/share-card") {
            const form = await new Response(request.postDataBuffer(), {headers: request.headers()}).formData();
            const file = form.get("file");
            assert.equal(file.type, "image/png");
            assert.ok(file.size > 1000 && file.size <= 8 * 1024 * 1024);
            uploaded = Buffer.from(await file.arrayBuffer());
            return json({sent: true});
        }
        if (pathname.endsWith("/adamantine_headband.webp")) {
            return route.fulfill({path: path.join(root, "assets/img/items/adamantine_headband.webp"), contentType: "image/webp"});
        }
        if (url.hostname !== "localhost") return json({});
        const file = path.resolve(root, "." + decodeURIComponent(pathname));
        assert.ok(file.startsWith(root));
        try { return await route.fulfill({body: await readFile(file), contentType: types[path.extname(file)]}); }
        catch { return route.fulfill({status: 404}); }
    });
    await page.goto("http://localhost:8789/pages/oggetti.html");
    const modal = page.locator(".discord-share-modal");
    const sheet = modal.locator(".discord-item-sheet");
    await page.locator("#items-config-controls-button").click();
    async function open(id) {
        await page.evaluate(() => window.paintedWords = []);
        await page.locator('[data-item-discord-share="' + id + '"]').click();
        await modal.locator("[data-share-send]:enabled").waitFor();
    }
    const block = page.locator("#diadema-adamantino .cripta-catalog-property").first();
    await page.locator("#diadema-adamantino").evaluate(el => el.open = true);
    const background = await block.evaluate(el => getComputedStyle(el).backgroundColor);
    assert.equal(background, "rgb(33, 31, 35)", "The wiki must use dark paper even with a light OS theme");
    if (process.env.ITEM_SHARE_QA_DIR) await page.locator("#diadema-adamantino").screenshot({
        path: path.join(process.env.ITEM_SHARE_QA_DIR, "cerchietto-wiki.png"),
        style: ".sidebar,.top-auth-bar,.items-tools{visibility:hidden}"
    });
    await open(circlet.id);
    assert.equal(await sheet.locator("img").count(), 1);
    assert.equal(await sheet.locator(".cripta-catalog-property").first().evaluate(el => getComputedStyle(el).backgroundColor), background);
    assert.equal(await sheet.locator(".cripta-catalog-property-charges").first().textContent(), "12 cariche");
    if (process.env.ITEM_SHARE_QA_DIR) await modal.locator(".discord-share-dialog").screenshot({
        path: path.join(process.env.ITEM_SHARE_QA_DIR, "cerchietto-anteprima-discord.png")
    });
    await modal.locator("[data-share-send]").click();
    await modal.getByText("Pubblicata", {exact: true}).waitFor();
    assert.equal(uploaded.readUInt32BE(16), 1320, "The uploaded PNG uses the full export width");
    if (process.env.ITEM_SHARE_QA_DIR) await writeFile(path.join(process.env.ITEM_SHARE_QA_DIR, "cerchietto-discord.png"), uploaded);
    await modal.getByRole("button", {name: "Annulla"}).click();
    await page.setViewportSize({width: 320, height: 650});
    await open("rich");
    assert.deepEqual(await sheet.locator(".discord-item-legend").allTextContents(), ["✦ Geniale", "☾ Negativa"]);
    assert.deepEqual(await sheet.locator(".discord-item-marker").allTextContents(), ["3.", "4.", "•"]);
    assert.equal(await sheet.locator("strong").textContent(), "Forza");
    assert.ok(await sheet.evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth));
    const words = await page.evaluate(() => window.paintedWords);
    assert.ok(words.some(([word, font]) => word === "Forza" && /bold|700/.test(font)));
    assert.ok(words.some(([word, font]) => word === "astuzia" && font.includes("italic")));
    assert.ok(words.some(([word]) => word === "3."));
    assert.ok(!words.some(([word]) => word === "SEGRETO"));
    await page.keyboard.press("Escape");
    await open("unidentified");
    assert.match(await modal.locator("[data-share-warning]").innerText(), /Solo DM/);
    assert.equal(await sheet.locator(".discord-item-name").textContent(), "Pietra liscia");
    assert.equal(await sheet.locator(".cripta-catalog-property").count(), 0);
    assert.ok(!(await sheet.innerText()).includes("SEGRETO"));
    assert.ok(!(await page.evaluate(() => window.paintedWords.flat().join(" "))).includes("SEGRETO"));
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.CriptaDiscordShare.open({kind: "npc", entityId: "test-npc", name: "Custode"}));
    await modal.locator("[data-share-preview] > img").waitFor();
    assert.equal(await modal.locator("[data-share-send]").isEnabled(), true);
    console.log("OK palette scura, scheda responsiva, PNG, formattazione e visibilità Discord.");
} finally {
    await browser.close();
}
