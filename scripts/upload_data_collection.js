const fs = require('fs');

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

async function main() {
  const args = parseArgs(process.argv);
  const collection = String(args.collection || '').trim();
  const campaign = String(args.campaign || 'oltre-il-velo').trim();
  const input = String(args.input || '').trim();
  const apiBase = String(args.api || 'https://sigillo-api.khuzoe.workers.dev').replace(/\/+$/, '');
  const token = String(args.token || process.env.SIGILLO_TOKEN || '').trim();

  if (!collection || !input) {
    console.error('Uso: node scripts/upload_data_collection.js --collection locations --campaign oltre-il-velo --input campaigns/oltre-il-velo/data/locations.json');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(input, 'utf8'));
  const count = Array.isArray(data) ? data.length : 1;
  if (args['dry-run']) {
    console.log(`DRY RUN: ${collection} / ${campaign} da ${input} (${count} record)`);
    return;
  }

  if (!token) {
    console.error('Token mancante. Passa --token oppure imposta SIGILLO_TOKEN.');
    process.exit(1);
  }

  const url = new URL(`${apiBase}/api/data/${collection}`);
  url.searchParams.set('campaign', campaign);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ data })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }

  console.log(`Pubblicata collection ${collection} / ${campaign}: ${count} record, versione ${payload.version || 'n/d'}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
