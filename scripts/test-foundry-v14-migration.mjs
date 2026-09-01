import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const moduleRoot = path.join(root, "module");
const mainPath = path.join(moduleRoot, "scripts", "main.js");
const gatewayPath = path.join(moduleRoot, "scripts", "services", "worker-gateway.js");
const syncPolicyPath = path.join(moduleRoot, "scripts", "services", "sync-policy.js");
const workerPath = path.join(root, "workers", "main-worker", "src", "index.js");
const campaignItemsPath = path.join(root, "workers", "main-worker", "src", "campaign-items.js");
const layoutPath = path.join(root, "assets", "js", "layout.js");
const skillTreePath = path.join(root, "assets", "js", "shared", "character-skill-tree.js");

const manifest = JSON.parse(fs.readFileSync(path.join(moduleRoot, "module.json"), "utf8"));
const mainSource = fs.readFileSync(mainPath, "utf8");
const gatewaySource = fs.readFileSync(gatewayPath, "utf8");
const workerSource = fs.readFileSync(workerPath, "utf8");
const campaignItemsSource = fs.readFileSync(campaignItemsPath, "utf8");
const layoutSource = fs.readFileSync(layoutPath, "utf8");
const skillTreeSource = fs.readFileSync(skillTreePath, "utf8");

assert.equal(manifest.id, "cripta-wiki-sync", "L'ID interno resta stabile per conservare impostazioni e flag esistenti.");
assert.equal(manifest.title, "Khuzoe Wiki Sync");
assert.equal(manifest.version, "0.9.2");
assert.equal(manifest.compatibility.minimum, "14");
assert.equal(manifest.compatibility.verified, "14");
assert.equal(manifest.relationships.systems[0].id, "dnd5e");
assert.equal(manifest.relationships.systems[0].compatibility.minimum, "5.3.0");

