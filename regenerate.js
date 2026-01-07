const fs = require('fs');
const path = require('path');

const srcJson = 'assets/data/npcss.json';
const outDataDir = 'assets/data/characters';
const outContentDir = 'assets/content/characters';

const mapChars = {
  '…': 'à',\n  '•': 'ò',\n  '‚': 'é',\n  '\\u0082': 'é',\n  '\\u0085': 'à',\n  '\\u0095': 'ò',\n  '\\u008d': 'ì',\n  '\\u008f': 'ù',
  'Çÿ': 'à',
  'Çù': 'è',
  'Ç¸': 'é',
  'Çª': 'ì',
  'Çý': 'ò',
  'Çû': 'ù',
  'Ç^': 'è',
  'ÿ': 'à',
  'ý': 'ò',
  'û': 'ù'
};

const slugify = (str) => (str || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'contenuto';

const htmlToMd = (html) => {
  if (!html) return '';
  let s = html.replace(/\r\n?/g, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div)>/gi, '\n\n');
  s = s.replace(/<p[^>]*>/gi, '');
  s = s.replace(/<div[^>]*>/gi, '');
  s = s.replace(/<strong[^>]*>/gi, '**').replace(/<\/strong>/gi, '**');
  s = s.replace(/<b[^>]*>/gi, '**').replace(/<\/b>/gi, '**');
  s = s.replace(/<em[^>]*>/gi, '*').replace(/<\/em>/gi, '*');
  s = s.replace(/<i[^>]*>/gi, '*').replace(/<\/i>/gi, '*');
  s = s.replace(/<ul[^>]*>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '- ').replace(/<\/li>/gi, '\n');
  s = s.replace(/<\/ul>/gi, '\n');
  s = s.replace(/<span[^>]*>/gi, '').replace(/<\/span>/gi, '');
  s = s.replace(/<h[1-6][^>]*>/gi, '\n### ').replace(/<\/h[1-6]>/gi, '\n');
  s = s.replace(/<blockquote[^>]*>/gi, '> ').replace(/<\/blockquote>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
};

function fixText(str) {
  let out = str;
  for (const [bad, good] of Object.entries(mapChars)) {
    if (out.includes(bad)) out = out.split(bad).join(good);
  }
  return out;
}

if (!fs.existsSync(srcJson)) throw new Error('Source JSON not found');
fs.mkdirSync(outDataDir, { recursive: true });
fs.mkdirSync(outContentDir, { recursive: true });

const raw = fs.readFileSync(srcJson, 'utf8').replace(/^\uFEFF/, '');
const data = JSON.parse(raw);
const manifest = [];

for (const [idx, char] of data.entries()) {
  const id = char.id || `char-${idx+1}`;
  const blocks = Array.isArray(char.content_blocks) ? char.content_blocks : [];
  const updatedBlocks = blocks.map((block, bidx) => {
    const copy = { ...block };
    const slug = slugify(copy.title || `block-${bidx+1}`);
    const fileName = `${bidx+1}-${slug}.md`;
    const relPath = path.join('characters', id, fileName).replace(/\\/g, '/');

    const parts = [];
    if (copy.content) { parts.push(htmlToMd(fixText(copy.content))); delete copy.content; }
    if (copy.subtitle) { parts.push(`*${fixText(copy.subtitle)}*`); delete copy.subtitle; }
    if (Array.isArray(copy.sections)) {
      for (const section of copy.sections) {
        const heading = section.heading ? `### ${fixText(section.heading)}\n` : '';
        parts.push(`${heading}${htmlToMd(fixText(section.text || ''))}`.trim());
      }
      delete copy.sections;
    }
    if (copy.quote) { parts.push(`> ${htmlToMd(fixText(copy.quote)).replace(/\n/g, '\n> ')}`); delete copy.quote; }

    const md = parts.filter(Boolean).join('\n\n').trim();
    if (md) {
      const outPath = path.join(outContentDir, id, fileName);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, md + '\n', 'utf8');
      copy.markdown = relPath;
    }
    return copy;
  });

  const outChar = { ...char, type: char.type || 'npc', content_blocks: updatedBlocks };
  const yaml = toYaml(outChar);
  fs.writeFileSync(path.join(outDataDir, `${id}.yaml`), yaml + '\n', 'utf8');
  manifest.push({ id, type: outChar.type, file: `characters/${id}.yaml` });
}

const manifestYaml = toYaml(manifest);
fs.writeFileSync(path.join(outDataDir, 'index.yaml'), manifestYaml + '\n', 'utf8');
console.log('Regenerated characters and manifest');

function toYaml(value, indent = '') {
  const next = indent + '  ';
  if (Array.isArray(value)) {
    if (value.length === 0) return indent + '[]';
    return value.map(item => {
      const formatted = toYaml(item, next);
      if (formatted.startsWith(next)) return `${indent}- ${formatted.slice(next.length)}`;
      return `${indent}- ${formatted.trimStart()}`;
    }).join('\n');
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return indent + '{}';
    return entries.map(([key, val]) => {
      const yamlKey = /^[A-Za-z_][\w-]*$/.test(key) ? key : JSON.stringify(key);
      const formatted = toYaml(val, next);
      const lines = formatted.split('\n');
      if (lines.length === 1) {
        const line = lines[0];
        const valuePart = line.startsWith(next) ? line.slice(next.length) : line.trimStart();
        return `${indent}${yamlKey}: ${valuePart}`;
      }
      return `${indent}${yamlKey}:\n${formatted}`;
    }).join('\n');
  }
  if (typeof value === 'string') return indent + JSON.stringify(fixText(value));
  if (typeof value === 'number' || typeof value === 'boolean') return indent + String(value);
  if (value === null) return indent + 'null';
  return indent + JSON.stringify(value);
}

