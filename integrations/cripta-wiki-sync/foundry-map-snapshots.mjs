import { DEFAULT_CAMPAIGN_ID, DEFAULT_SITE_BASE_URL, DISCORD_WORKER_URL, MODULE_ID, SETTINGS } from "../constants.js";
import { canPushToWorker } from "./sync-policy.js";
import { policyFetch } from "./worker-gateway.js";

const FLAG = "mapSnapshot";
const MAX_EDGE = 3072;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_FOG_EDGE = 4096;
const assetKey = document => JSON.stringify([document.id, document.texture?.src || ""]);

export function playerPlaceables(placeables, approved) {
    const keys = new Set(approved);
    return placeables.filter(entry => !entry.document.hidden && keys.has(assetKey(entry.document)));
}

export function unionExploredPixels(mask, pixels) {
    if (pixels.length !== mask.length * 4) throw new Error("Dimensione della nebbia non coerente.");
    for (let i = 0; i < mask.length; i++) {
        // The saved texture's red channel is explored coverage. A threshold
        // keeps lossy pixels just outside the explored boundary fully opaque.
        if (pixels[i * 4] >= 224 && pixels[i * 4 + 3] >= 224) mask[i] = 255;
    }
}

function sceneLayers() {
    return {
        backgrounds: canvas.primary.levelTextures.filter(mesh => mesh.visible && mesh.texture?.valid),
        tiles: canvas.tiles.placeables.filter(item => item.document.texture?.src),
        tokens: canvas.tokens.placeables,
    };
}

function configuredLevelTextures(scene) {
    // Foundry includes empty background and foreground slots for the viewed level.
    return scene._configureLevelTextures().filter(layer => layer.src);
}

function sceneSignature(scene, backgrounds) {
    return JSON.stringify([scene.fog.mode, scene.tokenVision, scene._view, scene.backgroundColor,
        canvas.dimensions.sceneRect.width, canvas.dimensions.sceneRect.height,
        configuredLevelTextures(scene).map(layer => [layer.src, layer.name, layer.elevation, layer.tint, { ...layer.level.textures }]),
        backgrounds.length]);
}

function captureSize(rect) {
    const scale = Math.min(1, MAX_EDGE / Math.max(rect.width, rect.height));
    return { width: Math.max(1, Math.round(rect.width * scale)), height: Math.max(1, Math.round(rect.height * scale)) };
}

function playerVisibilitySignature(scene, layers, settings) {
    return JSON.stringify([scene.fog.reset,
        playerPlaceables(layers.tiles, settings.tileKeys).map(entry => assetKey(entry.document)),
        playerPlaceables(layers.tokens, settings.tokenKeys).map(entry => assetKey(entry.document))]);
}