assert.doesNotMatch(mainSource, /extends\s+(?:Application|FormApplication)\b/);
assert.doesNotMatch(mainSource, /\bnew\s+Dialog\b|Dialog\.confirm\s*\(/);
assert.doesNotMatch(mainSource, /system\.(?:actionType|attackBonus)\s*=/);
assert.match(mainSource, /getHeaderControlsActorSheetV2/);
assert.match(mainSource, /renderActorSheetV2/);
assert.match(mainSource, /activities:\s*buildWikiAbilityActivities/);
assert.match(mainSource, /type:\s*"attack"/);
assert.match(mainSource, /type:\s*"save"/);
assert.match(mainSource, /type:\s*"utility"/);
assert.doesNotMatch(mainSource, /[?&](?:token|access_token)=/i);

const allModuleScripts = fs.readdirSync(path.join(moduleRoot, "scripts"), { recursive: true })
    .filter((entry) => String(entry).endsWith(".js"))
    .map((entry) => path.join(moduleRoot, "scripts", entry));
for (const file of allModuleScripts) {
    const source = fs.readFileSync(file, "utf8");
    if (path.resolve(file) === path.resolve(gatewayPath)) continue;
    assert.doesNotMatch(source, /globalThis\.fetch\s*\(|(?<!policy)\bfetch\s*\(/, `Fetch non mediata: ${file}`);
}
assert.match(gatewaySource, /X-Khuzoe-Sync-Contract/);
assert.match(gatewaySource, /X-Khuzoe-Foundry-Generation/);
assert.match(gatewaySource, /MANAGED_ACTOR_ACK_PATH/);
assert.match(gatewaySource, /MANAGED_ACTOR_DOCUMENT_PATH/);
assert.match(mainSource, /runAutomaticLightSyncFromWorkerStatus[\s\S]+?if \(!canApplyRemoteChanges\(\)\) return false;/);
assert.match(mainSource, /pullManagedActorVariants\(\{ forceIndex: true, pullCommands: true \}\)/);

let syncMode = "diagnostic";
const nativeCalls = [];
globalThis.location = { href: "http://localhost:30000/game" };
globalThis.game = {
    release: { generation: 14 },
    version: "14.367",
    settings: { get: () => syncMode },
    modules: new Map([["cripta-wiki-sync", { version: manifest.version }]]),
    system: { id: "dnd5e", version: "5.3.3" }
};
globalThis.fetch = async (input, init = {}) => {
    nativeCalls.push({ input, init, headers: new Headers(init.headers || {}) });
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
};

const gateway = await import(`${pathToFileURL(gatewayPath).href}?test=${Date.now()}`);
await gateway.policyFetch("https://sigillo-api.khuzoe.workers.dev/api/ping");
assert.equal(nativeCalls.at(-1).headers.has("X-Khuzoe-Sync-Contract"), false, "Le letture pubbliche non causano preflight superflui.");
await assert.rejects(
    gateway.policyFetch("https://sigillo-api.khuzoe.workers.dev/api/inventory", { method: "POST" }),
    (error) => error?.code === "KHUZOE_SYNC_POLICY_BLOCKED"
);

syncMode = "pull";
await gateway.policyFetch("https://sigillo-api.khuzoe.workers.dev/auth/device/login", { method: "POST" });
assert.equal(nativeCalls.at(-1).headers.get("X-Khuzoe-Sync-Contract"), "1");
assert.equal(nativeCalls.at(-1).headers.get("X-Khuzoe-Foundry-Generation"), "14");
await gateway.policyFetch("https://sigillo-api.khuzoe.workers.dev/api/managed-actor-commands/world-v14/ack?campaign=test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ results: [{ id: "command-1", status: "applied" }] })
});
assert.equal(nativeCalls.at(-1).headers.get("X-Khuzoe-Sync-Contract"), "1", "Pull deve poter confermare soltanto i comandi applicati.");
await assert.rejects(
    gateway.policyFetch("https://sigillo-api.khuzoe.workers.dev/api/managed-actors/world-v14/actor-1?campaign=test", { method: "POST" }),
    (error) => error?.code === "KHUZOE_SYNC_POLICY_BLOCKED"
);
await gateway.policyFetch("https://sigillo-api.khuzoe.workers.dev/api/managed-actors/world-v14/actor-1?campaign=test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actorId: "actor-1" }),
    khuzoeSyncIntent: "managed-actor-command-reconciliation"
});
assert.equal(nativeCalls.at(-1).headers.get("X-Khuzoe-Sync-Contract"), "1");
assert.equal(Object.hasOwn(nativeCalls.at(-1).init, "khuzoeSyncIntent"), false, "L'intento interno non deve essere inviato sulla rete.");
await assert.rejects(
    gateway.policyFetch("https://sigillo-api.khuzoe.workers.dev/api/inventory", { method: "POST" }),
    (error) => error?.code === "KHUZOE_SYNC_POLICY_BLOCKED"
);
await assert.rejects(
    gateway.policyFetch("https://sigillo-api.khuzoe.workers.dev/api/managed-actor-commands/world-v14/profile", {
        method: "POST",
        khuzoeSyncIntent: "managed-actor-command-reconciliation"
    }),
    (error) => error?.code === "KHUZOE_SYNC_POLICY_BLOCKED"
);

const syncPolicy = await import(`${pathToFileURL(syncPolicyPath).href}?test=${Date.now()}`);
assert.equal(syncPolicy.canStartLiveSync(), true, "Pull deve mantenere aperto il canale live sito → Foundry.");

syncMode = "push";
assert.equal(syncPolicy.canStartLiveSync(), false, "Push non deve aprire un canale di ricezione dal sito.");
await gateway.policyFetch("https://sigillo-api.khuzoe.workers.dev/api/inventory", {
    method: "POST",
    headers: { "X-Cripta-Inventory-Secret": "test" }
});
assert.equal(nativeCalls.at(-1).headers.get("X-Khuzoe-Sync-Contract"), "1");

syncMode = "bidirectional";
assert.equal(syncPolicy.canStartLiveSync(), true);

const activeEffectApi = await import(`${pathToFileURL(path.join(moduleRoot, "scripts", "services", "foundry-v14.js")).href}?test=${Date.now()}`);
const normalizedEffect = activeEffectApi.normalizeActiveEffectSourceV14({
    name: "Test",
    icon: "icons/svg/aura.svg",
    changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "1", priority: 20 }],
    flags: { dae: { showIcon: true } }
});
assert.equal(normalizedEffect.img, "icons/svg/aura.svg");
assert.equal(normalizedEffect.icon, undefined);
assert.equal(normalizedEffect.changes, undefined);
assert.equal(normalizedEffect.system.changes[0].type, "add");
assert.equal(normalizedEffect.system.changes[0].phase, "initial");
assert.equal(normalizedEffect.system.changes[0].priority, 20);

