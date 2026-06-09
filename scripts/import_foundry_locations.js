const fs = require('fs');
const path = require('path');

const SECTION_CHILDREN = {
  'piano-esterno-delle-celesti-arcate': [
    'Le Porte della Purezza',
    "Le Valli dell'Eternità",
    'Le Cripte dei Caduti',
    'La Cittadella dei Luminar',
    "Le Scale dell'Ascensione"
  ],
  'piano-esterno-elementale': [
    'Geodoma, il Regno della Terra',
    'Il Colosso di Pietra',
    'Le Caverne di Eclazion',
    'La Fossa degli Antichi',
    "Aerodoma, il Regno dell'Aria",
    'La Cittadella dei Venti',
    'Il Labirinto delle Tempeste',
    'Le Cascate Celesti di Aeloria',
    'Pyrodoma, il Regno del Fuoco',
    'La Forgia di Krenor',
    'Il Mare di Cenere di Thul',
    'La Fortezza di Fiamma di Ashkar',
    "Hydrodoma, il Regno dell'Acqua",
    'La Città Sottomarina di Nymar',
    'Le Correnti di Thalassia',
    'La Fossa Abissale di Nereth'
  ],
  'piano-dei-sogni': [
    'Le Porte dei Sogni',
    'La Fortezza delle Illusioni',
    'La Valle degli Incubi',
    'Il Giardino degli Eterni Desideri',
    'Il Mare delle Memorie Perdute',
    'Le Stelle Oniriche',
    'Le Catene di Morfeo',
    'Il Sentiero dei Mille Volti',
    "L'Obelisco dei Segreti"
  ],
  'piano-esterno-delle-ombre': [
    'Le Faglie del Mana',
    "Il Santuario dell'Umbral",
    'La Foresta di Nebbia',
    'Il Tempio delle Anime Infrante',
    'Il Velo del Nulla',
    'Il Cuore della Tenebra',
    'Il Sentiero dei Perduti',
    "L'Albero delle Anime"
  ],
  'reame-vacuo': [
    'La Distesa del Nulla',
    "Le Scogliere dell'Esilio"
  ],
  'reami-astratti': [
    'I Geyser del Mana',
    'La Città degli Eterni',
    'I Fili del Fato',
    'Il Mare delle Frontiere'
  ],
  'reami-dell-assolutore': [
    'La Corte delle Anime Perdute',
    "Le Cascate dell'Oblio",
    'Le Sale del Rimorso',
    'Il Santuario del Giusto',
    "Le Faglie dell'Assolutore",
    'Il Lamento dei Morti',
    "L'Ancora dei Rimpianti"
  ],
  'piano-del-tempo': [
    "Le Torri dell'Eternità",
    'Il Fiume del Tempo',
    'Il Tempio di Demorgan',
    "L'Arena delle Ere",
    'Le Clessidre Eterne'
  ],
  'l-altro-mondo': [
    "I Condotti dell'Orrore",
    "La Campana dell'Altro Mondo"
  ],
  mirmane: {
    mode: 'strong',
    titles: [
      'Il Cuore Addormentato del Grande Verme',
      "La Cometa Incatenata di Navle Af’is",
      'Il Canto Spezzato della Corda di Steinfure'
    ],
    type: 'legend'
  },
  'terre-neutrali': {
    mode: 'allStrong'
  },
  vermidiandas: {
    mode: 'strong',
    titles: [
      'Porto di Weilam',
      'Il Trono Rosso della Corona di Zaahul',
      'La Lancia Spezzata di Mezna',
      'Le Statue che Sussurrano nel Giardino degli Eroi',
      'I Dodici Rintocchi di Drezno',
      'La Maschera del Primo Inquisitore',
      'Il Corteo Infranto della Marcia di Isvinde'
    ],
    type: 'legend'
  },
  morgammar: {
    mode: 'strong',
    titles: [
      'La Cripta di Almaroth',
      'La Spada di Luanor',
      'Il Segreto di Kurnag'
    ],
    type: 'legend'
  },
  arazora: {
    mode: 'strong',
    titles: [
      'Il Nono Anello del Portale di Eryn',
      'Il Pastore delle Radici di Ulginia'
    ],
    type: 'legend'
  },
  'isole-tributarie': {
    mode: 'plain',
    titles: [
      'Smirna, l’Isola dalle Mille Conchiglie',
      'Finares, l’Isola dei Diavoli Rossi',
      'Karmandi, l’Isola del Progresso'
    ],
    type: 'place'
  },
  vidammar: {
    mode: 'custom',
    entries: [
      { title: 'Città-Tempio di Zaahul', marker: 'Le Radici della Maledizione', type: 'city' },
      { title: 'La Cattedrale di Piombo', marker: 'La Cattedrale di Piombo', type: 'landmark' },
      { title: "Le Torri dell'Osservatorio Arcano", marker: "Le Torri dell'Osservatorio Arcano", type: 'landmark' },
      { title: 'Il Ponte delle Anime', marker: 'Il Ponte delle Anime', type: 'landmark' },
      { title: 'Il Mercato dei Maghi', marker: 'Il Mercato dei Maghi', type: 'district' },
      { title: 'Yildizi, la Stella di Ghiaccio', marker: 'Yildizi, la Stella di Ghiaccio', type: 'city' },
      { title: 'Nanotumulo', marker: 'Nanotumulo', type: 'city' },
      { title: "Porto d'Ebano di Elianka", marker: 'Due Anime, Una Città', type: 'city' },
      { title: 'Marfesa', marker: 'La Necropoli Originaria', type: 'city' },
      { title: 'Char', marker: 'Le Vene della Montagna', type: 'city' },
      { title: 'La Strada Carnevalesca di Roderik', marker: 'La Strada Cernevalesca di Roderik', type: 'district' },
      { title: 'Il Parco Termale di Morgentheim', marker: 'Il Parco Termale di Morgentheim', type: 'landmark' },
      { title: 'Noktro', marker: 'Il Groviglio', type: 'city' },
      { title: 'Lago Vetricia', marker: "L'Acqua che Non è Acqua", type: 'landmark' },
      { title: 'Pianto di Settimpur', marker: 'Pianto di Settimpur Prima della catastrofe', type: 'landmark', plain: true },
      { title: 'Il Decimo Traditore', marker: 'Il Decimo Traditore', type: 'legend' },
      { title: 'La Prima Nota degli Alberi Cantanti', marker: 'La Prima Nota degli Alberi Cantanti', type: 'legend' },
      { title: 'Il Contratto di Verminferno', marker: 'Il Contratto di Verminferno', type: 'legend' }
    ]
  }
};

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry.startsWith('--')) continue;
    const key = entry.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function fixMojibake(value) {
  return String(value || '')
    .replace(/â€™/g, '’')
    .replace(/â€˜/g, '‘')
    .replace(/â€œ/g, '“')
    .replace(/â€/g, '”')
    .replace(/â€“/g, '–')
    .replace(/â€”/g, '—')
    .replace(/â€¦/g, '…')
    .replace(/Ã€|Ãƒâ‚¬/g, 'À')
    .replace(/Ãˆ|ÃƒË†/g, 'È')
    .replace(/Ã‰|Ãƒâ€/g, 'É')
    .replace(/Ã |ÃƒÂ /g, 'à')
    .replace(/Ã¨|ÃƒÂ¨/g, 'è')
    .replace(/Ã©|ÃƒÂ©/g, 'é')
    .replace(/Ã¬|ÃƒÂ¬/g, 'ì')
    .replace(/Ã²|ÃƒÂ²/g, 'ò')
    .replace(/Ã¹|ÃƒÂ¹/g, 'ù')
    .replace(/Ã§|ÃƒÂ§/g, 'ç')
    .replace(/Ã±|ÃƒÂ±/g, 'ñ')
    .replace(/Â°/g, '°')
    .replace(/Â«/g, '«')
    .replace(/Â»/g, '»')
    .replace(/Ã‚/g, '');
}

