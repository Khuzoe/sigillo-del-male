const fs = require('fs');
const path = require('path');

const CHARS_DIR = 'assets/data/characters';
const SIDEBAR_PATH = 'sidebar.html';
const OUTPUT_FILE = 'assets/js/static_data.js';

// --- Simple YAML Parser (Adapted from npcs.html) ---
// --- Simple YAML Parser & Hydrator ---

function parseYamlAndHydrate(yamlText, charId) {
    const text = yamlText.replace(/^\uFEFF/, '');

    // 1. Basic Metadata Extraction
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
            avatar: imagesMatch[1].trim().replace(/"/g, ''),
            hover: imagesMatch[2].trim().replace(/"/g, ''),
            portrait: imagesMatch[3].trim().replace(/"/g, '')
        };
    }

    // Quick summary extraction (limited)
    const summaryMatch = text.match(/^summary:\s*\r?\n\s+race:\s*(.*)/m);
    if (summaryMatch) { result.summary = { race: summaryMatch[1].trim().replace(/"/g, '') }; }

    // 2. Content Blocks Extraction & Hydration
    // We need to find the content_blocks array and for each item, read the markdown file.
    // This regex is a bit complex for a simple parser, let's try a line-by-line approach for blocks.

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
                    // HYDRATION MAGIC HERE
                    currentBlock[k] = v;
                    const mdPath = path.join('assets/content', v);
                    if (fs.existsSync(mdPath)) {
                        currentBlock.markdownText = fs.readFileSync(mdPath, 'utf8');
                    } else {
                        console.warn(`[WARN] Markdown file not found for ${charId}: ${mdPath}`);
                    }
                } else {
                    currentBlock[k] = v;
                }
            }
        }
    }
    if (currentBlock) contentBlocks.push(currentBlock);

    result.content_blocks = contentBlocks;

    // 3. Relationships Extraction (Simple)
    // Similar to content blocks logic
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
    console.log("Building static data with full content...");

    // 1. Sidebar HTML
    let sidebarHtml = "";
    if (fs.existsSync(SIDEBAR_PATH)) {
        sidebarHtml = fs.readFileSync(SIDEBAR_PATH, 'utf8');
    } else {
        console.warn("Sidebar file not found:", SIDEBAR_PATH);
    }

    // 2. Character Data
    const characters = [];
    if (fs.existsSync(CHARS_DIR)) {
        const files = fs.readdirSync(CHARS_DIR).filter(f => f.endsWith('.yaml') && f !== 'index.yaml');

        files.forEach(file => {
            try {
                const content = fs.readFileSync(path.join(CHARS_DIR, file), 'utf8');
                const charId = file.replace('.yaml', '');
                const parsed = parseYamlAndHydrate(content, charId);
                if (parsed.id) {
                    characters.push(parsed);
                }
            } catch (err) {
                console.error(`Error parsing ${file}:`, err);
            }
        });
    }

    // 3. Output JS
    const jsContent = `/** AUTO-GENERATED FILE */
window.SIDEBAR_HTML = ${JSON.stringify(sidebarHtml)};
window.NPC_DATA = ${JSON.stringify(characters)};
console.log("Static FULL data loaded:", window.NPC_DATA.length, "characters");
`;

    fs.writeFileSync(OUTPUT_FILE, jsContent, 'utf8');
    console.log(`Successfully wrote to ${OUTPUT_FILE}`);
}

build();