assert.match(workerSource, /if\s*\(!contract\)\s*\{[\s\S]*?CONTRACT_UNSUPPORTED/);
assert.match(workerSource, /generation\s*>=\s*14/);
assert.match(workerSource, /Foundry sync is not configured/);
assert.match(workerSource, /function publicMediaCorsHeaders\(\)[\s\S]+?"Access-Control-Allow-Origin": "\*"/);
const restrictedCorsBlock = workerSource.match(/function corsHeadersFor\([\s\S]+?(?=\nfunction isPublicMediaReadRequest)/)?.[0] || "";
assert.doesNotMatch(restrictedCorsBlock, /Access-Control-Allow-Origin["']?\s*:\s*["']\*["']/, "Le API devono conservare la allowlist CORS.");
assert.doesNotMatch(workerSource, /searchParams\.get\(["']token["']\)/);
assert.match(workerSource, /X-Khuzoe-Sync-Contract/);
assert.match(campaignItemsSource, /if\s*\(!contract\)/);

assert.doesNotMatch(layoutSource, /postMessage\([^)]*,\s*["']\*["']/s);
assert.doesNotMatch(skillTreeSource, /postMessage\([^)]*,\s*["']\*["']/s);
assert.doesNotMatch(layoutSource, /consumeEmbeddedTokenFromQuery/);
assert.match(layoutSource, /embeddedParentOrigin/);

const syncContract = {
    name: "khuzoe-wiki-sync",
    version: 1,
    module: { id: "cripta-wiki-sync", version: manifest.version },
    foundry: { generation: 14, version: "14.367" },
    system: { id: "dnd5e", version: "5.3.3" }
};
const kvWrites = [];
const workerEnv = {
    INVENTORY_SYNC_SECRET: "test-secret",
    SIGILLO_KV: {
        async get() { return null; },
        async put(key, value) { kvWrites.push({ key, value }); }
    }
};
const worker = (await import(`${pathToFileURL(workerPath).href}?test=${Date.now()}`)).default;
const foundryHeaders = {
    Origin: "http://localhost:30000",
    "Content-Type": "application/json",
    "X-Cripta-Inventory-Secret": "test-secret",
    "X-Khuzoe-Sync-Contract": "1",
    "X-Khuzoe-Foundry-Generation": "14"
};

const legacyInventory = await worker.fetch(new Request("https://worker.test/api/inventory?campaign=test", {
    method: "POST",
    headers: foundryHeaders,
    body: JSON.stringify({ actors: [] })
}), workerEnv, {});
assert.equal(legacyInventory.status, 426);
assert.equal(kvWrites.length, 0, "Un payload Foundry senza contratto non deve scrivere KV.");

const validInventory = await worker.fetch(new Request("https://worker.test/api/inventory?campaign=test", {
    method: "POST",
    headers: foundryHeaders,
    body: JSON.stringify({ schemaVersion: 3, contract: syncContract, actors: [], companions: [] })
}), workerEnv, {});
assert.equal(validInventory.status, 200);
assert.equal(kvWrites.length, 1, "Lo snapshot valido aggiorna la chiave canonica della campagna.");

const missingSecretWrites = [];
const missingSecretResponse = await worker.fetch(new Request("https://worker.test/api/inventory?campaign=test", {
    method: "POST",
    headers: { Origin: "http://localhost:30000", "Content-Type": "application/json" },
    body: JSON.stringify({ schemaVersion: 3, contract: syncContract, actors: [], companions: [] })
}), {
    SIGILLO_KV: {
        async get() { return null; },
        async put(key) { missingSecretWrites.push(key); }
    }
}, {});
assert.equal(missingSecretResponse.status, 503);
assert.equal(missingSecretWrites.length, 0, "Un secret non configurato deve fallire senza scritture.");

const rejectedPreflight = await worker.fetch(new Request("https://worker.test/api/inventory", {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example" }
}), workerEnv, {});
assert.equal(rejectedPreflight.status, 403);
assert.equal(rejectedPreflight.headers.get("Access-Control-Allow-Origin"), null);

const publicMediaEnv = {
    MEDIA_BUCKET: {
        async get(key) {
            if (key !== "campaigns/test/items/token.webp") return null;
            return {
                body: "webp-data",
                size: 9,
                httpEtag: '"media-etag"',
                writeHttpMetadata(headers) { headers.set("Content-Type", "image/webp"); }
            };
        }
    }
};
const publicMediaResponse = await worker.fetch(new Request("https://worker.test/media/campaigns/test/items/token.webp", {
    headers: { Origin: "http://151.30.197.16:30000" }
}), publicMediaEnv, {});
assert.equal(publicMediaResponse.status, 200);
assert.equal(publicMediaResponse.headers.get("Access-Control-Allow-Origin"), "*", "Le texture pubbliche R2 devono essere caricabili da un Foundry remoto.");
assert.equal(publicMediaResponse.headers.get("Cross-Origin-Resource-Policy"), "cross-origin");

const publicMediaPreflight = await worker.fetch(new Request("https://worker.test/media/campaigns/test/items/token.webp", {
    method: "OPTIONS",
    headers: {
        Origin: "http://151.30.197.16:30000",
        "Access-Control-Request-Method": "GET"
    }
}), publicMediaEnv, {});
assert.equal(publicMediaPreflight.status, 200);
assert.equal(publicMediaPreflight.headers.get("Access-Control-Allow-Origin"), "*");

const protectedUploadPreflight = await worker.fetch(new Request("https://worker.test/media/upload", {
    method: "OPTIONS",
    headers: {
        Origin: "http://151.30.197.16:30000",
        "Access-Control-Request-Method": "POST"
    }
}), publicMediaEnv, {});
assert.equal(protectedUploadPreflight.status, 403, "L'upload media deve restare protetto dalla allowlist CORS.");

const { handleCampaignItemFoundrySync } = await import(`${pathToFileURL(campaignItemsPath).href}?test=${Date.now()}`);
const itemStore = new Map();
const itemEnv = {
    INVENTORY_SYNC_SECRET: "test-secret",
    SIGILLO_KV: {
        async get(key) { return itemStore.get(key) ?? null; },
        async put(key, value) { itemStore.set(key, String(value)); }
    }
};
const itemBody = {
    campaignId: "test",
    worldId: "world-v14",
    seedData: [{ id: "test-item", name: "Oggetto test" }],
    items: [{
        campaignItemId: "test-item",
        document: {
            itemId: "foundry-item",
            uuid: "Item.foundry-item",
            folderPath: "Test",
            document: { name: "Oggetto test", type: "loot", img: "", system: {}, effects: [], flags: {} }
        }
    }]
};
const legacyItemResponse = await handleCampaignItemFoundrySync(new Request("https://worker.test/api/campaign-items/foundry-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Cripta-Inventory-Secret": "test-secret" },
    body: JSON.stringify(itemBody)
}), "test", itemEnv, {});
assert.equal(legacyItemResponse.status, 426);
assert.equal(itemStore.size, 0);

const validItemResponse = await handleCampaignItemFoundrySync(new Request("https://worker.test/api/campaign-items/foundry-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Cripta-Inventory-Secret": "test-secret" },
    body: JSON.stringify({ ...itemBody, contract: syncContract })
}), "test", itemEnv, {});
assert.equal(validItemResponse.status, 200);
assert.equal(itemStore.size, 1);

console.log("Foundry v14 migration: manifest, UI, policy, contract, Active Effects and iframe security passed.");