function slugify(value) {
  return fixMojibake(String(value || 'luogo'))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'luogo';
}

function uniqueId(base, used) {
  const normalized = slugify(base);
  let id = normalized;
  let suffix = 2;
  while (used.has(id)) {
    id = `${normalized}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function normalizeFoundryAssetPath(value) {
  const raw = decodeURIComponent(fixMojibake(String(value || '').trim()));
  if (!raw) return '';
  return raw.replace(/\\/g, '/').replace(/^\/+/, '');
}

function cleanTitle(value) {
  return fixMojibake(value)
    .replace(/^#+\s*/, '')
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .trim();
}

function isSeparator(line) {
  return line.trim() === '---';
}

function isMetadataHeading(title) {
  return /^Cartella\b/i.test(title);
}

function parseFoundryLocations(markdown) {
  const lines = fixMojibake(markdown).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let current = [];

  for (const line of lines) {
    if (isSeparator(line)) {
      if (current.some((entry) => entry.trim())) blocks.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.some((entry) => entry.trim())) blocks.push(current);

  const entries = [];
  for (const block of blocks) {
    const groupLineIndex = block.findIndex((line) => /^##\s+/.test(line) && !isMetadataHeading(cleanTitle(line)));
    if (groupLineIndex === -1) continue;
    const group = cleanTitle(block[groupLineIndex]);
    if (!group) continue;

    const h3Indexes = [];
    block.forEach((line, index) => {
      if (index > groupLineIndex && /^###\s+/.test(line)) h3Indexes.push(index);
    });

    if (!h3Indexes.length) continue;
    h3Indexes.forEach((start, entryIndex) => {
      const end = h3Indexes[entryIndex + 1] ?? block.length;
      const title = cleanTitle(block[start]);
      const body = block.slice(start + 1, end).join('\n').trim();
      if (!title) return;
      entries.push({ title, group, body });
    });
  }

  return entries;
}

function extractImage(markdown) {
  const lines = fixMojibake(markdown).split(/\r?\n/);
  for (const line of lines) {
    const explicit = line.match(/\*\*Immagine:\*\*\s*!\[([^\]]*)\]\((.+)\)/i);
    if (explicit) {
      return {
        image: normalizeFoundryAssetPath(explicit[2]),
        imageAlt: explicit[1] || ''
      };
    }
    const plain = line.trim().match(/^!\[([^\]]*)\]\((.+)\)$/);
    if (plain) {
      return {
        image: normalizeFoundryAssetPath(plain[2]),
        imageAlt: plain[1] || ''
      };
    }
  }
  return { image: '', imageAlt: '' };
}

function extractCaption(markdown) {
  const match = fixMojibake(markdown).match(/\*\*Didascalia:\*\*\s*(.+)/i);
  return match ? match[1].trim() : '';
}

function stripTableLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return line;
  if (/^\|\s*-/.test(trimmed)) return '';
  const cells = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean);
  if (!cells.length) return '';
  return cells.join('\n\n');
}

function normalizeTableMarkdown(markdown) {
  return fixMojibake(markdown)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(stripTableLine)
    .join('\n')
    .replace(/[ \t]{2,}/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractDetails(markdown) {
  const details = {};
  const text = normalizeTableMarkdown(markdown);
  const regex = /\*\*([^*:]{2,40}):\*\*\s*([\s\S]*?)(?=\s*\*\*[^*:]{2,40}:\*\*|\n{2,}|$)/g;
  let match;
  while ((match = regex.exec(text))) {
    const key = match[1].trim().toLowerCase();
    if (!['regione', 'popolazione', 'fondazione', 'governo'].includes(key)) continue;
    details[key] = match[2].replace(/\s+/g, ' ').trim();
  }
  return details;
}

function stripMetadata(markdown) {
  return normalizeTableMarkdown(markdown)
    .split(/\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (/^\*\*(Immagine|Didascalia):\*\*/i.test(trimmed)) return false;
      if (/^\*\*(Regione|Popolazione|Fondazione|Governo):\*\*/i.test(trimmed)) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function markdownInlineToHtml(value) {
  return escapeHtml(fixMojibake(value))
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong>$1</strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function markdownToHtml(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let paragraph = [];
  let list = [];

  const flushParagraph = () => {
    const text = paragraph.join(' ').trim();
    if (text) html.push(`<p>${markdownInlineToHtml(text)}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (list.length) html.push(`<ul>${list.map((item) => `<li>${markdownInlineToHtml(item)}</li>`).join('')}</ul>`);
    list = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const imageMatch = trimmed.match(/^!\[([^\]]*)\]\((.+)\)$/);
    if (imageMatch) {
      flushParagraph();
      flushList();
      const src = normalizeFoundryAssetPath(imageMatch[2]);
      const alt = imageMatch[1] || '';
      html.push(`<figure class="location-figure"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"></figure>`);
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = Math.min(5, Math.max(3, headingMatch[1].length + 2));
      html.push(`<h${level}>${markdownInlineToHtml(cleanTitle(headingMatch[2]))}</h${level}>`);
      continue;
    }

    const listMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      list.push(listMatch[1]);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return html.join('\n');
}

