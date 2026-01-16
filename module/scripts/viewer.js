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
            width: 1100,
            height: 900,
            resizable: true,
            classes: ["cripta-window"]
        });
    }

    async getData() {
        if (!this.data) {
            try {
                const src = game.settings.get("cripta-viewer", "sourceUrl");
                const res = await fetch(src + "?t=" + Date.now());
                this.data = await res.json();
            } catch (e) {
                console.error("Cripta Viewer | Error loading data", e);
                ui.notifications.error("Errore caricamento dati Cripta (vedi console)");
            }
        }
        return this.data;
    }

    async _render(force, options) {
        await super._render(force, options);
        await this.renderContent();
    }

    async renderContent() {
        // Initialize Setup if needed
        const el = this.element[0].querySelector(".window-content");
        el.innerHTML = "";

        if (!this.data) await this.getData();
        if (!this.data) return;

        // Container
        const container = document.createElement("div");
        container.style.cssText = "display:flex; height:100%; width:100%; overflow:hidden;";

        // Sidebar
        const sidebar = document.createElement("div");
        sidebar.className = "sidebar-container";
        sidebar.style.cssText = "width:250px; background:#1a1a1a; color:#ccc; overflow-y:auto; border-right:1px solid #444; padding:10px; flex-shrink:0;";

        // Main
        const main = document.createElement("div");
        main.style.cssText = "flex:1; position:relative; background:black; display:flex; flex-direction:column; overflow:hidden;";

        // Shadow Host
        const shadowHost = document.createElement("div");
        shadowHost.style.cssText = "flex:1; position:relative; width:100%; overflow:hidden;";
        main.appendChild(shadowHost);

        this.renderSidebarLayout(sidebar, shadowHost);

        container.appendChild(sidebar);
        container.appendChild(main);
        el.appendChild(container);

        // Default View
        this.renderHome(shadowHost);
    }

    renderSidebarLayout(sidebar, host) {
        const mkHeader = (text) => {
            const h = document.createElement("h3");
            h.innerText = text;
            h.style.cssText = "border-bottom:1px solid #555; color:gold; margin-top:15px; font-family:'Cinzel'; font-weight:normal; letter-spacing:1px;";
            sidebar.appendChild(h);
        }

        const mkItem = (text, icon, onClick) => {
            const div = document.createElement("div");
            div.innerHTML = `<i class="fas ${icon}" style="width:20px; text-align:center; margin-right:5px;"></i> ${text}`;
            div.style.cssText = "padding:6px; cursor:pointer; font-family:'Montserrat'; font-size:0.9rem; border-radius:4px; display:flex; align-items:center;";
            div.onmouseover = () => div.style.background = "#333";
            div.onmouseout = () => div.style.background = "transparent";
            div.onclick = onClick;
            sidebar.appendChild(div);
        }

        mkHeader("Generale");
        mkItem("Home / Sessioni", "fa-book", () => this.renderHome(host));

        mkHeader("Personaggi");
        if (this.data.characters) {
            this.data.characters.forEach(char => {
                mkItem(char.name, "fa-user", () => this.renderCharacter(host, char));
            });
        }

        if (this.data.players && this.data.players.length > 0) {
            mkHeader("Giocatori");
            this.data.players.forEach(p => {
                mkItem(p.name, "fa-dice-d20", () => this.renderPlayer(host, p));
            });
        }
    }

    renderHome(host) {
        if (!this.data.sessions) return;

        let html = `<div class="dashboard-wrapper">
            <div class="dashboard-header" style="text-align:center; padding:2rem; border-bottom:1px solid #333;">
                <h1 class="text-gold-gradient" style="font-size:3rem; margin:0;">Cripta di Sangue</h1>
                <p style="color:#aaa; font-style:italic;">Wiki & Diario di Campagna</p>
            </div>
            <div class="session-list" style="padding:20px;">`;

        const blocks = [];
        const sessions = this.data.sessions.sessions || [];

        sessions.slice().reverse().forEach(s => {
            html += `
             <div id="session-${s.id}" class="content-card" style="margin-bottom:20px;">
                <h3 class="text-gold-gradient" style="font-size:1.5rem; border-bottom:1px solid #444; padding-bottom:10px; margin-bottom:15px;">
                    Sessione ${s.id} - ${s.date}
                </h3>
                <div class="session-body" style="font-size:1.1rem; line-height:1.6;">${s.summary}</div>
             </div>`;
            blocks.push({ selector: `#session-${s.id}`, title: `Sessione ${s.id}` });
        });

        html += `</div></div>`;
        this.attachShadow(host, html, blocks);
    }

    renderPlayer(host, player) {
        const skills = this.data.skills ? this.data.skills[player.id] : null;

        // Skill Tree HTML
        let skillTreeHtml = "";
        if (skills) {
            const bg = skills.bgImage ? `background-image: url('${skills.bgImage}');` : 'background:#111;';

            // Nodes
            const nodes = skills.nodes.map(n => {
                const isUnlocked = n.state === 'unlocked';
                const isUnlockable = n.state === 'unlockable';
                // Style adjustments
                let filter = "filter: grayscale(100%) brightness(0.5); opacity:0.6;";
                let border = "border: 1px solid #555;";

                if (isUnlocked) {
                    filter = "";
                    border = n.keyNode ? "border: 2px solid gold; box-shadow: 0 0 10px gold;" : "border: 2px solid #888;";
                } else if (isUnlockable) {
                    filter = "filter: grayscale(100%); opacity: 0.8;";
                    border = "border: 1px dashed gold;";
                }

                return `
                <div class="skill-node" title="${n.title}" 
                     style="position:absolute; left:${n.x}%; top:${n.y}%; width:50px; height:50px; transform:translate(-50%, -50%); cursor:help; z-index:10;">
                    <img src="${n.icon}" style="width:100%; height:100%; object-fit:cover; border-radius:50%; ${border} ${filter}">
                    <div class="tooltip">${n.title}</div>
                </div>`;
            }).join('');

            // Lines (Naive)
            let lines = "";
            skills.nodes.forEach(n => {
                if (n.connections) {
                    n.connections.forEach(targetId => {
                        const t = skills.nodes.find(x => x.id === targetId);
                        if (t) {
                            const color = (n.state === 'unlocked' && t.state === 'unlocked') ? "var(--gold)" : "#444";
                            lines += `<line x1="${n.x}%" y1="${n.y}%" x2="${t.x}%" y2="${t.y}%" stroke="${color}" stroke-width="2" />`;
                        }
                    });
                }
            });

            skillTreeHtml = `
            <div class="content-card">
                <h3 class="text-gold-gradient">Albero Abilità</h3>
                <div class="skill-tree-frame" style="position:relative; width:100%; aspect-ratio:16/9; ${bg} background-size:cover; background-position:center; border-radius:8px; border:1px solid #444; overflow:hidden;">
                    <svg style="position:absolute; width:100%; height:100%; pointer-events:none;">
                        ${lines}
                    </svg>
                    ${nodes}
                </div>
                <p style="margin-top:10px; font-size:0.9rem; color:#888;">* Passa il mouse sulle icone per i dettagli (Tooltip non ancora implementati nativamente, usa Title per ora)</p>
            </div>`;
        }

        let html = `
            <div class="hero-mini" style="padding:2rem; background:linear-gradient(to right, rgba(138,28,28,0.1), transparent); border-bottom:1px solid rgba(255,255,255,0.05); margin-bottom:2rem;">
                <h1 class="text-gold-gradient" style="font-size:3rem; margin:0;">${player.name}</h1>
                <div class="subtitle" style="font-family:'Cinzel'; color:var(--accent-primary); font-size:1.2rem; letter-spacing:2px; text-transform:uppercase;">${player.role || ''}</div>
            </div>

            <div class="container" style="padding:0 2rem;">
                <div class="char-grid" style="display:grid; grid-template-columns: 2fr 1fr; gap:3rem;">
                    <div class="left-col">
                        <div class="content-card">
                            <p class="npc-desc" style="font-size:1.1em; line-height:1.7; color:#a0a0a0;">${player.description || ''}</p>
                            
                            ${player.summary ? `
                                <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-top:20px; border-top:1px solid #333; padding-top:15px;">
                                    <div><b style="color:gold;">Razza:</b> ${player.summary.race}</div>
                                    <div><b style="color:gold;">Periodo:</b> ${player.summary.period}</div>
                                </div>` : ''}
                        </div>
                        ${skillTreeHtml}
                    </div>

                    <div class="right-col">
                         <div class="npc-avatar-container" style="width:200px; height:200px; border-radius:50%; border:3px solid gold; position:relative; margin:0 auto; background:#0a0a0a; overflow:hidden;">
                            <img src="${player.images.portrait}" class="img-main" style="width:100%; height:100%; object-fit:cover;">
                         </div>
                    </div>
                </div>
            </div>
        `;

        this.attachShadow(host, html, []);
    }

    renderCharacter(host, char) {
        // Status formatting
        let statusStyle = "";
        let statusIcon = "fa-question";
        if (char.status === "vivo") { statusStyle = "color:var(--status-alive);"; statusIcon = "fa-heartbeat"; }
        else if (char.status === "morto") { statusStyle = "color:var(--status-dead);"; statusIcon = "fa-skull"; }

        let html = `
            <div class="hero-mini" style="padding:2rem; background:linear-gradient(to right, rgba(138,28,28,0.1), transparent); border-bottom:1px solid rgba(255,255,255,0.05); margin-bottom:2rem;">
                <h1 class="text-gold-gradient" style="font-size:3rem; margin:0;">${char.name}</h1>
                <div class="subtitle" style="font-family:'Cinzel'; color:var(--accent-primary); font-size:1.2rem; letter-spacing:2px; text-transform:uppercase;">${char.role || ''}</div>
            </div>

            <div class="container" style="padding:0 2rem;">
                <div class="char-grid" style="display:grid; grid-template-columns: 2fr 1fr; gap:3rem;">
                    
                    <!-- LEFT COLUMN -->
                    <div class="left-col" style="display:flex; flex-direction:column; gap:2rem;">
                         
                         <!-- INFO CARD -->
                         <div class="content-card">
                            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:0.5rem; margin-bottom:1rem;">
                                <span class="npc-role" style="font-family:'Montserrat'; font-size:0.9rem; color:gold; text-transform:uppercase; letter-spacing:1px;">${char.role}</span>
                                <span style="${statusStyle} font-weight:bold; text-transform:uppercase; font-size:0.8rem;">
                                    <i class="fas ${statusIcon}"></i> ${char.status}
                                </span>
                            </div>
                            
                            <p class="npc-desc" style="font-size:1.1em; font-style:italic; border-left:3px solid gold; padding-left:1rem; color:#a0a0a0; margin-bottom:1.5rem;">
                                "${char.quote || ''}"
                            </p>

                            <!-- BLOCKS -->
                            ${this.renderBlocks(char.content_blocks)}
                         </div>

                         <!-- RELATIONS -->
                         ${this.renderRelations(char.relationships)}
                    </div>

                    <!-- RIGHT COLUMN -->
                    <div class="right-col">
                        <div class="npc-card" style="background:rgba(30,30,30,0.4); backdrop-filter:blur(10px); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:2rem; display:flex; flex-direction:column; align-items:center;">
                            <div class="npc-avatar-container" style="width:200px; height:200px; border-radius:50%; border:3px solid gold; position:relative; background:#0a0a0a; margin-bottom:1.5rem;">
                                <!-- Simple swap logic handled by CSS or just absolute overlap -->
                                <img src="${char.images.portrait}" class="img-main" style="width:100%; height:100%; object-fit:cover; border-radius:50%; position:absolute; top:0; left:0; transition:opacity 0.4s;">
                                <img src="${char.images.hover}" class="img-hover" style="width:100%; height:100%; object-fit:cover; opacity:0; position:absolute; top:0; left:0; transition:opacity 0.4s;" 
                                     onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0">
                            </div>
                            <div class="npc-info" style="text-align:center;">
                                <div class="npc-name text-gold-gradient" style="font-size:1.5rem;">${char.name}</div>
                                <div class="npc-role" style="font-size:0.8rem; color:gold; margin-top:5px;">${char.role}</div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        `;

        // Extract blocks for sharing
        const blocks = (char.content_blocks || []).map((b, i) => ({
            selector: `#block-${i}`,
            title: `${char.name} - ${b.title}`
        }));

        this.attachShadow(host, html, blocks);
    }

    renderBlocks(blocks) {
        if (!blocks) return "";
        return blocks.map((block, idx) => {
            const text = block.markdownText || block.markdown || "";
            let img = "";
            let content = "";

            // Image Box
            if (block.type === 'image_box' && block.image) {
                content = `
                <div class="char-block-flex" style="display:flex; gap:20px; align-items:flex-start; margin-top:15px;">
                    <div style="flex-shrink:0; width:250px;">
                        <img src="${block.image}" style="width:100%; border-radius:4px; border:1px solid #444; cursor:zoom-in;">
                    </div>
                    <div style="flex:1;">${text}</div>
                </div>`;
            } else if (block.type === 'banner_box') {
                return `
                <div id="block-${idx}" style="margin:20px 0; border:1px solid gold; background:rgba(0,0,0,0.5); padding:0;">
                    ${block.banner ? `<img src="${block.banner}" style="width:100%; display:block;">` : ''}
                    <div style="padding:15px;">
                        <h3 style="color:gold; margin-top:0;">${block.title}</h3>
                        ${text}
                        <div style="text-align:right; margin-top:10px;"><button class="share-btn">👁️</button></div>
                    </div>
                </div>`;
            } else {
                // Lore / Standard
                content = `<div style="margin-top:10px;">${text}</div>`;
            }

            return `
            <div id="block-${idx}" class="content-block" style="border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:20px; margin-bottom:20px;">
                <h3 style="color:gold; font-family:'Cinzel'; border-bottom:1px solid #444; margin-bottom:10px; display:flex; justify-content:space-between;">
                    <span><i class="fas ${block.icon || 'fa-scroll'}"></i> ${block.title}</span>
                    <button class="share-btn">👁️</button>
                </h3>
                ${content}
            </div>`;
        }).join("");
    }

    renderRelations(rels) {
        if (!rels || rels.length === 0) return "";
        return `
        <div class="content-card" style="margin-top:2rem;">
            <h3 class="text-gold-gradient" style="font-size:1.2rem; border-bottom:1px solid #444; margin-bottom:10px;">Relazioni</h3>
            <ul style="list-style:none; padding:0;">
                ${rels.map(r => `
                <li style="margin-bottom:10px; display:flex; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:5px;">
                    <strong style="color:gold; width:120px; flex-shrink:0;">${r.id}</strong>
                    <span style="color:#aaa;">${r.description}</span>
                </li>`).join('')}
            </ul>
        </div>`;
    }

    attachShadow(host, htmlContent, blocksForSharing = []) {
        this.setupShadowRoot(host, htmlContent, blocksForSharing);
    }

    // SHARED SETUP
    setupShadowRoot(host, htmlContent, blocksForSharing = []) {
        if (host.shadowRoot) host.shadowRoot.innerHTML = "";
        else host.attachShadow({ mode: "open" });

        const root = host.shadowRoot;

        // Styles
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = CSS_URL;
        root.appendChild(link);

        const fa = document.createElement("link");
        fa.rel = "stylesheet";
        fa.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css";
        root.appendChild(fa);

        const fonts = document.createElement("link");
        fonts.href = "https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Crimson+Text:ital,wght@0,400;0,600;1,400&family=Montserrat:wght@400;600&display=swap";
        fonts.rel = "stylesheet";
        root.appendChild(fonts);

        // Custom Styles Override
        const style = document.createElement("style");
        style.textContent = `
            :host { display:flex; flex-direction:column; width:100%; height:100%; font-family: 'Crimson Text', serif; font-size:18px; color:#e0e0e0; }
            .content-card { background:var(--bg-card, #1e1e1e); padding:2rem; border-radius:4px; margin-bottom:0; }
            .text-gold-gradient { 
                background: linear-gradient(to bottom, #cfc09f 0%, #ffecb3 45%, #9e7f2a 100%);
                -webkit-background-clip: text; -webkit-text-fill-color: transparent; color:gold;
                font-family: 'Cinzel', serif; text-transform:uppercase;
            }
            .share-btn { 
                background:rgba(0,0,0,0.5); border:1px solid gold; color:gold; 
                width:30px; height:30px; border-radius:50%; cursor:pointer; 
                display:inline-flex; align-items:center; justify-content:center;
                font-size:14px; margin-left:10px;
            }
            .share-btn:hover { background:gold; color:black; }
            
            /* Responsive Grid */
            @media(max-width: 900px) {
                .char-grid { grid-template-columns: 1fr !important; }
                .right-col { order:-1; }
            }
            
            /* Scrollbars */
            ::-webkit-scrollbar { width: 10px; }
            ::-webkit-scrollbar-track { background: #0a0a0a; }
            ::-webkit-scrollbar-thumb { background: #444; border: 1px solid #222; border-radius: 4px; }
            ::-webkit-scrollbar-thumb:hover { background: gold; }
        `;
        root.appendChild(style);

        // Content Wrapper
        const wrapper = document.createElement("div");
        wrapper.className = "main-content";
        wrapper.style.cssText = "flex:1; overflow-y:auto; padding:0; position:relative;";
        wrapper.innerHTML = htmlContent;
        wrapper.querySelectorAll("button.share-btn").forEach(b => b.remove()); // clean placeholders
        root.appendChild(wrapper);

        // Lightbox
        // ... (省略 lightbox logic per brevità, se serve lo rimetto, ma il codice originale lo aveva)
        // Re-adding Lightbox simple logic
        const lb = document.createElement("div");
        lb.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); z-index:9999; display:none; align-items:center; justify-content:center;";
        lb.innerHTML = '<img style="max-width:90%; max-height:90%; border:2px solid gold; box-shadow:0 0 50px black;">';
        lb.onclick = () => lb.style.display = "none";
        root.appendChild(lb);

        wrapper.querySelectorAll("img").forEach(img => {
            img.style.cursor = "zoom-in";
            img.onclick = () => {
                lb.querySelector("img").src = img.src;
                lb.style.display = "flex";
            };
        });

        // Shared Buttons
        if (blocksForSharing.length > 0 && game.user.isGM) {
            blocksForSharing.forEach(b => {
                const target = wrapper.querySelector(b.selector);
                if (target) {
                    const btn = document.createElement("button");
                    btn.className = "share-btn";
                    btn.innerHTML = "👁️";
                    btn.title = "Condividi";
                    // Try to append near header
                    const h3 = target.querySelector("h3");
                    if (h3) h3.appendChild(btn);
                    else target.prepend(btn);

                    btn.onclick = (e) => {
                        e.stopPropagation();
                        if (criptaSocket) {
                            criptaSocket.executeForEveryone("showPopup", {
                                html: target.outerHTML,
                                title: b.title
                            });
                            ui.notifications.info(`Condiviso: ${b.title}`);
                        }
                    };
                }
            });
        }
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
