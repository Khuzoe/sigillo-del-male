const fs = require('fs');
const path = require('path');

const CHARS_DIR = 'assets/data/characters';
const SESSIONS_FILE = 'assets/data/sessions.json';
const OUTPUT_FILE = 'assets/data/foundry.json';
const BASE_URL = 'https://khuzoe.github.io/sigillo-del-male/'; // URL del tuo sito

// Ensure output directory exists
const outputDir = path.dirname(OUTPUT_FILE);
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Helpers
const fixPath = (p) => {
    if (!p) return null;
    if (p.startsWith('http')) return p;
    // Se il path inizia già con assets (es. assets/img...), non lo raddoppiamo.
    // Se inizia con img/ (come nei YAML), aggiungiamo assets/ davanti.
    if (p.startsWith('assets/')) return BASE_URL + p;
    return BASE_URL + 'assets/' + p;
};


// --- YAML Parser (Same as build_static_data.js) ---

// --- Simple Markdown Parser (No deps) ---
function parseMarkdown(md) {
    if (!md) return '';
    let html = md
        // Headers
        // Headers (Flexible: allow optional whitespace before/after #)
        .replace(/^\s*###\s*(.*?)[\r\n]*$/gim, '<h3>$1</h3>')
        .replace(/^\s*##\s*(.*?)[\r\n]*$/gim, '<h2>$1</h2>')
        .replace(/^\s*#\s*(.*?)[\r\n]*$/gim, '<h1>$1</h1>')
        // Bold
        .replace(/\*\*(.*?)\*\*/gim, '<b>$1</b>')
        .replace(/__(.*?)__/gim, '<b>$1</b>')
        // Italic
        .replace(/\*(.*?)\*/gim, '<i>$1</i>')
        .replace(/_(.*?)_/gim, '<i>$1</i>')
        // Lists
        .replace(/^\s*-\s+(.*?)[\r\n]*$/gim, '<ul><li>$1</li></ul>')
        // Fix list grouping (Naive)
        .replace(/<\/ul>\s*<ul>/gim, '')
        // Newlines to br (Handle CRLF)
        .replace(/\r?\n/gim, '<br>');

    return html;
}

function parseYamlAndHydrate(yamlText, charId) {
    const text = yamlText.replace(/^\uFEFF/, '');
    const result = {};

    const extract = (key) => {
        const match = text.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
        if (match) {
            const val = match[1].trim();
            if (val.startsWith('"') && val.endsWith('"')) return val.slice(1, -1);
            if (val.startsWith("'") && val.endsWith("'")) return val.slice(1, -1);
            return val;
        }
        return null;
    };

    result.id = extract('id');
    result.name = extract('name');
    result.role = extract('role');
    result.status = extract('status');
    result.quote = extract('quote');
    result.type = extract('type');

    const imagesMatch = text.match(/^images:\s*\r?\n\s+avatar:\s*(.*)\r?\n\s+hover:\s*(.*)\r?\n\s+portrait:\s*(.*)/m);
    if (imagesMatch) {
        result.images = {
            avatar: fixPath(imagesMatch[1].trim().replace(/"/g, '')),
            hover: fixPath(imagesMatch[2].trim().replace(/"/g, '')),
            portrait: fixPath(imagesMatch[3].trim().replace(/"/g, ''))
        };
    }

    // Content Blocks
    const lines = text.split(/\r?\n/);
    const contentBlocks = [];
    let currentBlock = null;
    let inBlocks = false;

    for (let line of lines) {
        const trim = line.trim();
        if (trim.startsWith('content_blocks:')) {
            inBlocks = true;
            continue;
        }
        if (!inBlocks) continue;
        if (trim === '' || trim.startsWith('relationships:') || trim.startsWith('questline:')) {
            inBlocks = false;
            if (currentBlock) contentBlocks.push(currentBlock);
            currentBlock = null;
            continue;
        }

        if (trim.startsWith('- type:')) {
            if (currentBlock) contentBlocks.push(currentBlock);
            currentBlock = { type: trim.replace('- type:', '').trim().replace(/"/g, '') };
        } else if (currentBlock) {
            const keyVal = trim.match(/^([^:]+):\s*(.*)$/);
            if (keyVal) {
                let k = keyVal[1].trim();
                let v = keyVal[2].trim().replace(/"/g, '');
                if (k === 'markdown') {
                    currentBlock[k] = v;
                    const mdPath = path.join('assets/content', v);
                    if (fs.existsSync(mdPath)) {
                        const rawMd = fs.readFileSync(mdPath, 'utf8');
                        currentBlock.markdownText = parseMarkdown(rawMd); // PARSE HERE
                    } else {
                        console.warn(`[WARN] Markdown file not found for ${charId}: ${mdPath}`);
                    }
                } else if (k === 'image') {
                    currentBlock[k] = fixPath(v);
                } else {
                    currentBlock[k] = v;
                }
            }
        }
    }
    if (currentBlock) contentBlocks.push(currentBlock);
    result.content_blocks = contentBlocks;

    // Relationships (Keep same)
    const relationships = [];
    let currentRel = null;
    let inRels = false;

    for (let line of lines) {
        const trim = line.trim();
        if (trim.startsWith('relationships:')) { inRels = true; continue; }
        if (!inRels) continue;
        if (trim === '' || trim.startsWith('type:') || trim.startsWith('summary:')) {
            inRels = false;
            if (currentRel) relationships.push(currentRel);
            currentRel = null;
            continue;
        }

        if (trim.startsWith('- id:')) {
            if (currentRel) relationships.push(currentRel);
            currentRel = { id: trim.replace('- id:', '').trim().replace(/"/g, '') };
        } else if (currentRel) {
            const keyVal = trim.match(/^([^:]+):\s*(.*)$/);
            if (keyVal) {
                currentRel[keyVal[1].trim()] = keyVal[2].trim().replace(/"/g, '');
            }
        }
    }
    if (currentRel) relationships.push(currentRel);
    result.relationships = relationships;

    return result;
}

// --- Main Build ---

function build() {
    console.log("Building Foundry VTT module data...");

    const data = {
        characters: [],
        players: [],
        skills: {},
        sessions: {}
    };

    // 1. Process NPC Characters
    if (fs.existsSync(CHARS_DIR)) {
        const files = fs.readdirSync(CHARS_DIR).filter(f => f.endsWith('.yaml') && f !== 'index.yaml');
        files.forEach(file => {
            try {
                const content = fs.readFileSync(path.join(CHARS_DIR, file), 'utf8');
                const charId = file.replace('.yaml', '');
                const parsed = parseYamlAndHydrate(content, charId);
                if (parsed.id) {
                    data.characters.push(parsed);
                }
            } catch (err) {
                console.error(`Error parsing character ${file}:`, err);
            }
        });
    }

    // 2. Process Sessions
    if (fs.existsSync(SESSIONS_FILE)) {
        try {
            const sessionsContent = fs.readFileSync(SESSIONS_FILE, 'utf8');
            data.sessions = JSON.parse(sessionsContent);
        } catch (err) {
            console.error("Error reading sessions file:", err);
        }
    } else {
        console.warn("Sessions file not found:", SESSIONS_FILE);
    }

    // 3. Process Players
    const playersFile = 'assets/data/players.json';
    if (fs.existsSync(playersFile)) {
        try {
            const playersContent = fs.readFileSync(playersFile, 'utf8');
            let playersData = JSON.parse(playersContent);

            // Fix paths for players
            playersData = playersData.map(p => {
                if (p.images) {
                    p.images.avatar = fixPath(p.images.avatar);
                    p.images.hover = fixPath(p.images.hover);
                    p.images.portrait = fixPath(p.images.portrait);
                }
                return p;
            });
            data.players = playersData;
        } catch (err) {
            console.error("Error reading players file:", err);
        }
    }

    // 4. Process Skills
    const skillsFile = 'assets/data/skills.json';
    if (fs.existsSync(skillsFile)) {
        try {
            const skillsContent = fs.readFileSync(skillsFile, 'utf8');
            let skillsData = JSON.parse(skillsContent);

            // Fix paths in skills
            for (const charId in skillsData) {
                const skillTree = skillsData[charId];
                if (skillTree.bgImage) {
                    skillTree.bgImage = fixPath('img/skill_trees/' + skillTree.bgImage);
                }
                if (skillTree.nodes) {
                    skillTree.nodes.forEach(node => {
                        if (node.icon) {
                            node.icon = fixPath('img/skill_trees/' + node.icon);
                        }
                    });
                }
            }
            data.skills = skillsData;
        } catch (err) {
            console.error("Error reading skills file:", err);
        }
    }


    // 3. Write Output
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Successfully wrote module data to ${OUTPUT_FILE}`);
    console.log(`- Characters: ${data.characters.length}`);
    console.log(`- Players: ${data.players.length}`);
    console.log(`- Sessions: ${data.sessions.sessions ? data.sessions.sessions.length : 0}`);
}

build();