function firstMeaningfulParagraph(markdown) {
  const cleaned = stripMetadata(markdown)
    .split('\n')
    .filter((line) => !line.trim().startsWith('!['))
    .join('\n')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/^#{1,6}\s+.+$/gm, '')
    .replace(/\*{2,3}/g, '')
    .trim();
  const paragraph = cleaned.split(/\n\s*\n/).map((entry) => entry.trim()).find(Boolean) || '';
  return paragraph.replace(/^[-*]\s+/, '').replace(/\s+/g, ' ').slice(0, 280);
}

function guessType(group, title, fallback = '') {
  if (fallback) return fallback;
  const source = fixMojibake(`${group} ${title}`).toLowerCase();
  if (source.includes('appunti') || source.includes('maps') || source.includes('mappa')) return 'map';
  if (source.includes('piano') || source.includes('ream')) return 'plane';
  if (source.includes('citt') || ['gleanscath', 'bedrager', 'nanotumulo', 'char', 'marfesa', 'noktro'].some((name) => source.includes(name))) return 'city';
  if (source.includes('regione') || source.includes('kama') || source.includes('daremmar') || source.includes('terre')) return 'region';
  if (/(locanda|taverna|birreria|bottega|arsenale)/i.test(source)) return 'shop';
  if (/(leggenda|segreto|canto|contratto|maschera|corteo)/i.test(source)) return 'legend';
  if (/(ponte|tempio|santuario|basilica|osservatorio|rocca|conca|golfo|foresta|fiume|abissi|grotte|fossa|villa|piazza|spiaggia|torri|strada|parco|lago|porto)/i.test(source)) return 'landmark';
  return 'place';
}

