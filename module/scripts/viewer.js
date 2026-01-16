import { criptaSocket } from "./main.js";

const DATA_URL = "https://khuzoe.github.io/sigillo-del-male/assets/data/foundry.json";
// NOTE: Must match the CSS file from the site
const CSS_URL = "https://khuzoe.github.io/sigillo-del-male/assets/css/abyssal.css";

export class CriptaViewer extends Application {
    constructor() {
        super();
        this.data = null;
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            id: "cripta-viewer-main",
            title: "Cripta di Sangue - Wiki",
            template: "modules/cripta-viewer/templates/viewer.html",
            width: 1000,
            height: 800,
            resizable: true,
            classes: ["cripta-window"]
        });
    }

    async getData() {
        // Fetch data if not already loaded
        if (!this.data) {
            try {
                const src = game.settings.get("cripta-viewer", "sourceUrl");
                const res = await fetch(src + "?t=" + Date.now()); // Prevent caching
                this.data = await res.json();
            } catch (e) {
                console.error("Cripta Viewer | Error loading data", e);
                ui.notifications.error("Errore caricamento dati Cripta (vedi console)");
            }
        }
        return this.data;
    }

    async _render(force, options) {
        // Standard render to create the window
        await super._render(force, options);

        // Now fully hijack the content
        await this.renderContent();
    }

    async renderContent() {
        const el = this.element[0].querySelector(".window-content");
        el.innerHTML = ""; // Clear existing

        if (!this.data) await this.getData();
        if (!this.data) return;

        // --- MASTER LAYOUT ---
        // Left: Sidebar (List), Right: Preview

        const container = document.createElement("div");
        container.style.display = "flex";
        container.style.height = "100%";
        container.style.width = "100%"; // Ensure width fill
        container.style.overflow = "hidden";

        // Sidebar
        const sidebar = document.createElement("div");
        sidebar.style.width = "250px";
        sidebar.style.background = "#1a1a1a";
        sidebar.style.color = "#ccc";
        sidebar.style.overflowY = "auto";
        sidebar.style.borderRight = "1px solid #444";
        sidebar.style.padding = "10px";
        sidebar.style.flexShrink = "0"; // Prevent shrink

        // Main View
        const main = document.createElement("div");
        main.style.flex = "1";
        main.style.position = "relative";
        main.style.background = "black"; // Base for Shadow DOM
        main.style.display = "flex";       // Flex container for host
        main.style.flexDirection = "column";
        main.style.overflow = "hidden";

        // Create Shadow DOM host
        // FIX: Use Flexbox child to fill space
        const shadowHost = document.createElement("div");
        shadowHost.style.flex = "1";
        shadowHost.style.position = "relative"; // Context
        shadowHost.style.width = "100%";
        shadowHost.style.overflow = "hidden"; // Clip anything spilling out
        main.appendChild(shadowHost);

        // --- Populate Sidebar ---
        this.renderSidebar(sidebar, shadowHost);

        container.appendChild(sidebar);
        container.appendChild(main);
        el.appendChild(container);

        // Render "Home" (Sessions) by default
        this.renderSessions(shadowHost);
    }

    renderSidebar(sidebar, host) {
        const mkHeader = (text) => {
            const h = document.createElement("h3");
            h.innerText = text;
            h.style.borderBottom = "1px solid #555";
            h.style.color = "gold";
            h.style.marginTop = "10px";
            sidebar.appendChild(h);
        }

        const mkItem = (text, onClick) => {
            const div = document.createElement("div");
            div.innerText = text;
            div.style.padding = "5px";
            div.style.cursor = "pointer";
            div.onmouseover = () => div.style.background = "#333";
            div.onmouseout = () => div.style.background = "transparent";
            div.onclick = onClick;
            sidebar.appendChild(div);
        }

        mkHeader("Generale");
        mkItem("Sessioni", () => this.renderSessions(host));

        mkHeader("Personaggi");
        if (this.data.characters) {
            this.data.characters.forEach(char => {
                mkItem(char.name, () => this.renderCharacter(host, char));
            });
        }
    }

    // --- SHARED HELPER ---
    setupShadowRoot(host, htmlContent, blocksForSharing = []) {
        // Clear old
        if (host.shadowRoot) {
            host.shadowRoot.innerHTML = "";
        } else {
            host.attachShadow({ mode: "open" });
        }

        const root = host.shadowRoot;

        // 1. Style
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = CSS_URL;
        root.appendChild(link);

        // 1b. Custom Scrollbar & Lightbox Styles (Injected)
        const customStyle = document.createElement("style");
        customStyle.textContent = `
            /* RESET LAYOUT from Abyssal.css */
            :host {
                display: flex;
                flex-direction: column;
                height: 100%;
                width: 100%;
                overflow: hidden; /* Prevent double scrollbars */
                box-sizing: border-box;
            }
            .main-content {
                margin: 0 !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
                width: 100% !important;
                max-width: 100% !important;
                padding: 20px !important; 
                padding-right: 15px !important; /* Space for scrollbar */
                
                /* FLEX SCROLL FIX */
                flex: 1;
                height: auto !important; /* Let Flex handle height */
                min-height: 0; /* Allow shrink */
                
                overflow-y: auto !important;
                overflow-x: hidden !important;
                box-sizing: border-box !important;
                position: relative;
            }

            /* Scrollbar */
            ::-webkit-scrollbar { width: 10px; height: 10px; }
            ::-webkit-scrollbar-track { background: #000; box-shadow: inset 0 0 6px rgba(0,0,0,0.3); }
            ::-webkit-scrollbar-thumb { background: #444; border: 1px solid #222; border-radius: 4px; }
            ::-webkit-scrollbar-thumb:hover { background: var(--gold, gold); }
            
            /* Lightbox */
            .lightbox-overlay {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.95); z-index: 10000;
                display: none; align-items: center; justify-content: center;
                backdrop-filter: blur(8px);
            }
            .lightbox-overlay.active { display: flex; animation: fadeIn 0.3s; }
            .lightbox-content { 
                max-width: 95%; max-height: 95%; 
                border: 2px solid var(--gold, gold); 
                box-shadow: 0 0 50px rgba(0,0,0,1); 
                object-fit: contain;
            }
            .lightbox-close {
                position: absolute; top: 20px; right: 30px;
                font-size: 50px; color: var(--gold, gold); cursor: pointer;
                text-shadow: 0 0 10px black;
                font-family: serif;
            }
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            
            /* Cursor for images */
            img { cursor: zoom-in; transition: transform 0.2s; }
            img:hover { transform: scale(1.02); }

            /* Share Button Style */
            .share-btn {
                float: right;
                margin-left: 10px;
                margin-bottom: 5px;
                width: 30px;
                height: 30px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                background: rgba(0, 0, 0, 0.5);
                border: 1px solid gold;
                color: white;
                cursor: pointer;
                z-index: 100; /* Ensure it's on top */
                position: relative; /* Ensure z-index works */
                box-sizing: border-box;
                padding: 0;
            }
            .share-btn:hover { background: gold; color: black; }
            .share-btn span { pointer-events: none; } /* Click goes to button */

            /* Character Block Layout - Image Left, Text Right */
            .char-block-flex {
                display: flex;
                flex-direction: row;
                gap: 20px;
                align-items: flex-start;
            }
            
            /* Responsive: Stack on very small screens */
            @media (max-width: 600px) {
                .char-block-flex { flex-direction: column; }
            }

            .char-block-img-container {
                flex-shrink: 0;
                width: 250px; /* Fixed width for consistency */
                max-width: 30%;
            }
            .char-block-img-container img {
                width: 100%;
                border-radius: 4px;
                border: 1px solid #444;
            }
            .char-block-text {
                flex: 1;
                min-width: 0; /* Fix flex overflow */
            }
            /* Markdown Styling */
            .char-block-text h1, .char-block-text h2, .char-block-text h3 {
                margin-top: 0;
                color: var(--gold, gold);
                font-family: 'Cinzel', serif;
            } 
            .char-block-text p { margin-bottom: 10px; }
            .char-block-text ul { padding-left: 20px; }
        `;
        root.appendChild(customStyle);

        // 2. Font Awesome (External)
        const fa = document.createElement("link");
        fa.rel = "stylesheet";
        fa.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css";
        root.appendChild(fa);

        // 3. Fonts
        const fonts = document.createElement("link");
        fonts.href = "https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Crimson+Text:ital,wght@0,400;0,600;1,400&family=Montserrat:wght@400;600&display=swap";
        fonts.rel = "stylesheet";
        root.appendChild(fonts);

        // 4. Wrapper
        const wrapper = document.createElement("div");
        // Reuse main-content style usually found in body
        wrapper.className = "main-content";
        // Inline styles removed, relying on CSS override above
        wrapper.innerHTML = htmlContent;
        wrapper.querySelectorAll("button").forEach(b => b.remove()); // Clean old buttons if any
        root.appendChild(wrapper);

        // 5. Lightbox Element
        const lightbox = document.createElement("div");
        lightbox.className = "lightbox-overlay";
        lightbox.innerHTML = `
            <span class="lightbox-close">&times;</span>
            <img class="lightbox-content" src="">
        `;
        root.appendChild(lightbox);

        // Lightbox Logic
        const lbImg = lightbox.querySelector(".lightbox-content");
        const lbClose = lightbox.querySelector(".lightbox-close");

        const closeLb = () => { lightbox.classList.remove("active"); lbImg.src = ""; };
        lbClose.onclick = closeLb;
        lightbox.onclick = (e) => { if (e.target === lightbox) closeLb(); };

        // Attach click to all images
        wrapper.querySelectorAll("img").forEach(img => {
            img.onclick = () => {
                lbImg.src = img.src;
                lightbox.classList.add("active");
            };
        });

        // 6. Inject Sharing Buttons (The "Eye")
        if (blocksForSharing.length > 0 && game.user.isGM) {
            blocksForSharing.forEach(block => {
                let el = wrapper.querySelector(block.selector);
                if (el) {
                    // Create Eye Button
                    const btn = document.createElement("button");
                    btn.className = "share-btn";
                    btn.innerHTML = "<span>👁️</span>";
                    btn.title = "Mostra ai Giocatori";

                    // Prepend to float right
                    el.prepend(btn);

                    btn.onclick = (e) => {
                        e.stopPropagation();
                        // SocketLib Emit
                        console.log("Cripta Viewer | Emitting share event via Socketlib for:", block.title);
                        if (criptaSocket) {
                            criptaSocket.executeForEveryone("showPopup", {
                                html: block.html || el.outerHTML,
                                title: block.title
                            });
                            ui.notifications.info(`Condiviso: ${block.title}`);
                        } else {
                            ui.notifications.error("Errore: Socketlib non caricato.");
                        }
                    };
                }
            });
        }
    }

    // --- RENDERERS (Inject into Shadow DOM) ---

    attachShadow(host, htmlContent, blocksForSharing = []) {
        this.setupShadowRoot(host, htmlContent, blocksForSharing);
    }

    renderSessions(host) {
        if (!this.data.sessions || !this.data.sessions.sessions) return;

        // Build HTML for sessions
        let html = `<h1>Diario delle Sessioni</h1><div class="session-list">`;
        const blocks = [];

        this.data.sessions.sessions.reverse().forEach(s => {
            html += `
            <div id="session-${s.id}" class="session-card" style="margin-bottom: 2rem;">
                <div class="session-header">
                     <h3 class="session-title text-gold-gradient">Sessione ${s.id} - ${s.date}</h3>
                </div>
                <div class="session-body">${s.summary}</div>
            </div>`;

            blocks.push({
                selector: `#session-${s.id}`,
                title: `Sessione ${s.id}`,
            });
        });
        html += "</div>";

        this.attachShadow(host, html, blocks);
    }

    renderCharacter(host, char) {
        // Build HTML for Character (Header + Blocks)
        let html = `
            <div class="char-header" style="text-align:center; padding:20px; border-bottom:1px solid #444; margin-bottom:20px;">
                <img src="${char.images?.avatar || ''}" style="width:100px; height:100px; border-radius:50%; border:2px solid gold; box-shadow:0 0 10px gold;">
                <div>
                    <h1 style="color:gold; font-family:'Cinzel', serif; margin:10px 0;">${char.name}</h1>
                    <p style="color:#aaa; font-style:italic;">"${char.quote || ''}"</p>
                    <div style="display:flex; justify-content:center; gap:20px; font-size:0.9em; color:#ddd;">
                        <span><i class="fas fa-user-tag"></i> ${char.role || 'N/A'}</span>
                        <span><i class="fas fa-heartbeat"></i> ${char.status || 'N/A'}</span>
                    </div>
                </div>
            </div>
            <div class="char-content">
        `;

        const blocks = [];

        if (char.content_blocks) {
            char.content_blocks.forEach((block, idx) => {
                const safeText = block.markdownText || "";

                const blockId = `block-${idx}`;

                // New Flex Layout
                html += `
                <div id="${blockId}" class="content-block char-section" style="background:rgba(255,255,255,0.05); padding:15px; margin-bottom:15px; border-radius:8px;">
                    <h3 style="color:gold; border-bottom:1px solid #444; margin-bottom:10px;">
                        <i class="fas ${block.icon || 'fa-scroll'}"></i> ${block.title}
                    </h3>
                    
                    <div class="char-block-flex">
                        ${block.image ? `
                        <div class="char-block-img-container">
                            <img src="${block.image}">
                        </div>` : ''}
                        
                        <div class="char-block-text block-text">
                            ${safeText}
                        </div>
                    </div>
                </div>`;

                blocks.push({
                    selector: `#${blockId}`,
                    title: `${char.name} - ${block.title}`
                });
            });
        }

        html += "</div>";
        this.attachShadow(host, html, blocks);
    }
}

