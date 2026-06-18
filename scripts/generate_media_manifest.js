const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CAMPAIGNS_DIR = path.join(ROOT, "campaigns");
const MEDIA_VARIANTS = ["idle", "hover", "token", "avatar"];

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function slugify(value, fallback = "media") {
  const slug = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function getCampaignIds() {
  if (!fs.existsSync(CAMPAIGNS_DIR)) return [];
  return fs.readdirSync(CAMPAIGNS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .filter((campaignId) => fs.existsSync(path.join(CAMPAIGNS_DIR, campaignId, "data")))
    .sort((a, b) => a.localeCompare(b));
}

function getCollectionData(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function getMediaSlug(entity, fallback) {
  return slugify(
    entity?.mediaSlug
      || entity?.media_slug
      || entity?.mediaId
      || entity?.media_id
      || entity?.folderSlug
      || entity?.folder_slug
      || entity?.id
      || entity?.name
      || fallback,
    fallback
  );
}

function buildCharacterPaths(campaignId, mediaSlug) {
  return Object.fromEntries(
    MEDIA_VARIANTS.map((variant) => [
      variant,
      `media/campaigns/${campaignId}/characters/${mediaSlug}/${variant}.webp`,
    ])
  );
}

function buildPlayerPaths(campaignId, mediaSlug) {
  return {
    idle: `media/campaigns/${campaignId}/players/${mediaSlug}-idle.webp`,
    hover: `media/campaigns/${campaignId}/players/${mediaSlug}-hover.webp`,
    token: `media/campaigns/${campaignId}/players/${mediaSlug}-token.webp`,
    avatar: `media/campaigns/${campaignId}/players/${mediaSlug}-avatar.webp`,
  };
}

function compactImages(images) {
  if (!images || typeof images !== "object" || Array.isArray(images)) return {};
  return Object.fromEntries(
    ["idle", "hover", "token", "avatar", "portrait"]
      .map((key) => [key, images[key]])
      .filter(([, value]) => typeof value === "string" && value.trim())
  );
}

function mapEntities(campaignId, collection, kind) {
  const builder = kind === "player" ? buildPlayerPaths : buildCharacterPaths;
  return Object.fromEntries(
    collection
      .filter((entity) => entity && typeof entity === "object" && entity.id)
      .map((entity) => {
        const mediaSlug = getMediaSlug(entity, kind === "player" ? "personaggio" : "npc");
        return [
          String(entity.id),
          {
            id: String(entity.id),
            name: entity.name || "",
            type: kind,
            mediaSlug,
            canonical: builder(campaignId, mediaSlug),
            current: compactImages(entity.images),
          },
        ];
      })
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function buildManifest(campaignId) {
  const dataDir = path.join(CAMPAIGNS_DIR, campaignId, "data");
  const characters = getCollectionData(readJsonIfExists(path.join(dataDir, "characters.json"), []));
  const players = getCollectionData(readJsonIfExists(path.join(dataDir, "players.json"), []));

  return {
    version: 1,
    collection: "media-manifest",
    campaignId,
    entities: {
      characters: mapEntities(campaignId, characters, "npc"),
      players: mapEntities(campaignId, players, "player"),
    },
  };
}

function main() {
  const campaignIds = process.argv.slice(2).length
    ? process.argv.slice(2)
    : getCampaignIds();

  campaignIds.forEach((campaignId) => {
    const dataDir = path.join(CAMPAIGNS_DIR, campaignId, "data");
    if (!fs.existsSync(dataDir)) return;
    const manifestPath = path.join(dataDir, "media-manifest.json");
    writeJson(manifestPath, buildManifest(campaignId));
    console.log(`Media manifest aggiornato: ${path.relative(ROOT, manifestPath).replace(/\\/g, "/")}`);
  });
}

main();