function buildLocationRecord({ id, title, group, body, campaignId, used, type, parentId = '', parentTitle = '', order = 0, image = '', imageAlt = '', caption = '', details = {}, tags = [] }) {
  const cleanBody = stripMetadata(body);
  const metadata = image ? { image, imageAlt } : extractImage(body);
  const locationId = id || uniqueId(parentId ? `${parentId}-${title}` : title, used);
  const locationTags = Array.from(new Set([
    group,
    parentTitle,
    guessType(group, title, type),
    ...tags
  ].filter(Boolean).map(slugify)));

  const summary = firstMeaningfulParagraph(cleanBody) || caption || metadata.imageAlt || '';

  return {
    id: locationId,
    title,
    type: guessType(group, title, type),
    group: group || '',
    campaignId,
    source: 'foundry-journal',
    parentId,
    parentTitle,
    order,
    summary,
    image: metadata.image,
    imageAlt: metadata.imageAlt || title,
    caption: caption || extractCaption(body),
    details,
    contentMarkdown: cleanBody,
    desc: markdownToHtml(cleanBody),
    tags: locationTags
  };
}

function markerDefinitionsForEntry(entry, body) {
  const key = slugify(entry.title);
  const config = SECTION_CHILDREN[key];
  if (!config) return [];

  if (Array.isArray(config)) {
    return config.map((title) => ({ title, marker: title, type: guessType('', title), source: 'configured' }));
  }

  if (config.mode === 'allStrong') {
    const titles = [];
    const seen = new Set();
    const regex = /\*{2,3}([^*\n]{3,110})\*{2,3}/g;
    let match;
    while ((match = regex.exec(body))) {
      const title = cleanTitle(match[1]);
      if (/^(Regione|Governo|Popolazione|Fondazione):?$/i.test(title)) continue;
      const slug = slugify(title);
      if (seen.has(slug)) continue;
      seen.add(slug);
      titles.push(title);
    }
    return titles.map((title) => ({ title, marker: title, type: guessType('', title, config.type), source: 'strong' }));
  }

  if (config.mode === 'custom') {
    return config.entries.map((item) => ({
      title: item.title,
      marker: item.marker || item.title,
      type: item.type || guessType('', item.title),
      plain: Boolean(item.plain),
      source: 'custom'
    }));
  }

  return (config.titles || []).map((title) => ({
    title,
    marker: title,
    type: guessType('', title, config.type),
    plain: config.mode === 'plain',
    source: config.mode
  }));
}