function renderLayers(rect, size, backgrounds, tiles, tokens, backgroundColor) {
    const { width, height } = size;
    const stage = new PIXI.Container();
    const target = PIXI.RenderTexture.create({ width, height, resolution: 1 });
    const sort = foundry.canvas.groups.PrimaryCanvasGroup._compareObjects;
    try {
        const layers = [
            ...backgrounds.map(mesh => ({ mesh, alpha: mesh.alpha })),
            ...[...tiles, ...tokens].map(entry => ({ mesh: entry.mesh, alpha: entry.document.alpha })),
        ];
        const background = new PIXI.Graphics();
        const color = typeof backgroundColor === "string" ? Number.parseInt(backgroundColor.replace(/^#/, ""), 16) : Number(backgroundColor ?? NaN);
        background.beginFill(Number.isFinite(color) ? color : 0x16181d).drawRect(rect.x, rect.y, rect.width, rect.height).endFill();
        stage.addChild(background);
        for (const { mesh, alpha } of layers.sort((a, b) => {
            if (!a.mesh || !b.mesh) return 0;
            return sort(a.mesh, b.mesh);
        })) {
            if (!mesh?.texture?.valid) throw new Error("Un tile o token non è ancora caricato.");
            const sprite = new PIXI.Sprite(mesh.texture);
            sprite.anchor.copyFrom(mesh.anchor);
            sprite.position.copyFrom(mesh.position);
            sprite.scale.copyFrom(mesh.scale);
            sprite.angle = mesh.angle;
            sprite.tint = mesh.tint;
            sprite.alpha = Number.isFinite(alpha) ? alpha : 1;
            stage.addChild(sprite);
        }
        const sx = width / rect.width;
        const sy = height / rect.height;
        const transform = new PIXI.Matrix(sx, 0, 0, sy, -rect.x * sx, -rect.y * sy);
        canvas.app.renderer.render(stage, { renderTexture: target, transform, clear: true });
        return canvas.app.renderer.extract.canvas(target);
    } finally {
        stage.destroy({ children: true, texture: false, baseTexture: false });
        target.destroy(true);
    }
}

async function playerFog(scene) {
    const users = game.users.filter(user => !user.isGM);
    const reset = Number(scene.fog.reset || 0);
    const loaded = [];
    for (const user of users) {
        const doc = await foundry.documents.FogExploration.load({ scene, user });
        if (doc?.explored && (!reset || Number(doc.timestamp) >= reset)) loaded.push(doc.explored);
    }
    return [...new Set(loaded)];
}

async function hideUnexplored(image, rect, config, fogPosition, sources) {
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = image.width;
    maskCanvas.height = image.height;
    const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
    const pixels = maskContext.createImageData(image.width, image.height);
    const union = new Uint8Array(image.width * image.height);
    const expectedWidth = Math.round(config.width * config.resolution);
    const expectedHeight = Math.round(config.height * config.resolution);
    if (!(expectedWidth > 0 && expectedWidth <= MAX_FOG_EDGE && expectedHeight > 0 && expectedHeight <= MAX_FOG_EDGE)) {
        throw new Error("La risoluzione della nebbia non è compatibile.");
    }
    maskContext.imageSmoothingEnabled = false;
    for (const source of sources) {
        if (!/^data:image\/(?:webp|png|jpeg);base64,/i.test(source)) throw new Error("Formato della nebbia non valido.");
        const bitmap = await createImageBitmap(await (await fetch(source)).blob());
        try {
            if (bitmap.width !== expectedWidth || bitmap.height !== expectedHeight) {
                throw new Error("La nebbia salvata non corrisponde alle dimensioni correnti della scena.");
            }
            maskContext.clearRect(0, 0, image.width, image.height);
            const sx = image.width / rect.width;
            const sy = image.height / rect.height;
            maskContext.drawImage(bitmap, (fogPosition.x - rect.x) * sx, (fogPosition.y - rect.y) * sy, config.width * sx, config.height * sy);
            unionExploredPixels(union, maskContext.getImageData(0, 0, image.width, image.height).data);
        } finally { bitmap.close(); }
    }
    for (let i = 0; i < union.length; i++) pixels.data[i * 4 + 3] = union[i];
    maskContext.putImageData(pixels, 0, 0);
    const context = image.getContext("2d");
    context.globalCompositeOperation = "destination-in";
    context.drawImage(maskCanvas, 0, 0);
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = "#17191f";
    context.fillRect(0, 0, image.width, image.height);
    context.globalCompositeOperation = "source-over";
}

async function encodeWebp(image) {
    for (const quality of [0.88, 0.76, 0.62]) {
        const blob = await new Promise(resolve => image.toBlob(resolve, "image/webp", quality));
        if (blob?.type === "image/webp" && blob.size <= MAX_BYTES) return blob;
    }
    throw new Error("La mappa supera 4 MB anche dopo la compressione.");
}

async function capture(scene, settings) {
    if (!canvas.ready || canvas.scene !== scene) throw new Error("Apri la scena sul canvas prima di esportarla.");
    if (scene.levels.size !== 1) throw new Error("Il prototipo supporta scene con un solo livello.");
    const hasFog = scene.fog.mode !== CONST.FOG_EXPLORATION_MODES.DISABLED;
    if (hasFog && !scene.tokenVision) throw new Error("La nebbia richiede la visuale dei token per questo prototipo.");
    const initialFog = JSON.stringify(scene.fog);
    const sources = hasFog ? await playerFog(scene) : [];
    if (!canvas.ready || canvas.scene !== scene || JSON.stringify(scene.fog) !== initialFog) throw new Error("La scena è cambiata durante l’esportazione.");
    const layers = sceneLayers();
    const signature = sceneSignature(scene, layers.backgrounds);
    if (settings.signature && settings.signature !== signature) throw new Error("Sfondo o impostazioni di visuale cambiati. Rivedi l’anteprima.");
    if (layers.backgrounds.length < configuredLevelTextures(scene).length) {
        throw new Error("Una delle immagini configurate per lo sfondo o il primo piano non è stata caricata.");
    }
    const playerTiles = playerPlaceables(layers.tiles, settings.tileKeys);
    const playerTokens = playerPlaceables(layers.tokens, settings.tokenKeys);
    const visibility = playerVisibilitySignature(scene, layers, settings);
    const rect = canvas.dimensions.sceneRect.clone();
    const size = captureSize(rect);
    const player = renderLayers(rect, size, layers.backgrounds, playerTiles, playerTokens, scene.backgroundColor);
    const separate = hasFog || playerTiles.length !== layers.tiles.length || playerTokens.length !== layers.tokens.length;
    const dm = separate ? renderLayers(rect, size, layers.backgrounds, layers.tiles, layers.tokens, scene.backgroundColor) : null;
    if (hasFog) {
        const fog = canvas.fog;
        if (!fog.textureConfiguration || !fog.sprite?.position) throw new Error("La nebbia della scena non è pronta.");
        await hideUnexplored(player, rect, { ...fog.textureConfiguration }, { x: fog.sprite.x, y: fog.sprite.y }, sources);
    }
    return { player: await encodeWebp(player), dm: dm ? await encodeWebp(dm) : null, signature, visibility };
}

function campaignId() {
    return game.settings.get(MODULE_ID, SETTINGS.CAMPAIGN_ID) || DEFAULT_CAMPAIGN_ID;
}

async function publish(scene, settings, images) {
    if (!canPushToWorker()) throw new Error("Attiva l’invio al sito nelle impostazioni Wiki Sync.");
    if (!canvas.ready || canvas.scene !== scene) throw new Error("La scena è cambiata. Rigenera l’anteprima prima di pubblicare.");
    const layers = sceneLayers();
    if (sceneSignature(scene, layers.backgrounds) !== images.signature || playerVisibilitySignature(scene, layers, settings) !== images.visibility) {
        throw new Error("La scena è cambiata. Rigenera l’anteprima prima di pubblicare.");
    }
    const url = new URL(DISCORD_WORKER_URL + "/api/foundry-maps/" + encodeURIComponent(game.world.id) + "/" + encodeURIComponent(scene.id));
    url.searchParams.set("campaign", campaignId());
    const token = game.settings.get(MODULE_ID, SETTINGS.DISCORD_TOKEN);
    const secret = game.settings.get(MODULE_ID, SETTINGS.INVENTORY_SYNC_SECRET);
    const form = new FormData();
    form.set("title", settings.title);
    form.set("player", images.player, "players.webp");
    if (images.dm) form.set("dm", images.dm, "dm.webp");
    const response = await policyFetch(url, { method: "POST", body: form, signal: AbortSignal.timeout(30_000), headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(secret ? { "X-Cripta-Inventory-Secret": secret } : {}),
    } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) throw new Error(result.error || "Il sito non ha accettato la mappa.");
    return result;
}

function sceneLink(scene) {
    const base = game.settings.get(MODULE_ID, SETTINGS.SITE_BASE_URL) || DEFAULT_SITE_BASE_URL;
    const url = new URL(base.replace(/\/+$/, "") + "/pages/mappa.html");
    url.searchParams.set("campaign", campaignId());
    url.searchParams.set("scena", game.world.id + "/" + scene.id);
    return url.toString();
}

function editPublication(scene) {
    const previous = scene.getFlag(MODULE_ID, FLAG);
    const dialog = document.createElement("dialog");
    dialog.style.cssText = "width:min(760px,95vw);max-height:90vh;overflow:auto;padding:1rem";
    dialog.innerHTML = '<h2>Mappa sul sito</h2><p>Approva gli elementi visibili ai giocatori. I token nascosti restano riservati al DM.</p>'
        + '<label>Titolo <input name="title" maxlength="120"></label><label><input type="checkbox" name="auto"> Aggiorna all’avvio sulla scena attiva</label>'
        + '<details><summary>Tile per i giocatori</summary><div data-tiles></div></details>'
        + '<details open><summary>Token per i giocatori</summary><div data-tokens></div></details>'
        + '<p role="status"></p><img alt="Anteprima della mappa per i giocatori" hidden style="width:100%;max-height:52vh;object-fit:contain">'
        + '<div><button type="button" data-preview>Anteprima giocatori</button> <button type="button" data-publish disabled>Pubblica e collega</button> '
        + '<button type="button" data-close>Chiudi</button> <a target="_blank" rel="noopener" hidden>Apri sul sito</a></div>';
    const title = dialog.querySelector("[name=title]");
    title.value = previous?.title || scene.name;
    const auto = dialog.querySelector("[name=auto]");
    auto.checked = previous?.auto ?? true;
    const layers = sceneLayers();
    const addCheck = (parent, placeable, text, checked) => {
        const label = document.createElement("label");
        label.style.display = "block";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.value = assetKey(placeable.document);
        box.checked = checked;
        label.append(box, " " + text);
        parent.append(label);
    };
    for (const tile of layers.tiles.filter(entry => !entry.document.hidden)) {
        addCheck(dialog.querySelector("[data-tiles]"), tile, tile.document.texture.src.split("/").pop(),
            previous ? previous.tileKeys?.includes(assetKey(tile.document)) : true);
    }
    for (const token of layers.tokens.filter(entry => !entry.document.hidden)) {
        addCheck(dialog.querySelector("[data-tokens]"), token, token.document.name,
            previous ? previous.tokenKeys?.includes(assetKey(token.document)) : token.actor?.type === "character" && token.actor.hasPlayerOwner);
    }
    const status = dialog.querySelector("[role=status]");
    if (scene.fog.mode === CONST.FOG_EXPLORATION_MODES.DISABLED) status.textContent = "Senza nebbia, il terreno della scena è visibile per intero.";
    const previewButton = dialog.querySelector("[data-preview]");
    const publishButton = dialog.querySelector("[data-publish]");
    const preview = dialog.querySelector("img");
    const link = dialog.querySelector("a");
    link.href = sceneLink(scene);
    link.hidden = !previous;
    let images, settings, previewUrl, busy = false, edits = 0;
    const checked = selector => [...dialog.querySelectorAll(selector + " input:checked")].map(input => input.value);
    const invalidate = () => {
        edits++;
        images = null;
        preview.hidden = true;
        publishButton.disabled = true;
    };
    dialog.addEventListener("input", invalidate);
    previewButton.addEventListener("click", async () => {
        if (busy) return;
        invalidate();
        if (!title.value.trim()) { status.textContent = "Inserisci un titolo."; return; }
        const draft = { title: title.value.trim(), auto: auto.checked, tileKeys: checked("[data-tiles]"), tokenKeys: checked("[data-tokens]") };
        const version = edits;
        busy = true;
        previewButton.disabled = true;
        status.textContent = "Composizione della mappa…";
        try {
            const captured = await capture(scene, draft);
            if (!dialog.open || edits !== version) { status.textContent = "Impostazioni cambiate. Rigenera l’anteprima."; return; }
            settings = draft;
            images = captured;
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            preview.src = previewUrl = URL.createObjectURL(images.player);
            preview.hidden = false;
            publishButton.disabled = false;
            status.textContent = "Controlla la vista giocatori prima di pubblicare.";
        } catch (error) { status.textContent = error.message; }
        finally { busy = false; previewButton.disabled = false; }
    });
    publishButton.addEventListener("click", async () => {
        if (busy || !images) return;
        busy = true;
        publishButton.disabled = true;
        status.textContent = "Pubblicazione…";
        try {
            await publish(scene, settings, images);
            await scene.setFlag(MODULE_ID, FLAG, { ...settings, signature: images.signature });
            link.hidden = false;
            status.textContent = "Mappa aggiornata sul sito.";
        } catch (error) { status.textContent = error.message; }
        finally { busy = false; publishButton.disabled = !images; }
    });
    dialog.querySelector("[data-close]").addEventListener("click", () => { if (!busy) dialog.close(); });
    dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
    dialog.addEventListener("close", () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        dialog.remove();
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
}

if (globalThis.Hooks) {
    Hooks.on("getSceneContextOptions", (_navigation, options) => {
        options.push({
            label: "Mappa sul sito",
            icon: "fa-solid fa-map",
            visible: entry => game.user.isGM && canvas.ready && entry.dataset.sceneId === canvas.scene?.id && !entry.dataset.levelId,
            onClick: () => editPublication(canvas.scene),
        });
    });

    Hooks.once("ready", () => {
        const updateStartup = async () => {
            const scene = canvas.scene;
            if (!canvas.ready || !scene?.active || game.users.activeGM?.id !== game.user.id || !canPushToWorker()) return;
            const settings = scene.getFlag(MODULE_ID, FLAG);
            if (!settings?.auto || !settings.signature) return;
            try { await publish(scene, settings, await capture(scene, settings)); }
            catch (error) { ui.notifications.warn("Wiki Sync · Mappa non aggiornata. " + error.message); }
        };
        if (canvas.ready) void updateStartup();
        else Hooks.once("canvasReady", updateStartup);
    });
}
