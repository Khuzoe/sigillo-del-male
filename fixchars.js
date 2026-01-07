const fs = require('fs');
const path = require('path');

const map = {
  '\u00C7\u00FF': 'à',
  '\u00C7\u00F9': 'è',
  '\u00C7\u00B8': 'é',
  '\u00C7\u00AA': 'ì',
  '\u00C7\u00FD': 'ò',
  '\u00C7\u00FB': 'ù',
  '\u2026': 'à',
  '\u2022': 'ò',
  '\u201A': 'é',
  '\u2019': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u00C3\u00A8': 'è',
  '\u00C3\u00A9': 'é',
  '\u00C3\u00A0': 'à',
  '\u00C3\u00B2': 'ò',
  '\u00C3\u00B9': 'ù',
  '\u00C3\u00AC': 'ì'
};

function listFiles(dir, ext) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, ext));
    else if (!ext || entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

const files = [
  ...listFiles('assets/content/characters', '.md'),
  ...listFiles('assets/data/characters', '.yaml'),
];

let changed = 0;
for (const file of files) {
  let text = fs.readFileSync(file, 'utf8');
  let orig = text;
  for (const [bad, good] of Object.entries(map)) {
    if (text.includes(bad)) text = text.split(bad).join(good);
  }
  if (text !== orig) {
    fs.writeFileSync(file, text, 'utf8');
    console.log('fixed', file);
    changed++;
  }
}
console.log('files updated', changed);
