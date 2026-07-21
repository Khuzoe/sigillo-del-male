import fs from "node:fs/promises";
import path from "node:path";

const API_BASE = String(process.env.SIGILLO_API_URL || "https://sigillo-api.khuzoe.workers.dev").replace(/\/$/, "");
const CAMPAIGNS = ["cripta-di-sangue", "mago-folle", "oltre-il-velo"];

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/T/, "-").replace(/\..+$/, "");
}

async function readJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

const target = path.resolve("backups", `item-categories-before-canonical-${timestamp()}`);
await fs.mkdir(target, { recursive: true });
const manifest = { createdAt: new Date().toISOString(), apiBase: API_BASE, campaigns: [] };

for (const campaignId of CAMPAIGNS) {
  const itemsUrl = `${API_BASE}/api/data/items?campaign=${encodeURIComponent(campaignId)}&force=1`;
  const categoriesUrl = `${API_BASE}/api/item-categories?campaign=${encodeURIComponent(campaignId)}`;
  const [items, categories] = await Promise.all([readJson(itemsUrl), readJson(categoriesUrl)]);
  await Promise.all([
    fs.writeFile(path.join(target, `${campaignId}-items.json`), `${JSON.stringify(items, null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(target, `${campaignId}-item-categories.json`), `${JSON.stringify(categories, null, 2)}\n`, "utf8"),
  ]);
  manifest.campaigns.push({
    campaignId,
    itemVersion: Number(items?.version || 0),
    itemCount: Array.isArray(items?.data) ? items.data.length : 0,
    categoryRevision: Number(categories?.revision ?? categories?.data?.revision ?? 0),
    categoryCount: Array.isArray(categories?.data?.categories) ? categories.data.categories.length : 0,
  });
}

await fs.writeFile(path.join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ target, ...manifest }, null, 2));