function findMarker(body, marker) {
  const escaped = escapeRegExp(marker);
  const patterns = [
    new RegExp(`^#{1,6}\\s+\\*\\*${escaped}\\*\\*\\s*$`, 'im'),
    new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, 'im'),
    new RegExp(`\\*\\*\\*${escaped}\\*\\*\\*`, 'i'),
    new RegExp(`\\*\\*${escaped}\\*\\*`, 'i'),
    new RegExp(`(^|\\n|[.!?]\\s+)${escaped}(?=\\s+[A-ZÀ-Ü]|\\s*$)`, 'i')
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(body);
    if (!match) continue;
    const prefixLength = match[1] ? match[1].length : 0;
    return {
      index: match.index + prefixLength,
      length: match[0].length - prefixLength
    };
  }

  return null;
}

function splitEntryIntoLocations(entry, campaignId, used) {
  const details = extractDetails(entry.body);
  const imageData = extractImage(entry.body);
  const caption = extractCaption(entry.body);
  const fullBody = stripMetadata(entry.body);
  const markers = markerDefinitionsForEntry(entry, fullBody)
    .map((definition) => {
      const marker = findMarker(fullBody, definition.marker);
      return marker ? { ...definition, ...marker } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.index - right.index);

  const parentId = uniqueId(entry.title, used);
  const parentGroup = entry.group || '';
  const baseRecord = buildLocationRecord({
    id: parentId,
    title: entry.title,
    group: parentGroup,
    body: markers.length ? fullBody.slice(0, markers[0].index).trim() : fullBody,
    campaignId,
    used,
    type: guessType(entry.group, entry.title),
    image: imageData.image,
    imageAlt: imageData.imageAlt,
    caption,
    details,
    order: 0
  });

  if (!markers.length) return [baseRecord];

  const childGroup = entry.title;
  const children = markers.map((marker, index) => {
    const next = markers[index + 1];
    const start = marker.index + marker.length;
    const end = next ? next.index : fullBody.length;
    let body = fullBody.slice(start, end).trim().replace(/^[,.;:–—\s]+/, '');
    if (/^[a-zàèéìòù]/.test(body)) {
      body = `${marker.title} ${body}`;
    }
    return buildLocationRecord({
      title: marker.title,
      group: childGroup,
      body,
      campaignId,
      used,
      type: marker.type,
      parentId,
      parentTitle: entry.title,
      order: index + 1,
      details,
      tags: [entry.group, entry.title]
    });
  }).filter((location) => location.contentMarkdown || location.summary);

  return [baseRecord, ...children];
}

function buildLocations(entries, campaignId) {
  const used = new Set();
  return entries.flatMap((entry) => splitEntryIntoLocations(entry, campaignId, used));
}

function main() {
  const args = parseArgs(process.argv);
  const input = args.input;
  const campaignId = args.campaign || 'oltre-il-velo';
  const output = args.output || path.join('campaigns', campaignId, 'data', 'locations.json');

  if (!input) {
    console.error('Uso: node scripts/import_foundry_locations.js --input foundry_luoghi.md --campaign oltre-il-velo');
    process.exit(1);
  }

  const markdown = fs.readFileSync(input, 'utf8');
  const entries = parseFoundryLocations(markdown);
  const locations = buildLocations(entries, campaignId);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(locations, null, 2)}\n`, 'utf8');

  const groups = locations.reduce((acc, location) => {
    acc[location.group || 'Senza categoria'] = (acc[location.group || 'Senza categoria'] || 0) + 1;
    return acc;
  }, {});
  console.log(`Importati ${locations.length} luoghi in ${output}`);
  Object.entries(groups).sort(([left], [right]) => left.localeCompare(right, 'it')).forEach(([group, count]) => {
    console.log(`- ${group}: ${count}`);
  });
}

main();