export class CriptaPopup extends Application {
    constructor(content) {
        super();
        this.frameContent = content; // { html, title }
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            id: "cripta-popup",
            title: "Condiviso",
            template: "modules/cripta-viewer/templates/viewer.html",
            width: 800,
            height: 600,
            classes: ["cripta-window", "cripta-popup"],
            resizable: true
        });
    }

    getData() { return {}; }

    async _render(force, options) {
        await super._render(force, options);
        // Inject into Shadow DOM

        // Host
        const el = this.element[0].querySelector(".window-content");
        el.style.background = "#111";
        el.style.position = "relative"; // Ensure parent is relative for absolute child
        el.style.overflow = "hidden";   // Disable default Foundry scrollbar

        const host = document.createElement("div");
        // FIX: Absolute positioning to constrain height to the window size
        host.style.position = "absolute";
        host.style.top = "0";
        host.style.left = "0";
        host.style.width = "100%";
        host.style.height = "100%";
        host.style.border = "none";

        el.appendChild(host);

        // Re-use logic from CriptaViewer via prototype or mixin, or just instantiate logic here.
        // Since CriptaViewer is an instance, we can't easily call its method unless we made it static.
        // Let's copy the method as a standalone helper or make it static.
        // Better: Instantiate CriptaViewer to use its method? No.
        // Let's just define the helper in CriptaPopup too or move it out. 
        // For now, I will define `setupShadowRoot` in CriptaViewer validly, and here I will use a trick
        // to call it: CriptaViewer.prototype.setupShadowRoot.call(this, host, ...).

        new CriptaViewer().setupShadowRoot(host, this.frameContent.html, []); // Sharing disabled in popup

        // Update Title
        this.options.title = this.frameContent.title || "Condiviso";
        this.element.find(".window-title").text(this.options.title);
    }
}
