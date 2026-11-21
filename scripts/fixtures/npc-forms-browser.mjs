import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname } from "node:path";

export async function verifyDossierForms(call, dm) {
    const puppeteer = createRequire(import.meta.url)("puppeteer");
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    const site = "https://wiki.test";
    const dossier = site + "/pages/characters/managed-actor.html?world=world&actor=human";
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const files = new URL("../../", import.meta.url);
    const types = { ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".json": "application/json", ".webp": "image/webp" };
    await page.evaluateOnNewDocument(token => {
        if (location.origin === "https://wiki.test" && !sessionStorage.getItem("forms-test")) {
            sessionStorage.setItem("forms-test", "1");
            localStorage.setItem("discord_jwt", token);
        }
    }, dm);
    await page.setRequestInterception(true);
    page.on("request", async request => {
        const url = new URL(request.url());
        const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
        if (request.method() === "OPTIONS") return request.respond({ status: 204, headers });
        if (url.pathname.startsWith("/api/")) {
            const payload = url.pathname.startsWith("/api/managed-actors") ? await call(url.pathname + url.search,
                request.postData() ? JSON.parse(request.postData()) : undefined,
                request.headers().authorization?.replace(/^Bearer /, "") || "") : { ok: true, data: [] };
            return request.respond({ status: payload.status || 200, contentType: "application/json", headers, body: JSON.stringify(payload) });
        }
        if (url.origin !== site) return request.abort();
        if (url.pathname.endsWith("/search-index.json")) return request.respond({
            status: 200, contentType: "application/json", body: JSON.stringify({ items: [
                { type: "npc", entityId: "human", title: "Arianna", content: "Custode" },
                { type: "npc", entityId: "angel", title: "Arianna serafica", content: "Angelica" }
            ] })
        });
        try {
            const path = /^\/assets\/(human|angel|shade|other)-(avatar|token)\.webp$/.test(url.pathname)
                ? "assets/img/ui/tab_icon.webp" : "." + url.pathname;
            const body = await readFile(new URL(path, files));
            return request.respond({ status: 200, contentType: types[extname(url.pathname)], body });
        } catch { return request.respond({ status: 404, body: "" }); }
    });
    page.setDefaultTimeout(8000);
    try {
        await page.goto(dossier + "&profile=1");
        await page.waitForSelector(".npc-forms-manager summary", { visible: true });
        await page.click(".npc-forms-manager summary");
        await page.waitForSelector('[name="actor"] option[value="world:angel"]');
        await page.select('[data-form-link] select', "world:angel");
        await page.type('[data-form-link] [name="label"]', "Angelica");
        await Promise.all([page.waitForNavigation(), page.click("[data-form-link] button")]);
        await page.waitForSelector('[data-action="current"]', { visible: true });
        assert.equal(await page.$eval("h1", node => node.textContent), "Arianna");
        assert.match(await page.$eval("#managed-npc-profile", node => node.textContent), /Storia condivisa/);
        assert.match(await page.$eval(".managed-actor-art .managed-actor-token img", node => node.src), /angel-token/);
        assert.equal(await page.$eval(".npc-form-switch select", node => node.value), "world:angel");
        await Promise.all([page.waitForNavigation(), page.click('[data-action="current"]')]);
        await page.waitForSelector('[data-form-member]', { visible: true });
        await page.select("[data-form-member]", "world:human");
        await Promise.all([page.waitForNavigation(), page.click('[data-action="past"]')]);
        await page.waitForSelector(".npc-form-switch select");
        assert.match(await page.$eval(".npc-form-switch select", node => node.selectedOptions[0].textContent), /Passata/);
        await page.goto(dossier);
        await page.waitForSelector(".npc-form-switch select");
        assert.match(await page.$eval(".npc-form-switch select", node => node.selectedOptions[0].textContent), /Angelica · Attuale/);
        await page.click('[data-managed-edit-toggle="edit"]');
        await page.waitForSelector('[data-managed-profile-field="role"]', { visible: true });
        await page.$eval('[data-managed-profile-field="role"]', node => {
            node.value = "Guardiana";
            node.dispatchEvent(new Event("input", { bubbles: true }));
        });
        const profileSaved = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/human/profile"));
        await page.click("[data-managed-save]");
        assert.equal((await profileSaved).status(), 200);
        assert.equal((await call("/api/managed-actors/world/human/profile")).data.role, "Guardiana");
        assert.equal((await call("/api/managed-actors/world/angel/profile")).data.role, "Custode");
        await page.goto(dossier);
        await page.waitForSelector(".npc-forms-manager summary", { visible: true });
        await page.click(".npc-forms-manager summary");
        await Promise.all([page.waitForNavigation(), page.click("[data-form-portrait]")]);
        await page.waitForSelector(".npc-form-switch select");
        await page.evaluate(() => localStorage.removeItem("discord_jwt"));
        await page.setViewport({ width: 390, height: 844 });
        await page.goto(dossier);
        await page.waitForSelector(".is-profile-only .npc-form-switch select");
        assert.equal(await page.$(".npc-forms-manager"), null);
        assert.equal(await page.$("#managed-stats"), null);
        assert.match(await page.$eval(".managed-actor-avatar img", node => node.src), /angel-avatar/);
        assert.match(await page.$eval(".managed-actor-token img", node => node.src), /angel-token/);
        assert.ok(await page.$eval(".managed-actor-token", node => node.getBoundingClientRect().width > 0));
        await Promise.all([page.waitForNavigation(), page.select(".npc-form-switch select", "world:human")]);
        await page.waitForSelector("#managed-stats");
        assert.match(await page.$eval(".managed-actor-avatar img", node => node.src), /human-avatar/);
        const saved = await call("/api/managed-actors/world/human/forms");
        assert.equal(saved.group.forms.find(form => form.current).key, "world:angel");
        await page.goto(site + "/pages/cerca.html?q=Arianna");
        await page.waitForSelector(".result-item");
        assert.deepEqual(await page.$$eval(".result-title", nodes => nodes.map(node => node.textContent)), ["Arianna", "Arianna delle ombre"]);
        assert.match(await page.$eval(".result-item", node => node.href), /actor=human/);
        await page.goto(site + "/pages/cerca.html?q=Angelica");
        await page.waitForSelector(".result-item");
        assert.deepEqual(await page.$$eval(".result-title", nodes => nodes.map(node => node.textContent)), ["Arianna"]);
        assert.deepEqual(errors, []);
        console.log("Browser desktop e mobile: collegamento, selezione, forma passata, dossier condiviso e vista giocatore verificati.");
    } catch (error) {
        console.error("Stato del dossier:", page.url(), await page.$eval("[data-managed-actor-root]", node => node.innerText.slice(0, 350)).catch(() => ""), errors);
        throw error;
    } finally { await browser.close(); }
}
