// === CONFIGURAZIONE ===
        const BASE_PATH = '../assets/img/skill_trees/';
        const JSON_FILE = '../assets/data/skills.json';
        
        // Contenitore globale per i dati
        let skillsData = {}; 

        const container = document.getElementById('tree-container');
        const svgLines = document.getElementById('tree-lines');
        const infoPanel = document.getElementById('info-panel');

        // === CARICAMENTO DATI ===
        async function loadSkillsData() {
            try {
                const response = await fetch(JSON_FILE);
                
                if (!response.ok) {
                    throw new Error(`Errore HTTP: ${response.status}`);
                }
                
                skillsData = await response.json();
                
                // Carica il primo personaggio di default una volta ottenuti i dati
                switchCharacter('apothecary');
                resetInfoPanel();

            } catch (error) {
                console.error("Errore nel caricamento del JSON:", error);
                infoPanel.innerHTML = `
                    <div class="error-message">
                        <i class="fas fa-exclamation-triangle"></i>
                        <h3>Impossibile caricare le abilità</h3>
                        <p>Assicurati di usare un server locale (Live Server) e che il file ${JSON_FILE} sia nella cartella.</p>
                        <small>${error.message}</small>
                    </div>
                `;
            }
        }

        // === LOGICA ALBERO ===
        function switchCharacter(charKey) {
            // Controlla se i dati sono stati caricati
            if (!skillsData[charKey]) return;

            // Aggiorna tab attivo
            document.querySelectorAll('.skill-tab').forEach(t => {
                t.classList.remove('active');
                if(t.getAttribute('onclick').includes(`'${charKey}'`)) t.classList.add('active');
            });

            // Pulisci
            container.querySelectorAll('.skill-node').forEach(n => n.remove());
            svgLines.innerHTML = '';
            resetInfoPanel();

            const data = skillsData[charKey];

            // Sfondo dinamico
            const bgUrl = resolvePath(data.bgImage);
            
            // Imposta sfumatura in base al personaggio
            let gradientColor = '#000';
            if(charKey === 'valdor' || charKey === 'garun') gradientColor = '#3a0000';
            else if(charKey === 'apothecary') gradientColor = '#4a0000';
            else gradientColor = '#002200';

            container.style.backgroundImage = `url('${bgUrl}'), radial-gradient(circle, ${gradientColor}, #000)`;

            // Disegna Linee
            data.nodes.forEach(node => {
                if (node.connections) {
                    node.connections.forEach(targetId => {
                        const targetNode = data.nodes.find(n => n.id === targetId);
                        if (targetNode) drawLine(node, targetNode);
                    });
                }
            });

            // Disegna Nodi
            data.nodes.forEach(node => {
                const el = document.createElement('div');
                let stateClass;

                switch (node.state) {
                    case 'unlocked': stateClass = 'unlocked'; break;
                    case 'unlockable': stateClass = 'unlockable'; break;
                    default: stateClass = 'locked';
                }
                el.className = `skill-node ${stateClass} ${node.keyNode ? 'key-node' : ''}`;
                
                el.style.left = node.x + '%';
                el.style.top = node.y + '%';
                
                const iconUrl = resolvePath(node.icon);
                el.style.backgroundImage = `url('${iconUrl}')`;

                el.addEventListener('mouseenter', () => updateInfoPanel(node));
                
                container.appendChild(el);
            });
        }

        function resolvePath(path) {
            if (!path) return '';
            // Se è un URL completo o base64, usalo così com'è
            if (path.startsWith('http') || path.startsWith('data:')) {
                return path;
            }
            // Altrimenti aggiungi il percorso base
            return BASE_PATH + path;
        }

        function drawLine(start, end) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', start.x + '%');
            line.setAttribute('y1', start.y + '%');
            line.setAttribute('x2', end.x + '%');
            line.setAttribute('y2', end.y + '%');

            const map = {
                unlocked: 'unlocked',
                unlockable: 'unlockable'
            };
            line.setAttribute('class', `connection-line ${map[end.state] ?? ''}`);

            svgLines.appendChild(line);
        }

        function updateInfoPanel(node) {
            const iconUrl = resolvePath(node.icon);
            infoPanel.innerHTML = `
                <div class="info-header">
                    <img src="${iconUrl}" class="info-icon">
                    <h3 class="info-title">${node.title}</h3>
                </div>
                <p class="info-flavor">${node.flavor}</p>
                <div class="info-desc">${node.desc}</div>
            `;
        }

        function resetInfoPanel() {
            infoPanel.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-hand-pointer"></i>
                    <p>Passa il cursore su un nodo<br>per rivelarne i segreti.</p>
                </div>
            `;
        }

        // Avvio al caricamento della pagina
        document.addEventListener('DOMContentLoaded', loadSkillsData);
