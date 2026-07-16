(function () {
    "use strict";

    const API_PATH = "api/discord/share-card";
    const WIDTH = 1200;
    const MIN_HEIGHT = 675;
    const SCALE = 2;
    const THEMES = {
        "cripta-di-sangue": { accent: "#b77bd0", soft: "#3a203e", glow: "#6f294f" },
        "mago-folle": { accent: "#73bfe6", soft: "#173348", glow: "#245c78" },
        "oltre-il-velo": { accent: "#79c7aa", soft: "#173b33", glow: "#245f50" }
    };
    let modal;
    let active;
    let previewUrl = "";
    let lastFocused;

    function ensureModal() {
        if (modal) return modal;
        modal = document.createElement("div");
        modal.className = "discord-share-modal";
        modal.hidden = true;
        modal.innerHTML = `
            <button class="discord-share-backdrop" type="button" data-share-close aria-label="Chiudi anteprima"></button>
            <section class="discord-share-dialog" role="dialog" aria-modal="true" aria-labelledby="discord-share-title">
                <header class="discord-share-header">
                    <span class="discord-share-emblem"><i class="fab fa-discord" aria-hidden="true"></i></span>
                    <span><small>Condivisione nel canale della campagna</small><h2 id="discord-share-title">Anteprima Discord</h2></span>
                    <button class="discord-share-close" type="button" data-share-close aria-label="Chiudi"><i class="fas fa-xmark"></i></button>
                </header>
                <div class="discord-share-layout">
                    <div class="discord-share-preview-shell"><div class="discord-share-preview" data-share-preview></div></div>
                    <aside class="discord-share-summary">
                        <span class="discord-share-kind" data-share-kind></span>
                        <h3 data-share-name></h3>
                        <p data-share-description></p>
                        <div class="discord-share-warning" data-share-warning hidden></div>
                        <div class="discord-share-destination"><i class="fas fa-hashtag"></i><span>Canale configurato per questa campagna</span></div>
                        <p class="discord-share-privacy"><i class="fas fa-shield-halved"></i>Statistiche, note DM e proprietà nascoste non vengono incluse.</p>
                    </aside>
                </div>
                <footer class="discord-share-actions">
                    <p data-share-status role="status" aria-live="polite"></p>
                    <button class="discord-share-secondary" type="button" data-share-close>Annulla</button>
                    <button class="discord-share-primary" type="button" data-share-send disabled><i class="fab fa-discord"></i><span>Pubblica su Discord</span></button>
                </footer>
            </section>`;
        document.body.appendChild(modal);
        modal.addEventListener("click", event => {
            if (event.target.closest("[data-share-close]")) close();
            else if (event.target.closest("[data-share-send]")) send();
        });
        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && !modal.hidden) close();
        });
        return modal;
    }

    async function open(input) {
        const entity = normalizeEntity(input);
        if (!entity) throw new Error("Elemento non valido per la condivisione.");
        ensureModal();
        active = { entity, blob: null };
        lastFocused = document.activeElement;
        modal.hidden = false;
        document.body.classList.add("discord-share-open");
        modal.querySelector("[data-share-kind]").textContent = entity.kind === "npc" ? "Dossier NPC" : "Oggetto & materiale";
        modal.querySelector("[data-share-name]").textContent = entity.name;
        modal.querySelector("[data-share-description]").textContent = entity.description || "La card userà le informazioni pubbliche disponibili.";
        const warnings = [];
        if (entity.hidden) warnings.push("Questo elemento è Solo DM: pubblicandolo diventerà visibile nel canale Discord.");
        if (entity.unidentified) warnings.push("Verranno mostrati soltanto nome e descrizione della versione non identificata.");
        const warning = modal.querySelector("[data-share-warning]");
        warning.textContent = warnings.join(" ");
        warning.hidden = warnings.length === 0;
        status("");
        loadingPreview();
        setSending(false);
        modal.querySelector("[data-share-close]")?.focus();
        try {
            await document.fonts?.ready;
            const blob = await renderBlob(entity);
            if (!active || active.entity !== entity) return;
            active.blob = blob;
            showPreview(blob, entity.name);
            setSending(false);
        } catch (error) {
            console.error("Card Discord non generata", error);
            status("Non riesco a generare l'anteprima. Riprova dopo aver ricaricato la pagina.", true);
            modal.querySelector("[data-share-preview]").innerHTML = '<span class="discord-share-preview-loader is-error"><i class="fas fa-triangle-exclamation"></i>Anteprima non disponibile</span>';
        }
    }

    function close() {
        if (!modal || modal.hidden) return;
        modal.hidden = true;
        document.body.classList.remove("discord-share-open");
        revokePreview();
        active = null;
        lastFocused?.focus?.();
        lastFocused = null;
    }

    async function send() {
        if (!active?.blob) return;
        setSending(true);
        status("Invio della card in corso...");
        const { entity, blob } = active;
        try {
            const form = new FormData();
            form.append("campaignId", entity.campaignId);
            form.append("kind", entity.kind);
            form.append("entityId", entity.entityId);
            form.append("source", entity.source);
            if (entity.worldId) form.append("worldId", entity.worldId);
            if (entity.actorId) form.append("actorId", entity.actorId);
            if (entity.pageUrl) form.append("pageUrl", entity.pageUrl);
            form.append("file", blob, `${entity.kind}-${slug(entity.name) || entity.entityId}.png`);
            const result = await window.CriptaApp.api.request(API_PATH, {
                method: "POST",
                token: String(window.CriptaApp?.auth?.getToken?.() || ""),
                body: form,
                cache: false
            });
            if (!result?.sent) {
                if (result?.missingChannel) throw new Error("Il canale Discord della campagna non è ancora configurato.");
                throw new Error(result?.error || "Discord non ha confermato l'invio.");
            }
            status("Card pubblicata correttamente su Discord.", false, true);
            const button = modal.querySelector("[data-share-send]");
            button.innerHTML = '<i class="fas fa-circle-check"></i><span>Pubblicata</span>';
            button.disabled = true;
        } catch (error) {
            console.error("Condivisione Discord fallita", error);
            status(error?.message || "Invio non riuscito. Riprova.", true);
            setSending(false);
        }
    }

    function setSending(value) {
        const button = modal?.querySelector("[data-share-send]");
        if (!button) return;
        button.disabled = value || !active?.blob;
        button.innerHTML = value
            ? '<i class="fas fa-circle-notch fa-spin"></i><span>Pubblicazione...</span>'
            : '<i class="fab fa-discord"></i><span>Pubblica su Discord</span>';
    }

    function status(message, isError = false, isSuccess = false) {
        const target = modal?.querySelector("[data-share-status]");
        if (!target) return;
        target.textContent = message || "";
        target.classList.toggle("is-error", isError);
        target.classList.toggle("is-success", isSuccess);
    }

    function loadingPreview() {
        revokePreview();
        const host = modal.querySelector("[data-share-preview]");
        host.classList.remove("is-ready");
        host.innerHTML = '<span class="discord-share-preview-loader"><i class="fas fa-wand-magic-sparkles"></i>Creo la card...</span>';
    }

    function showPreview(blob, name) {
        revokePreview();
        previewUrl = URL.createObjectURL(blob);
        const image = document.createElement("img");
        const host = modal.querySelector("[data-share-preview]");
        host.classList.remove("is-ready");
        image.alt = `Anteprima Discord: ${name}`;
        image.addEventListener("load", () => host.classList.add("is-ready"), { once: true });
        image.src = previewUrl;
        host.replaceChildren(image);
    }

    function revokePreview() {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = "";
    }

    function normalizeEntity(input) {
        if (!input || !["npc", "item"].includes(input.kind)) return null;
        const campaignId = slug(input.campaignId || window.CriptaApp?.campaigns?.currentId?.() || "cripta-di-sangue");
        const entityId = String(input.entityId || "").trim().slice(0, 180);
        if (!campaignId || !entityId) return null;
        return {
            kind: input.kind,
            campaignId,
            entityId,
            source: String(input.source || (input.kind === "npc" ? "characters" : "items")).trim().toLowerCase().slice(0, 24),
            worldId: String(input.worldId || "").trim().slice(0, 96),
            actorId: String(input.actorId || "").trim().slice(0, 96),
            name: text(input.name) || (input.kind === "npc" ? "NPC" : "Oggetto"),
            subtitle: text(input.subtitle),
            description: text(input.description),
            imageUrl: imageUrl(input.imageUrl),
            badges: list(input.badges, 5),
            facts: list(input.facts, 8),
            sections: normalizeSections(input.sections),
            hidden: input.hidden === true,
            unidentified: input.unidentified === true,
            pageUrl: pageUrl(input.pageUrl || window.location.href)
        };
    }

    function text(value, max = 0) { const clean = String(value || "").replace(/\s+/g, " ").trim(); return max > 0 ? clean.slice(0, max) : clean; }
    function list(value, maxItems, maxLength = 0) { return (Array.isArray(value) ? value : []).map(item => text(item, maxLength)).filter(Boolean).slice(0, maxItems); }
    function normalizeSections(value) {
        return (Array.isArray(value) ? value : []).map(section => ({
            title: text(section?.title),
            meta: text(section?.meta),
            description: text(section?.description),
            tone: ["negative", "material", "note"].includes(section?.tone) ? section.tone : "default"
        })).filter(section => section.title || section.meta || section.description);
    }
    function imageUrl(value) { try { return new URL(String(value || ""), window.location.href).toString(); } catch (_) { return ""; } }
    function pageUrl(value) { try { const url = new URL(String(value || ""), window.location.href); return url.origin === window.location.origin ? url.toString() : ""; } catch (_) { return ""; } }

    async function renderBlob(entity) {
        let image = null;
        if (entity.imageUrl) try { image = await loadImage(entity.imageUrl); } catch (_) { image = null; }
        try { return await drawCard(entity, image); }
        catch (error) { if (!image) throw error; return drawCard(entity, null); }
    }

    function drawCard(entity, image) {
        const theme = THEMES[entity.campaignId] || THEMES["cripta-di-sangue"];
        const layout = measureCardLayout(entity, theme);
        const renderScale = layout.height > 1500 ? 1.25 : (layout.height > 950 ? 1.5 : SCALE);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(WIDTH * renderScale);
        canvas.height = Math.round(layout.height * renderScale);
        const ctx = canvas.getContext("2d");
        ctx.scale(renderScale, renderScale);
        const bg = ctx.createLinearGradient(0, 0, WIDTH, layout.height);
        bg.addColorStop(0, "#08080b"); bg.addColorStop(.55, "#151117"); bg.addColorStop(1, theme.soft);
        ctx.fillStyle = bg; ctx.fillRect(0, 0, WIDTH, layout.height);
        const glow = ctx.createRadialGradient(1020, 70, 10, 1020, 70, Math.max(500, layout.height * .72));
        glow.addColorStop(0, `${theme.glow}aa`); glow.addColorStop(1, "#00000000");
        ctx.fillStyle = glow; ctx.fillRect(0, 0, WIDTH, layout.height);
        strokeRound(ctx, 22, 22, WIDTH - 44, layout.height - 44, 30, "rgba(225,195,111,.32)", 2);
        strokeRound(ctx, 35, 35, WIDTH - 70, layout.height - 70, 24, `${theme.accent}55`, 1);
        drawMedia(ctx, entity, image, theme, layout);
        drawText(ctx, entity, theme, layout);
        return toBlob(canvas);
    }

    function measureCardLayout(entity, theme) {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const x = 510;
        const maxWidth = 620;
        const titleFontSize = fitFontToLongestWord(ctx, entity.name, maxWidth, 51, 35, size => `700 ${size}px Georgia`);
        const titleLineHeight = Math.round(titleFontSize * 1.08);
        ctx.font = `700 ${titleFontSize}px Georgia`;
        const titleLines = wrapAll(ctx, entity.name, maxWidth);
        const titleStartY = 177;
        let cursorY = titleStartY + Math.max(0, titleLines.length - 1) * titleLineHeight + 58;

        ctx.font = "700 18px Arial";
        const subtitleLines = entity.subtitle ? wrapAll(ctx, entity.subtitle.toUpperCase(), maxWidth) : [];
        const subtitleStartY = cursorY;
        if (subtitleLines.length) cursorY += Math.max(0, subtitleLines.length - 1) * 25 + 43;
        else cursorY += 5;

        const pillLayout = measurePills(ctx, entity.badges, x, cursorY, maxWidth);
        if (pillLayout.entries.length) cursorY = pillLayout.bottomY + 25;
        const dividerY = cursorY;
        const descriptionStartY = dividerY + 40;

        ctx.font = "400 23px Georgia";
        const descriptionLines = wrapAll(ctx, entity.description || "Informazioni condivise dalla campagna.", maxWidth);
        const descriptionLastY = descriptionStartY + Math.max(0, descriptionLines.length - 1) * 34;

        ctx.font = "700 14px Arial";
        const factsLines = entity.facts.length ? wrapAll(ctx, entity.facts.join("   •   ").toUpperCase(), maxWidth) : [];
        const factsStartY = descriptionLastY + (factsLines.length ? 46 : 0);
        const baseContentBottomY = factsLines.length
            ? factsStartY + Math.max(0, factsLines.length - 1) * 21
            : descriptionLastY;
        const sectionLayout = measureSections(ctx, entity.sections, baseContentBottomY + 31, maxWidth);
        const contentBottomY = sectionLayout.entries.length ? sectionLayout.bottomY : baseContentBottomY;
        const height = Math.max(MIN_HEIGHT, Math.ceil(contentBottomY + 110));

        return {
            height,
            x,
            maxWidth,
            titleFontSize,
            titleLineHeight,
            titleLines,
            titleStartY,
            subtitleLines,
            subtitleStartY,
            pillLayout,
            dividerY,
            descriptionLines,
            descriptionStartY,
            factsLines,
            factsStartY,
            sectionLayout,
            footerY: height - 76,
            footerDotY: height - 86,
            media: { x: 66, y: 76, w: 390, h: height - 150 }
        };
    }

    function measureSections(ctx, sections, startY, maxWidth) {
        const entries = [];
        let cursorY = startY;
        (Array.isArray(sections) ? sections : []).forEach(section => {
            const separatorY = cursorY;
            cursorY += 30;

            ctx.font = "700 16px Arial";
            const titleLines = section.title ? wrapAll(ctx, section.title.toUpperCase(), maxWidth) : [];
            const titleStartY = cursorY;
            if (titleLines.length) cursorY += Math.max(0, titleLines.length - 1) * 22 + 29;

            ctx.font = "700 12px Arial";
            const metaLines = section.meta ? wrapAll(ctx, section.meta.toUpperCase(), maxWidth) : [];
            const metaStartY = cursorY;
            if (metaLines.length) cursorY += Math.max(0, metaLines.length - 1) * 18 + 29;

            ctx.font = "400 20px Georgia";
            const descriptionLines = section.description ? wrapAll(ctx, section.description, maxWidth) : [];
            const descriptionStartY = cursorY;
            if (descriptionLines.length) cursorY += Math.max(0, descriptionLines.length - 1) * 29 + 23;

            const bottomY = Math.max(separatorY + 30, cursorY);
            entries.push({ section, separatorY, titleLines, titleStartY, metaLines, metaStartY, descriptionLines, descriptionStartY, bottomY });
            cursorY = bottomY + 22;
        });
        return { entries, bottomY: entries.length ? entries[entries.length - 1].bottomY : startY };
    }
    function drawMedia(ctx, entity, image, theme, layout) {
        const { x, y, w, h } = layout.media;
        ctx.save(); round(ctx, x, y, w, h, 26); ctx.clip();
        const panel = ctx.createLinearGradient(x, y, x + w, y + h);
        panel.addColorStop(0, "rgba(255,255,255,.045)"); panel.addColorStop(1, "rgba(0,0,0,.55)");
        ctx.fillStyle = panel; ctx.fillRect(x, y, w, h);
        const halo = ctx.createRadialGradient(x + w / 2, y + Math.min(h * .43, 310), 20, x + w / 2, y + Math.min(h * .43, 310), w * .58);
        halo.addColorStop(0, `${theme.accent}2e`); halo.addColorStop(1, "#00000000");
        ctx.fillStyle = halo; ctx.fillRect(x, y, w, h);
        if (image) {
            const pad = entity.kind === "npc" ? 16 : 34;
            const availableHeight = h - pad * 2;
            const imageHeight = entity.kind === "item" ? Math.min(availableHeight, 430) : availableHeight;
            contain(ctx, image, x + pad, y + pad, w - pad * 2, imageHeight);
        } else {
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillStyle = "rgba(225,195,111,.18)"; ctx.font = "72px Georgia";
            ctx.fillText(entity.kind === "npc" ? "✦" : "◈", x + w / 2, y + h / 2 - 8);
            ctx.fillStyle = "rgba(240,229,205,.48)"; ctx.font = "600 18px Arial";
            ctx.fillText(entity.kind === "npc" ? "DOSSIER" : "RELIQUIA", x + w / 2, y + h / 2 + 58);
        }
        ctx.restore(); strokeRound(ctx, x, y, w, h, 26, "rgba(225,195,111,.28)", 1.4);
    }

    function drawText(ctx, entity, theme, layout) {
        const { x, maxWidth } = layout;
        ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "rgba(225,195,111,.72)"; ctx.font = "700 16px Arial";
        ctx.fillText(`${pretty(entity.campaignId).toUpperCase()}  /  ${entity.kind === "npc" ? "NPC" : "OGGETTO"}`, x, 112);

        ctx.fillStyle = "#f3ead5"; ctx.font = `700 ${layout.titleFontSize}px Georgia`;
        layout.titleLines.forEach((line, index) => ctx.fillText(line, x, layout.titleStartY + index * layout.titleLineHeight));

        if (layout.subtitleLines.length) {
            ctx.fillStyle = theme.accent; ctx.font = "700 18px Arial";
            layout.subtitleLines.forEach((line, index) => ctx.fillText(line, x, layout.subtitleStartY + index * 25));
        }
        drawPills(ctx, layout.pillLayout, theme);

        ctx.strokeStyle = "rgba(225,195,111,.14)"; ctx.beginPath(); ctx.moveTo(x, layout.dividerY); ctx.lineTo(x + maxWidth, layout.dividerY); ctx.stroke();
        ctx.fillStyle = "rgba(235,224,202,.78)"; ctx.font = "400 23px Georgia";
        layout.descriptionLines.forEach((line, index) => ctx.fillText(line, x, layout.descriptionStartY + index * 34));

        if (layout.factsLines.length) {
            ctx.fillStyle = "rgba(225,195,111,.5)"; ctx.font = "700 14px Arial";
            layout.factsLines.forEach((line, index) => ctx.fillText(line, x, layout.factsStartY + index * 21));
        }
        drawSections(ctx, layout.sectionLayout, theme, x, maxWidth);
        ctx.fillStyle = "rgba(235,224,202,.42)"; ctx.font = "600 14px Arial";
        ctx.fillText("SIGILLO • ARCHIVIO DELLA CAMPAGNA", x, layout.footerY);
        ctx.fillStyle = theme.accent; ctx.beginPath(); ctx.arc(1110, layout.footerDotY, 7, 0, Math.PI * 2); ctx.fill();
    }

    function drawSections(ctx, layout, theme, x, maxWidth) {
        layout.entries.forEach(entry => {
            ctx.strokeStyle = "rgba(225,195,111,.12)";
            ctx.beginPath(); ctx.moveTo(x, entry.separatorY); ctx.lineTo(x + maxWidth, entry.separatorY); ctx.stroke();
            if (entry.titleLines.length) {
                ctx.fillStyle = sectionColor(entry.section.tone, theme); ctx.font = "700 16px Arial";
                entry.titleLines.forEach((line, index) => ctx.fillText(line, x, entry.titleStartY + index * 22));
            }
            if (entry.metaLines.length) {
                ctx.fillStyle = "rgba(225,195,111,.58)"; ctx.font = "700 12px Arial";
                entry.metaLines.forEach((line, index) => ctx.fillText(line, x, entry.metaStartY + index * 18));
            }
            if (entry.descriptionLines.length) {
                ctx.fillStyle = entry.section.tone === "negative" ? "rgba(239,198,190,.78)" : "rgba(235,224,202,.76)";
                ctx.font = "400 20px Georgia";
                entry.descriptionLines.forEach((line, index) => ctx.fillText(line, x, entry.descriptionStartY + index * 29));
            }
        });
    }

    function sectionColor(tone, theme) {
        if (tone === "negative") return "#e69a8e";
        if (tone === "material") return "#91c7aa";
        if (tone === "note") return "#dfc36f";
        return theme.accent;
    }
    function measurePills(ctx, labels, x, y, maxWidth) {
        const entries = [];
        let cx = x;
        let cy = y;
        labels.forEach(label => {
            const upper = label.toUpperCase();
            const fontSize = fitFontToLongestWord(ctx, upper, maxWidth - 30, 14, 9, size => `700 ${size}px Arial`);
            ctx.font = `700 ${fontSize}px Arial`;
            const width = Math.min(maxWidth, ctx.measureText(upper).width + 30);
            if (cx + width > x + maxWidth) { cx = x; cy += 38; }
            entries.push({ label: upper, x: cx, y: cy, width, fontSize });
            cx += width + 9;
        });
        return { entries, bottomY: entries.length ? cy : y };
    }

    function drawPills(ctx, layout, theme) {
        layout.entries.forEach(entry => {
            ctx.fillStyle = `${theme.accent}1f`; round(ctx, entry.x, entry.y - 21, entry.width, 29, 15); ctx.fill();
            ctx.strokeStyle = `${theme.accent}62`; ctx.stroke();
            ctx.fillStyle = "rgba(243,234,213,.82)"; ctx.font = `700 ${entry.fontSize}px Arial`;
            ctx.fillText(entry.label, entry.x + 15, entry.y);
        });
    }

    function contain(ctx, image, x, y, width, height) {
        const iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height;
        if (!iw || !ih) return;
        const scale = Math.min(width / iw, height / ih), dw = iw * scale, dh = ih * scale;
        ctx.drawImage(image, x + (width - dw) / 2, y + (height - dh) / 2, dw, dh);
    }

    function fitFontToLongestWord(ctx, value, maxWidth, preferred, minimum, fontFactory) {
        const words = text(value).split(" ").filter(Boolean);
        let size = preferred;
        while (size > minimum) {
            ctx.font = fontFactory(size);
            if (words.every(word => ctx.measureText(word).width <= maxWidth)) break;
            size -= 1;
        }
        return size;
    }

    function wrapAll(ctx, value, maxWidth) {
        const words = text(value).split(" ").filter(Boolean);
        const lines = [];
        let line = "";
        words.forEach(word => {
            const pieces = ctx.measureText(word).width > maxWidth ? splitLongWord(ctx, word, maxWidth) : [word];
            pieces.forEach((piece, pieceIndex) => {
                const joinsPrevious = pieceIndex === 0 && line;
                const candidate = joinsPrevious ? `${line} ${piece}` : (line ? `${line}${piece}` : piece);
                if (line && ctx.measureText(candidate).width > maxWidth) {
                    lines.push(line);
                    line = piece;
                } else {
                    line = candidate;
                }
                if (pieceIndex < pieces.length - 1) {
                    lines.push(line);
                    line = "";
                }
            });
        });
        if (line) lines.push(line);
        return lines.length ? lines : [""];
    }

    function splitLongWord(ctx, word, maxWidth) {
        const pieces = [];
        let piece = "";
        Array.from(word).forEach(character => {
            const candidate = piece + character;
            if (piece && ctx.measureText(candidate).width > maxWidth) {
                pieces.push(piece);
                piece = character;
            } else piece = candidate;
        });
        if (piece) pieces.push(piece);
        return pieces;
    }
    function round(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + width, y, x + width, y + height, r); ctx.arcTo(x + width, y + height, x, y + height, r); ctx.arcTo(x, y + height, x, y, r); ctx.arcTo(x, y, x + width, y, r); ctx.closePath();
    }
    function strokeRound(ctx, x, y, w, h, r, color, width) { ctx.strokeStyle = color; ctx.lineWidth = width; round(ctx, x, y, w, h, r); ctx.stroke(); }
    function toBlob(canvas) { return new Promise((resolve, reject) => { try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Canvas vuoto")), "image/png"); } catch (error) { reject(error); } }); }
    function loadImage(src) { return new Promise((resolve, reject) => { const image = new Image(); image.crossOrigin = "anonymous"; const timer = setTimeout(() => reject(new Error("Timeout immagine")), 8000); image.onload = () => { clearTimeout(timer); resolve(image); }; image.onerror = () => { clearTimeout(timer); reject(new Error("Immagine non disponibile")); }; image.src = src; }); }
    function pretty(value) { return String(value || "").split("-").filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" "); }
    function slug(value) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96); }

    window.CriptaDiscordShare = Object.freeze({ open, close });
})();