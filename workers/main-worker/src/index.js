import { discordBotPreferencesKey, handleDiscordBotDmNotifications, normalizeDiscordBotPreferences, sendDiscordBotChannelCard } from "./discord-bot/notifications.js";
import { handleCampaignItemFoundrySync, normalizeCampaignItemsForSiteSave } from "./campaign-items.js";
export { FoundrySyncHub } from "./foundry-sync-hub.js";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleSessionStartNotifications(env));
    ctx.waitUntil(handleDiscordBotDmNotifications(event, env));
  },

  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const corsHeaders = corsHeadersFor(request);
      const queryCampaignId = getCampaignIdFromUrl(url);

      // Preflight CORS
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
      }

      if (url.pathname === "/media/upload" && request.method === "POST") {
        return handleMediaUpload(request, env, corsHeaders);
      }

      if (url.pathname === "/media/copy-folder" && request.method === "POST") {
        return handleMediaCopyFolder(request, env, corsHeaders);
      }

      if (url.pathname.startsWith("/media/") && (request.method === "GET" || request.method === "HEAD")) {
        return handleMediaGet(request, env, corsHeaders);
      }

      if (url.pathname === "/api/foundry/asset-snapshot" && request.method === "POST") {
        return handleFoundryAssetSnapshot(request, queryCampaignId, env, corsHeaders);
      }

      if (url.pathname === "/api/campaign-items/foundry-sync" && request.method === "POST") {
        return handleCampaignItemFoundrySync(request, queryCampaignId, env, corsHeaders);
      }
      if (url.pathname === "/api/discord/share-card" && request.method === "POST") {
        return handleDiscordShareCard(request, queryCampaignId, env, corsHeaders);
      }
      if (url.pathname === "/api/npc-categories" && request.method === "GET") {
        return handleNpcCategoriesGet(request, queryCampaignId, env, corsHeaders);
      }
      if (url.pathname === "/api/npc-categories" && request.method === "POST") {
        return handleNpcCategoriesPost(request, queryCampaignId, env, corsHeaders);
      }

      if (url.pathname === "/api/missions" && request.method === "GET") {
        return handleMissionsGet(request, queryCampaignId, env, corsHeaders);
      }
      if (url.pathname === "/api/missions/bootstrap" && request.method === "POST") {
        return handleMissionsBootstrap(request, queryCampaignId, env, corsHeaders);
      }
      if (url.pathname === "/api/missions/upsert" && request.method === "POST") {
        return handleMissionUpsert(request, queryCampaignId, env, corsHeaders);
      }
      if (url.pathname === "/api/missions/progress" && request.method === "POST") {
        return handleMissionProgress(request, queryCampaignId, env, corsHeaders);
      }
      if (url.pathname === "/api/session-journal" && request.method === "GET") {
        return handleSessionJournalGet(request, queryCampaignId, env, corsHeaders);
      }
      if (url.pathname === "/api/session-journal/bootstrap" && request.method === "POST") {
        return handleSessionJournalBootstrap(request, queryCampaignId, env, corsHeaders);
      }
      if (url.pathname === "/api/session-journal/upsert" && request.method === "POST") {
        return handleSessionJournalUpsert(request, queryCampaignId, env, corsHeaders);
      }
      const managedActorRoute = matchManagedActorRoute(url.pathname);
      const managedActorLegacyAdoptRoute = matchManagedActorLegacyAdoptRoute(url.pathname);
      const managedActorProfileRoute = matchManagedActorProfileRoute(url.pathname);
      const managedActorProfileResolveRoute = matchManagedActorProfileResolveRoute(url.pathname);
      const managedActorRuntimeRoute = matchManagedActorRuntimeRoute(url.pathname);
      const managedActorRelationshipRoute = matchManagedActorRelationshipRoute(url.pathname);
      const managedActorCommandRoute = matchManagedActorCommandRoute(url.pathname);
      const managedActorCommandBatchRoute = matchManagedActorCommandBatchRoute(url.pathname);
      if (url.pathname === "/api/managed-actor-create-requests" && request.method === "POST") {
        return handleManagedActorCreateRequestEnqueue(request, queryCampaignId, env, corsHeaders, ctx);
      }
      if (managedActorCommandRoute && request.method === "POST") {
        return handleManagedActorCommandEnqueue(request, managedActorCommandRoute, queryCampaignId, env, corsHeaders, ctx);
      }
      if (managedActorCommandBatchRoute?.action === "ack" && request.method === "POST") {
        return handleManagedActorCommandAck(request, managedActorCommandBatchRoute, queryCampaignId, env, corsHeaders);
      }
      if (managedActorCommandBatchRoute?.action === "list" && request.method === "GET") {
        return handleManagedActorCommandList(request, managedActorCommandBatchRoute, queryCampaignId, env, corsHeaders);
      }
      if (managedActorProfileResolveRoute && request.method === "GET") {
        return handleManagedActorProfileResolveGet(request, managedActorProfileResolveRoute, queryCampaignId, env, corsHeaders);
      }
      if (managedActorProfileRoute && request.method === "GET") {
        return handleManagedActorProfileGet(request, managedActorProfileRoute, queryCampaignId, env, corsHeaders);
      }
      if (managedActorProfileRoute && request.method === "POST") {
        return handleManagedActorProfilePost(request, managedActorProfileRoute, queryCampaignId, env, corsHeaders, ctx);
      }
      if (managedActorRuntimeRoute && request.method === "POST") {
        return handleManagedActorRuntimePost(request, managedActorRuntimeRoute, queryCampaignId, env, corsHeaders);
      }
      if (managedActorRelationshipRoute && request.method === "POST") {
        return handleManagedActorRelationshipPost(request, managedActorRelationshipRoute, queryCampaignId, env, corsHeaders, ctx);
      }
      if (managedActorLegacyAdoptRoute && request.method === "POST") {
        return handleManagedActorLegacyAdopt(request, managedActorLegacyAdoptRoute, queryCampaignId, env, corsHeaders);
      }
      if (managedActorRoute && request.method === "POST") {
        return handleManagedActorPost(request, managedActorRoute, queryCampaignId, env, corsHeaders, ctx);
      }
      if (managedActorRoute && request.method === "GET") {
        return handleManagedActorGet(request, managedActorRoute, queryCampaignId, env, corsHeaders);
      }
      if (url.pathname === "/api/managed-actors" && request.method === "GET") {
        return handleManagedActorIndexGet(request, queryCampaignId, env, corsHeaders);
      }
      if (url.pathname === "/api/campaign/access" && request.method === "GET") {
        return handleCampaignAccessGet(request, queryCampaignId, env, corsHeaders);
      }

      if (url.pathname === "/api/asset-cleanup/dry-run" && request.method === "GET") {
        return handleAssetCleanupDryRun(request, queryCampaignId, env, corsHeaders);
      }

      if (url.pathname === "/api/asset-cleanup/apply" && request.method === "POST") {
        return handleAssetCleanupApply(request, queryCampaignId, env, corsHeaders);
      }

      if (url.pathname === "/auth/discord/foundry/start" && request.method === "GET") {
        if (!env.SIGILLO_KV) {
          return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
        }

        const bridgeState = randomState();
        await env.SIGILLO_KV.put(
          foundryAuthKey(bridgeState),
          JSON.stringify({
              status: "pending",
              campaignId: queryCampaignId,
              createdAt: new Date().toISOString(),
          }),
          { expirationTtl: 600 }
        );

        const origin = `${url.protocol}//${url.host}`;
        return json(
          {
            ok: true,
            state: bridgeState,
            authUrl: `${origin}/auth/discord/login?bridgeState=${encodeURIComponent(bridgeState)}&campaign=${encodeURIComponent(queryCampaignId)}`,
            pollUrl: `${origin}/auth/discord/foundry/poll?state=${encodeURIComponent(bridgeState)}`,
          },
          200,
          corsHeaders
        );
      }

      if (url.pathname === "/auth/discord/foundry/poll" && request.method === "GET") {
        if (!env.SIGILLO_KV) {
          return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
        }

        const bridgeState = sanitizeBridgeState(url.searchParams.get("state") || "");
        if (!bridgeState) {
          return json({ ok: false, error: "Missing or invalid state" }, 400, corsHeaders);
        }

        const raw = await env.SIGILLO_KV.get(foundryAuthKey(bridgeState));
        if (!raw) {
          return json({ ok: true, status: "missing" }, 200, corsHeaders);
        }

        const data = safeJsonParse(raw) || {};
        if (data.status === "complete" && data.token) {
          await env.SIGILLO_KV.delete(foundryAuthKey(bridgeState));
          return json(
            {
              ok: true,
              status: "complete",
              token: data.token,
              user: data.user || null,
            },
            200,
            corsHeaders
          );
        }

        return json({ ok: true, status: "pending" }, 200, corsHeaders);
      }

      // =========================
      // AUTH DISCORD - LOGIN
      // =========================
      if (url.pathname === "/auth/discord/login" && request.method === "GET") {
        const state = randomState();
        const bridgeState = sanitizeBridgeState(url.searchParams.get("bridgeState") || "");
        const campaignId = queryCampaignId;

        if (!env.DISCORD_CLIENT_ID) {
          return json({ ok: false, error: "Missing env.DISCORD_CLIENT_ID" }, 500, corsHeaders);
        }
        if (!env.DISCORD_REDIRECT_URI) {
          return json({ ok: false, error: "Missing env.DISCORD_REDIRECT_URI" }, 500, corsHeaders);
        }

        const authorize = new URL("https://discord.com/api/oauth2/authorize");
        authorize.searchParams.set("client_id", String(env.DISCORD_CLIENT_ID));
        authorize.searchParams.set("redirect_uri", String(env.DISCORD_REDIRECT_URI));
        authorize.searchParams.set("response_type", "code");
        authorize.searchParams.set("scope", "identify");
        authorize.searchParams.set("state", state);

        const headers = new Headers();
        headers.set("Location", authorize.toString());
        headers.append(
          "Set-Cookie",
          `oauth_state=${encodeURIComponent(state)}; Path=/; Max-Age=300; HttpOnly; Secure; SameSite=Lax`
        );
        if (bridgeState) {
          headers.append(
            "Set-Cookie",
            `oauth_bridge_state=${encodeURIComponent(bridgeState)}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`
          );
        }
        headers.append(
          "Set-Cookie",
          `oauth_campaign=${encodeURIComponent(campaignId)}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`
        );

        return new Response(null, {
          status: 302,
          headers,
        });
      }

      // =========================
      // AUTH DISCORD - CALLBACK
      // =========================
      if (url.pathname === "/auth/discord/callback" && request.method === "GET") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        if (!code || !state) {
          return json({ ok: false, error: "Missing code/state" }, 400, corsHeaders);
        }

        if (!env.DISCORD_CLIENT_ID) {
          return json({ ok: false, error: "Missing env.DISCORD_CLIENT_ID" }, 500, corsHeaders);
        }
        if (!env.DISCORD_CLIENT_SECRET) {
          return json({ ok: false, error: "Missing env.DISCORD_CLIENT_SECRET" }, 500, corsHeaders);
        }
        if (!env.DISCORD_REDIRECT_URI) {
          return json({ ok: false, error: "Missing env.DISCORD_REDIRECT_URI" }, 500, corsHeaders);
        }
        if (!env.FE_URL) {
          return json({ ok: false, error: "Missing env.FE_URL" }, 500, corsHeaders);
        }
        if (!env.JWT_SECRET) {
          return json({ ok: false, error: "Missing env.JWT_SECRET" }, 500, corsHeaders);
        }

        const cookies = parseCookies(request);
        if (!cookies.oauth_state || cookies.oauth_state !== state) {
          return json({ ok: false, error: "Invalid state" }, 400, corsHeaders);
        }
        const bridgeState = sanitizeBridgeState(cookies.oauth_bridge_state || "");
        const campaignId = sanitizeCampaignId(cookies.oauth_campaign || url.searchParams.get("campaign") || "");

        // Scambio code -> access token
        const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: String(env.DISCORD_CLIENT_ID),
            client_secret: String(env.DISCORD_CLIENT_SECRET),
            grant_type: "authorization_code",
            code,
            redirect_uri: String(env.DISCORD_REDIRECT_URI),
          }),
        });

        if (!tokenRes.ok) {
          const errText = await tokenRes.text();
          return json(
            { ok: false, error: "Token exchange failed", details: errText },
            400,
            corsHeaders
          );
        }

        const tokenJson = await tokenRes.json();

        // Prendi utente Discord
        const meRes = await fetch("https://discord.com/api/users/@me", {
          headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        });

        if (!meRes.ok) {
          const errText = await meRes.text();
          return json(
            { ok: false, error: "Failed to fetch user", details: errText },
            400,
            corsHeaders
          );
        }

        const me = await meRes.json();

        const linkedAccount = findDeviceLoginAccountByDiscordId(me.id, env);
        const accountId = linkedAccount?.accountId || sanitizeAccountId(me.id);
        const displayName = linkedAccount?.globalName || me.global_name || me.username || accountId;

        // JWT semplice per il frontend (7 giorni)
        const now = Math.floor(Date.now() / 1000);
        const jwt = await makeJWT(String(env.JWT_SECRET), {
          sub: accountId,
          id: accountId,
          accountId,
          discordId: me.id,
          username: linkedAccount?.username || accountId,
          global_name: displayName,
          discriminator: me.discriminator,
          avatar: me.avatar,
          authProvider: "discord",
          iat: now,
          exp: now + 7 * 24 * 60 * 60,
        });

        let redirectUrl;
        if (bridgeState && env.SIGILLO_KV) {
          await env.SIGILLO_KV.put(
            foundryAuthKey(bridgeState),
            JSON.stringify({
              status: "complete",
              token: jwt,
              user: {
                id: accountId,
                accountId,
                discordId: me.id,
                username: linkedAccount?.username || accountId,
                global_name: displayName,
                authProvider: "discord",
              },
              completedAt: new Date().toISOString(),
            }),
            { expirationTtl: 600 }
          );

          const completeUrl = new URL(String(env.FE_URL));
          applyCampaignToFrontendUrl(completeUrl, campaignId);
          completeUrl.searchParams.set("foundryAuth", "complete");
          redirectUrl = completeUrl.toString();
        } else {
          const fe = new URL(String(env.FE_URL));
          applyCampaignToFrontendUrl(fe, campaignId);
          fe.hash = `token=${encodeURIComponent(jwt)}`;
          redirectUrl = fe.toString();
        }

        const headers = new Headers();
        headers.set("Location", redirectUrl);
        headers.append(
          "Set-Cookie",
          "oauth_state=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"
        );
        headers.append(
          "Set-Cookie",
          "oauth_bridge_state=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"
        );
        headers.append(
          "Set-Cookie",
          "oauth_campaign=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"
        );

        return new Response(null, {
          status: 302,
          headers,
        });
      }

      // =========================
      // AUTH DISCORD - VERIFY JWT
      // =========================
      if (url.pathname === "/auth/discord/verify" && request.method === "GET") {
        let token = "";
        const auth = request.headers.get("Authorization");

        if (auth && auth.toLowerCase().startsWith("bearer ")) {
          token = auth.slice(7).trim();
        } else {
          token = url.searchParams.get("token") || "";
        }

        if (!token) {
          return new Response(JSON.stringify({ ok: true, user: null }), {
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }

        if (!env.JWT_SECRET) {
          return new Response(JSON.stringify({ ok: false, error: "Missing env.JWT_SECRET" }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
        }

        const payload = await verifyJWT(String(env.JWT_SECRET), token);

        return new Response(JSON.stringify({ ok: true, user: payload || null }), {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      // =========================
      // AUTH DEVICE CODE - LOGIN
      // =========================
      if (url.pathname === "/auth/device/login" && request.method === "POST") {
        if (!env.JWT_SECRET) {
          return json({ ok: false, error: "Missing env.JWT_SECRET" }, 500, corsHeaders);
        }

        const body = await request.json().catch(() => ({}));
        const campaignId = getCampaignIdFromBodyOrUrl(body, url);
        const code = normalizeDeviceCode(body?.code || "");
        const account = findDeviceLoginAccount(code, env);
        if (!account) {
          return json({ ok: false, error: "Codice accesso non valido" }, 401, corsHeaders);
        }

        const now = Math.floor(Date.now() / 1000);
        const jwt = await makeJWT(String(env.JWT_SECRET), {
          sub: account.accountId,
          id: account.accountId,
          accountId: account.accountId,
          discordId: account.discordId || "",
          username: account.username,
          global_name: account.globalName || account.username,
          authProvider: "device",
          campaignId,
          iat: now,
          exp: now + 90 * 24 * 60 * 60,
        });

        return json(
          {
            ok: true,
            token: jwt,
            user: {
              id: account.accountId,
              accountId: account.accountId,
              discordId: account.discordId || "",
              username: account.username,
              global_name: account.globalName || account.username,
              authProvider: "device",
            },
          },
          200,
          corsHeaders
        );
      }

      // =========================
      // DEBUG ENV
      // =========================
      if (url.pathname === "/auth/debug" && request.method === "GET") {
        return new Response(
          JSON.stringify({
            ok: true,
            has: {
              DISCORD_CLIENT_ID: !!env.DISCORD_CLIENT_ID,
              DISCORD_CLIENT_SECRET: !!env.DISCORD_CLIENT_SECRET,
              DISCORD_REDIRECT_URI: !!env.DISCORD_REDIRECT_URI,
              FE_URL: !!env.FE_URL,
              JWT_SECRET: !!env.JWT_SECRET,
              SIGILLO_KV: !!env.SIGILLO_KV,
              NOTES_ADMIN_DISCORD_IDS: !!env.NOTES_ADMIN_DISCORD_IDS,
              DEVICE_LOGIN_CODES: !!(env.DEVICE_LOGIN_CODES_SECRET || env.DEVICE_LOGIN_CODES),
            },
            values: {
              DISCORD_REDIRECT_URI: env.DISCORD_REDIRECT_URI || null,
              FE_URL: env.FE_URL || null,
              workerOrigin: new URL(request.url).origin,
            },
          }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // =========================
      // TEST ENDPOINT
      // =========================
      if (url.pathname === "/api/ping" && request.method === "GET") {
        return new Response(JSON.stringify({ ok: true, message: "Worker attivo" }), {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      if (url.pathname === "/api/version" && request.method === "GET") {
        return handleVersionGet(env, corsHeaders);
      }

      if (url.pathname === "/api/foundry/live-ticket" && request.method === "POST") {
        return handleFoundryLiveTicket(request, queryCampaignId, env, corsHeaders);
      }

      if (url.pathname === "/api/foundry/live/status" && request.method === "GET") {
        return handleFoundryLiveStatus(request, queryCampaignId, env, corsHeaders);
      }

      if (url.pathname === "/api/foundry/live" && request.method === "GET") {
        return handleFoundryLiveConnect(request, queryCampaignId, env, corsHeaders);
      }

      if (url.pathname === "/api/media/check" && (request.method === "GET" || request.method === "POST")) {
        return handleMediaCheck(request, env, corsHeaders);
      }

      if (url.pathname === "/api/sync/bootstrap" && request.method === "GET") {
        return handleSyncBootstrapGet(request, queryCampaignId, env, corsHeaders);
      }

      if (url.pathname === "/api/sync/status" && request.method === "GET") {
        return handleSyncStatusGet(request, queryCampaignId, env, corsHeaders);
      }

      if (url.pathname === "/api/sync/changes" && request.method === "GET") {
        return handleSyncChangesGet(request, queryCampaignId, env, corsHeaders);
      }

      // ======================================================
      // BOOTSTRAP PAGES
      // GET /api/bootstrap/character
      // ======================================================
      if (url.pathname === "/api/bootstrap/character" && request.method === "GET") {
        return handleCharacterBootstrapGet(request, queryCampaignId, env, corsHeaders);
      }

      // ======================================================
      // LIVE DATA OVERRIDES
      // GET /api/data/items | /api/data/bestiary | /api/data/characters | /api/data/monster-abilities
      // POST /api/data/items | /api/data/bestiary | /api/data/characters | /api/data/monster-abilities
      // ======================================================
      if (url.pathname.startsWith("/api/data/")) {
        const collection = sanitizeDataCollection(url.pathname.replace(/^\/api\/data\//, ""));
        if (!collection) {
          return json({ ok: false, error: "Invalid data collection" }, 400, corsHeaders);
        }

        if (request.method === "GET") {
          return handleDataCollectionGet(collection, queryCampaignId, env, corsHeaders);
        }

        if (request.method === "POST") {
          return handleDataCollectionPost(request, collection, queryCampaignId, env, corsHeaders, ctx);
        }
      }

      // ======================================================
      // INVENTORY / CHARACTER SNAPSHOT
      // POST protetto se INVENTORY_SYNC_SECRET e configurato.
      // ======================================================

      // POST /api/inventory -> salva snapshot
      if (url.pathname === "/api/inventory" && request.method === "POST") {
        const inventoryAuth = requireInventorySyncSecret(request, env, corsHeaders);
        if (inventoryAuth instanceof Response) return inventoryAuth;

        const ct = request.headers.get("Content-Type") || "";
        let data;

        try {
          if (ct.includes("application/json")) {
            data = await request.json();
          } else {
            const text = await request.text();
            data = text ? JSON.parse(text) : {};
          }
        } catch (e) {
          return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
        }

        if (!env.SIGILLO_KV) {
          return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
        }

        const campaignId = getCampaignIdFromBodyOrUrl(data, url);
        const normalizedInventory = normalizeInventorySnapshot(data);
        if (!normalizedInventory.ok) {
          return json({ ok: false, error: normalizedInventory.error }, 400, corsHeaders);
        }

        const snapshot = normalizedInventory.data;
        snapshot.campaignId = campaignId;
        await putCampaignKv(env.SIGILLO_KV, inventoryKey(campaignId), "inventory/latest", JSON.stringify(snapshot));
        let assetRegistry = null;
        if (Array.isArray(data?.assetRegistry?.assets)) {
          try {
            assetRegistry = await saveFoundryAssetSnapshotDocument({
              campaignId,
              assets: data.assetRegistry.assets,
            }, campaignId, env);
          } catch (error) {
            assetRegistry = {
              ok: false,
              error: error?.message || "Asset registry update failed",
            };
          }
        }

        return json({
          ok: true,
          saved: true,
          savedAt: snapshot.savedAt,
          schemaVersion: snapshot.schemaVersion,
          actorCount: snapshot.actors.length,
          companionCount: snapshot.companions?.length || 0,
          assetRegistry
        }, 200, corsHeaders);
      }

      // GET /api/inventory -> legge snapshot
      if (url.pathname === "/api/inventory" && request.method === "GET") {
        if (!env.SIGILLO_KV) {
          return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
        }

        const campaignId = queryCampaignId;
        const data = await getCampaignKv(env.SIGILLO_KV, inventoryKey(campaignId), "inventory/latest");
        return new Response(data ?? "{}", {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      // ======================================================
      // NOTES - GET
      // GET /api/notes?page=appunti
      // GET /api/notes?page=appunti&targetDiscordId=123456789
      //
      // Restituisce il merge tra:
      // - note personali: notes:user:<discordId>:<page>
      // - note condivise: notes:shared:<page>
      //
      // Un utente normale può leggere le proprie note personali + le condivise.
      // Un admin può leggere le note personali di targetDiscordId + le condivise.
      // ======================================================
      if (url.pathname === "/api/notes" && request.method === "GET") {
        if (!env.SIGILLO_KV) {
          return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
        }

        if (!env.JWT_SECRET) {
          return json({ ok: false, error: "Missing env.JWT_SECRET" }, 500, corsHeaders);
        }

        const user = await requireUser(request, env, corsHeaders);
        if (user instanceof Response) return user;

        const campaignId = queryCampaignId;
        const page = sanitizePageSlug(url.searchParams.get("page") || "");
        if (!page) {
          return json({ ok: false, error: "Missing or invalid query param: page" }, 400, corsHeaders);
        }

        const authenticatedDiscordId = getAuthenticatedAccountId(user, env);
        const targetDiscordId = String(
          url.searchParams.get("targetDiscordId") || authenticatedDiscordId
        ).trim();

        if (!sanitizeNoteOwnerId(targetDiscordId)) {
          return json({ ok: false, error: "Invalid targetDiscordId" }, 400, corsHeaders);
        }

        if (targetDiscordId !== authenticatedDiscordId && !isAuthenticatedAdmin(user, env)) {
          return json(
            {
              ok: false,
              error: "Forbidden: you are not allowed to read notes for this targetDiscordId",
              authenticatedUserId: authenticatedDiscordId,
              targetDiscordId,
            },
            403,
            corsHeaders
          );
        }

        const personalKey = noteUserKey(targetDiscordId, page, campaignId);
        const sharedKey = noteSharedKey(page, campaignId);
        const legacyPersonalKey = noteUserKey(targetDiscordId, page);
        const legacySharedKey = noteSharedKey(page);

        const [personalRaw, sharedRaw] = await Promise.all([
          getCampaignKv(env.SIGILLO_KV, personalKey, legacyPersonalKey),
          getCampaignKv(env.SIGILLO_KV, sharedKey, legacySharedKey),
        ]);

        const personalDoc = parseStoredNoteDocument(personalRaw);
        const sharedDoc = parseStoredNoteDocument(sharedRaw);
        const mergedDoc = mergeNoteDocuments(personalDoc, sharedDoc);

        return json(
          {
            ok: true,
            note: {
              page,
              campaignId,
              ownerDiscordId: targetDiscordId,
              content: JSON.stringify(mergedDoc),
              personalContent: JSON.stringify(personalDoc),
              sharedContent: JSON.stringify(sharedDoc),
              updatedAt: maxIsoDate(personalDoc.updatedAt, sharedDoc.updatedAt),
              storage: {
                personalKey,
                sharedKey,
              },
            },
          },
          200,
          corsHeaders
        );
      }

      // ======================================================
      // NOTES - POST
      // POST /api/notes
      // Body:
      // {
      //   "page": "appunti",
      //   "targetDiscordId": "123456789", // opzionale, solo admin se diverso dal proprio id
      //   "content": {
      //     "notes": [
      //       { "id": "a", "text": "privato" },
      //       { "id": "b", "text": "condiviso", "shared": true }
      //     ]
      //   }
      // }
      //
      // Salva separatamente:
      // - shared === true  -> notes:shared:<page>
      // - shared !== true  -> notes:user:<targetDiscordId>:<page>
      //
      // Regola permessi condivisi:
      // tutti possono creare e leggere note condivise,
      // ma solo l'autore può modificarle o rimuoverle.
      //
      // Se il client rimanda note condivise altrui nel payload,
      // il worker le preserva senza bloccare l'intero salvataggio.
      // ======================================================
      if (url.pathname === "/api/notes" && request.method === "POST") {
        if (!env.SIGILLO_KV) {
          return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
        }

        if (!env.JWT_SECRET) {
          return json({ ok: false, error: "Missing env.JWT_SECRET" }, 500, corsHeaders);
        }

        const user = await requireUser(request, env, corsHeaders);
        if (user instanceof Response) return user;

        let body;
        try {
          const ct = request.headers.get("Content-Type") || "";
          if (ct.includes("application/json")) {
            body = await request.json();
          } else {
            const text = await request.text();
            body = text ? JSON.parse(text) : {};
          }
        } catch {
          return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
        }

        const campaignId = getCampaignIdFromBodyOrUrl(body, url);
        const page = sanitizePageSlug(body?.page || "");
        if (!page) {
          return json({ ok: false, error: "Missing or invalid page" }, 400, corsHeaders);
        }

        const authenticatedDiscordId = getAuthenticatedAccountId(user, env);
        const authenticatedUsername = user.global_name || user.username || null;

        const targetDiscordId = String(body?.targetDiscordId || authenticatedDiscordId).trim();

        if (!sanitizeNoteOwnerId(targetDiscordId)) {
          return json({ ok: false, error: "Invalid targetDiscordId" }, 400, corsHeaders);
        }

        if (targetDiscordId !== authenticatedDiscordId && !isAuthenticatedAdmin(user, env)) {
          return json(
            {
              ok: false,
              error: "Forbidden: you are not allowed to write notes for this targetDiscordId",
              authenticatedUserId: authenticatedDiscordId,
              targetDiscordId,
            },
            403,
            corsHeaders
          );
        }

        const incomingDoc = normalizeIncomingNoteDocument(body?.content);
        const incomingTextSize = JSON.stringify(incomingDoc).length;

        // Limite prudenziale: 200 KB per richiesta.
        if (incomingTextSize > 200_000) {
          return json({ ok: false, error: "Note too large" }, 413, corsHeaders);
        }

        const personalKey = noteUserKey(targetDiscordId, page, campaignId);
        const sharedKey = noteSharedKey(page, campaignId);
        const legacyPersonalKey = noteUserKey(targetDiscordId, page);
        const legacySharedKey = noteSharedKey(page);

        const [existingPersonalRaw, existingSharedRaw] = await Promise.all([
          getCampaignKv(env.SIGILLO_KV, personalKey, legacyPersonalKey),
          getCampaignKv(env.SIGILLO_KV, sharedKey, legacySharedKey),
        ]);

        const existingPersonalDoc = parseStoredNoteDocument(existingPersonalRaw);
        const existingSharedDoc = parseStoredNoteDocument(existingSharedRaw);

        const split = splitIncomingNotes(incomingDoc, {
          authenticatedDiscordId,
          authenticatedUsername,
          targetDiscordId,
          existingSharedDoc,
        });

        if (split.error) {
          return json(split.error, split.status || 403, corsHeaders);
        }

        const now = new Date().toISOString();

        const nextPersonalDoc = {
          ...incomingDoc,
          notes: split.personalNotes,
          updatedAt: now,
          campaignId,
          ownerDiscordId: targetDiscordId,
          ownerUsername:
            targetDiscordId === authenticatedDiscordId
              ? authenticatedUsername
              : existingPersonalDoc.ownerUsername || null,
        };

        const nextSharedDoc = {
          ...existingSharedDoc,
          notes: split.sharedNotes,
          updatedAt: now,
          campaignId,
          ownerDiscordId: "shared",
        };

        await Promise.all([
          env.SIGILLO_KV.put(personalKey, JSON.stringify(nextPersonalDoc)),
          env.SIGILLO_KV.put(sharedKey, JSON.stringify(nextSharedDoc)),
        ]);

        const mergedDoc = mergeNoteDocuments(nextPersonalDoc, nextSharedDoc);

        return json(
          {
            ok: true,
            saved: true,
            note: {
              page,
              campaignId,
              ownerDiscordId: targetDiscordId,
              content: JSON.stringify(mergedDoc),
              updatedAt: now,
              counts: {
                personal: split.personalNotes.length,
                shared: split.sharedNotes.length,
              },
              storage: {
                personalKey,
                sharedKey,
              },
            },
          },
          200,
          corsHeaders
        );
      }

      // ======================================================
      // NOTES - DELETE
      // DELETE /api/notes?page=nome-pagina
      // Elimina gli appunti personali dell'utente autenticato
      // ======================================================
      if (url.pathname === "/api/notes" && request.method === "DELETE") {
        if (!env.SIGILLO_KV) {
          return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
        }

        if (!env.JWT_SECRET) {
          return json({ ok: false, error: "Missing env.JWT_SECRET" }, 500, corsHeaders);
        }

        const user = await requireUser(request, env, corsHeaders);
        if (user instanceof Response) return user;

        const campaignId = queryCampaignId;
        const page = sanitizePageSlug(url.searchParams.get("page") || "");
        if (!page) {
          return json({ ok: false, error: "Missing or invalid query param: page" }, 400, corsHeaders);
        }

        const key = noteUserKey(getAuthenticatedAccountId(user, env), page, campaignId);
        await env.SIGILLO_KV.delete(key);

        return json({ ok: true, deleted: true, page, key }, 200, corsHeaders);
      }

      // ======================================================
      // DISCORD BOT PREFERENCES - GET/POST
      // Preferenze DM del bot per utente e campagna.
      // ======================================================
      if (url.pathname === "/api/discord-bot/preferences" && request.method === "GET") {
        if (!env.SIGILLO_KV) {
          return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
        }

        if (!env.JWT_SECRET) {
          return json({ ok: false, error: "Missing env.JWT_SECRET" }, 500, corsHeaders);
        }

        const user = await requireUser(request, env, corsHeaders);
        if (user instanceof Response) return user;

        const campaignId = queryCampaignId;
        const accountId = getAuthenticatedAccountId(user, env);
        const discordId = getAuthenticatedDiscordId(user);
        if (!accountId) {
          return json({ ok: false, error: "Missing authenticated account id" }, 400, corsHeaders);
        }

        const raw = await env.SIGILLO_KV.get(discordBotPreferencesKey(campaignId, accountId));
        const preferences = normalizeDiscordBotPreferences({
          ...safeJsonParse(raw),
          campaignId,
          accountId,
          discordId,
        });

        return json({ ok: true, campaignId, accountId, preferences }, 200, corsHeaders);
      }

      if (url.pathname === "/api/discord-bot/preferences" && request.method === "POST") {
        if (!env.SIGILLO_KV) {
          return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
        }

        if (!env.JWT_SECRET) {
          return json({ ok: false, error: "Missing env.JWT_SECRET" }, 500, corsHeaders);
        }

        const user = await requireUser(request, env, corsHeaders);
        if (user instanceof Response) return user;

        let body;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
        }

        const campaignId = getCampaignIdFromBodyOrUrl(body, url);
        const accountId = getAuthenticatedAccountId(user, env);
        const discordId = getAuthenticatedDiscordId(user);
        if (!accountId) {
          return json({ ok: false, error: "Missing authenticated account id" }, 400, corsHeaders);
        }

        const key = discordBotPreferencesKey(campaignId, accountId);
        const existing = safeJsonParse(await env.SIGILLO_KV.get(key)) || {};
        const preferences = normalizeDiscordBotPreferences({
          ...existing,
          ...body,
          campaignId,
          accountId,
          discordId,
          updatedAt: new Date().toISOString(),
        });

        await env.SIGILLO_KV.put(key, JSON.stringify(preferences));
        return json({ ok: true, campaignId, accountId, preferences }, 200, corsHeaders);
      }
      // ======================================================
      // SESSION CURRENT - GET
      // GET /api/session/current
      // restituisce la prossima sessione attiva
      // ======================================================
      if (url.pathname === "/api/session/current" && request.method === "GET") {
        if (!env.SIGILLO_KV) {
          return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
        }

        const campaignId = queryCampaignId;
        const data = await getCampaignKv(env.SIGILLO_KV, sessionCurrentKey(campaignId), "session/current");

        if (!data) {
          return json({ ok: false, error: "Current session not found" }, 404, corsHeaders);
        }

        const session = safeJsonParse(data);
        if (!session || typeof session !== "object") {
          return json({ ok: false, error: "Stored session is invalid JSON" }, 500, corsHeaders);
        }

        return json(scrubSessionData(session), 200, corsHeaders);
      }

      // ======================================================
      // SESSION - GET
      // GET /api/session?number=21
      // ======================================================
      if (url.pathname === "/api/session" && request.method === "GET") {
        if (!env.SIGILLO_KV) {
          return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
        }

        const numberRaw = (url.searchParams.get("number") || "").trim();
        const campaignId = queryCampaignId;

        if (!numberRaw) {
          return json({ ok: false, error: "Missing query param: number" }, 400, corsHeaders);
        }

        if (!/^\d+$/.test(numberRaw)) {
          return json({ ok: false, error: "Invalid number: must be numeric" }, 400, corsHeaders);
        }

        const sessionNumber = Number(numberRaw);
        const key = sessionKey(campaignId, sessionNumber);
        const data = await getCampaignKv(env.SIGILLO_KV, key, `session/${sessionNumber}`);

        if (!data) {
          return json(
            { ok: false, error: "Session not found", number: sessionNumber },
            404,
            corsHeaders
          );
        }

        const session = safeJsonParse(data);
        if (!session || typeof session !== "object") {
          return json({ ok: false, error: "Stored session is invalid JSON" }, 500, corsHeaders);
        }

        return json(scrubSessionData(session), 200, corsHeaders);
      }

      // ======================================================
      // SESSION - POST (protetta con login Discord)
      // POST /api/session
      // salva l'intera sessione
      // ======================================================
      if (url.pathname === "/api/session" && request.method === "POST") {
        if (!env.SIGILLO_KV) {
          return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
        }

        if (!env.JWT_SECRET) {
          return json({ ok: false, error: "Missing env.JWT_SECRET" }, 500, corsHeaders);
        }

        const user = await requireUser(request, env, corsHeaders);
        if (user instanceof Response) return user;

        const ct = request.headers.get("Content-Type") || "";
        let body;

        try {
          if (ct.includes("application/json")) {
            body = await request.json();
          } else {
            const text = await request.text();
            body = text ? JSON.parse(text) : {};
          }
        } catch {
          return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
        }

        const campaignId = getCampaignIdFromBodyOrUrl(body, url);
        const number = body?.number;
        const dmAccountId = typeof body?.dmAccountId === "string" ? body.dmAccountId.trim() : "";
        const dmDiscordId = String(body?.dmDiscordId || "").trim();
        const pollManagerAccountIds = normalizeStringList(body?.pollManagerAccountIds || body?.sessionManagerAccountIds || []);
        const pollManagerDiscordIds = normalizeDiscordIdList(body?.pollManagerDiscordIds || body?.sessionManagerDiscordIds || []);
        const date = typeof body?.date === "string" ? body.date : "";
        const timeStart = typeof body?.timeStart === "string" ? body.timeStart : "";
        const timeEnd = typeof body?.timeEnd === "string" ? body.timeEnd : "";
        const isScheduled = body?.isScheduled;
        const campaignName = typeof body?.campaignName === "string" ? body.campaignName.trim() : "";
        const pollTitle = typeof body?.pollTitle === "string" ? body.pollTitle.trim() : "";
        const pollSubtitle = typeof body?.pollSubtitle === "string" ? body.pollSubtitle.trim() : "";
        const disableDiscordNotifications = Boolean(body?.disableDiscordNotifications);

        if (!Number.isInteger(number) || number <= 0) {
          return json({ ok: false, error: "Invalid number" }, 400, corsHeaders);
        }

        if (!dmAccountId && !dmDiscordId) {
          return json({ ok: false, error: "Missing dmAccountId" }, 400, corsHeaders);
        }

        const authenticatedAccountId = getAuthenticatedAccountId(user, env);
        const authenticatedDiscordId = getAuthenticatedDiscordId(user);
        const canManagePoll = (
          (dmAccountId && authenticatedAccountId === dmAccountId)
          || pollManagerAccountIds.includes(authenticatedAccountId)
          || (dmDiscordId && authenticatedDiscordId === dmDiscordId)
          || pollManagerDiscordIds.includes(authenticatedDiscordId)
        );
        if (!canManagePoll) {
          return json(
            {
              ok: false,
              error: "Forbidden: user must be campaign DM or poll manager",
              authenticatedAccountId,
              authenticatedDiscordId,
            },
            403,
            corsHeaders
          );
        }

        if (typeof isScheduled !== "boolean") {
          return json({ ok: false, error: "Invalid isScheduled: must be boolean" }, 400, corsHeaders);
        }

        if (!Array.isArray(body?.availabilityOptions)) {
          return json({ ok: false, error: "Invalid availabilityOptions: must be an array" }, 400, corsHeaders);
        }

        const availabilityOptions = [];
        const optionIds = new Set();

        for (const opt of body.availabilityOptions) {
          const id = String(opt?.id || "").trim();
          const label = String(opt?.label || "").trim();
          const time = String(opt?.time || "").trim();
          const meta = String(opt?.meta || "").trim();

          if (!id) {
            return json({ ok: false, error: "Invalid availabilityOptions: every option must have id" }, 400, corsHeaders);
          }

          if (optionIds.has(id)) {
            return json({ ok: false, error: `Duplicate availability option id: ${id}` }, 400, corsHeaders);
          }

          optionIds.add(id);

          availabilityOptions.push({
            id,
            label,
            time,
            meta,
          });
        }

        const sessionStorageKey = sessionKey(campaignId, number);
        const existingSessionRaw = await getCampaignKv(env.SIGILLO_KV, sessionStorageKey, `session/${number}`);
        const existingSession = safeJsonParse(existingSessionRaw) || {};
        const nowIso = new Date().toISOString();
        const createdAt = typeof body?.createdAt === "string" && body.createdAt.trim()
          ? body.createdAt.trim()
          : (typeof existingSession?.createdAt === "string" && existingSession.createdAt.trim() ? existingSession.createdAt.trim() : nowIso);

        const sessionData = {
          number,
          campaignId,
          campaignName,
          pollTitle,
          pollSubtitle,
          disableDiscordNotifications,
          dmAccountId,
          dmDiscordId,
          pollManagerAccountIds,
          pollManagerDiscordIds,
          date,
          timeStart,
          timeEnd,
          isScheduled,
          availabilityOptions,
          createdAt,
          updatedAt: nowIso,
        };

        await putCampaignKv(env.SIGILLO_KV, sessionStorageKey, `session/${number}`, JSON.stringify(sessionData));

        // aggiorna il puntatore alla prossima sessione attiva
        await putCampaignKv(env.SIGILLO_KV, sessionCurrentKey(campaignId), "session/current", JSON.stringify(sessionData));

        // inizializza i voti se non esistono
        const votesKey = sessionVotesKey(campaignId, number);
        const existingVotes = await getCampaignKv(env.SIGILLO_KV, votesKey, `session-votes/${number}`);

        if (!existingVotes) {
          const votesData = {
            sessionNumber: number,
            campaignId,
            votes: [],
          };

          await putCampaignKv(env.SIGILLO_KV, votesKey, `session-votes/${number}`, JSON.stringify(votesData));
        }

        return json(
          {
            ok: true,
            saved: true,
            number,
            data: sessionData,
          },
          200,
          corsHeaders
        );
      }

      // ======================================================
      // SESSION DISCORD - POST LINK (protetta con login Discord)
      // POST /api/session/discord/poll-link
      // ======================================================
      if (url.pathname === "/api/session/discord/poll-link" && request.method === "POST") {
        return handleSessionDiscordPollLink(request, queryCampaignId, env, corsHeaders);
      }

      // ======================================================
      // SESSION DISCORD - POST CARD (protetta con login Discord)
      // POST /api/session/discord/card
      // ======================================================
      if (url.pathname === "/api/session/discord/card" && request.method === "POST") {
        return handleSessionDiscordCard(request, queryCampaignId, env, corsHeaders);
      }
      // ======================================================
      // SESSION VOTES - GET
      // GET /api/session-votes?session=21
      // ======================================================
      if (url.pathname === "/api/session-votes" && request.method === "GET") {
        if (!env.SIGILLO_KV) {
          return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
        }

        const session = (url.searchParams.get("session") || "").trim();
        const campaignId = queryCampaignId;

        if (!session) {
          return json({ ok: false, error: "Missing query param: session" }, 400, corsHeaders);
        }

        if (!/^\d+$/.test(session)) {
          return json({ ok: false, error: "Invalid session: must be a numeric value" }, 400, corsHeaders);
        }

        const key = sessionVotesKey(campaignId, session);
        const data = await getCampaignKv(env.SIGILLO_KV, key, `session-votes/${session}`);

        if (!data) {
          return json(
            { ok: false, error: "Session votes not found", session: Number(session) },
            404,
            corsHeaders
          );
        }

        return new Response(data, {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      // ======================================================
      // SESSION VOTES - POST (protetta con login Discord)
      // POST /api/session-votes
      // Body:
      // {
      //   "sessionNumber": 21,
      //   "playerId": "142960432389423104",
      //   "optionId": "lun-16-mar-2030",
      //   "value": "yes"
      // }
      // ======================================================
      if (url.pathname === "/api/session-votes" && request.method === "POST") {
        if (!env.SIGILLO_KV) {
          return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
        }

        if (!env.JWT_SECRET) {
          return json({ ok: false, error: "Missing env.JWT_SECRET" }, 500, corsHeaders);
        }

        const user = await requireUser(request, env, corsHeaders);
        if (user instanceof Response) return user;

        const ct = request.headers.get("Content-Type") || "";
        let body;

        try {
          if (ct.includes("application/json")) {
            body = await request.json();
          } else {
            const text = await request.text();
            body = text ? JSON.parse(text) : {};
          }
        } catch {
          return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
        }

        const campaignId = getCampaignIdFromBodyOrUrl(body, url);
        const sessionNumber = body?.sessionNumber;
        const authenticatedAccountId = getAuthenticatedAccountId(user, env);
        const authenticatedDiscordId = getAuthenticatedDiscordId(user);
        const requestedAccountId = sanitizeAccountId(body?.accountId || body?.playerId || "");
        const requestedDiscordId = String(body?.discordId || "").trim();
        const optionId = String(body?.optionId || "").trim();
        const value = body?.value;

        if (!Number.isInteger(sessionNumber) || sessionNumber <= 0) {
          return json({ ok: false, error: "Invalid sessionNumber" }, 400, corsHeaders);
        }

        if (!requestedAccountId) {
          return json({ ok: false, error: "Missing accountId" }, 400, corsHeaders);
        }

        if (!optionId) {
          return json({ ok: false, error: "Missing optionId" }, 400, corsHeaders);
        }

        if (!["yes", "no", "maybe", ""].includes(value)) {
          return json({ ok: false, error: 'Invalid value: allowed "yes", "no", "maybe", ""' }, 400, corsHeaders);
        }

        if (requestedAccountId !== authenticatedAccountId) {
          return json(
            {
              ok: false,
              error: "Forbidden: accountId must match authenticated user",
              authenticatedAccountId,
              requestedAccountId,
            },
            403,
            corsHeaders
          );
        }

        // controllo che la sessione esista e che optionId sia valido
        const sessionStorageKey = sessionKey(campaignId, sessionNumber);
        const sessionRaw = await getCampaignKv(env.SIGILLO_KV, sessionStorageKey, `session/${sessionNumber}`);

        if (!sessionRaw) {
          return json({ ok: false, error: "Session not found" }, 404, corsHeaders);
        }

        let sessionData;
        try {
          sessionData = JSON.parse(sessionRaw);
        } catch {
          return json({ ok: false, error: "Stored session is invalid JSON" }, 500, corsHeaders);
        }

        const validOption = Array.isArray(sessionData?.availabilityOptions)
          ? sessionData.availabilityOptions.some((o) => String(o?.id) === optionId)
          : false;

        if (!validOption) {
          return json({ ok: false, error: "Invalid optionId for this session" }, 400, corsHeaders);
        }

        const key = sessionVotesKey(campaignId, sessionNumber);
        const raw = await getCampaignKv(env.SIGILLO_KV, key, `session-votes/${sessionNumber}`);

        let data;
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch {
            return json({ ok: false, error: "Stored session votes data is invalid JSON" }, 500, corsHeaders);
          }
        } else {
          data = {
            sessionNumber,
            campaignId,
            votes: [],
          };
        }

        if (!data || typeof data !== "object") {
          data = { sessionNumber, campaignId, votes: [] };
        }

        if (!Array.isArray(data.votes)) {
          data.votes = [];
        }

        if (!data.sessionNumber) {
          data.sessionNumber = sessionNumber;
        }
        data.campaignId = campaignId;

        let player = data.votes.find((v) => {
          const voteAccountId = sanitizeAccountId(v?.accountId || v?.playerId || "");
          const voteDiscordId = String(v?.discordId || "").trim();
          return voteAccountId === requestedAccountId
            || (authenticatedDiscordId && voteDiscordId === authenticatedDiscordId)
            || (requestedDiscordId && voteDiscordId === requestedDiscordId);
        });

        if (!player) {
          player = {
            playerId: requestedAccountId,
            accountId: requestedAccountId,
            discordId: authenticatedDiscordId || requestedDiscordId || "",
            name: user.global_name || user.username || requestedAccountId,
            selections: {},
          };
          data.votes.push(player);
        }

        if (!player.selections || typeof player.selections !== "object") {
          player.selections = {};
        }

        player.playerId = requestedAccountId;
        player.accountId = requestedAccountId;
        player.discordId = authenticatedDiscordId || requestedDiscordId || player.discordId || "";
        player.name = user.global_name || user.username || player.name || requestedAccountId;
        player.selections[optionId] = value;

        await putCampaignKv(env.SIGILLO_KV, key, `session-votes/${sessionNumber}`, JSON.stringify(data));

        return json(
          {
            ok: true,
            saved: true,
            sessionNumber,
            playerId: requestedAccountId,
            accountId: requestedAccountId,
            optionId,
            value,
            data,
          },
          200,
          corsHeaders
        );
      }

      return new Response(JSON.stringify({ ok: false, error: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: String(err && err.message ? err.message : err),
          stack: err && err.stack ? err.stack : null,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  },
};

// =========================
// Helpers
// =========================

function json(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

const DEFAULT_CAMPAIGN_ID = "cripta-di-sangue";
const WORKER_CODE_VERSION = "2026-07-15-discord-share-v1";
const SYNC_BOOTSTRAP_COLLECTIONS = [
  "characters",
  "quests",
  "items",
  "bestiary",
  "monster-abilities",
  "locations",
  "maps",
  "calendar",
  "crafting",
  "skill-trees",
  "skill-tree-states",
  "ability-overrides",
  "item-overrides",
  "media-overrides",
  "transformations",
  "asset-registry",
];

function sanitizeCampaignId(value) {
  const campaignId = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!campaignId || campaignId.length > 64) return DEFAULT_CAMPAIGN_ID;
  return campaignId;
}

function getCampaignIdFromUrl(url) {
  return sanitizeCampaignId(url.searchParams.get("campaign") || url.searchParams.get("campaignId") || "");
}

function getCampaignIdFromBodyOrUrl(body, url) {
  return sanitizeCampaignId(body?.campaignId || body?.campaign || getCampaignIdFromUrl(url));
}

function applyCampaignToFrontendUrl(url, campaignId) {
  const cleanCampaignId = sanitizeCampaignId(campaignId);
  if (cleanCampaignId !== DEFAULT_CAMPAIGN_ID) {
    url.searchParams.set("campaign", cleanCampaignId);
  }
}

function campaignKey(campaignId, key) {
  return `campaign:${sanitizeCampaignId(campaignId)}:${key}`;
}

async function getCampaignKv(kv, key, legacyKey = "") {
  const raw = await kv.get(key);
  if (raw !== null && raw !== undefined) return raw;
  if (legacyKey && legacyKey !== key) return kv.get(legacyKey);
  return raw;
}

async function putCampaignKv(kv, key, legacyKey, value, options) {
  await kv.put(key, value, options);
  // Keep the existing single-campaign keys warm for old clients until every consumer is migrated.
  if (legacyKey && legacyKey !== key && key.startsWith(`campaign:${DEFAULT_CAMPAIGN_ID}:`)) {
    await kv.put(legacyKey, value, options);
  }
}

function sanitizeDataCollection(value) {
  const collection = String(value || "").trim().toLowerCase().replace(/^\/+|\/+$/g, "");
  const allowedCollections = [
    "calendar",
    "crafting",
    "items",
    "bestiary",
    "characters",
    "quests",
    "locations",
    "maps",
    "monster-abilities",
    "transformations",
    "skill-trees",
    "skill-tree-states",
    "ability-icons",
    "ability-overrides",
    "item-overrides",
    "media-overrides",
    "asset-registry",
    "asset-sync-jobs",
    "asset-sync-archive",
    "asset-sync-backups"
  ];
  return allowedCollections.includes(collection) ? collection : "";
}

function dataCollectionKey(collection, campaignId = DEFAULT_CAMPAIGN_ID) {
  return campaignKey(campaignId, `data:${collection}:override`);
}

function managedActorIndexKey(campaignId = DEFAULT_CAMPAIGN_ID) {
  return campaignKey(campaignId, "managed-actors:index");
}

function managedActorRuntimeKey(campaignId, worldId, actorId) {
  return campaignKey(campaignId, `managed-actor-runtime:${sanitizeManagedActorId(worldId)}:${sanitizeManagedActorId(actorId)}`);
}

function managedActorDocumentKey(campaignId, worldId, actorId) {
  return campaignKey(campaignId, `managed-actor:${sanitizeManagedActorId(worldId)}:${sanitizeManagedActorId(actorId)}`);
}

function managedActorProfileKey(campaignId, worldId, actorId) {
  return campaignKey(campaignId, `managed-actor-profile:${sanitizeManagedActorId(worldId)}:${sanitizeManagedActorId(actorId)}`);
}

function npcCategoryRegistryKey(campaignId = DEFAULT_CAMPAIGN_ID) {
  return campaignKey(campaignId, "npc-categories");
}

function managedActorProfileLinkKey(campaignId, legacyCharacterId) {
  return campaignKey(campaignId, `managed-actor-profile-link:${sanitizeAssetId(legacyCharacterId)}`);
}

function managedActorLegacyMigrationBackupKey(campaignId, worldId, actorId, legacyCharacterId, migrationId) {
  return campaignKey(campaignId, `managed-actor-migration-backup:${sanitizeManagedActorId(worldId)}:${sanitizeManagedActorId(actorId)}:${sanitizeAssetId(legacyCharacterId)}:${sanitizeAssetId(migrationId)}`);
}

function managedActorCommandQueueKey(campaignId, worldId) {
  return campaignKey(campaignId, `managed-actor-commands:${sanitizeManagedActorId(worldId)}`);
}
function managedActorCreateRequestQueueKey(campaignId) {
  return campaignKey(campaignId, "managed-actor-create-requests");
}


function inventoryKey(campaignId = DEFAULT_CAMPAIGN_ID) {
  return campaignKey(campaignId, "inventory/latest");
}

function sessionCurrentKey(campaignId = DEFAULT_CAMPAIGN_ID) {
  return campaignKey(campaignId, "session/current");
}

function sessionKey(campaignId, number) {
  return campaignKey(campaignId, `session/${number}`);
}

function sessionVotesKey(campaignId, number) {
  return campaignKey(campaignId, `session-votes/${number}`);
}

function sessionStartNotificationKey(campaignId, number) {
  return campaignKey(campaignId, `session/${number}/start-notified`);
}

async function handleSessionDiscordPollLink(request, fallbackCampaignId, env, corsHeaders) {
  if (!env.SIGILLO_KV) {
    return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  }
  if (!env.JWT_SECRET) {
    return json({ ok: false, error: "Missing env.JWT_SECRET" }, 500, corsHeaders);
  }

  const user = await requireUser(request, env, corsHeaders);
  if (user instanceof Response) return user;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const campaignId = sanitizeCampaignId(body?.campaignId || body?.campaign || fallbackCampaignId);
  const session = await loadSessionForDiscordAction(env, campaignId, body?.number);
  if (!session) {
    return json({ ok: false, error: "Session not found" }, 404, corsHeaders);
  }
  if (!canManageSessionDiscordAction(user, env, session)) {
    return json({ ok: false, error: "Forbidden: user must be campaign DM or poll manager" }, 403, corsHeaders);
  }
  if (session.disableDiscordNotifications) {
    return json({ ok: true, sent: false, disabled: true }, 200, corsHeaders);
  }

  const webhookUrl = getSessionDiscordWebhookUrl(env, campaignId);
  if (!webhookUrl) {
    return json({ ok: true, sent: false, missingWebhook: true }, 200, corsHeaders);
  }

  const pollUrl = getSessionPollUrlForDiscord(body, env, campaignId);
  await postDiscordJson(webhookUrl, {
    content: `@everyone Nuova sessione ${session.number} creata.\nVota qui: ${pollUrl}`
  });

  return json({ ok: true, sent: true }, 200, corsHeaders);
}

async function handleSessionDiscordCard(request, fallbackCampaignId, env, corsHeaders) {
  if (!env.SIGILLO_KV) {
    return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  }
  if (!env.JWT_SECRET) {
    return json({ ok: false, error: "Missing env.JWT_SECRET" }, 500, corsHeaders);
  }

  const user = await requireUser(request, env, corsHeaders);
  if (user instanceof Response) return user;

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: "Invalid multipart form data" }, 400, corsHeaders);
  }

  const campaignId = sanitizeCampaignId(formData.get("campaignId") || formData.get("campaign") || fallbackCampaignId);
  const session = await loadSessionForDiscordAction(env, campaignId, formData.get("number"));
  if (!session) {
    return json({ ok: false, error: "Session not found" }, 404, corsHeaders);
  }
  if (!canManageSessionDiscordAction(user, env, session)) {
    return json({ ok: false, error: "Forbidden: user must be campaign DM or poll manager" }, 403, corsHeaders);
  }
  if (session.disableDiscordNotifications) {
    return json({ ok: true, sent: false, disabled: true }, 200, corsHeaders);
  }

  const webhookUrl = getSessionDiscordWebhookUrl(env, campaignId);
  if (!webhookUrl) {
    return json({ ok: true, sent: false, missingWebhook: true }, 200, corsHeaders);
  }

  const file = formData.get("file");
  if (!isBlobLikeFile(file)) {
    return json({ ok: false, error: "Missing file" }, 400, corsHeaders);
  }
  if (Number(file.size || 0) > 8 * 1024 * 1024) {
    return json({ ok: false, error: "File too large: max 8 MB" }, 413, corsHeaders);
  }

  const discordForm = new FormData();
  discordForm.append("content", buildSessionCardDiscordContent(session));
  discordForm.append("file", file, sanitizeDiscordFilename(file.name || `sessione-${session.number}.png`));
  await postDiscordForm(webhookUrl, discordForm);

  return json({ ok: true, sent: true }, 200, corsHeaders);
}

async function handleDiscordShareCard(request, fallbackCampaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  if (!env.JWT_SECRET) return json({ ok: false, error: "Missing env.JWT_SECRET" }, 500, corsHeaders);

  const user = await requireUser(request, env, corsHeaders);
  if (user instanceof Response) return user;

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "Invalid multipart form data" }, 400, corsHeaders);
  }

  const campaignId = sanitizeCampaignId(form.get("campaignId") || form.get("campaign") || fallbackCampaignId);
  const canPublish = isAuthenticatedAdmin(user, env)
    || await isAuthenticatedCampaignContentEditor(user, env, campaignId);
  if (!canPublish) {
    return json({ ok: false, error: "Forbidden: user must be the campaign DM or content editor" }, 403, corsHeaders);
  }

  const kind = String(form.get("kind") || "").trim().toLowerCase();
  if (!["npc", "item"].includes(kind)) return json({ ok: false, error: "Invalid share kind" }, 400, corsHeaders);
  const source = String(form.get("source") || (kind === "npc" ? "characters" : "items")).trim().toLowerCase();
  const entityId = sanitizeAssetId(form.get("entityId") || "");
  const worldId = sanitizeManagedActorId(form.get("worldId") || "");
  const actorId = sanitizeManagedActorId(form.get("actorId") || "");
  if (!entityId) return json({ ok: false, error: "Missing entity id" }, 400, corsHeaders);
  if (kind === "item" && source !== "items") return json({ ok: false, error: "Invalid item source" }, 400, corsHeaders);
  if (kind === "npc" && !["characters", "managed"].includes(source)) return json({ ok: false, error: "Invalid NPC source" }, 400, corsHeaders);
  if (source === "managed" && (!worldId || !actorId)) return json({ ok: false, error: "Missing managed actor identity" }, 400, corsHeaders);

  const exists = await discordShareEntityExists(env, campaignId, { kind, source, entityId, worldId, actorId });
  if (exists === false) return json({ ok: false, error: "Shared entity not found" }, 404, corsHeaders);

  const file = form.get("file");
  if (!isBlobLikeFile(file)) return json({ ok: false, error: "Missing file" }, 400, corsHeaders);
  const fileType = String(file.type || "").trim().toLowerCase();
  if (fileType && fileType !== "image/png") return json({ ok: false, error: "Only PNG cards are supported" }, 415, corsHeaders);
  if (Number(file.size || 0) > 8 * 1024 * 1024) return json({ ok: false, error: "File too large: max 8 MB" }, 413, corsHeaders);

  const channelId = getDiscordShareChannelId(env, campaignId, kind);
  if (!channelId) return json({ ok: true, sent: false, missingChannel: true }, 200, corsHeaders);
  if (!String(env.DISCORD_BOT_TOKEN || "").trim()) {
    return json({ ok: false, error: "Discord bot is not configured" }, 503, corsHeaders);
  }

  const publicUrl = buildDiscordSharePublicUrl(env, campaignId, { kind, source, entityId, worldId, actorId });
  const label = kind === "npc" ? "NPC" : "Oggetto";
  const result = await sendDiscordBotChannelCard(env, channelId, {
    content: "**" + label + " condiviso dalla wiki**\n" + publicUrl,
    file,
    filename: sanitizeDiscordFilename(file.name || (kind + "-" + entityId + ".png")),
    description: label + " della campagna " + campaignId,
  });
  if (!result.ok) {
    console.error("Discord share card failed", { campaignId, kind, status: result.status, error: result.error });
    return json({ ok: false, error: "Discord: " + String(result.error || "invio fallito").slice(0, 180) }, 502, corsHeaders);
  }

  const messageId = sanitizeDiscordShareChannelId(result.data?.id || "");
  const guildId = sanitizeDiscordShareChannelId(result.data?.guild_id || "");
  const discordUrl = messageId
    ? "https://discord.com/channels/" + (guildId || "@me") + "/" + channelId + "/" + messageId
    : "";
  return json({ ok: true, sent: true, messageId, discordUrl }, 200, corsHeaders);
}

async function discordShareEntityExists(env, campaignId, identity) {
  if (identity.source === "managed") {
    const raw = await env.SIGILLO_KV.get(managedActorDocumentKey(campaignId, identity.worldId, identity.actorId));
    const actor = safeJsonParse(raw);
    return Boolean(actor && String(actor.actorType || "npc").trim().toLowerCase() === "npc");
  }

  const collection = identity.kind === "item" ? "items" : "characters";
  const document = await readDataCollectionDocument(collection, campaignId, env);
  if (Array.isArray(document?.data)) return discordShareCollectionHasEntity(document.data, identity);

  const staticData = await loadDiscordShareStaticCollection(env, campaignId, collection);
  if (Array.isArray(staticData)) return discordShareCollectionHasEntity(staticData, identity);

  // A temporary static-catalog failure must not block an already authorized DM.
  return null;
}

function discordShareCollectionHasEntity(data, identity) {
  return data.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    if (identity.kind === "npc" && String(entry.type || "npc").trim().toLowerCase() !== "npc") return false;
    return sanitizeAssetId(entry.id || entry.actorId || entry.name || "") === identity.entityId;
  });
}

async function loadDiscordShareStaticCollection(env, campaignId, collection) {
  const base = String(env.FE_URL || "https://khuzoe.github.io/sigillo-del-male/").trim();
  const root = base.endsWith("/") ? base : base + "/";
  const cleanCampaignId = sanitizeCampaignId(campaignId);
  const relative = cleanCampaignId === DEFAULT_CAMPAIGN_ID
    ? "assets/data/" + collection + ".json"
    : "campaigns/" + cleanCampaignId + "/data/" + collection + ".json";
  try {
    const response = await fetch(new URL(relative, root).toString(), { cf: { cacheEverything: true, cacheTtl: 120 } });
    if (!response.ok) return null;
    const payload = await response.json();
    return Array.isArray(payload) ? payload : (Array.isArray(payload?.data) ? payload.data : null);
  } catch {
    return null;
  }
}

function getDiscordShareChannelId(env, campaignId, kind) {
  const cleanCampaignId = sanitizeCampaignId(campaignId);
  const campaignSuffix = cleanCampaignId.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const kindSuffix = kind.toUpperCase();
  const direct = sanitizeDiscordShareChannelId(
    env["DISCORD_SHARE_CHANNEL_" + campaignSuffix + "_" + kindSuffix]
      || env["DISCORD_SHARE_CHANNEL_" + campaignSuffix]
      || ""
  );
  if (direct) return direct;

  const raw = String(env.DISCORD_SHARE_CHANNELS || "").trim();
  if (!raw) return "";
  try {
    const map = JSON.parse(raw);
    if (map && typeof map === "object" && !Array.isArray(map)) {
      const campaign = map[cleanCampaignId];
      const candidate = campaign && typeof campaign === "object"
        ? campaign[kind] || campaign.default || campaign.channel
        : campaign;
      const nested = sanitizeDiscordShareChannelId(candidate || map[cleanCampaignId + "." + kind] || "");
      if (nested) return nested;
    }
  } catch {
    // Also accept campaign.kind=channel;campaign=channel.
  }

  for (const entry of raw.split(/[\r\n;]+/).map((value) => value.trim()).filter(Boolean)) {
    const separator = entry.includes("=") ? entry.indexOf("=") : entry.indexOf("|");
    if (separator <= 0) continue;
    const key = String(entry.slice(0, separator)).trim().toLowerCase();
    if (key !== cleanCampaignId + "." + kind && key !== cleanCampaignId) continue;
    const channelId = sanitizeDiscordShareChannelId(entry.slice(separator + 1));
    if (channelId) return channelId;
  }
  return "";
}

function sanitizeDiscordShareChannelId(value) {
  const id = String(value || "").trim();
  return /^\d{5,32}$/.test(id) ? id : "";
}

function buildDiscordSharePublicUrl(env, campaignId, identity) {
  const base = String(env.FE_URL || "https://khuzoe.github.io/sigillo-del-male/").trim();
  const root = base.endsWith("/") ? base : base + "/";
  let target;
  if (identity.kind === "item") {
    target = new URL("pages/oggetti.html", root);
    target.hash = identity.entityId;
  } else if (identity.source === "managed") {
    target = new URL("pages/characters/managed-actor.html", root);
    target.searchParams.set("world", identity.worldId);
    target.searchParams.set("actor", identity.actorId);
  } else {
    target = new URL("pages/characters/character.html", root);
    target.searchParams.set("id", identity.entityId);
    target.searchParams.set("type", "npc");
  }
  applyCampaignToFrontendUrl(target, campaignId);
  return target.toString();
}
function scrubSessionData(session) {
  if (!session || typeof session !== "object") return session;
  const copy = { ...session };
  delete copy.discordWebhookUrl;
  return copy;
}

async function loadSessionForDiscordAction(env, campaignId, rawNumber) {
  const cleanCampaignId = sanitizeCampaignId(campaignId);
  const numberText = String(rawNumber || "").trim();
  const number = /^\d+$/.test(numberText) ? Number(numberText) : 0;
  const raw = number > 0
    ? await getCampaignKv(env.SIGILLO_KV, sessionKey(cleanCampaignId, number), `session/${number}`)
    : await getCampaignKv(env.SIGILLO_KV, sessionCurrentKey(cleanCampaignId), cleanCampaignId === DEFAULT_CAMPAIGN_ID ? "session/current" : "");
  const session = safeJsonParse(raw);
  return session && typeof session === "object" ? { ...session, campaignId: session.campaignId || cleanCampaignId } : null;
}

function canManageSessionDiscordAction(user, env, session) {
  if (isAuthenticatedAdmin(user, env)) return true;
  const accountId = getAuthenticatedAccountId(user, env);
  const discordId = getAuthenticatedDiscordId(user);
  const dmAccountId = sanitizeAccountId(session?.dmAccountId || "");
  const dmDiscordId = String(session?.dmDiscordId || "").trim();
  const managerAccountIds = normalizeStringList(session?.pollManagerAccountIds || session?.sessionManagerAccountIds || []).map(sanitizeAccountId);
  const managerDiscordIds = normalizeDiscordIdList(session?.pollManagerDiscordIds || session?.sessionManagerDiscordIds || []);
  return (dmAccountId && accountId === dmAccountId)
    || (dmDiscordId && discordId === dmDiscordId)
    || (accountId && managerAccountIds.includes(accountId))
    || (discordId && managerDiscordIds.includes(discordId));
}

function getSessionPollUrlForDiscord(body, env, campaignId) {
  const candidate = String(body?.pollUrl || "").trim();
  if (/^https:\/\/khuzoe\.github\.io\/sigillo-del-male\//.test(candidate)) return candidate;
  const base = String(env.FE_URL || "https://khuzoe.github.io/sigillo-del-male/").trim() || "https://khuzoe.github.io/sigillo-del-male/";
  const root = base.endsWith("/") ? base : `${base}/`;
  const url = new URL("pages/sondaggio.html", root);
  applyCampaignToFrontendUrl(url, campaignId);
  return url.toString();
}

function getSessionDiscordWebhookUrl(env, campaignId) {
  const cleanCampaignId = sanitizeCampaignId(campaignId);
  const suffix = cleanCampaignId.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const direct = String(env[`SESSION_DISCORD_WEBHOOK_${suffix}`] || env[`DISCORD_WEBHOOK_${suffix}`] || "").trim();
  if (isDiscordWebhookUrl(direct)) return direct;

  const mapped = getCampaignWebhookFromMap(env.SESSION_DISCORD_WEBHOOKS || env.DISCORD_WEBHOOK_URLS || "", cleanCampaignId);
  if (mapped) return mapped;

  const defaultWebhook = String(env.SESSION_DISCORD_WEBHOOK_URL || env.DISCORD_WEBHOOK_URL || "").trim();
  return cleanCampaignId === DEFAULT_CAMPAIGN_ID && isDiscordWebhookUrl(defaultWebhook) ? defaultWebhook : "";
}

function getCampaignWebhookFromMap(rawValue, campaignId) {
  const raw = String(rawValue || "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const candidate = String(parsed[campaignId] || "").trim();
      return isDiscordWebhookUrl(candidate) ? candidate : "";
    }
  } catch {
    // Support delimited secrets: campaign=url;other-campaign=url
  }

  const entries = raw.split(/[\r\n;]+/).map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    const separatorIndex = entry.includes("=") ? entry.indexOf("=") : entry.indexOf("|");
    if (separatorIndex <= 0) continue;
    const key = sanitizeCampaignId(entry.slice(0, separatorIndex));
    const value = entry.slice(separatorIndex + 1).trim();
    if (key === campaignId && isDiscordWebhookUrl(value)) return value;
  }
  return "";
}

function buildSessionCardDiscordContent(session) {
  if (session?.isScheduled) {
    const date = String(session.date || "").trim();
    const timeStart = String(session.timeStart || "").trim();
    const timeEnd = String(session.timeEnd || "").trim();
    const range = timeStart && timeEnd ? `${timeStart} - ${timeEnd}` : timeStart;
    return `@everyone Sessione ${session.number} fissata: ${date}${range ? ` · ${range}` : ""}`;
  }
  return `Sessione ${session?.number || ""} - card generata`;
}

function isBlobLikeFile(value) {
  return value && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.size === "number";
}

function sanitizeDiscordFilename(value) {
  const name = String(value || "sessione.png")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return name || "sessione.png";
}

async function postDiscordJson(webhookUrl, body) {
  const response = await fetch(`${webhookUrl}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Discord webhook HTTP ${response.status}`);
  }
  return response.json().catch(() => null);
}

async function postDiscordForm(webhookUrl, formData) {
  const response = await fetch(`${webhookUrl}?wait=true`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`Discord webhook HTTP ${response.status}`);
  }
  return response.json().catch(() => null);
}
async function handleSessionStartNotifications(env) {
  if (!env.SIGILLO_KV) return;

  const campaigns = getSessionNotificationCampaignIds(env);
  await Promise.all(campaigns.map((campaignId) => handleSessionStartNotificationForCampaign(env, campaignId)));
}

function getSessionNotificationCampaignIds(env) {
  const raw = env.SESSION_START_NOTIFY_CAMPAIGNS || `${DEFAULT_CAMPAIGN_ID},mago-folle,oltre-il-velo`;
  return [...new Set(normalizeDelimitedStringList(raw).map(sanitizeCampaignId))];
}

async function handleSessionStartNotificationForCampaign(env, campaignId) {
  const raw = await getCampaignKv(
    env.SIGILLO_KV,
    sessionCurrentKey(campaignId),
    campaignId === DEFAULT_CAMPAIGN_ID ? "session/current" : ""
  );
  const session = safeJsonParse(raw);
  if (!session || typeof session !== "object") return;
  if (!session.isScheduled || session.disableDiscordNotifications) return;

  const number = Number(session.number);
  const webhookUrl = getSessionDiscordWebhookUrl(env, campaignId);
  if (!Number.isInteger(number) || number <= 0) return;
  if (!webhookUrl) return;

  const start = parseItalianSessionStart(session.date, session.timeStart);
  if (!start) return;

  const now = getRomeDateTimeParts();
  if (now.date !== start.date) return;

  const minutesFromStart = now.minutes - start.minutes;
  if (minutesFromStart < 0 || minutesFromStart > 15) return;

  const notifiedKey = sessionStartNotificationKey(campaignId, number);
  const alreadyNotified = await env.SIGILLO_KV.get(notifiedKey);
  if (alreadyNotified) return;

  const campaignName = String(session.campaignName || campaignId).trim();
  const timeEnd = String(session.timeEnd || "").trim();
  const content = [
    `@everyone La sessione ${number} di ${campaignName} inizia ora.`,
    timeEnd ? `Orario: ${session.timeStart} - ${timeEnd}` : `Orario: ${session.timeStart}`,
  ].join("\n");

  try {
    await postDiscordJson(webhookUrl, { content });
  } catch (error) {
    console.error("Session start Discord notification failed", {
      campaignId,
      number,
      message: error?.message || String(error),
    });
    return;
  }

  await env.SIGILLO_KV.put(
    notifiedKey,
    JSON.stringify({ campaignId, number, sentAt: new Date().toISOString() }),
    { expirationTtl: 60 * 60 * 24 * 45 }
  );
}

function isDiscordWebhookUrl(value) {
  return /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+$/.test(String(value || "").trim());
}

function parseItalianSessionStart(dateLabel, timeStart) {
  const normalizedDate = normalizeTextForMatch(dateLabel);
  const dateMatch = normalizedDate.match(/\b(\d{1,2})\s+([a-z]+)\s+(\d{4})\b/);
  const timeMatch = String(timeStart || "").match(/\b(\d{1,2}):(\d{2})\b/);
  if (!dateMatch || !timeMatch) return null;

  const day = Number(dateMatch[1]);
  const month = ITALIAN_MONTHS[dateMatch[2]];
  const year = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return {
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    minutes: hour * 60 + minute,
  };
}

const ITALIAN_MONTHS = {
  gennaio: 1,
  febbraio: 2,
  marzo: 3,
  aprile: 4,
  maggio: 5,
  giugno: 6,
  luglio: 7,
  agosto: 8,
  settembre: 9,
  ottobre: 10,
  novembre: 11,
  dicembre: 12,
};

function normalizeTextForMatch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getRomeDateTimeParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(map.hour === "24" ? "0" : map.hour);
  const minute = Number(map.minute || "0");
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    minutes: hour * 60 + minute,
  };
}

const MISSION_TYPES = new Set(["main", "side", "personal", "faction"]);
const MISSION_STATUSES = new Set(["draft", "available", "active", "completed", "failed", "archived"]);
const MISSION_VISIBILITIES = new Set(["public", "players", "assigned", "dm"]);
const MISSION_OBJECTIVE_STATUSES = new Set(["pending", "active", "completed", "failed", "hidden", "archived"]);

function missionText(value, maxLength = 4000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function missionId(value, fallback = "") {
  const clean = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return clean || `mission-${crypto.randomUUID().slice(0, 12)}`;
}

function normalizeMissionEntityRef(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = missionId(value.id || value.actorId || value.characterId || value.slug || "", "entity");
  const type = ["npc", "player", "companion", "faction", "location"].includes(String(value.type || "").toLowerCase())
    ? String(value.type).toLowerCase()
    : "npc";
  const accountIds = [...new Set([
    value.accountId,
    ...(Array.isArray(value.accountIds) ? value.accountIds : []),
  ].map(sanitizeAccountId).filter(Boolean))].slice(0, 16);
  return {
    id,
    type,
    name: missionText(value.name || value.label || id, 120),
    accountIds,
    worldId: missionText(value.worldId, 96),
    actorId: missionText(value.actorId, 96),
  };
}

function normalizeMissionEntityRefs(value, max = 32) {
  const refs = Array.isArray(value) ? value : value ? [value] : [];
  const normalized = refs.map(normalizeMissionEntityRef).filter(Boolean).slice(0, max);
  return normalized.filter((entry, index) => normalized.findIndex((candidate) => candidate.id === entry.id && candidate.type === entry.type) === index);
}

function normalizeMissionObjective(value, index = 0, depth = 0, counter = { count: 0 }) {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 6 || counter.count >= 320) return null;
  counter.count += 1;
  const statusValue = String(value.status || "pending").toLowerCase();
  const visibilityValue = String(value.visibility || (statusValue === "hidden" ? "dm" : "public")).toLowerCase();
  const target = Math.max(1, Math.min(999999, Number(value.progress?.target ?? value.target ?? 1) || 1));
  const current = Math.max(0, Math.min(target, Number(value.progress?.current ?? value.current ?? (statusValue === "completed" ? target : 0)) || 0));
  const childrenInput = value.subObjectives || value.children || value.subquests || [];
  const objective = {
    id: missionId(value.id || `objective-${depth + 1}-${index + 1}`, `objective-${depth + 1}-${index + 1}`),
    title: missionText(value.title || value.name || "Obiettivo senza titolo", 240),
    description: missionText(value.description, 6000),
    status: MISSION_OBJECTIVE_STATUSES.has(statusValue) ? statusValue : "pending",
    visibility: MISSION_VISIBILITIES.has(visibilityValue) ? visibilityValue : "public",
    required: value.required !== false && value.optional !== true,
    progress: { current, target },
    assigneeRefs: normalizeMissionEntityRefs(value.assigneeRefs || value.assignees || [], 16),
    reward: missionText(value.reward || value.rewards, 1000),
    subObjectives: [],
  };
  objective.subObjectives = (Array.isArray(childrenInput) ? childrenInput : [])
    .map((child, childIndex) => normalizeMissionObjective(child, childIndex, depth + 1, counter))
    .filter(Boolean);
  return objective;
}

function normalizeMissionRecord(value, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const typeValue = String(value.type || "side").toLowerCase();
  const statusValue = String(value.status || "draft").toLowerCase();
  const visibilityValue = String(value.visibility || "dm").toLowerCase();
  const objectiveCounter = { count: 0 };
  const objectivesInput = Array.isArray(value.objectives) ? value.objectives : [];
  const normalized = {
    id: missionId(value.id || options.fallbackId || value.title || ""),
    revision: Math.max(1, Number(value.revision || options.revision || 1) || 1),
    type: MISSION_TYPES.has(typeValue) ? typeValue : "side",
    status: MISSION_STATUSES.has(statusValue) ? statusValue : "draft",
    visibility: MISSION_VISIBILITIES.has(visibilityValue) ? visibilityValue : "dm",
    title: missionText(value.title || "Missione senza titolo", 240),
    summary: missionText(value.summary, 1200),
    description: missionText(value.description, 12000),
    dmNotes: missionText(value.dmNotes, 12000),
    giverRefs: normalizeMissionEntityRefs(value.giverRefs || value.giverRef || [], 12),
    assigneeRefs: normalizeMissionEntityRefs(value.assigneeRefs || value.assignees || [], 32),
    links: normalizeMissionEntityRefs(value.links || [], 32),
    tags: normalizeStringList(Array.isArray(value.tags) ? value.tags : []).slice(0, 24),
    rewards: missionText(value.rewards || value.reward, 4000),
    objectives: objectivesInput
      .map((objective, index) => normalizeMissionObjective(objective, index, 0, objectiveCounter))
      .filter(Boolean),
    createdAt: missionText(value.createdAt || options.now || new Date().toISOString(), 64),
    createdBy: missionText(value.createdBy || options.updatedBy, 120),
    updatedAt: missionText(value.updatedAt || options.now || new Date().toISOString(), 64),
    updatedBy: missionText(value.updatedBy || options.updatedBy, 120),
    legacySource: value.legacySource && typeof value.legacySource === "object" ? {
      collection: missionText(value.legacySource.collection, 40),
      id: missionText(value.legacySource.id, 120),
      copiedAt: missionText(value.legacySource.copiedAt, 64),
    } : null,
  };
  return normalized;
}

function missionReaderCanSeeRefList(refs, accountId) {
  if (!accountId) return false;
  return normalizeMissionEntityRefs(refs).some((ref) => ref.accountIds.includes(accountId) || sanitizeAccountId(ref.id) === accountId);
}

function missionVisibilityAllows(visibility, user, isEditor, accountId, assigneeRefs = []) {
  if (isEditor) return true;
  const normalized = MISSION_VISIBILITIES.has(String(visibility || "").toLowerCase())
    ? String(visibility).toLowerCase()
    : "dm";
  if (normalized === "public") return true;
  if (normalized === "players") return Boolean(user);
  if (normalized === "assigned") return Boolean(user && missionReaderCanSeeRefList(assigneeRefs, accountId));
  return false;
}

function publicMissionEntityRef(ref) {
  return {
    id: ref.id,
    type: ref.type,
    name: ref.name,
    worldId: ref.worldId,
    actorId: ref.actorId,
  };
}

function projectMissionObjectiveForReader(objective, reader, missionAssignees) {
  if (!objective || objective.status === "hidden" || objective.status === "archived") {
    return reader.isEditor ? objective : null;
  }
  const assignees = objective.assigneeRefs?.length ? objective.assigneeRefs : missionAssignees;
  if (!missionVisibilityAllows(objective.visibility, reader.user, reader.isEditor, reader.accountId, assignees)) return null;
  const projected = {
    ...objective,
    assigneeRefs: (objective.assigneeRefs || []).map(publicMissionEntityRef),
    subObjectives: (objective.subObjectives || [])
      .map((child) => projectMissionObjectiveForReader(child, reader, missionAssignees))
      .filter(Boolean),
  };
  return projected;
}

function projectMissionForReader(mission, reader) {
  if (!reader.isEditor && ["draft", "archived"].includes(mission.status)) return null;
  if (!missionVisibilityAllows(mission.visibility, reader.user, reader.isEditor, reader.accountId, mission.assigneeRefs)) return null;
  if (reader.isEditor) return mission;
  const projected = {
    ...mission,
    dmNotes: "",
    giverRefs: (mission.giverRefs || []).map(publicMissionEntityRef),
    assigneeRefs: (mission.assigneeRefs || []).map(publicMissionEntityRef),
    links: (mission.links || []).map(publicMissionEntityRef),
    objectives: (mission.objectives || [])
      .map((objective) => projectMissionObjectiveForReader(objective, reader, mission.assigneeRefs || []))
      .filter(Boolean),
  };
  delete projected.legacySource;
  return projected;
}

async function isMissionEditor(user, env, campaignId) {
  if (!user) return false;
  if (isAuthenticatedAdmin(user, env)) return true;
  const accountId = getAuthenticatedAccountId(user, env);
  const discordId = getAuthenticatedDiscordId(user);
  if (isExplicitDataAdmin(accountId, discordId, env)) return true;
  return isAuthenticatedCampaignContentEditor(user, env, campaignId);
}
async function getMissionReader(request, campaignId, env) {
  const user = await getOptionalAuthenticatedUser(request, env);
  const isEditor = Boolean(user && await isMissionEditor(user, env, campaignId));
  return {
    user,
    isEditor,
    accountId: user ? getAuthenticatedAccountId(user, env) : "",
  };
}

async function readMissionDocument(campaignId, env) {
  const raw = await env.SIGILLO_KV.get(dataCollectionKey("missions", campaignId));
  if (!raw) return null;
  const document = safeJsonParse(raw);
  return document && Array.isArray(document.data) ? document : { invalid: true };
}

async function requireMissionEditor(request, campaignId, env, corsHeaders) {
  const user = await requireUser(request, env, corsHeaders);
  if (user instanceof Response) return user;
  if (!await isMissionEditor(user, env, campaignId)) {
    return json({ ok: false, error: "Forbidden: mission editing requires campaign editor permissions" }, 403, corsHeaders);
  }
  return user;
}

async function handleMissionsGet(request, campaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  const cleanCampaignId = sanitizeCampaignId(campaignId);
  const reader = await getMissionReader(request, cleanCampaignId, env);
  const document = await readMissionDocument(cleanCampaignId, env);
  if (document?.invalid) return json({ ok: false, error: "Stored missions document is invalid" }, 500, corsHeaders);
  if (!document) {
    return json({
      ok: true,
      campaignId: cleanCampaignId,
      schemaVersion: 2,
      source: "missing",
      version: 0,
      data: null,
      permissions: { canEdit: reader.isEditor },
    }, 200, { ...corsHeaders, "Cache-Control": "no-store" });
  }
  const normalized = document.data
    .map((mission, index) => normalizeMissionRecord(mission, { fallbackId: `mission-${index + 1}` }))
    .filter(Boolean);
  const visible = normalized.map((mission) => projectMissionForReader(mission, reader)).filter(Boolean);
  return json({
    ok: true,
    campaignId: cleanCampaignId,
    schemaVersion: 2,
    source: "kv",
    version: Number(document.version || 1),
    updatedAt: document.updatedAt || null,
    updatedBy: document.updatedBy || null,
    data: visible,
    permissions: { canEdit: reader.isEditor },
  }, 200, { ...corsHeaders, "Cache-Control": "no-store" });
}

async function handleMissionsBootstrap(request, fallbackCampaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  let body;
  try { body = await request.json(); } catch (_) {
    return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }
  const campaignId = sanitizeCampaignId(body?.campaignId || body?.campaign || fallbackCampaignId);
  const user = await requireMissionEditor(request, campaignId, env, corsHeaders);
  if (user instanceof Response) return user;
  const existing = await readMissionDocument(campaignId, env);
  if (existing?.invalid) return json({ ok: false, error: "Stored missions document is invalid" }, 500, corsHeaders);
  if (existing) {
    return json({ ok: true, created: false, campaignId, version: Number(existing.version || 1), data: existing.data }, 200, corsHeaders);
  }
  const input = Array.isArray(body?.data) ? body.data : null;
  if (!input) return json({ ok: false, error: "Expected { data: [...] }" }, 400, corsHeaders);
  if (input.length > 240) return json({ ok: false, error: "Too many missions" }, 413, corsHeaders);
  const now = new Date().toISOString();
  const updatedBy = missionText(user.global_name || user.username || user.sub, 120);
  const data = input.map((mission, index) => normalizeMissionRecord(mission, {
    fallbackId: `mission-${index + 1}`,
    revision: 1,
    now,
    updatedBy,
  })).filter(Boolean);
  const document = {
    schemaVersion: 2,
    version: 1,
    collection: "missions",
    campaignId,
    updatedAt: now,
    updatedBy,
    migratedFrom: {
      collection: "quests",
      version: Math.max(0, Number(body?.sourceVersion || 0) || 0),
      copiedAt: now,
      recordCount: data.length,
    },
    data,
  };
  const serialized = JSON.stringify(document);
  if (serialized.length > 1024 * 1024) return json({ ok: false, error: "Payload too large" }, 413, corsHeaders);
  await env.SIGILLO_KV.put(dataCollectionKey("missions", campaignId), serialized);
  return json({ ok: true, created: true, campaignId, version: 1, updatedAt: now, data }, 201, corsHeaders);
}

async function handleMissionUpsert(request, fallbackCampaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  let body;
  try { body = await request.json(); } catch (_) {
    return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }
  const campaignId = sanitizeCampaignId(body?.campaignId || body?.campaign || fallbackCampaignId);
  const user = await requireMissionEditor(request, campaignId, env, corsHeaders);
  if (user instanceof Response) return user;
  const document = await readMissionDocument(campaignId, env);
  if (document?.invalid) return json({ ok: false, error: "Stored missions document is invalid" }, 500, corsHeaders);
  if (!document) return json({ ok: false, code: "MIGRATION_REQUIRED", error: "Create the missions register before saving" }, 409, corsHeaders);
  const incoming = body?.mission;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return json({ ok: false, error: "Expected { mission: {...} }" }, 400, corsHeaders);
  }
  const id = missionId(incoming.id || incoming.title || "");
  const index = document.data.findIndex((mission) => missionId(mission?.id || "") === id);
  const existing = index >= 0 ? document.data[index] : null;
  const currentRevision = Math.max(0, Number(existing?.revision || 0) || 0);
  const expectedRevision = Math.max(0, Number(body?.expectedRevision || 0) || 0);
  if (currentRevision !== expectedRevision) {
    return json({ ok: false, code: "REVISION_CONFLICT", error: "Mission changed online. Reload before saving.", id, currentRevision, expectedRevision }, 409, corsHeaders);
  }
  const now = new Date().toISOString();
  const updatedBy = missionText(user.global_name || user.username || user.sub, 120);
  const normalized = normalizeMissionRecord({ ...incoming, id }, {
    fallbackId: id,
    revision: currentRevision + 1,
    now,
    updatedBy,
  });
  normalized.revision = currentRevision + 1;
  normalized.createdAt = existing?.createdAt || normalized.createdAt || now;
  normalized.createdBy = existing?.createdBy || normalized.createdBy || updatedBy;
  normalized.updatedAt = now;
  normalized.updatedBy = updatedBy;
  const data = [...document.data];
  if (index >= 0) data[index] = normalized;
  else data.push(normalized);
  const next = {
    ...document,
    schemaVersion: 2,
    version: Math.max(0, Number(document.version || 0) || 0) + 1,
    collection: "missions",
    campaignId,
    updatedAt: now,
    updatedBy,
    data,
  };
  const serialized = JSON.stringify(next);
  if (serialized.length > 1024 * 1024) return json({ ok: false, error: "Payload too large" }, 413, corsHeaders);
  await env.SIGILLO_KV.put(dataCollectionKey("missions", campaignId), serialized);
  return json({ ok: true, campaignId, version: next.version, updatedAt: now, mission: normalized }, 200, corsHeaders);
}

function updateMissionObjective(objectives, objectiveId, patch) {
  let found = false;
  const updated = (Array.isArray(objectives) ? objectives : []).map((objective) => {
    if (found || !objective || typeof objective !== "object") return objective;
    if (missionId(objective.id || "") === objectiveId) {
      found = true;
      const target = Math.max(1, Math.min(999999, Number(patch?.progress?.target ?? objective.progress?.target ?? 1) || 1));
      const current = Math.max(0, Math.min(target, Number(patch?.progress?.current ?? objective.progress?.current ?? 0) || 0));
      const statusValue = String(patch?.status || objective.status || "pending").toLowerCase();
      return {
        ...objective,
        status: MISSION_OBJECTIVE_STATUSES.has(statusValue) ? statusValue : objective.status,
        progress: { current, target },
      };
    }
    const childResult = updateMissionObjective(objective.subObjectives, objectiveId, patch);
    if (childResult.found) {
      found = true;
      return { ...objective, subObjectives: childResult.objectives };
    }
    return objective;
  });
  return { found, objectives: updated };
}

async function handleMissionProgress(request, fallbackCampaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  let body;
  try { body = await request.json(); } catch (_) {
    return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }
  const campaignId = sanitizeCampaignId(body?.campaignId || body?.campaign || fallbackCampaignId);
  const user = await requireMissionEditor(request, campaignId, env, corsHeaders);
  if (user instanceof Response) return user;
  const document = await readMissionDocument(campaignId, env);
  if (!document || document.invalid) return json({ ok: false, code: "MIGRATION_REQUIRED", error: "Missions register is unavailable" }, 409, corsHeaders);
  const id = missionId(body?.missionId || "");
  const objectiveId = missionId(body?.objectiveId || "");
  const index = document.data.findIndex((mission) => missionId(mission?.id || "") === id);
  if (index < 0) return json({ ok: false, error: "Mission not found" }, 404, corsHeaders);
  const mission = normalizeMissionRecord(document.data[index], { fallbackId: id });
  const expectedRevision = Math.max(0, Number(body?.expectedRevision || 0) || 0);
  if (mission.revision !== expectedRevision) {
    return json({ ok: false, code: "REVISION_CONFLICT", error: "Mission changed online. Reload before saving.", id, currentRevision: mission.revision, expectedRevision }, 409, corsHeaders);
  }
  const result = updateMissionObjective(mission.objectives, objectiveId, body?.patch || {});
  if (!result.found) return json({ ok: false, error: "Objective not found" }, 404, corsHeaders);
  const now = new Date().toISOString();
  const updatedBy = missionText(user.global_name || user.username || user.sub, 120);
  const normalized = normalizeMissionRecord({
    ...mission,
    objectives: result.objectives,
    revision: mission.revision + 1,
    updatedAt: now,
    updatedBy,
  });
  normalized.revision = mission.revision + 1;
  normalized.updatedAt = now;
  normalized.updatedBy = updatedBy;
  const data = [...document.data];
  data[index] = normalized;
  const next = {
    ...document,
    schemaVersion: 2,
    version: Math.max(0, Number(document.version || 0) || 0) + 1,
    updatedAt: now,
    updatedBy,
    data,
  };
  await env.SIGILLO_KV.put(dataCollectionKey("missions", campaignId), JSON.stringify(next));
  return json({ ok: true, campaignId, version: next.version, updatedAt: now, mission: normalized }, 200, corsHeaders);
}

const SESSION_JOURNAL_STATUSES = new Set(["draft", "published", "archived"]);
const SESSION_JOURNAL_VISIBILITIES = new Set(["public", "players", "dm"]);
const SESSION_JOURNAL_EVENT_TYPES = new Set(["event", "encounter", "discovery", "decision", "consequence"]);
const SESSION_JOURNAL_REF_TYPES = new Set(["npc", "player", "companion", "mission", "item", "location"]);

function sessionJournalId(value, fallback = "") {
  const clean = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return clean || "session-" + crypto.randomUUID().slice(0, 12);
}

function normalizeSessionJournalDate(value, legacyValue = "") {
  const direct = missionText(value, 32);
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  const legacy = missionText(legacyValue || value, 32);
  const match = legacy.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return "";
  return match[3] + "-" + match[2].padStart(2, "0") + "-" + match[1].padStart(2, "0");
}

function sessionJournalDateLabel(date, fallback = "") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return missionText(fallback, 32);
  const parts = date.split("-");
  return parts[2] + "/" + parts[1] + "/" + parts[0];
}

function normalizeSessionJournalRef(value, fallbackType = "npc") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const typeValue = String(value.type || fallbackType).trim().toLowerCase();
  const type = SESSION_JOURNAL_REF_TYPES.has(typeValue) ? typeValue : fallbackType;
  const id = sessionJournalId(value.id || value.actorId || value.slug || value.name || "", type);
  return {
    id,
    type,
    name: missionText(value.name || value.label || value.title || id, 160),
    worldId: missionText(value.worldId, 96),
    actorId: missionText(value.actorId, 96),
  };
}

function normalizeSessionJournalRefs(value, fallbackType = "npc", max = 64) {
  const rows = Array.isArray(value) ? value : [];
  const refs = rows.map((entry) => normalizeSessionJournalRef(entry, fallbackType)).filter(Boolean).slice(0, max);
  return refs.filter((entry, index) => refs.findIndex((candidate) => candidate.id === entry.id && candidate.type === entry.type) === index);
}

function normalizeSessionJournalEvent(value, index = 0, seed = "session") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const typeValue = String(value.type || "event").toLowerCase();
  const visibilityValue = String(value.visibility || "public").toLowerCase();
  return {
    id: sessionJournalId(value.id || seed + "-event-" + (index + 1), "event-" + (index + 1)),
    type: SESSION_JOURNAL_EVENT_TYPES.has(typeValue) ? typeValue : "event",
    visibility: visibilityValue === "dm" ? "dm" : "public",
    title: missionText(value.title || value.name || "Momento " + (index + 1), 240),
    text: missionText(value.text || value.description, 10000),
  };
}

function normalizeSessionJournalBonus(value) {
  return (Array.isArray(value) ? value : []).slice(0, 24).map((entry) => ({
    name: missionText(entry?.name, 120),
    amount: Math.max(0, Math.min(999999999, Number(entry?.amount || 0) || 0)),
  })).filter((entry) => entry.name);
}

function normalizeSessionJournalLines(value, max = 80, maxLength = 1000) {
  return (Array.isArray(value) ? value : []).slice(0, max)
    .map((entry) => missionText(entry, maxLength))
    .filter(Boolean);
}

function normalizeSessionPartyChanges(value) {
  return (Array.isArray(value) ? value : []).slice(0, 32).map((entry) => ({
    type: String(entry?.type || "").toLowerCase() === "out" ? "out" : "in",
    name: missionText(entry?.name, 120),
  })).filter((entry) => entry.name);
}

function normalizeSessionJournalRecord(value, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const number = Math.max(0, Math.min(9999, Number(value.number ?? value.sessionNumber ?? value.legacySource?.id ?? value.id ?? options.index + 1) || 0));
  const id = sessionJournalId(value.id && !Number.isFinite(Number(value.id)) ? value.id : "session-" + number, "session-" + number);
  const statusValue = String(value.status || "draft").toLowerCase();
  const visibilityValue = String(value.visibility || "dm").toLowerCase();
  const date = normalizeSessionJournalDate(value.date || value.dateIso, value.dateLabel || value.date);
  const events = (Array.isArray(value.events) ? value.events : [])
    .slice(0, 60)
    .map((entry, index) => normalizeSessionJournalEvent(entry, index, id))
    .filter(Boolean);
  const links = value.links && typeof value.links === "object" && !Array.isArray(value.links) ? value.links : {};
  const xp = value.xp && typeof value.xp === "object" ? value.xp : {};
  const now = options.now || new Date().toISOString();
  return {
    id,
    number,
    revision: Math.max(1, Number(value.revision || options.revision || 1) || 1),
    status: SESSION_JOURNAL_STATUSES.has(statusValue) ? statusValue : "draft",
    visibility: SESSION_JOURNAL_VISIBILITIES.has(visibilityValue) ? visibilityValue : "dm",
    title: missionText(value.title || "Sessione " + number, 240),
    date,
    dateLabel: sessionJournalDateLabel(date, value.dateLabel || value.date),
    teaser: missionText(value.teaser, 1200),
    summary: missionText(value.summary, 40000),
    events,
    participants: normalizeSessionJournalRefs(value.participants, "npc", 64),
    links: {
      missions: normalizeSessionJournalRefs(links.missions, "mission", 32),
      items: normalizeSessionJournalRefs(links.items, "item", 64),
      locations: normalizeSessionJournalRefs(links.locations, "location", 32),
    },
    xp: {
      total: Math.max(0, Math.min(999999999, Number(xp.total || 0) || 0)),
      each: Math.max(0, Math.min(999999999, Number(xp.each || 0) || 0)),
      bonus: normalizeSessionJournalBonus(xp.bonus),
    },
    loot: normalizeSessionJournalLines(value.loot, 80, 1200),
    consequences: normalizeSessionJournalLines(value.consequences, 80, 1600),
    partyChanges: normalizeSessionPartyChanges(value.partyChanges),
    levelUp: missionText(value.levelUp || value.levelup, 40),
    skillPoint: value.skillPoint === true,
    dmNotes: missionText(value.dmNotes, 20000),
    createdAt: missionText(value.createdAt || now, 64),
    createdBy: missionText(value.createdBy || options.updatedBy, 120),
    updatedAt: missionText(value.updatedAt || now, 64),
    updatedBy: missionText(value.updatedBy || options.updatedBy, 120),
    legacySource: value.legacySource && typeof value.legacySource === "object" ? {
      collection: missionText(value.legacySource.collection || "sessions", 48),
      id: missionText(value.legacySource.id || number, 120),
      copiedAt: missionText(value.legacySource.copiedAt, 64),
    } : null,
  };
}

function publicSessionJournalRef(ref) {
  return {
    id: ref.id,
    type: ref.type,
    name: ref.name,
    worldId: ref.worldId,
    actorId: ref.actorId,
  };
}

function projectSessionJournalForReader(session, reader) {
  if (!reader.isEditor) {
    if (session.status !== "published") return null;
    if (session.visibility === "dm") return null;
    if (session.visibility === "players" && !reader.user) return null;
  }
  if (reader.isEditor) return session;
  const projected = {
    ...session,
    dmNotes: "",
    participants: (session.participants || []).map(publicSessionJournalRef),
    links: {
      missions: (session.links?.missions || []).map(publicSessionJournalRef),
      items: (session.links?.items || []).map(publicSessionJournalRef),
      locations: (session.links?.locations || []).map(publicSessionJournalRef),
    },
    events: (session.events || []).filter((event) => event.visibility !== "dm"),
  };
  delete projected.legacySource;
  return projected;
}

async function getSessionJournalReader(request, campaignId, env) {
  const user = await getOptionalAuthenticatedUser(request, env);
  const isEditor = Boolean(user && await isMissionEditor(user, env, campaignId));
  return {
    user,
    isEditor,
    accountId: user ? getAuthenticatedAccountId(user, env) : "",
  };
}

async function readSessionJournalDocument(campaignId, env) {
  const raw = await env.SIGILLO_KV.get(dataCollectionKey("session-journal", campaignId));
  if (!raw) return null;
  const document = safeJsonParse(raw);
  return document && Array.isArray(document.data) ? document : { invalid: true };
}

async function requireSessionJournalEditor(request, campaignId, env, corsHeaders) {
  const user = await requireUser(request, env, corsHeaders);
  if (user instanceof Response) return user;
  if (!await isMissionEditor(user, env, campaignId)) {
    return json({ ok: false, error: "Forbidden: session journal editing requires campaign editor permissions" }, 403, corsHeaders);
  }
  return user;
}

async function handleSessionJournalGet(request, campaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  const cleanCampaignId = sanitizeCampaignId(campaignId);
  const reader = await getSessionJournalReader(request, cleanCampaignId, env);
  const document = await readSessionJournalDocument(cleanCampaignId, env);
  if (document?.invalid) return json({ ok: false, error: "Stored session journal document is invalid" }, 500, corsHeaders);
  if (!document) {
    return json({
      ok: true,
      campaignId: cleanCampaignId,
      schemaVersion: 2,
      source: "missing",
      version: 0,
      data: null,
      permissions: { canEdit: reader.isEditor },
    }, 200, { ...corsHeaders, "Cache-Control": "no-store" });
  }
  const normalized = document.data
    .map((session, index) => normalizeSessionJournalRecord(session, { index }))
    .filter(Boolean);
  const visible = normalized.map((session) => projectSessionJournalForReader(session, reader)).filter(Boolean);
  return json({
    ok: true,
    campaignId: cleanCampaignId,
    schemaVersion: 2,
    source: "kv",
    version: Math.max(1, Number(document.version || 1) || 1),
    updatedAt: document.updatedAt || null,
    updatedBy: document.updatedBy || null,
    data: visible,
    permissions: { canEdit: reader.isEditor },
  }, 200, { ...corsHeaders, "Cache-Control": "no-store" });
}

async function handleSessionJournalBootstrap(request, fallbackCampaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  let body;
  try { body = await request.json(); } catch (_) {
    return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }
  const campaignId = sanitizeCampaignId(body?.campaignId || body?.campaign || fallbackCampaignId);
  const user = await requireSessionJournalEditor(request, campaignId, env, corsHeaders);
  if (user instanceof Response) return user;
  const existing = await readSessionJournalDocument(campaignId, env);
  if (existing?.invalid) return json({ ok: false, error: "Stored session journal document is invalid" }, 500, corsHeaders);
  if (existing) {
    return json({ ok: true, created: false, campaignId, version: Number(existing.version || 1), data: existing.data }, 200, corsHeaders);
  }
  const input = Array.isArray(body?.data) ? body.data : null;
  if (!input) return json({ ok: false, error: "Expected { data: [...] }" }, 400, corsHeaders);
  if (input.length > 600) return json({ ok: false, error: "Too many session records" }, 413, corsHeaders);
  const now = new Date().toISOString();
  const updatedBy = missionText(user.global_name || user.username || user.sub, 120);
  const data = input.map((session, index) => normalizeSessionJournalRecord(session, {
    index,
    revision: 1,
    now,
    updatedBy,
  })).filter(Boolean);
  const document = {
    schemaVersion: 2,
    version: 1,
    collection: "session-journal",
    campaignId,
    updatedAt: now,
    updatedBy,
    migratedFrom: {
      collection: "sessions",
      version: Math.max(0, Number(body?.sourceVersion || 0) || 0),
      copiedAt: now,
      recordCount: data.length,
    },
    data,
  };
  const serialized = JSON.stringify(document);
  if (serialized.length > 1024 * 1024) return json({ ok: false, error: "Payload too large" }, 413, corsHeaders);
  await env.SIGILLO_KV.put(dataCollectionKey("session-journal", campaignId), serialized);
  return json({ ok: true, created: true, campaignId, version: 1, updatedAt: now, data }, 201, corsHeaders);
}

async function handleSessionJournalUpsert(request, fallbackCampaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  let body;
  try { body = await request.json(); } catch (_) {
    return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }
  const campaignId = sanitizeCampaignId(body?.campaignId || body?.campaign || fallbackCampaignId);
  const user = await requireSessionJournalEditor(request, campaignId, env, corsHeaders);
  if (user instanceof Response) return user;
  const document = await readSessionJournalDocument(campaignId, env);
  if (document?.invalid) return json({ ok: false, error: "Stored session journal document is invalid" }, 500, corsHeaders);
  if (!document) return json({ ok: false, code: "MIGRATION_REQUIRED", error: "Create the session journal before saving" }, 409, corsHeaders);
  const incoming = body?.session;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return json({ ok: false, error: "Expected { session: {...} }" }, 400, corsHeaders);
  }
  const id = sessionJournalId(incoming.id || "session-" + Number(incoming.number || 0));
  const index = document.data.findIndex((session) => sessionJournalId(session?.id || "session-" + Number(session?.number || 0)) === id);
  const expectedRevision = Math.max(0, Number(body?.expectedRevision || 0) || 0);
  const current = index >= 0 ? normalizeSessionJournalRecord(document.data[index], { index }) : null;
  if (current && current.revision !== expectedRevision) {
    return json({
      ok: false,
      code: "REVISION_CONFLICT",
      error: "Session changed online. Reload before saving.",
      id,
      currentRevision: current.revision,
      expectedRevision,
    }, 409, corsHeaders);
  }
  if (!current && expectedRevision !== 0) {
    return json({ ok: false, code: "REVISION_CONFLICT", error: "Session does not exist at the expected revision.", id, currentRevision: 0, expectedRevision }, 409, corsHeaders);
  }
  const now = new Date().toISOString();
  const updatedBy = missionText(user.global_name || user.username || user.sub, 120);
  const nextRevision = current ? current.revision + 1 : 1;
  const normalized = normalizeSessionJournalRecord({
    ...incoming,
    id,
    revision: nextRevision,
    createdAt: current?.createdAt || incoming.createdAt || now,
    createdBy: current?.createdBy || incoming.createdBy || updatedBy,
    updatedAt: now,
    updatedBy,
  }, { index: index >= 0 ? index : document.data.length, revision: nextRevision, now, updatedBy });
  normalized.revision = nextRevision;
  normalized.updatedAt = now;
  normalized.updatedBy = updatedBy;
  const data = [...document.data];
  if (index >= 0) data[index] = normalized;
  else data.push(normalized);
  const next = {
    ...document,
    schemaVersion: 2,
    version: Math.max(0, Number(document.version || 0) || 0) + 1,
    updatedAt: now,
    updatedBy,
    data,
  };
  const serialized = JSON.stringify(next);
  if (serialized.length > 1024 * 1024) return json({ ok: false, error: "Payload too large" }, 413, corsHeaders);
  await env.SIGILLO_KV.put(dataCollectionKey("session-journal", campaignId), serialized);
  return json({ ok: true, campaignId, version: next.version, updatedAt: now, session: normalized }, 200, corsHeaders);
}

async function handleDataCollectionGet(collection, campaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) {
    return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  }

  const key = dataCollectionKey(collection, campaignId);
  const raw = await env.SIGILLO_KV.get(key);
  if (!raw) {
    return json({ ok: true, collection, campaignId, source: "static", data: null }, 200, corsHeaders);
  }

  const doc = safeJsonParse(raw);
  if (!doc || !Array.isArray(doc.data)) {
    return json({ ok: false, error: "Stored data override is invalid JSON" }, 500, corsHeaders);
  }

  return json({
    ok: true,
    collection,
    campaignId,
    source: "kv",
    version: doc.version || 1,
    updatedAt: doc.updatedAt || null,
    updatedBy: doc.updatedBy || null,
    data: doc.data,
  }, 200, corsHeaders);
}

async function readDataCollectionDocument(collection, campaignId, env) {
  if (!env.SIGILLO_KV) return null;
  const key = dataCollectionKey(collection, campaignId);
  const raw = await env.SIGILLO_KV.get(key);
  if (!raw) return {
    ok: true,
    collection,
    campaignId,
    source: "static",
    version: 0,
    updatedAt: null,
    updatedBy: null,
    data: null,
  };
  const doc = safeJsonParse(raw);
  if (!doc || !Array.isArray(doc.data)) {
    return {
      ok: false,
      collection,
      campaignId,
      source: "kv",
      error: "Stored data override is invalid JSON",
      data: null,
    };
  }
  return {
    ok: true,
    collection,
    campaignId,
    source: "kv",
    version: Number(doc.version || 1),
    updatedAt: doc.updatedAt || null,
    updatedBy: doc.updatedBy || null,
    data: doc.data,
  };
}

async function handleCharacterBootstrapGet(request, campaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) {
    return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  }

  const url = new URL(request.url);
  const characterId = sanitizeBootstrapId(url.searchParams.get("id") || url.searchParams.get("characterId") || "");
  const type = String(url.searchParams.get("type") || "player").trim().toLowerCase();
  const collections = [
    "characters",
    "items",
    "skill-trees",
    "skill-tree-states",
    "ability-overrides",
    "item-overrides",
    "media-overrides",
    "managed-actors",
    "transformations",
  ];

  const [inventoryRaw, ...documents] = await Promise.all([
    getCampaignKv(env.SIGILLO_KV, inventoryKey(campaignId), "inventory/latest"),
    ...collections.map((collection) => readDataCollectionDocument(collection, campaignId, env)),
  ]);

  const data = documents.reduce((acc, doc, index) => {
    acc[collections[index]] = doc;
    return acc;
  }, {});

  return json({
    ok: true,
    campaignId,
    characterId,
    type,
    inventory: safeJsonParse(inventoryRaw) || {},
    data,
  }, 200, corsHeaders);
}

function handleVersionGet(env, corsHeaders = {}) {
  return json({
    ok: true,
    worker: "sigillo-api",
    version: String(env.WORKER_VERSION || WORKER_CODE_VERSION),
    codeVersion: WORKER_CODE_VERSION,
  }, 200, {
    ...corsHeaders,
    "Cache-Control": "no-store",
  });
}

async function handleSyncBootstrapGet(request, fallbackCampaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) {
    return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  }

  const url = new URL(request.url);
  const campaignId = getCampaignIdFromUrl(url) || fallbackCampaignId;
  const collections = getRequestedSyncCollections(url);
  const snapshot = await buildCampaignSyncSnapshot(campaignId, env, collections);
  return json({
    ok: true,
    ...snapshot,
  }, 200, {
    ...corsHeaders,
    "Cache-Control": "no-store",
  });
}

async function handleSyncStatusGet(request, fallbackCampaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) {
    return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  }

  const url = new URL(request.url);
  const campaignId = getCampaignIdFromUrl(url) || fallbackCampaignId;
  const snapshot = await buildCampaignSyncSnapshot(campaignId, env, SYNC_BOOTSTRAP_COLLECTIONS);
  return json({
    ok: true,
    campaignId,
    stateToken: snapshot.stateToken,
    updatedAt: snapshot.updatedAt,
    collections: snapshot.collections,
    inventory: snapshot.inventory,
    assetRegistry: snapshot.assetRegistry,
    mediaManifest: snapshot.mediaManifest,
  }, 200, {
    ...corsHeaders,
    "Cache-Control": "no-store",
  });
}

async function handleSyncChangesGet(request, fallbackCampaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) {
    return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  }

  const url = new URL(request.url);
  const campaignId = getCampaignIdFromUrl(url) || fallbackCampaignId;
  const since = sanitizeSyncSince(url.searchParams.get("since") || url.searchParams.get("sinceUpdatedAt") || "");
  const collections = getRequestedSyncCollections(url);
  const snapshot = await buildCampaignSyncSnapshot(campaignId, env, collections);
  const changedCollections = Object.values(snapshot.collections)
    .filter((entry) => !since || isIsoAfter(entry.updatedAt, since))
    .map((entry) => ({
      collection: entry.collection,
      source: entry.source,
      version: entry.version,
      updatedAt: entry.updatedAt,
      updatedBy: entry.updatedBy,
      count: entry.count,
    }));

  const inventoryChanged = !since || isIsoAfter(snapshot.inventory.updatedAt, since);
  const assetRegistryChanged = !since || isIsoAfter(snapshot.assetRegistry.updatedAt, since);

  return json({
    ok: true,
    campaignId,
    since: since || null,
    stateToken: snapshot.stateToken,
    updatedAt: snapshot.updatedAt,
    changes: {
      collections: changedCollections,
      inventory: inventoryChanged ? snapshot.inventory : null,
      assetRegistry: assetRegistryChanged ? snapshot.assetRegistry : null,
    },
  }, 200, {
    ...corsHeaders,
    "Cache-Control": "no-store",
  });
}

function getRequestedSyncCollections(url) {
  const requested = String(url.searchParams.get("collections") || "")
    .split(",")
    .map((value) => sanitizeDataCollection(value))
    .filter(Boolean);
  if (!requested.length) return SYNC_BOOTSTRAP_COLLECTIONS;
  return Array.from(new Set(requested));
}

async function buildCampaignSyncSnapshot(campaignId, env, collections = SYNC_BOOTSTRAP_COLLECTIONS) {
  const cleanCampaignId = sanitizeCampaignId(campaignId);
  const [inventoryRaw, ...documents] = await Promise.all([
    getCampaignKv(env.SIGILLO_KV, inventoryKey(cleanCampaignId), "inventory/latest"),
    ...collections.map((collection) => readDataCollectionDocument(collection, cleanCampaignId, env)),
  ]);

  const collectionSummaries = documents.reduce((acc, doc, index) => {
    const collection = collections[index];
    acc[collection] = summarizeDataCollectionDocument(collection, cleanCampaignId, doc);
    return acc;
  }, {});

  const inventory = summarizeInventorySnapshot(safeJsonParse(inventoryRaw) || {});
  const assetRegistry = collectionSummaries["asset-registry"] || {
    collection: "asset-registry",
    campaignId: cleanCampaignId,
    source: "static",
    version: 0,
    updatedAt: null,
    updatedBy: null,
    count: 0,
  };
  const updatedAt = maxSyncUpdatedAt([
    inventory.updatedAt,
    ...Object.values(collectionSummaries).map((entry) => entry.updatedAt),
  ]);

  return {
    campaignId: cleanCampaignId,
    stateToken: buildSyncStateToken(cleanCampaignId, collectionSummaries, inventory),
    updatedAt,
    collections: collectionSummaries,
    inventory,
    assetRegistry,
    mediaManifest: {
      source: "static-site",
      url: buildCampaignDataUrl(env, cleanCampaignId, "media-manifest.json"),
    },
  };
}

function summarizeDataCollectionDocument(collection, campaignId, doc) {
  const data = Array.isArray(doc?.data) ? doc.data : [];
  return {
    collection,
    campaignId,
    source: doc?.source || "static",
    ok: doc?.ok !== false,
    version: Number(doc?.version || 0),
    updatedAt: doc?.updatedAt || null,
    updatedBy: doc?.updatedBy || null,
    count: data.length,
    error: doc?.error || null,
  };
}

function summarizeInventorySnapshot(snapshot) {
  const actors = Array.isArray(snapshot?.actors) ? snapshot.actors : [];
  const companions = Array.isArray(snapshot?.companions) ? snapshot.companions : [];
  const players = Array.isArray(snapshot?.players) ? snapshot.players : [];
  const actorRecords = [...actors, ...companions, ...players];
  return {
    source: actorRecords.length ? "kv" : "empty",
    schemaVersion: snapshot?.schemaVersion || null,
    updatedAt: snapshot?.savedAt || snapshot?.updatedAt || null,
    savedAt: snapshot?.savedAt || null,
    actorCount: actors.length,
    companionCount: companions.length,
    playerCount: players.length,
    itemCount: actorRecords.reduce((sum, actor) => sum + (Array.isArray(actor?.inventory) ? actor.inventory.length : 0), 0),
  };
}

function buildSyncStateToken(campaignId, collections, inventory) {
  const collectionToken = Object.values(collections)
    .sort((a, b) => String(a.collection).localeCompare(String(b.collection)))
    .map((entry) => `${entry.collection}:${entry.version || 0}:${entry.updatedAt || ""}:${entry.count || 0}`)
    .join("|");
  return `${campaignId}|${inventory.updatedAt || ""}|${collectionToken}`;
}

function maxSyncUpdatedAt(values) {
  return values
    .filter(Boolean)
    .sort((a, b) => String(b).localeCompare(String(a)))[0] || null;
}

function sanitizeSyncSince(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function isIsoAfter(value, since) {
  if (!value) return false;
  return String(value) > String(since);
}

function buildCampaignDataUrl(env, campaignId, filename) {
  const base = String(env.FE_URL || "").trim() || "https://khuzoe.github.io/sigillo-del-male/";
  const target = new URL(base.endsWith("/") ? base : `${base}/`);
  const cleanCampaignId = sanitizeCampaignId(campaignId);
  target.pathname = `${target.pathname.replace(/\/+$/, "")}/campaigns/${cleanCampaignId}/data/${String(filename || "").replace(/^\/+/, "")}`;
  return target.toString();
}

function sanitizeBootstrapId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
}


function matchManagedActorRoute(pathname) {
  const match = String(pathname || "").match(/^\/api\/managed-actors\/([A-Za-z0-9_-]{1,96})\/([A-Za-z0-9_-]{1,96})$/);
  if (!match) return null;
  const worldId = sanitizeManagedActorId(match[1]);
  const actorId = sanitizeManagedActorId(match[2]);
  return worldId && actorId ? { worldId, actorId } : null;
}


function matchManagedActorLegacyAdoptRoute(pathname) {
  const match = String(pathname || "").match(/^\/api\/managed-actors\/([A-Za-z0-9_-]{1,96})\/([A-Za-z0-9_-]{1,96})\/adopt-legacy$/);
  if (!match) return null;
  const worldId = sanitizeManagedActorId(match[1]);
  const actorId = sanitizeManagedActorId(match[2]);
  return worldId && actorId ? { worldId, actorId } : null;
}
function matchManagedActorProfileRoute(pathname) {
  const match = String(pathname || "").match(/^\/api\/managed-actors\/([A-Za-z0-9_-]{1,96})\/([A-Za-z0-9_-]{1,96})\/profile$/);
  if (!match) return null;
  const worldId = sanitizeManagedActorId(match[1]);
  const actorId = sanitizeManagedActorId(match[2]);
  return worldId && actorId ? { worldId, actorId } : null;
}

function matchManagedActorProfileResolveRoute(pathname) {
  const match = String(pathname || "").match(/^\/api\/managed-actor-profiles\/resolve\/([A-Za-z0-9_-]{1,128})$/);
  if (!match) return null;
  const legacyCharacterId = sanitizeAssetId(match[1]);
  return legacyCharacterId ? { legacyCharacterId } : null;
}

function matchManagedActorRuntimeRoute(pathname) {
  const match = String(pathname || "").match(/^\/api\/managed-actors\/([A-Za-z0-9_-]{1,96})\/([A-Za-z0-9_-]{1,96})\/runtime$/);
  if (!match) return null;
  const worldId = sanitizeManagedActorId(match[1]);
  const actorId = sanitizeManagedActorId(match[2]);
  return worldId && actorId ? { worldId, actorId } : null;
}

function matchManagedActorRelationshipRoute(pathname) {
  const match = String(pathname || "").match(/^\/api\/managed-actors\/([A-Za-z0-9_-]{1,96})\/([A-Za-z0-9_-]{1,96})\/relationship$/);
  if (!match) return null;
  const worldId = sanitizeManagedActorId(match[1]);
  const actorId = sanitizeManagedActorId(match[2]);
  return worldId && actorId ? { worldId, actorId } : null;
}

function matchManagedActorCommandRoute(pathname) {
  const match = String(pathname || "").match(/^\/api\/managed-actors\/([A-Za-z0-9_-]{1,96})\/([A-Za-z0-9_-]{1,96})\/commands$/);
  if (!match) return null;
  const worldId = sanitizeManagedActorId(match[1]);
  const actorId = sanitizeManagedActorId(match[2]);
  return worldId && actorId ? { worldId, actorId } : null;
}

function matchManagedActorCommandBatchRoute(pathname) {
  const match = String(pathname || "").match(/^\/api\/managed-actor-commands\/([A-Za-z0-9_-]{1,96})(?:\/(ack))?$/);
  if (!match) return null;
  const worldId = sanitizeManagedActorId(match[1]);
  return worldId ? { worldId, action: match[2] === "ack" ? "ack" : "list" } : null;
}
function sanitizeManagedActorId(value) {
  const id = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return id && id.length <= 96 ? id : "";
}

function managedActorVisibilityState(value) {
  const state = String(value?.state || value || "dm").trim().toLowerCase();
  return ["public", "players", "owners", "dm"].includes(state) ? state : "dm";
}
function normalizeManagedActorRelationshipType(value, actorType = "", ownerCharacterId = "") {
  const requested = String(value || "").trim().toLowerCase();
  if (["player", "companion"].includes(requested)) return requested;
  const type = String(actorType || "").trim().toLowerCase();
  if (ownerCharacterId && ["character", "player"].includes(type)) return "player";
  if (ownerCharacterId && type === "npc") return "companion";
  return "";
}


function getOptionalAuthenticatedUser(request, env) {
  const auth = String(request.headers.get("Authorization") || "");
  if (!auth.toLowerCase().startsWith("bearer ")) return Promise.resolve(null);
  return verifyJWT(String(env.JWT_SECRET), auth.slice(7).trim());
}

function isFoundrySyncSecretAuthorized(request, env) {
  const expected = String(env.INVENTORY_SYNC_SECRET || "").trim();
  if (!expected) return false;
  const provided = String(
    request.headers.get("X-Cripta-Inventory-Secret")
    || request.headers.get("X-Inventory-Sync-Secret")
    || ""
  ).trim();
  return Boolean(provided && provided === expected);
}

async function authorizeFoundryLive(request, env, campaignId, corsHeaders = {}) {
  if (isFoundrySyncSecretAuthorized(request, env)) {
    return { source: "foundry-secret", accountId: "foundry" };
  }
  const user = await requireUser(request, env, corsHeaders);
  if (user instanceof Response) return user;
  if (!await isAuthenticatedCampaignContentEditor(user, env, campaignId)) {
    return json({ ok: false, error: "Forbidden: live sync requires campaign editor permissions" }, 403, corsHeaders);
  }
  return {
    source: "campaign-editor",
    accountId: getAuthenticatedAccountId(user, env) || "campaign-editor",
  };
}

async function handleFoundryLiveTicket(request, fallbackCampaignId, env, corsHeaders = {}) {
  if (!env.JWT_SECRET) return json({ ok: false, error: "Missing env.JWT_SECRET" }, 500, corsHeaders);
  if (!env.FOUNDRY_SYNC_HUB) return json({ ok: false, error: "Missing env.FOUNDRY_SYNC_HUB" }, 503, corsHeaders);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }
  const campaignId = sanitizeCampaignId(body?.campaignId || body?.campaign || fallbackCampaignId);
  const worldId = sanitizeManagedActorId(body?.worldId || "");
  const clientId = sanitizeManagedActorId(body?.clientId || "") || crypto.randomUUID();
  if (!worldId) return json({ ok: false, error: "Missing worldId" }, 400, corsHeaders);
  const authorization = await authorizeFoundryLive(request, env, campaignId, corsHeaders);
  if (authorization instanceof Response) return authorization;

  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 90;
  const ticket = await makeJWT(String(env.JWT_SECRET), {
    purpose: "foundry-live",
    campaignId,
    worldId,
    clientId,
    accountId: authorization.accountId,
    source: authorization.source,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + expiresIn,
  });
  return json({
    ok: true,
    campaignId,
    worldId,
    clientId,
    ticket,
    expiresIn,
    socketUrl: new URL("/api/foundry/live", request.url).toString().replace(/^http/i, "ws"),
  }, 200, { ...corsHeaders, "Cache-Control": "private, no-store" });
}

async function handleFoundryLiveConnect(request, fallbackCampaignId, env, corsHeaders = {}) {
  if (!env.JWT_SECRET) return json({ ok: false, error: "Missing env.JWT_SECRET" }, 500, corsHeaders);
  if (!env.FOUNDRY_SYNC_HUB) return json({ ok: false, error: "Missing env.FOUNDRY_SYNC_HUB" }, 503, corsHeaders);
  if (String(request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
    return json({ ok: false, error: "Expected WebSocket upgrade" }, 426, corsHeaders);
  }
  const url = new URL(request.url);
  const ticket = String(url.searchParams.get("ticket") || "").trim();
  const claims = ticket ? await verifyJWT(String(env.JWT_SECRET), ticket) : null;
  if (!claims || claims.purpose !== "foundry-live") {
    return json({ ok: false, error: "Invalid or expired live sync ticket" }, 401, corsHeaders);
  }
  const campaignId = sanitizeCampaignId(claims.campaignId);
  const requestedCampaignId = sanitizeCampaignId(url.searchParams.get("campaign") || fallbackCampaignId);
  const worldId = sanitizeManagedActorId(claims.worldId);
  const clientId = sanitizeManagedActorId(claims.clientId) || crypto.randomUUID();
  if (!campaignId || !worldId || requestedCampaignId !== campaignId) {
    return json({ ok: false, error: "Live sync ticket scope mismatch" }, 403, corsHeaders);
  }

  const id = env.FOUNDRY_SYNC_HUB.idFromName(campaignId);
  const stub = env.FOUNDRY_SYNC_HUB.get(id);
  return stub.fetch("https://foundry-sync-hub/connect", {
    method: "GET",
    headers: {
      Upgrade: "websocket",
      "X-Sigillo-Campaign": campaignId,
      "X-Sigillo-World": worldId,
      "X-Sigillo-Client": clientId,
    },
  });
}

async function handleFoundryLiveStatus(request, fallbackCampaignId, env, corsHeaders = {}) {
  if (!env.FOUNDRY_SYNC_HUB) return json({ ok: false, error: "Missing env.FOUNDRY_SYNC_HUB" }, 503, corsHeaders);
  const url = new URL(request.url);
  const campaignId = sanitizeCampaignId(url.searchParams.get("campaign") || fallbackCampaignId);
  const authorization = await authorizeFoundryLive(request, env, campaignId, corsHeaders);
  if (authorization instanceof Response) return authorization;
  const id = env.FOUNDRY_SYNC_HUB.idFromName(campaignId);
  const response = await env.FOUNDRY_SYNC_HUB.get(id).fetch("https://foundry-sync-hub/status");
  const payload = await response.json().catch(() => ({ ok: false, error: "Invalid live sync status" }));
  return json({ ...payload, campaignId }, response.status, { ...corsHeaders, "Cache-Control": "private, no-store" });
}

function scheduleFoundryLiveInvalidation(ctx, env, input = {}) {
  if (!env?.FOUNDRY_SYNC_HUB) return false;
  const campaignId = sanitizeCampaignId(input.campaignId);
  const collections = Array.from(new Set((Array.isArray(input.collections) ? input.collections : [])
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)));
  if (!campaignId || !collections.length) return false;
  const event = {
    type: "invalidate",
    schemaVersion: 1,
    eventId: crypto.randomUUID(),
    campaignId,
    worldId: sanitizeManagedActorId(input.worldId || ""),
    worldIds: Array.from(new Set((Array.isArray(input.worldIds) ? input.worldIds : [])
      .map(sanitizeManagedActorId)
      .filter(Boolean))),
    collections,
    actorIds: Array.from(new Set((Array.isArray(input.actorIds) ? input.actorIds : [])
      .map(sanitizeManagedActorId)
      .filter(Boolean))),
    reason: String(input.reason || "site-update").trim().slice(0, 96),
    revision: Math.max(0, Math.floor(Number(input.revision) || 0)),
    emittedAt: new Date().toISOString(),
  };
  const id = env.FOUNDRY_SYNC_HUB.idFromName(campaignId);
  const task = env.FOUNDRY_SYNC_HUB.get(id).fetch("https://foundry-sync-hub/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  }).then(async (response) => {
    if (response.ok) return true;
    const detail = await response.text().catch(() => "");
    throw new Error(`Live sync publish HTTP ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`);
  }).catch((error) => {
    console.warn("sigillo-api | Notifica live Foundry rimandata al fallback.", {
      campaignId,
      collections,
      error: String(error?.message || error),
    });
    return false;
  });
  if (ctx?.waitUntil) ctx.waitUntil(task);
  return true;
}

async function authorizeManagedActorWrite(request, env, campaignId, corsHeaders, actor = null) {
  if (isFoundrySyncSecretAuthorized(request, env)) return { source: "foundry", user: null, isEditor: true, isOwner: false };
  const user = await requireUser(request, env, corsHeaders);
  if (user instanceof Response) return user;
  const isEditor = await isAuthenticatedCampaignContentEditor(user, env, campaignId);
  const isOwner = isManagedActorOwner(actor, user, env);
  if (!isEditor && !isOwner) {
    return json({ ok: false, error: "Forbidden: managed actor editing requires campaign editor or actor owner permissions" }, 403, corsHeaders);
  }
  return { source: "site", user, isEditor, isOwner };
}

function managedActorIndexEntry(document, previousEntry = null) {
  return {
    id: document.id,
    worldId: document.worldId,
    actorId: document.actorId,
    foundryActorId: document.foundryActorId || document.actorId,
    name: document.name,
    actorType: document.actorType,
    relationshipType: normalizeManagedActorRelationshipType(document.relationshipType, document.actorType, document.ownerCharacterId),
    ownerCharacterId: document.ownerCharacterId || "",
    ownerAccountIds: Array.isArray(document.ownerAccountIds) ? document.ownerAccountIds : [],
    visibility: document.visibility,
    relationshipRevision: Math.max(0, Math.floor(Number(document.relationshipRevision) || 0)),
    media: {
      avatar: document.media?.avatar || null,
      token: document.media?.token || null,
      idle: document.media?.idle || null,
      hover: document.media?.hover || null,
    },
    profile: previousEntry?.profile || null,
    revision: document.revision,
    updatedAt: document.updatedAt,
  };
}

function managedActorIndexEntryComparable(entry) {
  if (!entry) return "";
  const { updatedAt, ...stable } = entry;
  return JSON.stringify(stable);
}

function canReadManagedActor(entry, user, isEditor, env) {
  const state = managedActorVisibilityState(entry?.visibility);
  if (state === "public" || entry?.visibility?.published === true) return true;
  if (isEditor) return true;
  if (!user) return false;
  if (state === "players") return true;
  return isManagedActorOwner(entry, user, env);
}

function isManagedActorOwner(entry, user, env) {
  const accountId = getAuthenticatedAccountId(user, env);
  const owners = Array.isArray(entry?.ownerAccountIds) ? entry.ownerAccountIds.map(sanitizeAccountId) : [];
  return Boolean(accountId && owners.includes(accountId));
}

function canEditPublicManagedNpcStats(entry, user) {
  const actorType = String(entry?.actorType || "").trim().toLowerCase();
  return Boolean(user && actorType === "npc" && managedActorVisibilityState(entry?.visibility) === "public");
}

async function authorizeManagedActorStatsWrite(request, env, campaignId, corsHeaders, actor) {
  const user = await requireUser(request, env, corsHeaders);
  if (user instanceof Response) return user;
  const isEditor = await isAuthenticatedCampaignContentEditor(user, env, campaignId);
  const isOwner = isManagedActorOwner(actor, user, env);
  const canEditPublicStats = canEditPublicManagedNpcStats(actor, user);
  if (!isEditor && !isOwner && !canEditPublicStats) {
    return json({ ok: false, error: "Forbidden: managed actor statistics are not editable" }, 403, corsHeaders);
  }
  return { source: "site", user, isEditor, isOwner, canEditPublicStats };
}

async function getManagedActorReader(request, env, campaignId) {
  if (isFoundrySyncSecretAuthorized(request, env)) return { user: null, isEditor: true };
  const user = await getOptionalAuthenticatedUser(request, env);
  const isEditor = Boolean(user && await isAuthenticatedCampaignContentEditor(user, env, campaignId));
  return { user, isEditor };
}
async function handleCampaignAccessGet(request, campaignId, env, corsHeaders = {}) {
  const user = await getOptionalAuthenticatedUser(request, env);
  const isEditor = Boolean(user && await isAuthenticatedCampaignContentEditor(user, env, campaignId));
  return json({
    ok: true,
    campaignId,
    authenticated: Boolean(user),
    permissions: { isEditor, canManageCampaign: isEditor },
  }, 200, {
    ...corsHeaders,
    "Cache-Control": user ? "private, no-store" : "public, max-age=60, must-revalidate",
  });
}

function sanitizeNpcCategoryId(value) {
  return sanitizeBootstrapId(value).slice(0, 80);
}

function normalizeNpcCategoryRecord(value, index = 0) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const name = String(input.name || input.label || "").trim().slice(0, 120);
  const id = sanitizeNpcCategoryId(input.id || name);
  if (!id || !name) return null;
  const orderValue = Number(input.order);
  const color = /^#[0-9a-f]{6}$/i.test(String(input.color || ""))
    ? String(input.color).toLowerCase()
    : "#b99a45";
  const icon = String(input.icon || "fa-folder-open")
    .replace(/[^A-Za-z0-9_-]+/g, "")
    .slice(0, 64) || "fa-folder-open";
  return {
    id,
    name,
    order: Number.isFinite(orderValue) ? Math.round(orderValue) : ((index + 1) * 10),
    color,
    icon,
    archived: input.archived === true,
    mergedInto: sanitizeNpcCategoryId(input.mergedInto || ""),
  };
}

function normalizeNpcCategoryRegistryDocument(value, campaignId) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const seen = new Set();
  const categories = (Array.isArray(input.categories) ? input.categories : [])
    .slice(0, 160)
    .map(normalizeNpcCategoryRecord)
    .filter((category) => {
      if (!category || seen.has(category.id)) return false;
      seen.add(category.id);
      return true;
    })
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, "it"));
  return {
    schemaVersion: 1,
    campaignId,
    revision: Math.max(0, Math.floor(Number(input.revision) || 0)),
    updatedAt: input.updatedAt || null,
    updatedBy: String(input.updatedBy || "").slice(0, 120),
    categories,
  };
}

async function readNpcCategoryRegistry(env, campaignId) {
  const raw = await env.SIGILLO_KV.get(npcCategoryRegistryKey(campaignId));
  return normalizeNpcCategoryRegistryDocument(safeJsonParse(raw), campaignId);
}

function resolveNpcCategoryRecord(registry, requestedId, fallbackName = "") {
  const categories = Array.isArray(registry?.categories) ? registry.categories : [];
  const byId = new Map(categories.map((category) => [category.id, category]));
  let id = sanitizeNpcCategoryId(requestedId || fallbackName);
  const visited = new Set();
  while (id && byId.has(id) && !visited.has(id)) {
    visited.add(id);
    const category = byId.get(id);
    if (!category.mergedInto || !byId.has(category.mergedInto)) return category;
    id = category.mergedInto;
  }
  return byId.get(sanitizeNpcCategoryId(fallbackName)) || null;
}

function enrichManagedActorProfileCategory(profile, registry) {
  if (!profile || typeof profile !== "object") return profile;
  const sourceId = sanitizeNpcCategoryId(profile.categoryId || profile.category || "");
  const resolved = resolveNpcCategoryRecord(registry, sourceId, profile.category);
  if (!resolved) {
    return {
      ...profile,
      categoryId: sourceId,
      category: String(profile.category || "").trim().slice(0, 120),
    };
  }
  return {
    ...profile,
    categorySourceId: sourceId && sourceId !== resolved.id ? sourceId : "",
    categoryId: resolved.id,
    category: resolved.name,
    categoryOrder: resolved.order,
    categoryColor: resolved.color,
    categoryIcon: resolved.icon,
    categoryArchived: resolved.archived === true,
  };
}

function addNpcCategoryUsage(usage, categoryId, categoryName, order = null) {
  const name = String(categoryName || "").trim().slice(0, 120);
  const id = sanitizeNpcCategoryId(categoryId || name);
  if (!id || !name) return;
  const previous = usage.get(id) || { id, name, usageCount: 0, order: null };
  previous.usageCount += 1;
  if (!previous.name) previous.name = name;
  const numericOrder = Number(order);
  if (Number.isFinite(numericOrder) && (previous.order === null || numericOrder < previous.order)) {
    previous.order = Math.round(numericOrder);
  }
  usage.set(id, previous);
}

async function collectNpcCategoryUsage(env, campaignId) {
  const indexRaw = await env.SIGILLO_KV.get(managedActorIndexKey(campaignId));
  const storedIndex = safeJsonParse(indexRaw) || { version: 0, campaignId, data: [] };
  const indexDoc = await hydrateManagedActorProfileIndex(storedIndex, campaignId, env);
  const entries = Array.isArray(indexDoc.data) ? indexDoc.data : [];
  const usage = new Map();
  const managedLegacyIds = new Set();

  entries.forEach((entry) => {
    const profile = entry?.profile;
    if (!profile) return;
    const legacyId = sanitizeAssetId(profile.legacyCharacterId || "");
    if (legacyId) managedLegacyIds.add(legacyId);
    addNpcCategoryUsage(usage, profile.categoryId, profile.category, profile.categoryOrder);
  });

  const charactersDocument = await readDataCollectionDocument("characters", campaignId, env);
  (Array.isArray(charactersDocument?.data) ? charactersDocument.data : []).forEach((character) => {
    if (String(character?.type || "npc").trim().toLowerCase() !== "npc") return;
    const legacyId = sanitizeAssetId(character?.id || character?.name || "");
    if (legacyId && managedLegacyIds.has(legacyId)) return;
    const categoryName = character?.category || character?.group || character?.faction || "";
    addNpcCategoryUsage(usage, character?.categoryId, categoryName, character?.categoryPriority);
  });
  return usage;
}

async function buildNpcCategoryRegistryView(env, campaignId, storedRegistry = null) {
  const registry = storedRegistry || await readNpcCategoryRegistry(env, campaignId);
  const usage = await collectNpcCategoryUsage(env, campaignId);
  const storedIds = new Set(registry.categories.map((category) => category.id));
  const categories = registry.categories.map((category) => ({
    ...category,
    inferred: false,
    usageCount: usage.get(category.id)?.usageCount || 0,
  }));
  usage.forEach((entry) => {
    if (storedIds.has(entry.id)) return;
    categories.push({
      id: entry.id,
      name: entry.name,
      order: entry.order ?? (1000 + (categories.length * 10)),
      color: "#b99a45",
      icon: "fa-folder-open",
      archived: false,
      mergedInto: "",
      inferred: true,
      usageCount: entry.usageCount,
    });
  });
  categories.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, "it"));
  return { ...registry, categories };
}

function validateNpcCategoryAliases(categories) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const activeNames = new Set();
  for (const category of categories) {
    if (!category.archived && !category.mergedInto) {
      const nameKey = sanitizeNpcCategoryId(category.name);
      if (activeNames.has(nameKey)) return "Non possono esistere due categorie attive con lo stesso nome.";
      activeNames.add(nameKey);
    }

    if (!category.mergedInto) continue;
    const target = byId.get(category.mergedInto);
    if (!target || target.id === category.id) return "Ogni unione deve indicare una categoria di destinazione valida.";
    const visited = new Set([category.id]);
    let cursor = target;
    while (cursor?.mergedInto) {
      if (visited.has(cursor.id)) return "Le unioni tra categorie non possono formare un ciclo.";
      visited.add(cursor.id);
      cursor = byId.get(cursor.mergedInto);
      if (!cursor) return "Una categoria unita punta a una destinazione inesistente.";
    }
  }
  return "";
}

async function authorizeNpcCategoryManagement(request, env, campaignId, corsHeaders) {
  if (isFoundrySyncSecretAuthorized(request, env)) return { source: "foundry", user: null };
  const user = await requireUser(request, env, corsHeaders);
  if (user instanceof Response) return user;
  if (!await isAuthenticatedCampaignContentEditor(user, env, campaignId)) {
    return json({ ok: false, error: "Forbidden: category management requires campaign editor permissions" }, 403, corsHeaders);
  }
  return { source: "site", user };
}

async function handleNpcCategoriesGet(request, campaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  const authorization = await authorizeNpcCategoryManagement(request, env, campaignId, corsHeaders);
  if (authorization instanceof Response) return authorization;
  const data = await buildNpcCategoryRegistryView(env, campaignId);
  return json({ ok: true, campaignId, revision: data.revision, data }, 200, {
    ...corsHeaders,
    "Cache-Control": "private, no-store",
  });
}

async function handleNpcCategoriesPost(request, campaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  const authorization = await authorizeNpcCategoryManagement(request, env, campaignId, corsHeaders);
  if (authorization instanceof Response) return authorization;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }
  if (JSON.stringify(body || {}).length > 120_000) {
    return json({ ok: false, error: "NPC category document is too large" }, 413, corsHeaders);
  }

  const existing = await readNpcCategoryRegistry(env, campaignId);
  const expectedRevision = Math.max(0, Math.floor(Number(body?.expectedRevision) || 0));
  if (expectedRevision !== existing.revision) {
    return json({ ok: false, error: "NPC category revision conflict", expectedRevision, currentRevision: existing.revision }, 409, corsHeaders);
  }

  const seen = new Set();
  const categories = (Array.isArray(body?.categories) ? body.categories : [])
    .slice(0, 160)
    .map(normalizeNpcCategoryRecord)
    .filter((category) => {
      if (!category || seen.has(category.id)) return false;
      seen.add(category.id);
      return true;
    });
  const aliasError = validateNpcCategoryAliases(categories);
  if (aliasError) return json({ ok: false, error: aliasError }, 400, corsHeaders);

  const usage = await collectNpcCategoryUsage(env, campaignId);
  const nextIds = new Set(categories.map((category) => category.id));
  const unsafeRemoval = existing.categories.find((category) => !nextIds.has(category.id) && (usage.get(category.id)?.usageCount || 0) > 0);
  if (unsafeRemoval) {
    return json({ ok: false, error: "La categoria " + unsafeRemoval.name + " e ancora assegnata: archiviarla o unirla prima di rimuoverla." }, 409, corsHeaders);
  }

  const now = new Date().toISOString();
  const next = normalizeNpcCategoryRegistryDocument({
    schemaVersion: 1,
    campaignId,
    revision: existing.revision + 1,
    updatedAt: now,
    updatedBy: authorization.source === "foundry"
      ? "foundry"
      : (getAuthenticatedAccountId(authorization.user, env) || "campaign-editor"),
    categories,
  }, campaignId);
  await env.SIGILLO_KV.put(npcCategoryRegistryKey(campaignId), JSON.stringify(next));
  const data = await buildNpcCategoryRegistryView(env, campaignId, next);
  return json({ ok: true, saved: true, campaignId, revision: next.revision, data }, 200, {
    ...corsHeaders,
    "Cache-Control": "private, no-store",
  });
}

function managedActorProfileVisibilityState(value) {
  const state = String(value?.state || value || "dm").trim().toLowerCase();
  return state === "dm" ? "dm" : "public";
}

function normalizeManagedNpcLifeState(value, fallback = "") {
  const state = String(value || fallback || "").trim().toLowerCase();
  if (["alive", "vivo", "viva"].includes(state) || state.includes("viv")) return "alive";
  if (["dead", "morto", "morta"].includes(state) || state.includes("mort")) return "dead";
  return "unknown";
}

function managedActorProfileBlockVisibility(value, hidden = false) {
  if (hidden === true) return "dm";
  const state = String(value?.state || value || "public").trim().toLowerCase();
  return state === "dm" ? "dm" : "public";
}

function managedActorProfileIndexMetadata(profile) {
  if (!profile || typeof profile !== "object") return null;
  const blocks = Array.isArray(profile.blocks) ? profile.blocks : [];
  return {
    visibility: { state: managedActorProfileVisibilityState(profile.visibility) },
    legacyCharacterId: sanitizeAssetId(profile.legacyCharacterId || ""),
    categoryId: sanitizeNpcCategoryId(profile.categoryId || profile.category || ""),
    category: String(profile.category || "").trim().slice(0, 120),
    role: String(profile.role || "").trim().slice(0, 240),
    quote: String(profile.quote || "").trim().slice(0, 1_000),
    lifeState: normalizeManagedNpcLifeState(profile.lifeState, profile.status),
    status: String(profile.status || "").trim().slice(0, 80),
    hasContent: Boolean(profile.categoryId || profile.category || profile.role || profile.quote || blocks.length),
    revision: Math.max(0, Math.floor(Number(profile.revision) || 0)),
    updatedAt: profile.updatedAt || null,
  };
}

function canReadManagedActorProfileIndex(profile, user, isEditor, entry = null, env = null) {
  if (!profile) return false;
  return canReadManagedActorProfile(profile, user, isEditor, entry, env);
}

async function hydrateManagedActorProfileIndex(doc, campaignId, env) {
  if (Number(doc?.profileAccessVersion || 0) >= 1) return doc;
  const entries = Array.isArray(doc?.data) ? doc.data : [];
  const profileDocuments = await Promise.all(entries.map(async (entry) => {
    const raw = await env.SIGILLO_KV.get(managedActorProfileKey(campaignId, entry.worldId, entry.actorId));
    return safeJsonParse(raw);
  }));
  let changed = false;
  const data = entries.map((entry, index) => {
    const profile = managedActorProfileIndexMetadata(profileDocuments[index]);
    if (!profile) return entry;
    const nextEntry = { ...entry, profile };
    if (managedActorIndexEntryComparable(entry) !== managedActorIndexEntryComparable(nextEntry)) changed = true;
    return nextEntry;
  });
  const next = {
    ...doc,
    profileAccessVersion: 1,
    version: Number(doc?.version || 0) + 1,
    updatedAt: changed ? new Date().toISOString() : (doc?.updatedAt || null),
    data,
  };
  await env.SIGILLO_KV.put(managedActorIndexKey(campaignId), JSON.stringify(next));
  return next;
}

async function updateManagedActorProfileIndex(env, campaignId, actor, profile) {
  const indexKey = managedActorIndexKey(campaignId);
  const indexDoc = safeJsonParse(await env.SIGILLO_KV.get(indexKey)) || { version: 0, campaignId, data: [] };
  const entries = Array.isArray(indexDoc.data) ? indexDoc.data : [];
  const actorId = `${actor.worldId}:${actor.actorId}`;
  const previousEntry = entries.find((entry) => entry?.id === actorId) || null;
  const nextEntry = {
    ...managedActorIndexEntry(actor, previousEntry),
    profile: managedActorProfileIndexMetadata(profile),
  };
  if (managedActorIndexEntryComparable(previousEntry) === managedActorIndexEntryComparable(nextEntry)) return false;
  const data = [...entries.filter((entry) => entry?.id !== actorId), nextEntry]
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
  await env.SIGILLO_KV.put(indexKey, JSON.stringify({
    ...indexDoc,
    version: Number(indexDoc.version || 0) + 1,
    campaignId,
    updatedAt: new Date().toISOString(),
    data,
  }));
  return true;
}

function normalizeManagedActorProfileText(value, maxLength = 50_000) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .slice(0, maxLength);
}

function normalizeManagedActorProfileMediaPath(value) {
  const clean = String(value || "").trim().replace(/^\/+/, "").slice(0, 1_000);
  if (!clean || clean.includes("..")) return "";
  if (/^https:\/\/sigillo-api\.khuzoe\.workers\.dev\/media\//i.test(clean)) return clean;
  if (/^(media|icons|systems|modules|worlds)\/[A-Za-z0-9_./%+@'() -]+\.(png|jpe?g|webp|gif|svg)$/i.test(clean)) return clean;
  return "";
}

function normalizeManagedActorProfileMediaSlot(value) {
  const input = typeof value === "string" ? { path: value } : value;
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const path = normalizeManagedActorProfileMediaPath(input.path || input.src);
  if (!path) return null;
  const presentation = normalizeManagedActorPresentation(input.presentation);
  return { path, ...(presentation ? { presentation } : {}) };
}

function normalizeManagedActorProfileMedia(value, fallback = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const previous = fallback && typeof fallback === "object" ? fallback : {};
  return {
    avatar: normalizeManagedActorProfileMediaSlot(input.avatar) || normalizeManagedActorProfileMediaSlot(previous.avatar),
    idle: normalizeManagedActorProfileMediaSlot(input.idle) || normalizeManagedActorProfileMediaSlot(previous.idle),
    hover: normalizeManagedActorProfileMediaSlot(input.hover) || normalizeManagedActorProfileMediaSlot(previous.hover),
  };
}

function managedActorProfileMediaFromActor(actor) {
  return normalizeManagedActorProfileMedia({
    avatar: actor?.media?.avatar,
    idle: actor?.media?.idle,
    hover: actor?.media?.hover,
  });
}

function managedActorProfileMediaComparable(value) {
  return JSON.stringify(normalizeManagedActorProfileMedia(value));
}

function managedActorProfileWithCurrentMedia(profile, actor) {
  return {
    ...profile,
    media: managedActorProfileMediaFromActor(actor),
    name: String(actor?.name || profile?.name || "NPC").trim().slice(0, 180),
    mediaSyncVersion: 1,
    mediaUpdatedAt: actor?.updatedAt || profile?.mediaUpdatedAt || null,
  };
}

async function syncStoredManagedActorProfileMedia(env, campaignId, route, actor) {
  const key = managedActorProfileKey(campaignId, route.worldId, route.actorId);
  const profile = safeJsonParse(await env.SIGILLO_KV.get(key));
  if (!profile) return false;
  const next = managedActorProfileWithCurrentMedia(profile, actor);
  if (Number(profile.mediaSyncVersion || 0) >= 1
    && managedActorProfileMediaComparable(profile.media) === managedActorProfileMediaComparable(next.media)
    && String(profile.name || "") === String(next.name || "")
    && String(profile.mediaUpdatedAt || "") === String(next.mediaUpdatedAt || "")) return false;
  await env.SIGILLO_KV.put(key, JSON.stringify(next));
  return true;
}

function normalizeManagedActorProfileBlock(block, index = 0) {
  const input = block && typeof block === "object" && !Array.isArray(block) ? block : {};
  const allowedTypes = new Set(["lore", "image_box", "banner_box", "custom_box", "secret_dossier"]);
  const legacyTypeAliases = {
    text: "lore",
    image: "image_box",
    banner: "banner_box",
    custom: "custom_box",
    secret: "secret_dossier",
  };
  const rawType = String(input.type || (input.image ? "image_box" : "lore")).trim().toLowerCase();
  const requestedType = legacyTypeAliases[rawType] || rawType;
  const type = allowedTypes.has(requestedType) ? requestedType : "lore";
  const fallbackId = `blocco-${index + 1}`;
  const id = sanitizeAssetId(input.id || input.title || fallbackId) || fallbackId;
  const image = normalizeManagedActorProfileMediaPath(input.image);
  const banner = normalizeManagedActorProfileMediaPath(input.banner);
  const text = normalizeManagedActorProfileText(input.markdownText ?? input.text ?? input.content ?? "");
  const tags = Array.isArray(input.tags)
    ? input.tags.map((tag) => String(tag || "").trim().slice(0, 40)).filter(Boolean).slice(0, 12)
    : [];
  return {
    id,
    type,
    title: String(input.title || "Informazioni").trim().slice(0, 180),
    icon: String(input.icon || (type === "image_box" ? "fa-book-open" : "fa-scroll")).trim().replace(/[^A-Za-z0-9_-]+/g, "").slice(0, 64),
    text,
    visibility: managedActorProfileBlockVisibility(input.visibility, input.hidden === true),
    ...(image ? { image } : {}),
    ...(banner ? { banner } : {}),
    ...(input.image_caption ? { imageCaption: String(input.image_caption).trim().slice(0, 500) } : {}),
    ...(input.borderColor ? { borderColor: String(input.borderColor).trim().slice(0, 32) } : {}),
    ...(tags.length ? { tags } : {}),
  };
}

function normalizeManagedActorProfileSummary(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    race: String(input.race || "").trim().slice(0, 120),
    birthYear: String(input.birthYear || input.birth_year || "").trim().slice(0, 80),
    age: String(input.age || "").trim().slice(0, 80),
    height: String(input.height || "").trim().slice(0, 80),
    weight: String(input.weight || "").trim().slice(0, 80),
  };
}

function managedActorProfileFromLegacy(character, actor, campaignId, route) {
  const source = character && typeof character === "object" ? character : {};
  const legacyBlocks = Array.isArray(source.content_blocks)
    ? source.content_blocks
    : (Array.isArray(source.blocks) ? source.blocks : []);
  const legacyImages = source.images && typeof source.images === "object" ? source.images : {};
  const actorMedia = actor?.media || {};
  const media = normalizeManagedActorProfileMedia({
    avatar: legacyImages.avatar || legacyImages.portrait || actorMedia.avatar,
    idle: legacyImages.idle || actorMedia.idle,
    hover: legacyImages.hover || actorMedia.hover,
  });
  return {
    schemaVersion: 1,
    id: `${route.worldId}:${route.actorId}:profile`,
    campaignId,
    worldId: route.worldId,
    actorId: route.actorId,
    legacyCharacterId: sanitizeAssetId(source.id || source.name || ""),
    categoryId: sanitizeNpcCategoryId(source.categoryId || source.category || source.group || source.faction || ""),
    category: String(source.category || source.group || source.faction || "").trim().slice(0, 120),
    name: String(source.name || actor?.name || "NPC").trim().slice(0, 180),
    role: String(source.role || source.subtitle || "").trim().slice(0, 240),
    quote: String(source.quote || "").trim().slice(0, 1_000),
    lifeState: normalizeManagedNpcLifeState(source.lifeState, source.status),
    status: String(source.status || "").trim().slice(0, 80),
    visibility: { state: source.hidden === true ? "dm" : "public" },
    summary: normalizeManagedActorProfileSummary(source.summary),
    media,
    mediaSyncVersion: 1,
    mediaUpdatedAt: actor?.updatedAt || null,
    blocks: legacyBlocks.slice(0, 64).map(normalizeManagedActorProfileBlock),
    revision: 0,
    createdAt: null,
    updatedAt: source.updatedAt || null,
    updatedBy: "legacy",
  };
}

function emptyManagedActorProfile(actor, campaignId, route) {
  return {
    schemaVersion: 1,
    id: `${route.worldId}:${route.actorId}:profile`,
    campaignId,
    worldId: route.worldId,
    actorId: route.actorId,
    legacyCharacterId: "",
    categoryId: "",
    category: "",
    name: String(actor?.name || "NPC").trim().slice(0, 180),
    role: "",
    quote: "",
    lifeState: "unknown",
    status: "",
    visibility: { state: "dm" },
    summary: normalizeManagedActorProfileSummary({}),
    media: managedActorProfileMediaFromActor(actor),
    mediaSyncVersion: 1,
    mediaUpdatedAt: actor?.updatedAt || null,
    blocks: [],
    revision: 0,
    createdAt: null,
    updatedAt: null,
    updatedBy: "site",
  };
}

function normalizeManagedActorProfileDocument(input, existing, actor, campaignId, route, updatedBy) {
  const now = new Date().toISOString();
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const previous = existing && typeof existing === "object" ? existing : {};
  const blocks = Array.isArray(source.blocks) ? source.blocks.slice(0, 64).map(normalizeManagedActorProfileBlock) : (previous.blocks || []);
  return {
    schemaVersion: 1,
    id: `${route.worldId}:${route.actorId}:profile`,
    campaignId,
    worldId: route.worldId,
    actorId: route.actorId,
    legacyCharacterId: sanitizeAssetId(source.legacyCharacterId || previous.legacyCharacterId || ""),
    categoryId: sanitizeNpcCategoryId(source.categoryId !== undefined ? source.categoryId : (previous.categoryId || source.category || previous.category || "")),
    category: String(source.category ?? previous.category ?? "").trim().slice(0, 120),
    name: String(source.name || previous.name || actor?.name || "NPC").trim().slice(0, 180),
    role: String(source.role ?? previous.role ?? "").trim().slice(0, 240),
    quote: String(source.quote ?? previous.quote ?? "").trim().slice(0, 1_000),
    lifeState: normalizeManagedNpcLifeState(source.lifeState ?? previous.lifeState, source.status ?? previous.status),
    status: String(source.status ?? previous.status ?? "").trim().slice(0, 80),
    visibility: { state: managedActorProfileVisibilityState(source.visibility || previous.visibility) },
    summary: normalizeManagedActorProfileSummary(source.summary || previous.summary),
    media: managedActorProfileMediaFromActor(actor),
    mediaSyncVersion: 1,
    mediaUpdatedAt: actor?.updatedAt || previous.mediaUpdatedAt || null,
    blocks,
    revision: Number(previous.revision || 0) + 1,
    createdAt: previous.createdAt || now,
    updatedAt: now,
    updatedBy: String(updatedBy || "site").slice(0, 120),
  };
}

function canReadManagedActorProfile(profile, user, isEditor, actor = null, env = null) {
  if (isEditor || isManagedActorOwner(actor, user, env)) return true;
  return managedActorProfileVisibilityState(profile?.visibility) === "public";
}

function filterManagedActorProfileForReader(profile, user, isEditor, actor = null, env = null) {
  if (isEditor || isManagedActorOwner(actor, user, env)) return profile;
  const blocks = (Array.isArray(profile?.blocks) ? profile.blocks : [])
    .filter((block) => managedActorProfileBlockVisibility(block?.visibility) === "public");
  return { ...profile, blocks };
}
function preserveManagedProfileVisibilityForOwner(next, existing = null) {
  const profileState = existing
    ? managedActorProfileVisibilityState(existing.visibility)
    : "dm";
  const previousBlocks = new Map((Array.isArray(existing?.blocks) ? existing.blocks : [])
    .map((block) => [String(block?.id || ""), managedActorProfileBlockVisibility(block?.visibility, block?.hidden === true)]));
  const blocks = (Array.isArray(next?.blocks) ? next.blocks : []).map((block) => {
    const previousState = previousBlocks.get(String(block?.id || ""));
    const state = previousState || profileState;
    return { ...block, hidden: state === "dm", visibility: { state } };
  });
  return { ...next, legacyCharacterId: existing?.legacyCharacterId || "", categoryId: existing?.categoryId || "", category: existing?.category || "", visibility: { state: profileState }, blocks };
}



function legacyManagedActorMediaPath(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return String(value.path || value.src || value.url || "").trim();
}

function managedActorLegacySourceKey(value, campaignId) {
  const extracted = extractMediaKeyFromValue(legacyManagedActorMediaPath(value));
  if (!extracted) return "";
  const campaignPrefix = `campaigns/${campaignId}/`;
  if (extracted.startsWith("campaigns/")) {
    return extracted.startsWith(campaignPrefix) ? extracted : "";
  }
  return sanitizeMediaKey(`${campaignPrefix}${extracted}`);
}

function managedActorLegacyPresentation(value, fallback = null) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return normalizeManagedActorPresentation(input.presentation || input.adjust || fallback?.presentation);
}

function hasCuratedManagedActorProfile(profile) {
  if (!profile || Number(profile.revision || 0) < 1) return false;
  const summary = profile.summary && typeof profile.summary === "object" ? profile.summary : {};
  return Boolean(
    sanitizeAssetId(profile.legacyCharacterId || "")
    || String(profile.categoryId || profile.category || profile.role || profile.quote || profile.status || "").trim()
    || (Array.isArray(profile.blocks) && profile.blocks.length)
    || Object.values(summary).some((value) => String(value || "").trim())
  );
}

async function preflightManagedActorLegacyMedia(env, campaignId, entries) {
  if (!entries.length) return { ok: true, sources: new Map() };
  if (!env.MEDIA_BUCKET) return { ok: false, status: 500, error: "Missing env.MEDIA_BUCKET" };
  const sources = new Map();
  const missing = [];
  for (const entry of entries) {
    const sourceKey = managedActorLegacySourceKey(entry.source, campaignId);
    if (!sourceKey) {
      missing.push({ slot: entry.slot, path: legacyManagedActorMediaPath(entry.source), reason: "invalid-path" });
      continue;
    }
    const object = await env.MEDIA_BUCKET.head(sourceKey);
    if (!object) {
      missing.push({ slot: entry.slot, path: legacyManagedActorMediaPath(entry.source), key: sourceKey, reason: "not-found" });
      continue;
    }
    sources.set(entry.slot, { key: sourceKey, object });
  }
  return missing.length
    ? { ok: false, status: 422, error: "One or more legacy media files are missing", missing }
    : { ok: true, sources };
}

async function copyManagedActorLegacyMedia(env, options) {
  const {
    campaignId,
    route,
    migrationId,
    slot,
    source,
    destinationKey,
    required = true,
  } = options;
  if (!env.MEDIA_BUCKET) {
    if (!required) return { ok: false, slot, warning: "missing-media-bucket" };
    throw new Error("Missing env.MEDIA_BUCKET");
  }
  const sourceKey = managedActorLegacySourceKey(source, campaignId);
  if (!sourceKey) {
    if (!required) return { ok: false, slot, warning: "invalid-path", sourcePath: legacyManagedActorMediaPath(source) };
    throw new Error(`Invalid legacy media path for ${slot}`);
  }
  const sourceHead = await env.MEDIA_BUCKET.head(sourceKey);
  if (!sourceHead) {
    if (!required) return { ok: false, slot, warning: "not-found", sourceKey };
    throw new Error(`Legacy media not found for ${slot}`);
  }

  const destinationHead = await env.MEDIA_BUCKET.head(destinationKey);
  const sameObject = Boolean(
    destinationHead
    && Number(destinationHead.size || 0) === Number(sourceHead.size || 0)
    && normalizeHttpEtag(destinationHead.httpEtag)
    && normalizeHttpEtag(destinationHead.httpEtag) === normalizeHttpEtag(sourceHead.httpEtag)
  );
  if (sameObject) {
    return {
      ok: true,
      slot,
      copied: false,
      sourceKey,
      destinationKey,
      path: `media/${destinationKey}`,
      size: destinationHead.size,
      etag: destinationHead.httpEtag,
      backupKey: "",
    };
  }

  let backupKey = "";
  if (destinationHead) {
    const destinationObject = await env.MEDIA_BUCKET.get(destinationKey);
    if (!destinationObject) throw new Error(`Cannot back up existing ${slot} media`);
    const filename = destinationKey.split("/").pop();
    backupKey = `campaigns/${campaignId}/managed-actors/${route.worldId}/${route.actorId}/migration-backups/${migrationId}/${filename}`;
    await env.MEDIA_BUCKET.put(backupKey, destinationObject.body, {
      httpMetadata: destinationObject.httpMetadata,
      customMetadata: {
        ...(destinationObject.customMetadata || {}),
        migrationBackupOf: destinationKey,
        migrationId,
        backedUpAt: new Date().toISOString(),
      },
    });
    const storedBackup = await env.MEDIA_BUCKET.head(backupKey);
    if (!storedBackup || Number(storedBackup.size || 0) !== Number(destinationHead.size || 0)) {
      throw new Error(`R2 backup verification failed for ${slot}`);
    }
  }

  const sourceObject = await env.MEDIA_BUCKET.get(sourceKey);
  if (!sourceObject) throw new Error(`Legacy media disappeared during migration for ${slot}`);
  await env.MEDIA_BUCKET.put(destinationKey, sourceObject.body, {
    httpMetadata: {
      ...(sourceObject.httpMetadata || {}),
      contentType: sourceObject.httpMetadata?.contentType || "image/webp",
      cacheControl: mediaCacheControlForKey(destinationKey),
    },
    customMetadata: {
      ...(sourceObject.customMetadata || {}),
      campaignId,
      copiedFrom: sourceKey,
      copiedAt: new Date().toISOString(),
      migrationId,
      migrationSlot: slot,
      migrationType: "managed-actor-legacy-adoption",
    },
  });
  const stored = await env.MEDIA_BUCKET.head(destinationKey);
  if (!stored || Number(stored.size || 0) !== Number(sourceHead.size || 0)) {
    throw new Error(`R2 copy verification failed for ${slot}`);
  }
  return {
    ok: true,
    slot,
    copied: true,
    sourceKey,
    destinationKey,
    path: `media/${destinationKey}`,
    size: stored.size,
    etag: stored.httpEtag,
    backupKey,
  };
}

function managedActorLegacyMediaSlot(copy, previous, presentation) {
  return {
    path: copy.path,
    revision: Math.max(1, Math.floor(Number(previous?.revision) || 0) + 1),
    hash: String(copy.etag || "").slice(0, 160),
    source: "site",
    presentation: presentation || normalizeManagedActorPresentation(previous?.presentation),
  };
}

async function handleManagedActorLegacyAdopt(request, route, fallbackCampaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }
  if (JSON.stringify(body || {}).length > 500_000) {
    return json({ ok: false, error: "Legacy migration payload too large" }, 413, corsHeaders);
  }

  const campaignId = sanitizeCampaignId(body?.campaignId || body?.campaign || fallbackCampaignId);
  const actorKey = managedActorDocumentKey(campaignId, route.worldId, route.actorId);
  const profileKey = managedActorProfileKey(campaignId, route.worldId, route.actorId);
  const [actorRaw, profileRaw] = await Promise.all([
    env.SIGILLO_KV.get(actorKey),
    env.SIGILLO_KV.get(profileKey),
  ]);
  const actor = safeJsonParse(actorRaw);
  const existingProfile = safeJsonParse(profileRaw);
  if (!actor) return json({ ok: false, error: "Managed actor not found" }, 404, corsHeaders);
  const authorization = await authorizeManagedActorWrite(request, env, campaignId, corsHeaders, actor);
  if (authorization instanceof Response) return authorization;
  if (!authorization.isEditor) {
    return json({ ok: false, error: "Only a campaign editor can adopt legacy NPC data" }, 403, corsHeaders);
  }

  const expectedRevision = Number(body?.expectedRevision);
  if (!Number.isFinite(expectedRevision) || expectedRevision !== Number(actor.revision || 0)) {
    return json({
      ok: false,
      error: "Managed actor revision conflict",
      code: "VERSION_CONFLICT",
      currentRevision: Number(actor.revision || 0),
    }, 409, corsHeaders);
  }

  const requestedLegacyId = sanitizeAssetId(body?.legacyCharacterId || body?.legacyCharacter?.id || "");
  if (!requestedLegacyId) return json({ ok: false, error: "Missing legacyCharacterId" }, 400, corsHeaders);
  const charactersDocument = await readDataCollectionDocument("characters", campaignId, env);
  const storedLegacy = Array.isArray(charactersDocument?.data)
    ? charactersDocument.data.find((entry) => sanitizeAssetId(entry?.id || entry?.name || "") === requestedLegacyId)
    : null;
  const submittedLegacy = body?.legacyCharacter && typeof body.legacyCharacter === "object" && !Array.isArray(body.legacyCharacter)
    ? body.legacyCharacter
    : null;
  const legacy = storedLegacy || submittedLegacy;
  if (!legacy || sanitizeAssetId(legacy.id || legacy.name || "") !== requestedLegacyId) {
    return json({ ok: false, error: "Legacy NPC not found" }, 404, corsHeaders);
  }
  if (String(legacy.type || "npc").trim().toLowerCase() !== "npc") {
    return json({ ok: false, error: "The selected legacy character is not an NPC" }, 400, corsHeaders);
  }

  const previousLegacyId = sanitizeAssetId(existingProfile?.legacyCharacterId || "");
  if (previousLegacyId === requestedLegacyId) {
    return json({
      ok: true,
      alreadyUnified: true,
      campaignId,
      worldId: route.worldId,
      actorId: route.actorId,
      legacyCharacterId: requestedLegacyId,
      revision: actor.revision || 0,
      profileRevision: existingProfile.revision || 0,
      media: actor.media || {},
      safety: { legacyDataDeleted: false, legacyMediaDeleted: false },
    }, 200, { ...corsHeaders, "Cache-Control": "private, no-store" });
  }
  if (previousLegacyId && previousLegacyId !== requestedLegacyId) {
    return json({ ok: false, error: "This managed actor is already linked to another legacy NPC", legacyCharacterId: previousLegacyId }, 409, corsHeaders);
  }
  if (hasCuratedManagedActorProfile(existingProfile)) {
    return json({ ok: false, error: "This managed actor already has curated dossier data; automatic replacement was blocked" }, 409, corsHeaders);
  }

  const linkKey = managedActorProfileLinkKey(campaignId, requestedLegacyId);
  const linked = safeJsonParse(await env.SIGILLO_KV.get(linkKey));
  if (linked && (linked.worldId !== route.worldId || linked.actorId !== route.actorId)) {
    return json({ ok: false, error: "This legacy NPC is already linked to another managed actor", linkedActor: { worldId: linked.worldId, actorId: linked.actorId } }, 409, corsHeaders);
  }
  const indexDocument = safeJsonParse(await env.SIGILLO_KV.get(managedActorIndexKey(campaignId))) || {};
  const indexedLink = (Array.isArray(indexDocument.data) ? indexDocument.data : []).find((entry) => {
    if (sanitizeAssetId(entry?.profile?.legacyCharacterId || "") !== requestedLegacyId) return false;
    return sanitizeManagedActorId(entry?.worldId) !== route.worldId || sanitizeManagedActorId(entry?.actorId) !== route.actorId;
  });
  if (indexedLink) {
    return json({ ok: false, error: "This legacy NPC is already indexed by another managed actor", linkedActor: { worldId: indexedLink.worldId, actorId: indexedLink.actorId } }, 409, corsHeaders);
  }


  const legacyImages = legacy.images && typeof legacy.images === "object" ? legacy.images : {};
  const avatarSource = legacyImages.avatar || legacyImages.portrait || "";
  const explicitIdleSource = legacyImages.idle || "";
  const hoverSource = legacyImages.hover || "";
  const requiredMedia = [
    ...(avatarSource ? [{ slot: "avatar", source: avatarSource }] : []),
  ];
  const mediaPreflight = await preflightManagedActorLegacyMedia(env, campaignId, requiredMedia);
  if (!mediaPreflight.ok) {
    return json({ ok: false, error: mediaPreflight.error, missing: mediaPreflight.missing || [] }, mediaPreflight.status || 422, corsHeaders);
  }

  const now = new Date().toISOString();
  const nextActorRevision = Number(actor.revision || 0) + 1;
  const migrationId = sanitizeAssetId(`legacy-${requestedLegacyId}-r${nextActorRevision}`);
  const actorPrefix = `campaigns/${campaignId}/managed-actors/${route.worldId}/${route.actorId}`;
  const copies = [];
  const warnings = [];
  const nextMedia = {
    ...(actor.media || {}),
    variants: Array.isArray(actor.media?.variants) ? actor.media.variants : [],
  };

  if (avatarSource) {
    const avatarRevision = Math.max(1, Math.floor(Number(actor.media?.avatar?.revision) || 0) + 1);
    const copied = await copyManagedActorLegacyMedia(env, {
      campaignId, route, migrationId, slot: "avatar", source: avatarSource,
      destinationKey: `${actorPrefix}/base/avatar-site-r${avatarRevision}.webp`,
    });
    copies.push(copied);
    nextMedia.avatar = managedActorLegacyMediaSlot(
      copied,
      actor.media?.avatar,
      managedActorLegacyPresentation(avatarSource, actor.media?.avatar),
    );
    if (!explicitIdleSource) {
      nextMedia.idle = managedActorLegacyMediaSlot(
        copied,
        actor.media?.idle,
        managedActorLegacyPresentation(avatarSource, actor.media?.idle),
      );
    }
  }
  if (explicitIdleSource) {
    const copied = await copyManagedActorLegacyMedia(env, {
      campaignId, route, migrationId, slot: "idle", source: explicitIdleSource,
      destinationKey: `${actorPrefix}/site/idle.webp`,
      required: false,
    });
    if (copied.ok) {
      copies.push(copied);
      nextMedia.idle = managedActorLegacyMediaSlot(copied, actor.media?.idle, managedActorLegacyPresentation(explicitIdleSource, actor.media?.idle));
    } else {
      warnings.push(copied);
    }
  }
  if (hoverSource) {
    const copied = await copyManagedActorLegacyMedia(env, {
      campaignId, route, migrationId, slot: "hover", source: hoverSource,
      destinationKey: `${actorPrefix}/site/hover.webp`,
      required: false,
    });
    if (copied.ok) {
      copies.push(copied);
      nextMedia.hover = managedActorLegacyMediaSlot(copied, actor.media?.hover, managedActorLegacyPresentation(hoverSource, actor.media?.hover));
    } else {
      warnings.push(copied);
    }
  }

  const nextActor = {
    ...actor,
    media: nextMedia,
    site: {
      ...(actor.site || {}),
      profileId: requestedLegacyId,
      legacyCharacterId: requestedLegacyId,
      legacyMigration: { id: migrationId, source: "characters", migratedAt: now, nonDestructive: true },
    },
    revision: nextActorRevision,
    updatedAt: now,
    updatedBy: "legacy-migration",
  };

  const legacyProfile = managedActorProfileFromLegacy(legacy, nextActor, campaignId, route);
  for (const block of legacyProfile.blocks || []) {
    for (const field of ["image", "banner"]) {
      if (!block[field]) continue;
      const copied = await copyManagedActorLegacyMedia(env, {
        campaignId,
        route,
        migrationId,
        slot: `profile-${block.id}-${field}`,
        source: block[field],
        destinationKey: `${actorPrefix}/profile/${sanitizeAssetId(block.id) || "block"}-${field}-legacy.webp`,
        required: false,
      });
      if (copied.ok) {
        block[field] = copied.path;
        copies.push(copied);
      } else {
        warnings.push(copied);
      }
    }
  }
  const nextProfile = normalizeManagedActorProfileDocument(legacyProfile, existingProfile, nextActor, campaignId, route, "legacy-migration");
  const backupKey = managedActorLegacyMigrationBackupKey(campaignId, route.worldId, route.actorId, requestedLegacyId, migrationId);
  await env.SIGILLO_KV.put(backupKey, JSON.stringify({
    schemaVersion: 1,
    migrationId,
    campaignId,
    worldId: route.worldId,
    actorId: route.actorId,
    legacyCharacterId: requestedLegacyId,
    createdAt: now,
    previous: { actorMedia: actor.media || {}, actorSite: actor.site || {}, profile: existingProfile || null },
  }));

  await env.SIGILLO_KV.put(actorKey, JSON.stringify(nextActor));
  await env.SIGILLO_KV.put(profileKey, JSON.stringify(nextProfile));
  await env.SIGILLO_KV.put(linkKey, JSON.stringify({
    campaignId,
    legacyCharacterId: requestedLegacyId,
    worldId: route.worldId,
    actorId: route.actorId,
    name: nextProfile.name,
    visibility: nextProfile.visibility,
    updatedAt: now,
  }));
  await updateManagedActorProfileIndex(env, campaignId, nextActor, nextProfile);

  return json({
    ok: true,
    saved: true,
    campaignId,
    worldId: route.worldId,
    actorId: route.actorId,
    legacyCharacterId: requestedLegacyId,
    legacyName: nextProfile.name,
    revision: nextActor.revision,
    profileRevision: nextProfile.revision,
    media: nextActor.media,
    copies,
    warnings,
    backupKey,
    preserved: { token: true, tokenVariants: true, definition: true, runtime: true, system: true },
    safety: { legacyDataDeleted: false, legacyMediaDeleted: false },
  }, 200, { ...corsHeaders, "Cache-Control": "private, no-store" });

}
function findLegacyCharacterForManagedActor(data, actor) {
  if (!Array.isArray(data) || !actor) return null;
  const explicitId = sanitizeAssetId(actor?.site?.profileId || actor?.site?.legacyCharacterId || "");
  if (explicitId) {
    const explicit = data.find((entry) => sanitizeAssetId(entry?.id || entry?.name || "") === explicitId);
    if (explicit) return explicit;
  }
  const actorName = sanitizeManagedActorId(actor.name || "");
  if (!actorName) return null;
  return data.find((entry) => sanitizeManagedActorId(entry?.name || "") === actorName) || null;
}

async function handleManagedActorProfileGet(request, route, campaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  const reader = await getManagedActorReader(request, env, campaignId);
  const [storedRaw, actorRaw] = await Promise.all([
    env.SIGILLO_KV.get(managedActorProfileKey(campaignId, route.worldId, route.actorId)),
    env.SIGILLO_KV.get(managedActorDocumentKey(campaignId, route.worldId, route.actorId)),
  ]);
  const actor = safeJsonParse(actorRaw);
  if (!actor) return json({ ok: false, error: "Managed actor not found" }, 404, corsHeaders);
  let profile = safeJsonParse(storedRaw);
  let source = "profile";

  if (profile && (Number(profile.mediaSyncVersion || 0) < 1
    || String(profile.name || "") !== String(actor.name || ""))) {
    profile = managedActorProfileWithCurrentMedia(profile, actor);
    await env.SIGILLO_KV.put(managedActorProfileKey(campaignId, route.worldId, route.actorId), JSON.stringify(profile));
  }
  if (!profile) {
    const charactersDocument = await readDataCollectionDocument("characters", campaignId, env);
    const legacy = findLegacyCharacterForManagedActor(charactersDocument?.data, actor);
    profile = legacy
      ? managedActorProfileFromLegacy(legacy, actor, campaignId, route)
      : emptyManagedActorProfile(actor, campaignId, route);
    source = legacy ? "legacy" : "empty";
  }
  const categoryRegistry = await readNpcCategoryRegistry(env, campaignId);
  profile = enrichManagedActorProfileCategory(profile, categoryRegistry);

  const isOwner = isManagedActorOwner(actor, reader.user, env);
  if (!canReadManagedActorProfile(profile, reader.user, reader.isEditor, actor, env)) {
    return json({ ok: false, error: "Forbidden" }, 403, corsHeaders);
  }
  const data = filterManagedActorProfileForReader(profile, reader.user, reader.isEditor, actor, env);
  return json({
    ok: true,
    campaignId,
    source,
    data,
    permissions: { canEdit: reader.isEditor === true || isOwner, isEditor: reader.isEditor === true, isOwner, npcCategoryRevision: categoryRegistry.revision },
  }, 200, {
    ...corsHeaders,
    "Cache-Control": reader.user || reader.isEditor ? "private, no-store" : "public, max-age=120, must-revalidate",
  });
}

async function handleManagedActorProfilePost(request, route, campaignId, env, corsHeaders = {}, ctx = null) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }
  if (JSON.stringify(body || {}).length > 300_000) return json({ ok: false, error: "Profile document is too large" }, 413, corsHeaders);

  const profileKey = managedActorProfileKey(campaignId, route.worldId, route.actorId);
  const [existingRaw, actorRaw] = await Promise.all([
    env.SIGILLO_KV.get(profileKey),
    env.SIGILLO_KV.get(managedActorDocumentKey(campaignId, route.worldId, route.actorId)),
  ]);
  let existing = safeJsonParse(existingRaw);
  const actor = safeJsonParse(actorRaw);
  if (!actor) return json({ ok: false, error: "Managed actor not found" }, 404, corsHeaders);
  const authorization = await authorizeManagedActorWrite(request, env, campaignId, corsHeaders, actor);
  if (authorization instanceof Response) return authorization;
  if (!existing) {
    const charactersDocument = await readDataCollectionDocument("characters", campaignId, env);
    const legacy = findLegacyCharacterForManagedActor(charactersDocument?.data, actor);
    existing = legacy
      ? managedActorProfileFromLegacy(legacy, actor, campaignId, route)
      : emptyManagedActorProfile(actor, campaignId, route);
  }
  const { isEditor, isOwner } = authorization;
  const expectedRevision = Math.max(0, Math.floor(Number(body?.expectedRevision) || 0));
  const currentRevision = Math.max(0, Math.floor(Number(existing?.revision) || 0));
  if (expectedRevision !== currentRevision) {
    return json({ ok: false, error: "Profile revision conflict", expectedRevision, currentRevision }, 409, corsHeaders);
  }

  let sourceData = body?.data || body;
  const requestedCategoryId = sanitizeNpcCategoryId(sourceData?.categoryId || "");
  if (requestedCategoryId) {
    const registry = await readNpcCategoryRegistry(env, campaignId);
    const resolvedCategory = resolveNpcCategoryRecord(registry, requestedCategoryId, sourceData?.category);
    if (resolvedCategory) {
      sourceData = { ...sourceData, categoryId: resolvedCategory.id, category: resolvedCategory.name };
    } else if (!String(sourceData?.category || "").trim()) {
      return json({ ok: false, error: "Categoria NPC non riconosciuta" }, 400, corsHeaders);
    }
  }
  const updatedBy = authorization.source === "foundry"
    ? "foundry"
    : (getAuthenticatedAccountId(authorization.user, env) || "campaign-editor");
  let next = normalizeManagedActorProfileDocument(sourceData, existing, actor, campaignId, route, updatedBy);
  if (isOwner && !isEditor) next = preserveManagedProfileVisibilityForOwner(next, existing);
  await env.SIGILLO_KV.put(profileKey, JSON.stringify(next));
  await updateManagedActorProfileIndex(env, campaignId, actor, next);

  const previousLegacyId = sanitizeAssetId(existing?.legacyCharacterId || "");
  const nextLegacyId = sanitizeAssetId(next.legacyCharacterId || "");
  if (previousLegacyId && previousLegacyId !== nextLegacyId) {
    await env.SIGILLO_KV.delete(managedActorProfileLinkKey(campaignId, previousLegacyId));
  }
  const linkChanged = Boolean(nextLegacyId) && (
    !existing
    || previousLegacyId !== nextLegacyId
    || managedActorProfileVisibilityState(existing.visibility) !== managedActorProfileVisibilityState(next.visibility)
  );
  if (linkChanged) {
    await env.SIGILLO_KV.put(managedActorProfileLinkKey(campaignId, nextLegacyId), JSON.stringify({
      campaignId,
      legacyCharacterId: nextLegacyId,
      worldId: route.worldId,
      actorId: route.actorId,
      name: next.name,
      visibility: next.visibility,
      updatedAt: next.updatedAt,
    }));
  }

  if (authorization.source === "site") {
    scheduleFoundryLiveInvalidation(ctx, env, {
      campaignId,
      worldId: route.worldId,
      collections: ["managed-actors"],
      actorIds: [route.actorId],
      reason: "managed-actor-profile",
      revision: next.revision,
    });
  }
  return json({ ok: true, saved: true, campaignId, revision: next.revision, data: next }, 200, {
    ...corsHeaders,
    "Cache-Control": "private, no-store",
  });
}

async function handleManagedActorProfileResolveGet(request, route, campaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  const reader = await getManagedActorReader(request, env, campaignId);
  const raw = await env.SIGILLO_KV.get(managedActorProfileLinkKey(campaignId, route.legacyCharacterId));
  const link = safeJsonParse(raw);
  if (!link) return json({ ok: false, error: "Managed actor profile link not found" }, 404, corsHeaders);
  const actorRaw = await env.SIGILLO_KV.get(managedActorDocumentKey(campaignId, link.worldId, link.actorId));
  const actor = safeJsonParse(actorRaw);
  const canReadProfile = canReadManagedActorProfile(link, reader.user, reader.isEditor, actor, env);
  const canReadStats = Boolean(actor && canReadManagedActor(actor, reader.user, reader.isEditor, env));
  const permissions = { canReadProfile, canReadStats, isEditor: reader.isEditor === true };
  if (!canReadProfile && !canReadStats) {
    return json({ ok: true, campaignId, hidden: true, data: { legacyCharacterId: route.legacyCharacterId }, permissions }, 200, {
      ...corsHeaders,
      "Cache-Control": reader.user || reader.isEditor ? "private, no-store" : "public, max-age=120, must-revalidate",
    });
  }
  const data = {
    campaignId,
    legacyCharacterId: route.legacyCharacterId,
    worldId: link.worldId,
    actorId: link.actorId,
    name: canReadProfile ? link.name : (actor?.name || link.name),
  };
  return json({ ok: true, campaignId, data, permissions }, 200, {
    ...corsHeaders,
    "Cache-Control": reader.user || reader.isEditor ? "private, no-store" : "public, max-age=120, must-revalidate",
  });
}

const MANAGED_ACTOR_ITEM_PATCH_PATHS = new Set([
  "name",
  "img",
  "system.description.value",
  "system.quantity",
  "system.equipped",
  "system.attuned",
  "system.attunement",
  "system.preparation.prepared",
  "system.preparation.mode",
  "system.uses.value",
  "system.uses.spent",
  "system.uses.max",
  "system.uses.per",
  "system.level",
  "system.school",
  "system.identifier",
  "system.requirements",
]);

const MANAGED_ACTOR_ITEM_OBJECT_PATCH_PATHS = new Set([
  "system.properties",
  "system.activation",
  "system.target",
  "system.range",
  "system.duration",
  "system.uses.recovery",
  "system.recharge",
  "system.damage",
  "system.attack",
  "system.save",
  "system.activities",
  "system.type",
  "system.materials",
  "system.weight",
  "system.price",
  "system.currency",
  "system.capacity",
]);

const MANAGED_ACTOR_EFFECT_PATCH_PATHS = new Set([
  "name",
  "img",
  "disabled",
  "duration",
  "changes",
  "statuses",
]);

const MANAGED_ACTOR_UPDATE_STATIC_PATHS = new Set([
  "name",
  "system.attributes.hp.value",
  "system.attributes.hp.temp",
  "system.attributes.hp.max",
  "system.attributes.hp.tempmax",
  "system.attributes.ac.flat",
  "system.attributes.ac.calc",
  "system.attributes.prof",
  "system.attributes.init.bonus",
  "system.attributes.movement.walk",
  "system.attributes.movement.fly",
  "system.attributes.movement.swim",
  "system.attributes.movement.climb",
  "system.attributes.movement.burrow",
  "system.attributes.movement.units",
  "system.attributes.movement.hover",
  "system.details.cr",
  "system.traits.size",
]);

function isManagedActorUpdatePatchPath(path) {
  return MANAGED_ACTOR_UPDATE_STATIC_PATHS.has(path)
    || /^system\.abilities\.(str|dex|con|int|wis|cha)\.(value|proficient)$/.test(path)
    || /^system\.skills\.[a-z0-9_-]{2,16}\.value$/.test(path)
    || /^system\.traits\.(dr|di|dv|ci|languages)\.(value|bypasses|custom)$/.test(path)
    || /^system\.spells\.(spell[0-9]|pact)\.(value|spent|max|override)$/.test(path);
}

function sanitizeManagedCommandObject(value, depth = 0) {
  if (depth > 12) return null;
  if (value === null || value === undefined) return null;
  if (["string", "number", "boolean"].includes(typeof value)) {
    if (typeof value === "string") return value.slice(0, 12_000);
    return typeof value === "number" && !Number.isFinite(value) ? null : value;
  }
  if (Array.isArray(value)) return value.slice(0, 256).map((entry) => sanitizeManagedCommandObject(entry, depth + 1));
  if (typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value).slice(0, 256)
    .filter(([key]) => /^[A-Za-z0-9_-]{1,96}$/.test(key) && !["__proto__", "prototype", "constructor"].includes(key))
    .map(([key, entry]) => [key, sanitizeManagedCommandObject(entry, depth + 1)]));
}

function normalizeManagedCommandObject(value, maxBytes = 64 * 1024) {
  if ((!value || typeof value !== "object") && !Array.isArray(value)) return { valid: false, value: null };
  const normalized = sanitizeManagedCommandObject(value);
  return JSON.stringify(normalized).length <= maxBytes ? { valid: true, value: normalized } : { valid: false, value: null };
}

function normalizeManagedMediaReference(value) {
  if (typeof value !== "string") return { valid: false, value: "" };
  const clean = String(value || "").trim().slice(0, 1_000);
  if (!clean) return { valid: true, value: "" };
  if (/^media\/campaigns\/[a-z0-9_-]+\/(managed-actors|items)\//.test(clean)) return { valid: true, value: clean };
  if (/^media\/items\/[A-Za-z0-9_./%+@-]+\.(png|jpe?g|webp|gif)$/i.test(clean) && !clean.includes("..")) return { valid: true, value: clean };
  if (/^https:\/\/sigillo-api\.khuzoe\.workers\.dev\/media\//i.test(clean)) return { valid: true, value: clean };
  if (/^(icons|systems|modules|worlds)\/[A-Za-z0-9_./%+@-]+\.(png|jpe?g|webp|gif|svg)$/i.test(clean) && !clean.includes("..")) return { valid: true, value: clean };
  return { valid: false, value: "" };
}

function normalizeManagedActorItemCommandValue(path, value) {
  if (path === "name") return { valid: typeof value === "string" && Boolean(String(value).trim()), value: String(value || "").trim().slice(0, 180) };
  if (path === "img") return normalizeManagedMediaReference(value);
  if (path === "system.description.value") {
    if (typeof value !== "string") return { valid: false, value: "" };
    return { valid: true, value: String(value).replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/\son\w+\s*=\s*(["']).*?\1/gi, "").slice(0, 24_000) };
  }
  if (["system.equipped", "system.attuned", "system.preparation.prepared"].includes(path)) {
    return { valid: typeof value === "boolean", value: Boolean(value) };
  }
  if (["system.quantity", "system.uses.value", "system.uses.spent", "system.uses.max", "system.level"].includes(path)) {
    const number = Number(value);
    return { valid: Number.isFinite(number), value: Math.max(0, Math.min(999_999, number)) };
  }
  if (["system.attunement", "system.uses.per", "system.school", "system.identifier", "system.requirements", "system.preparation.mode"].includes(path)) {
    if (!["string", "number", "boolean"].includes(typeof value)) return { valid: false, value: null };
    return { valid: true, value: typeof value === "string" ? value.trim().slice(0, 180) : value };
  }
  if (MANAGED_ACTOR_ITEM_OBJECT_PATCH_PATHS.has(path)) return normalizeManagedCommandObject(value);
  return { valid: false, value: null };
}

function normalizeManagedActorEffectCommandValue(path, value) {
  if (path === "name") return { valid: typeof value === "string" && Boolean(String(value).trim()), value: String(value).trim().slice(0, 180) };
  if (path === "img") return normalizeManagedMediaReference(value);
  if (path === "disabled") return { valid: typeof value === "boolean", value: value };
  if (["duration", "changes"].includes(path)) return normalizeManagedCommandObject(value, 32 * 1024);
  if (path === "statuses") {
    if (!Array.isArray(value)) return { valid: false, value: [] };
    return { valid: true, value: Array.from(new Set(value.map((entry) => String(entry || "").trim().slice(0, 96)).filter(Boolean))).slice(0, 64) };
  }
  return { valid: false, value: null };
}

function normalizeManagedActorUpdateCommandValue(path, value) {
  if (path === "name") return { valid: typeof value === "string" && Boolean(String(value).trim()), value: String(value || "").trim().slice(0, 180) };
  if (path === "system.attributes.movement.hover") return { valid: typeof value === "boolean", value: Boolean(value) };
  if (/^system\.traits\.(dr|di|dv|ci|languages)\.(value|bypasses)$/.test(path)) {
    if (!Array.isArray(value)) return { valid: false, value: [] };
    const values = Array.from(new Set(value.map((entry) => String(entry || "").trim().slice(0, 80)).filter(Boolean))).slice(0, 64);
    return { valid: true, value: values };
  }
  if (/^system\.traits\.(dr|di|dv|ci|languages)\.custom$/.test(path)) {
    return { valid: typeof value === "string", value: String(value || "").trim().slice(0, 2_000) };
  }
  if (path === "system.details.cr") {
    if (typeof value === "string") return { valid: Boolean(value.trim()), value: value.trim().slice(0, 16) };
    const number = Number(value);
    return { valid: Number.isFinite(number), value: Math.max(0, Math.min(99, number)) };
  }
  if (["system.attributes.ac.calc", "system.attributes.movement.units", "system.traits.size"].includes(path)) {
    return { valid: typeof value === "string", value: String(value || "").trim().slice(0, 40) };
  }
  if (/^system\.abilities\.(str|dex|con|int|wis|cha)\.proficient$/.test(path)
    || /^system\.skills\.[a-z0-9_-]{2,16}\.value$/.test(path)) {
    const number = Number(value);
    return { valid: Number.isFinite(number), value: Math.max(0, Math.min(2, number)) };
  }
  if (/^system\.abilities\.(str|dex|con|int|wis|cha)\.value$/.test(path)) {
    const number = Number(value);
    return { valid: Number.isFinite(number), value: Math.max(0, Math.min(99, Math.round(number))) };
  }
  if (path === "system.attributes.init.bonus") {
    const number = Number(value);
    return { valid: Number.isFinite(number), value: Math.max(-99, Math.min(99, number)) };
  }
  if (path === "system.attributes.ac.flat" || path === "system.attributes.prof") {
    const number = Number(value);
    return { valid: Number.isFinite(number), value: Math.max(0, Math.min(99, number)) };
  }
  if (/^system\.attributes\.hp\.(value|temp|max|tempmax)$/.test(path)
    || /^system\.attributes\.movement\.(walk|fly|swim|climb|burrow)$/.test(path)
    || /^system\.spells\.(spell[0-9]|pact)\.(value|spent|max|override)$/.test(path)) {
    const number = Number(value);
    return { valid: Number.isFinite(number), value: Math.max(0, Math.min(999_999, number)) };
  }
  return { valid: false, value: null };
}

function normalizeManagedActorCommandPatch(input, kind = "item.update") {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const path = String(input.path || "").trim();
  let normalizeValue;
  if (kind === "actor.update") {
    if (!isManagedActorUpdatePatchPath(path)) return null;
    normalizeValue = normalizeManagedActorUpdateCommandValue;
  } else if (kind === "item.update") {
    if (!MANAGED_ACTOR_ITEM_PATCH_PATHS.has(path) && !MANAGED_ACTOR_ITEM_OBJECT_PATCH_PATHS.has(path)) return null;
    normalizeValue = normalizeManagedActorItemCommandValue;
  } else if (kind === "effect.update") {
    if (!MANAGED_ACTOR_EFFECT_PATCH_PATHS.has(path)) return null;
    normalizeValue = normalizeManagedActorEffectCommandValue;
  } else return null;
  const normalized = normalizeValue(path, input.value);
  if (!normalized.valid) return null;
  const base = input.baseValue === null || input.baseValue === undefined || input.baseValue === ""
    ? { valid: true, value: null }
    : normalizeValue(path, input.baseValue);
  return { path, value: normalized.value, baseValue: base.valid ? base.value : null };
}

function normalizeManagedCreateDocument(input, kind) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (kind === "item.create") {
    const name = String(input.name || "").trim().slice(0, 180);
    const type = String(input.type || "").trim().toLowerCase();
    if (!name || !["weapon", "equipment", "consumable", "tool", "loot", "container", "feat", "spell", "background", "class", "subclass"].includes(type)) return null;
    const img = input.img ? normalizeManagedMediaReference(input.img) : { valid: true, value: "" };
    const system = normalizeManagedCommandObject(input.system || {}, 96 * 1024);
    const effects = normalizeManagedCommandObject(Array.isArray(input.effects) ? input.effects : [], 64 * 1024);
    if (!img.valid || !system.valid || !effects.valid) return null;
    return { name, type, img: img.value, system: system.value, effects: effects.value, campaignItemId: sanitizeAssetId(input.campaignItemId || ""), transferId: String(input.transferId || "").trim().slice(0, 180) };
  }
  if (kind === "effect.create") {
    const name = String(input.name || "").trim().slice(0, 180);
    if (!name) return null;
    const img = input.img ? normalizeManagedMediaReference(input.img) : { valid: true, value: "" };
    const duration = normalizeManagedCommandObject(input.duration || {}, 16 * 1024);
    const changes = normalizeManagedCommandObject(Array.isArray(input.changes) ? input.changes : [], 32 * 1024);
    const statuses = normalizeManagedActorEffectCommandValue("statuses", Array.isArray(input.statuses) ? input.statuses : []);
    if (!img.valid || !duration.valid || !changes.valid || !statuses.valid) return null;
    return { name, img: img.value, disabled: input.disabled === true, duration: duration.value, changes: changes.value, statuses: statuses.value, clientId: String(input.clientId || "").trim().slice(0, 96) };
  }
  return null;
}
function normalizeManagedActorCommandTarget(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const transferId = String(input.transferId || "").trim().slice(0, 180);
  const itemId = String(input.itemId || "").trim().slice(0, 96);
  const effectId = String(input.effectId || "").trim().slice(0, 96);
  const clientId = String(input.clientId || "").trim().slice(0, 96);
  return transferId || itemId || effectId || clientId ? { transferId, itemId, effectId, clientId } : null;
}

function readManagedActorCommandQueue(raw, campaignId, worldId) {
  const parsed = typeof raw === "string" ? safeJsonParse(raw) : raw;
  return {
    schemaVersion: 1,
    campaignId,
    worldId,
    version: Number(parsed?.version || 0),
    updatedAt: parsed?.updatedAt || null,
    commands: Array.isArray(parsed?.commands) ? parsed.commands.slice(0, 256) : [],
  };
}

async function writeManagedActorCommandQueue(env, queue) {
  await env.SIGILLO_KV.put(managedActorCommandQueueKey(queue.campaignId, queue.worldId), JSON.stringify(queue), { expirationTtl: 60 * 24 * 60 * 60 });
}


function readManagedActorCreateRequestQueue(raw, campaignId) {
  const parsed = typeof raw === "string" ? safeJsonParse(raw) : raw;
  return {
    schemaVersion: 1,
    campaignId,
    version: Number(parsed?.version || 0),
    updatedAt: parsed?.updatedAt || null,
    requests: Array.isArray(parsed?.requests) ? parsed.requests.slice(0, 128) : [],
  };
}

async function writeManagedActorCreateRequestQueue(env, queue) {
  await env.SIGILLO_KV.put(managedActorCreateRequestQueueKey(queue.campaignId), JSON.stringify(queue), { expirationTtl: 60 * 24 * 60 * 60 });
}

function publicManagedActorCreateRequest(request) {
  return {
    id: request.id,
    kind: "actor.create",
    legacyCharacterId: request.legacyCharacterId,
    document: request.document,
    status: request.status,
    error: request.error || "",
    current: request.current && typeof request.current === "object" ? request.current : undefined,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

function managedActorCreateMediaSource(value) {
  const clean = String(value || "").trim().replace(/\\/g, "/").slice(0, 1_000);
  if (!clean || clean.includes("..")) return "";
  if (/^media\/[A-Za-z0-9_./%+@-]+$/i.test(clean)) return clean;
  if (/^https:\/\/sigillo-api\.khuzoe\.workers\.dev\/media\//i.test(clean)) return clean;
  return "";
}

async function enqueueManagedActorRelationshipCommand(env, campaignId, actor, relationship, createdBy) {
  const queueKey = managedActorCommandQueueKey(campaignId, actor.worldId);
  const queue = readManagedActorCommandQueue(await env.SIGILLO_KV.get(queueKey), campaignId, actor.worldId);
  const now = new Date().toISOString();
  const pendingIndex = queue.commands.findIndex((command) =>
    command.status === "pending"
    && command.kind === "relationship.update"
    && command.actorId === actor.actorId
  );
  const document = {
    relationshipType: relationship.relationshipType || "",
    ownerCharacterId: relationship.ownerCharacterId || "",
    ownerAccountIds: Array.isArray(relationship.ownerAccountIds) ? relationship.ownerAccountIds : [],
    relationshipRevision: Number(relationship.relationshipRevision || 0),
  };
  if (pendingIndex >= 0) {
    queue.commands[pendingIndex] = {
      ...queue.commands[pendingIndex],
      document,
      baseRevision: Number(actor.revision || 0),
      updatedAt: now,
    };
  } else {
    queue.commands.push({
      id: crypto.randomUUID(),
      kind: "relationship.update",
      campaignId,
      worldId: actor.worldId,
      actorId: actor.actorId,
      foundryActorId: String(actor.foundryActorId || actor.actorId).slice(0, 96),
      baseRevision: Number(actor.revision || 0),
      target: {},
      patches: [],
      document,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      createdBy,
    });
  }
  queue.version += 1;
  queue.updatedAt = now;
  await writeManagedActorCommandQueue(env, queue);
  return queue;
}

function publicManagedActorCommand(command) {
  return {
    id: command.id,
    kind: command.kind,
    actorId: command.actorId,
    foundryActorId: command.foundryActorId,
    target: command.target,
    patches: command.patches,
    document: command.document,
    status: command.status,
    error: command.error || "",
    current: command.current && typeof command.current === "object" ? command.current : undefined,
    createdAt: command.createdAt,
    updatedAt: command.updatedAt,
  };
}

async function handleManagedActorCommandEnqueue(request, route, fallbackCampaignId, env, corsHeaders = {}, ctx = null) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }
  if (JSON.stringify(body || {}).length > 128 * 1024) return json({ ok: false, error: "Managed actor command too large" }, 413, corsHeaders);
  const campaignId = sanitizeCampaignId(body?.campaignId || body?.campaign || fallbackCampaignId);
  const actorRaw = await env.SIGILLO_KV.get(managedActorDocumentKey(campaignId, route.worldId, route.actorId));
  const actor = safeJsonParse(actorRaw);
  if (!actor) return json({ ok: false, error: "Managed actor not found" }, 404, corsHeaders);



  const authorization = await authorizeManagedActorStatsWrite(request, env, campaignId, corsHeaders, actor);
  if (authorization instanceof Response) return authorization;
  if (authorization.source !== "site") return json({ ok: false, error: "Managed actor commands must originate from the site" }, 400, corsHeaders);
  const expectedRevision = Number(body?.expectedRevision);
  if (!Number.isFinite(expectedRevision) || expectedRevision !== Number(actor.revision || 0)) {
    return json({ ok: false, error: "Managed actor revision conflict", code: "VERSION_CONFLICT", currentRevision: actor.revision || 0 }, 409, corsHeaders);
  }

  const kind = String(body?.kind || "item.update").trim().toLowerCase();
  const allowedKinds = new Set(["actor.update", "item.update", "item.create", "item.delete", "effect.update", "effect.create", "effect.delete"]);
  if (!allowedKinds.has(kind)) return json({ ok: false, error: "Unsupported managed actor command" }, 400, corsHeaders);

  const isUpdate = kind.endsWith(".update");
  const isCreate = kind.endsWith(".create");
  const isDelete = kind.endsWith(".delete");
  const isItemKind = kind.startsWith("item.");
  const isEffectKind = kind.startsWith("effect.");
  let document = isCreate ? normalizeManagedCreateDocument(body?.document, kind) : null;
  let target = kind === "actor.update" ? {} : normalizeManagedActorCommandTarget(body?.target);
  if (kind === "item.create" && document) {
    document.transferId ||= `item-${crypto.randomUUID()}`;
    target = { transferId: document.transferId, itemId: "", effectId: "", clientId: "" };
  }
  if (kind === "effect.create" && document) {
    document.clientId ||= `effect-${crypto.randomUUID()}`;
    target = { transferId: "", itemId: "", effectId: "", clientId: document.clientId };
  }
  const patches = isUpdate
    ? (Array.isArray(body?.patches) ? body.patches : []).slice(0, 64).map((patch) => normalizeManagedActorCommandPatch(patch, kind)).filter(Boolean)
    : [];
  if ((isUpdate && !patches.length) || ((isItemKind || isEffectKind) && !target) || (isCreate && !document) || (!isUpdate && !isCreate && !isDelete)) {
    return json({ ok: false, error: "Managed actor command has no valid target or payload" }, 400, corsHeaders);
  }

  const queueKey = managedActorCommandQueueKey(campaignId, route.worldId);
  const queue = readManagedActorCommandQueue(await env.SIGILLO_KV.get(queueKey), campaignId, route.worldId);
  const now = new Date().toISOString();
  const entityMatches = (command) => {
    if (command.actorId !== route.actorId) return false;
    if (kind === "actor.update") return command.kind === "actor.update";
    if (isItemKind && !String(command.kind || "").startsWith("item.")) return false;
    if (isEffectKind && !String(command.kind || "").startsWith("effect.")) return false;
    if (target.transferId) return command.target?.transferId === target.transferId;
    if (target.itemId) return command.target?.itemId === target.itemId;
    if (target.effectId) return command.target?.effectId === target.effectId;
    return Boolean(target.clientId && command.target?.clientId === target.clientId);
  };
  const sameTarget = (command) => command.kind === kind && entityMatches(command);
  const pendingIndex = queue.commands.findIndex((command) => command.status === "pending" && sameTarget(command));
  let command;
  if (pendingIndex >= 0) {
    const previous = queue.commands[pendingIndex];
    if (isUpdate) {
      const byPath = new Map((Array.isArray(previous.patches) ? previous.patches : []).map((patch) => [patch.path, patch]));
      for (const patch of patches) {
        const existingPatch = byPath.get(patch.path);
        byPath.set(patch.path, existingPatch ? { ...patch, baseValue: existingPatch.baseValue } : patch);
      }
      command = { ...previous, patches: Array.from(byPath.values()), updatedAt: now };
      queue.commands[pendingIndex] = command;
    } else command = previous;
  } else {
    const commands = queue.commands.filter((entry) => {
      if (sameTarget(entry) && ["conflict", "failed"].includes(entry.status)) return false;
      if (isDelete && entry.status === "pending" && entityMatches(entry)) return false;
      return true;
    });
    if (commands.length >= 256) return json({ ok: false, error: "Managed actor command queue is full" }, 429, corsHeaders);
    command = {
      id: crypto.randomUUID(),
      kind,
      campaignId,
      worldId: route.worldId,
      actorId: route.actorId,
      foundryActorId: String(actor.foundryActorId || actor.actorId || route.actorId).slice(0, 96),
      baseRevision: Number(actor.revision || 0),
      target,
      patches,
      ...(document ? { document } : {}),
      status: "pending",
      createdAt: now,
      updatedAt: now,
      createdBy: getAuthenticatedAccountId(authorization.user, env) || "editor",
    };
    queue.commands = [...commands, command];
  }  queue.version += 1;
  queue.updatedAt = now;
  await writeManagedActorCommandQueue(env, queue);
  scheduleFoundryLiveInvalidation(ctx, env, {
    campaignId,
    worldId: route.worldId,
    collections: ["managed-actors"],
    actorIds: [route.actorId],
    reason: `managed-actor-command:${kind}`,
    revision: queue.version,
  });
  return json({ ok: true, queued: true, campaignId, worldId: route.worldId, actorId: route.actorId, queueVersion: queue.version, command: publicManagedActorCommand(command) }, 202, { ...corsHeaders, "Cache-Control": "private, no-store" });
}


async function handleManagedActorCreateRequestEnqueue(request, fallbackCampaignId, env, corsHeaders = {}, ctx = null) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }
  if (JSON.stringify(body || {}).length > 64 * 1024) return json({ ok: false, error: "Managed actor create request too large" }, 413, corsHeaders);

  const campaignId = sanitizeCampaignId(body?.campaignId || body?.campaign || fallbackCampaignId);
  const user = await requireUser(request, env, corsHeaders);
  if (user instanceof Response) return user;
  if (!await isAuthenticatedCampaignContentEditor(user, env, campaignId)) {
    return json({ ok: false, error: "Only a campaign editor can create Foundry actors" }, 403, corsHeaders);
  }

  const legacyCharacterId = sanitizeAssetId(body?.legacyCharacterId || body?.characterId || "");
  if (!legacyCharacterId) return json({ ok: false, error: "Missing legacyCharacterId" }, 400, corsHeaders);
  const charactersDocument = await readDataCollectionDocument("characters", campaignId, env);
  const legacy = Array.isArray(charactersDocument?.data)
    ? charactersDocument.data.find((entry) => sanitizeAssetId(entry?.id || entry?.name || "") === legacyCharacterId)
    : null;
  if (!legacy) return json({ ok: false, error: "NPC profile not found" }, 404, corsHeaders);
  if (String(legacy.type || "npc").trim().toLowerCase() !== "npc") {
    return json({ ok: false, error: "Only NPC profiles can create a Foundry NPC" }, 400, corsHeaders);
  }

  const linked = safeJsonParse(await env.SIGILLO_KV.get(managedActorProfileLinkKey(campaignId, legacyCharacterId)));
  if (linked?.worldId && linked?.actorId) {
    return json({ ok: true, alreadyLinked: true, campaignId, legacyCharacterId, actor: linked }, 200, { ...corsHeaders, "Cache-Control": "private, no-store" });
  }

  const queue = readManagedActorCreateRequestQueue(
    await env.SIGILLO_KV.get(managedActorCreateRequestQueueKey(campaignId)),
    campaignId,
  );
  const now = new Date().toISOString();
  const images = legacy.images && typeof legacy.images === "object" ? legacy.images : {};
  const avatar = managedActorCreateMediaSource(images.avatar || images.portrait || "");
  const token = managedActorCreateMediaSource(images.token || images.portrait || images.avatar || "");
  const document = {
    name: String(legacy.name || "Nuovo NPC").trim().slice(0, 180) || "Nuovo NPC",
    actorType: "npc",
    folderName: "Cripta Wiki Bestiario",
    media: { avatar, token: token || avatar },
  };

  const existingIndex = queue.requests.findIndex((entry) => entry.legacyCharacterId === legacyCharacterId);
  let createRequest;
  if (existingIndex >= 0) {
    const previous = queue.requests[existingIndex];
    createRequest = {
      ...previous,
      document,
      status: "pending",
      error: "",
      current: undefined,
      updatedAt: now,
    };
    queue.requests[existingIndex] = createRequest;
  } else {
    if (queue.requests.length >= 128) return json({ ok: false, error: "Managed actor create queue is full" }, 429, corsHeaders);
    createRequest = {
      id: crypto.randomUUID(),
      kind: "actor.create",
      campaignId,
      legacyCharacterId,
      document,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      createdBy: getAuthenticatedAccountId(user, env) || "editor",
    };
    queue.requests.push(createRequest);
  }
  queue.version += 1;
  queue.updatedAt = now;
  await writeManagedActorCreateRequestQueue(env, queue);
  scheduleFoundryLiveInvalidation(ctx, env, {
    campaignId,
    collections: ["managed-actors"],
    reason: "managed-actor-create",
    revision: queue.version,
  });
  return json({
    ok: true,
    queued: true,
    campaignId,
    queueVersion: queue.version,
    request: publicManagedActorCreateRequest(createRequest),
  }, 202, { ...corsHeaders, "Cache-Control": "private, no-store" });
}

async function handleManagedActorCommandList(request, route, campaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  if (!isFoundrySyncSecretAuthorized(request, env)) return json({ ok: false, error: "Forbidden" }, 403, corsHeaders);
  const [commandRaw, createRaw] = await Promise.all([
    env.SIGILLO_KV.get(managedActorCommandQueueKey(campaignId, route.worldId)),
    env.SIGILLO_KV.get(managedActorCreateRequestQueueKey(campaignId)),
  ]);
  const queue = readManagedActorCommandQueue(commandRaw, campaignId, route.worldId);
  const createQueue = readManagedActorCreateRequestQueue(createRaw, campaignId);
  const commands = queue.commands.filter((command) => command.status === "pending").map(publicManagedActorCommand);
  const createRequests = createQueue.requests.filter((entry) => entry.status === "pending").map(publicManagedActorCreateRequest);
  return json({ ok: true, campaignId, worldId: route.worldId, version: queue.version, createVersion: createQueue.version, commands, createRequests }, 200, { ...corsHeaders, "Cache-Control": "private, no-store" });
}

async function handleManagedActorCommandAck(request, route, fallbackCampaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  if (!isFoundrySyncSecretAuthorized(request, env)) return json({ ok: false, error: "Forbidden" }, 403, corsHeaders);
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }
  const campaignId = sanitizeCampaignId(body?.campaignId || body?.campaign || fallbackCampaignId);
  const [commandRaw, createRaw] = await Promise.all([
    env.SIGILLO_KV.get(managedActorCommandQueueKey(campaignId, route.worldId)),
    env.SIGILLO_KV.get(managedActorCreateRequestQueueKey(campaignId)),
  ]);
  const queue = readManagedActorCommandQueue(commandRaw, campaignId, route.worldId);
  const createQueue = readManagedActorCreateRequestQueue(createRaw, campaignId);
  const results = new Map((Array.isArray(body?.results) ? body.results : []).slice(0, 256).map((result) => [String(result?.id || ""), result]));
  const createResults = new Map((Array.isArray(body?.createResults) ? body.createResults : []).slice(0, 128).map((result) => [String(result?.id || ""), result]));
  if (!results.size && !createResults.size) return json({ ok: false, error: "Missing command results" }, 400, corsHeaders);

  const now = new Date().toISOString();
  let changed = false;
  queue.commands = queue.commands.flatMap((command) => {
    const result = results.get(command.id);
    if (!result) return [command];
    const status = String(result.status || "").toLowerCase();
    if (status === "applied") {
      changed = true;
      return [];
    }
    if (["conflict", "failed"].includes(status)) {
      changed = true;
      return [{ ...command, status, error: String(result.error || result.message || status).slice(0, 800), current: result.current && typeof result.current === "object" ? result.current : undefined, updatedAt: now }];
    }
    return [command];
  });

  let createChanged = false;
  createQueue.requests = createQueue.requests.flatMap((entry) => {
    const result = createResults.get(entry.id);
    if (!result) return [entry];
    const status = String(result.status || "").toLowerCase();
    if (status === "applied") {
      createChanged = true;
      return [];
    }
    if (["conflict", "failed"].includes(status)) {
      createChanged = true;
      return [{ ...entry, status, error: String(result.error || result.message || status).slice(0, 800), current: result.current && typeof result.current === "object" ? result.current : undefined, updatedAt: now }];
    }
    return [entry];
  });

  if (changed) {
    queue.version += 1;
    queue.updatedAt = now;
    await writeManagedActorCommandQueue(env, queue);
  }
  if (createChanged) {
    createQueue.version += 1;
    createQueue.updatedAt = now;
    await writeManagedActorCreateRequestQueue(env, createQueue);
  }
  return json({
    ok: true,
    campaignId,
    worldId: route.worldId,
    acknowledged: changed,
    createAcknowledged: createChanged,
    queueVersion: queue.version,
    createQueueVersion: createQueue.version,
  }, 200, { ...corsHeaders, "Cache-Control": "private, no-store" });
}

function normalizeManagedActorPresentation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result = {};
  const finiteOr = (candidate, fallback) => Number.isFinite(Number(candidate)) ? Number(candidate) : fallback;
  if (["x", "y", "scale"].some((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    result.x = Math.max(0, Math.min(100, finiteOr(value.x, 50)));
    result.y = Math.max(0, Math.min(100, finiteOr(value.y, 50)));
    result.scale = Math.max(.5, Math.min(3, finiteOr(value.scale, 1)));
  }
  const circle = value.frameCircle;
  if (circle && typeof circle === "object" && !Array.isArray(circle)) {
    const x = Number(circle.x);
    const y = Number(circle.y);
    const radius = Number(circle.radius);
    if ([x, y, radius].every(Number.isFinite)) {
      result.frameCircle = {
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
        radius: Math.max(.03, Math.min(.5, radius)),
      };
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function normalizeManagedActorMediaSlot(slot) {
  if (!slot || typeof slot !== "object" || Array.isArray(slot)) return null;
  const path = String(slot.path || slot.src || "").trim();
  if (!path) return null;
  return {
    path,
    revision: Math.max(1, Math.floor(Number(slot.revision) || 1)),
    hash: String(slot.hash || "").slice(0, 160),
    source: String(slot.source || "foundry").slice(0, 24),
    presentation: normalizeManagedActorPresentation(slot.presentation),
  };
}

function preserveManagedActorFrameCircleForSameMedia(slot, previousSlot) {
  if (!slot || !previousSlot || slot.path !== previousSlot.path) return slot;
  if (Number(slot.revision || 1) !== Number(previousSlot.revision || 1)) return slot;
  const nextHash = String(slot.hash || "");
  const previousHash = String(previousSlot.hash || "");
  if (nextHash && previousHash && nextHash !== previousHash) return slot;
  const previousCircle = normalizeManagedActorPresentation(previousSlot.presentation)?.frameCircle;
  const nextPresentation = normalizeManagedActorPresentation(slot.presentation);
  if (!previousCircle || nextPresentation?.frameCircle) return slot;
  return {
    ...slot,
    presentation: {
      ...(nextPresentation || {}),
      frameCircle: previousCircle,
    },
  };
}

function normalizeManagedActorFoundryBaseMediaSlot(submittedSlot, existingSlot) {
  const incoming = normalizeManagedActorMediaSlot(submittedSlot);
  if (existingSlot?.source === "site" && incoming?.path !== existingSlot.path) {
    return existingSlot;
  }
  return preserveManagedActorFrameCircleForSameMedia(incoming, existingSlot)
    || existingSlot
    || null;
}

function normalizeManagedActorMedia(media, existingMedia = {}, source = "foundry", variantOptions = {}) {
  const submitted = media && typeof media === "object" && !Array.isArray(media) ? media : {};
  const variants = Array.isArray(submitted.variants)
    ? submitted.variants.slice(0, 128).map((variant) => {
      if (!variant || typeof variant !== "object") return null;
      const normalized = normalizeManagedActorMediaSlot(variant);
      if (!normalized) return null;
      return {
        ...normalized,
        id: sanitizeAssetId(variant.id),
        name: String(variant.name || "Variante").trim().slice(0, 160),
        width: Math.max(0.5, Math.min(12, Number(variant.width) || 1)),
        height: Math.max(0.5, Math.min(12, Number(variant.height) || Number(variant.width) || 1)),
      };
    }).filter((variant) => variant?.id)
    : [];
  const mode = ["replace", "merge"].includes(variantOptions.mode) ? variantOptions.mode : "preserve";
  const existingVariants = Array.isArray(existingMedia.variants) ? existingMedia.variants : [];
  let canonicalVariants = existingVariants;
  if (mode === "replace") {
    canonicalVariants = variants;
  } else if (mode === "merge") {
    const upsertIds = new Set((Array.isArray(variantOptions.upsertIds) ? variantOptions.upsertIds : []).map(sanitizeAssetId).filter(Boolean));
    const removedIds = new Set((Array.isArray(variantOptions.removedIds) ? variantOptions.removedIds : []).map(sanitizeAssetId).filter(Boolean));
    const byId = new Map(existingVariants.filter((variant) => variant?.id && !removedIds.has(variant.id)).map((variant) => [variant.id, variant]));
    for (const variant of variants) {
      if (upsertIds.has(variant.id)) byId.set(variant.id, variant);
    }
    canonicalVariants = Array.from(byId.values()).slice(0, 128);
  }
  const hasAvatar = Object.prototype.hasOwnProperty.call(submitted, "avatar");
  const hasToken = Object.prototype.hasOwnProperty.call(submitted, "token");
  const hasIdle = Object.prototype.hasOwnProperty.call(submitted, "idle");
  const hasHover = Object.prototype.hasOwnProperty.call(submitted, "hover");
  return {
    avatar: source === "foundry"
      ? normalizeManagedActorFoundryBaseMediaSlot(submitted.avatar, existingMedia.avatar)
      : (hasAvatar ? (normalizeManagedActorMediaSlot(submitted.avatar) || existingMedia.avatar || null) : (existingMedia.avatar || null)),
    token: source === "foundry"
      ? normalizeManagedActorFoundryBaseMediaSlot(submitted.token, existingMedia.token)
      : (hasToken ? (normalizeManagedActorMediaSlot(submitted.token) || existingMedia.token || null) : (existingMedia.token || null)),
    idle: source === "site" ? (hasIdle ? normalizeManagedActorMediaSlot(submitted.idle) : (existingMedia.idle || null)) : (existingMedia.idle || null),
    hover: source === "site" ? (hasHover ? normalizeManagedActorMediaSlot(submitted.hover) : (existingMedia.hover || null)) : (existingMedia.hover || null),
    variants: canonicalVariants,
  };
}

async function preserveExistingMediaWhenFoundryObjectIsMissing(next, existing, source, env, campaignId, route) {
  if (source !== "foundry" || !env.MEDIA_BUCKET) return [];
  const actorPrefix = `campaigns/${campaignId}/managed-actors/${route.worldId}/${route.actorId}/`;
  const ignored = [];
  for (const slot of ["avatar", "token"]) {
    const candidate = next?.media?.[slot] || null;
    const previous = existing?.media?.[slot] || null;
    if (!candidate?.path || candidate.path === previous?.path) continue;
    const key = extractMediaKeyFromValue(candidate.path);
    if (!key || !key.startsWith(actorPrefix)) continue;
    const object = await env.MEDIA_BUCKET.head(key);
    if (object) continue;
    next.media[slot] = previous;
    ignored.push({ slot, path: candidate.path, reason: "missing-r2-object" });
  }
  return ignored;
}

function managedRuntimeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeManagedActorRuntime(input = {}) {
  const runtime = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const hp = runtime.hp && typeof runtime.hp === "object" ? runtime.hp : {};
  const xp = runtime.xp && typeof runtime.xp === "object" ? runtime.xp : {};
  const weight = runtime.weight && typeof runtime.weight === "object" ? runtime.weight : {};
  const death = runtime.death && typeof runtime.death === "object" ? runtime.death : {};
  const resources = Object.fromEntries(Object.entries(runtime.resources && typeof runtime.resources === "object" ? runtime.resources : {})
    .slice(0, 32)
    .map(([key, value]) => [sanitizeAssetId(key), {
      value: managedRuntimeNumber(value?.value),
      max: managedRuntimeNumber(value?.max),
    }])
    .filter(([key]) => key));
  const spellSlots = Object.fromEntries(Object.entries(runtime.spellSlots && typeof runtime.spellSlots === "object" ? runtime.spellSlots : {})
    .filter(([key]) => key === "pact" || /^spell\d+$/.test(key))
    .slice(0, 12)
    .map(([key, value]) => [key, {
      value: managedRuntimeNumber(value?.value),
      spent: managedRuntimeNumber(value?.spent),
      max: managedRuntimeNumber(value?.max),
    }]));
  return {
    hp: {
      value: managedRuntimeNumber(hp.value),
      temp: managedRuntimeNumber(hp.temp),
      max: managedRuntimeNumber(hp.max),
      tempmax: managedRuntimeNumber(hp.tempmax),
    },
    inspiration: typeof runtime.inspiration === "boolean" ? runtime.inspiration : null,
    xp: {
      value: managedRuntimeNumber(xp.value),
      max: managedRuntimeNumber(xp.max),
    },
    weight: {
      value: managedRuntimeNumber(weight.value),
      max: managedRuntimeNumber(weight.max),
      pct: managedRuntimeNumber(weight.pct),
      encumbered: typeof weight.encumbered === "boolean" ? weight.encumbered : null,
    },
    death: {
      success: managedRuntimeNumber(death.success),
      failure: managedRuntimeNumber(death.failure),
    },
    resources,
    spellSlots,
  };
}

function mergeManagedActorRuntime(base = {}, overlay = {}) {
  return {
    ...base,
    ...overlay,
    hp: { ...(base.hp || {}), ...(overlay.hp || {}) },
    death: { ...(base.death || {}), ...(overlay.death || {}) },
    resources: { ...(base.resources || {}), ...(overlay.resources || {}) },
    spellSlots: { ...(base.spellSlots || {}), ...(overlay.spellSlots || {}) },
  };
}
function normalizeManagedActorDocument(input, existing, campaignId, route, source) {
  const now = new Date().toISOString();
  const requestedVariantMode = String(input.variantSyncMode || "").toLowerCase();
  const variantMode = !existing
    ? "replace"
    : ["replace", "merge"].includes(requestedVariantMode)
      ? requestedVariantMode
      : (input.variantSync === true ? "replace" : "preserve");
  const ownerAccountIds = Array.from(new Set(
    (Array.isArray(input.ownerAccountIds) ? input.ownerAccountIds : [])
      .map(sanitizeAccountId)
      .filter(Boolean)
  )).slice(0, 16);
  const actorType = String(source === "foundry" ? (input.actorType || input.type || existing?.actorType || "npc") : (existing?.actorType || "npc")).trim().slice(0, 48);
  const relationshipIsCanonical = Boolean(existing && Number(existing.relationshipRevision || 0) > 0);
  const relationshipOwnerCharacterId = sanitizeAssetId(relationshipIsCanonical
    ? (existing?.ownerCharacterId || "")
    : (source === "foundry" ? (input.ownerCharacterId || existing?.ownerCharacterId || "") : (existing?.ownerCharacterId || "")));
  const relationshipAccounts = relationshipIsCanonical ? (existing?.ownerAccountIds || []) : (source === "foundry" ? ownerAccountIds : (existing?.ownerAccountIds || ownerAccountIds));
  const requestedVisibility = input.visibility && typeof input.visibility === "object" ? input.visibility : {};
  const existingVisibility = existing?.visibility && typeof existing.visibility === "object" ? existing.visibility : null;
  const visibility = source === "site" || !existingVisibility
    ? {
      state: managedActorVisibilityState(requestedVisibility),
      published: requestedVisibility.published === true || managedActorVisibilityState(requestedVisibility) === "public",
    }
    : existingVisibility;
  return {
    schemaVersion: Math.max(1, Math.floor(Number(input.schemaVersion) || 1)),
    id: `${route.worldId}:${route.actorId}`,
    campaignId,
    worldId: route.worldId,
    actorId: route.actorId,
    actorUuid: String(source === "foundry" ? (input.actorUuid || `Actor.${route.actorId}`) : (existing?.actorUuid || `Actor.${route.actorId}`)).slice(0, 180),
    foundryActorId: String(source === "foundry" ? (input.foundryActorId || input.actorId || route.actorId) : (existing?.foundryActorId || route.actorId)).trim().slice(0, 96),
    name: String(source === "foundry" ? (input.name || existing?.name || "Actor") : (existing?.name || "Actor")).trim().slice(0, 180),
    actorType,
    relationshipType: normalizeManagedActorRelationshipType(relationshipIsCanonical ? existing?.relationshipType : (source === "foundry" ? (input.relationshipType || existing?.relationshipType || "") : (existing?.relationshipType || "")), actorType, relationshipOwnerCharacterId),
    ownerCharacterId: relationshipOwnerCharacterId,
    ownerAccountIds: relationshipAccounts,
    relationshipRevision: Math.max(0, Math.floor(Number(existing?.relationshipRevision) || 0)),
    relationshipUpdatedAt: existing?.relationshipUpdatedAt || null,
    relationshipUpdatedBy: existing?.relationshipUpdatedBy || "",
    visibility,
    media: normalizeManagedActorMedia(input.media, existing?.media || {}, source, {
      mode: variantMode,
      upsertIds: input.variantUpsertIds,
      removedIds: input.removedVariantIds,
    }),
    definition: source === "foundry" && input.definition && typeof input.definition === "object" ? input.definition : (existing?.definition || {}),
    runtime: source === "foundry" && input.runtime && typeof input.runtime === "object" ? input.runtime : (existing?.runtime || {}),
    runtimeUpdatedAt: source === "foundry" ? now : (existing?.runtimeUpdatedAt || existing?.updatedAt || now),
    system: source === "foundry" && input.system && typeof input.system === "object" ? input.system : (existing?.system || {}),
    site: source === "site" && input.site && typeof input.site === "object" ? input.site : (existing?.site || {}),
    contentHash: String(source === "foundry" ? (input.contentHash || "") : (existing?.contentHash || "")).slice(0, 160),
    mediaHash: String(source === "foundry" ? (input.mediaHash || "") : (existing?.mediaHash || "")).slice(0, 160),
    revision: Number(existing?.revision || 0) + 1,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    updatedBy: source,
  };
}

async function handleManagedActorPost(request, route, fallbackCampaignId, env, corsHeaders = {}, ctx = null) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }
  const serialized = JSON.stringify(body || {});
  if (serialized.length > 4 * 1024 * 1024) return json({ ok: false, error: "Managed actor payload too large" }, 413, corsHeaders);
  const campaignId = sanitizeCampaignId(body?.campaignId || body?.campaign || fallbackCampaignId);
  const key = managedActorDocumentKey(campaignId, route.worldId, route.actorId);
  const existing = safeJsonParse(await env.SIGILLO_KV.get(key));
  const authorization = await authorizeManagedActorWrite(request, env, campaignId, corsHeaders, existing);
  if (authorization instanceof Response) return authorization;
  if (authorization.source === "site" && !existing) return json({ ok: false, error: "Managed actor not found" }, 404, corsHeaders);
  if (authorization.source === "site") {
    const expectedRevision = Number(body?.expectedRevision);
    if (existing && Number.isFinite(expectedRevision) && expectedRevision !== Number(existing.revision || 0)) {
      return json({ ok: false, error: "Managed actor revision conflict", code: "VERSION_CONFLICT", currentRevision: existing.revision || 0 }, 409, corsHeaders);
    }
  }
  const next = normalizeManagedActorDocument(body, existing, campaignId, route, authorization.source);
  const ignoredMissingMedia = await preserveExistingMediaWhenFoundryObjectIsMissing(next, existing, authorization.source, env, campaignId, route);
  if (authorization.source === "site" && authorization.isOwner && !authorization.isEditor && existing?.visibility) {
    next.visibility = existing.visibility;
  }
  const unchanged = existing
    && authorization.source === "foundry"
    && next.contentHash
    && next.contentHash === existing.contentHash
    && next.mediaHash === existing.mediaHash;

  const indexKey = managedActorIndexKey(campaignId);
  const indexDoc = safeJsonParse(await env.SIGILLO_KV.get(indexKey)) || { version: 0, data: [] };
  const currentEntries = Array.isArray(indexDoc.data) ? indexDoc.data : [];
  const storedDocument = unchanged ? existing : next;
  const previousIndexEntry = currentEntries.find((entry) => entry?.id === storedDocument.id) || null;
  const nextIndexEntry = managedActorIndexEntry(storedDocument, previousIndexEntry);
  const indexChanged = managedActorIndexEntryComparable(previousIndexEntry) !== managedActorIndexEntryComparable(nextIndexEntry);
  const profileMediaChanged = Boolean(existing) && !unchanged
    && managedActorProfileMediaComparable(existing.media) !== managedActorProfileMediaComparable(next.media);
  if (!unchanged) await env.SIGILLO_KV.put(key, JSON.stringify(next));
  const profileNameChanged = Boolean(existing) && !unchanged
    && String(existing.name || "") !== String(next.name || "");
  if (indexChanged) {
    const data = [...currentEntries.filter((entry) => entry?.id !== nextIndexEntry.id), nextIndexEntry]
      .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
    await env.SIGILLO_KV.put(indexKey, JSON.stringify({
      ...indexDoc,
      version: Number(indexDoc.version || 0) + 1,
      campaignId,
      updatedAt: new Date().toISOString(),
      data,
    }));
  }
  const profileMediaSynced = profileMediaChanged || profileNameChanged
    ? await syncStoredManagedActorProfileMedia(env, campaignId, route, next)
    : false;
  const deletedMedia = [];
  if (!unchanged && existing && env.MEDIA_BUCKET) {
    const previousKeys = collectMediaKeysFromValue(existing);
    const nextKeys = collectMediaKeysFromValue(next);
    const actorPrefix = `campaigns/${campaignId}/managed-actors/${route.worldId}/${route.actorId}/`;
    for (const mediaKey of previousKeys) {
      if (!mediaKey.startsWith(actorPrefix) || nextKeys.has(mediaKey)) continue;
      await env.MEDIA_BUCKET.delete(mediaKey);
      deletedMedia.push(mediaKey);
    }
  }

  const stored = unchanged ? existing : next;
  if (authorization.source === "site") {
    scheduleFoundryLiveInvalidation(ctx, env, {
      campaignId,
      worldId: route.worldId,
      collections: ["managed-actors"],
      actorIds: [route.actorId],
      reason: "managed-actor-document",
      revision: stored?.revision || 0,
    });
  }
  return json({
    ok: true,
    saved: !unchanged,
    indexChanged,
    profileMediaSynced,
    ignoredMissingMedia,
    campaignId,
    worldId: route.worldId,
    actorId: route.actorId,
    revision: stored?.revision || 0,
    updatedAt: stored?.updatedAt || null,
    deletedMedia,
  }, 200, corsHeaders);
}

async function handleManagedActorRuntimePost(request, route, fallbackCampaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  if (!isFoundrySyncSecretAuthorized(request, env)) return json({ ok: false, error: "Forbidden" }, 403, corsHeaders);
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }
  if (JSON.stringify(body || {}).length > 64 * 1024) return json({ ok: false, error: "Managed actor runtime payload too large" }, 413, corsHeaders);
  const campaignId = sanitizeCampaignId(body?.campaignId || body?.campaign || fallbackCampaignId);
  const actorKey = managedActorDocumentKey(campaignId, route.worldId, route.actorId);
  const actorExists = await env.SIGILLO_KV.get(actorKey);
  if (!actorExists) return json({ ok: false, error: "Managed actor not found" }, 404, corsHeaders);
  const updatedAt = new Date().toISOString();
  const runtime = normalizeManagedActorRuntime(body?.runtime);
  await env.SIGILLO_KV.put(managedActorRuntimeKey(campaignId, route.worldId, route.actorId), JSON.stringify({
    schemaVersion: 1,
    campaignId,
    worldId: route.worldId,
    actorId: route.actorId,
    runtime,
    updatedAt,
  }));
  return json({ ok: true, saved: true, campaignId, worldId: route.worldId, actorId: route.actorId, runtimeUpdatedAt: updatedAt }, 200, {
    ...corsHeaders,
    "Cache-Control": "private, no-store",
  });
}
async function handleManagedActorRelationshipPost(request, route, fallbackCampaignId, env, corsHeaders = {}, ctx = null) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }
  const campaignId = sanitizeCampaignId(body?.campaignId || body?.campaign || fallbackCampaignId);
  const actorKey = managedActorDocumentKey(campaignId, route.worldId, route.actorId);
  const indexKey = managedActorIndexKey(campaignId);
  const [actorRaw, indexRaw] = await Promise.all([
    env.SIGILLO_KV.get(actorKey),
    env.SIGILLO_KV.get(indexKey),
  ]);
  const actor = safeJsonParse(actorRaw);
  if (!actor) return json({ ok: false, error: "Managed actor not found" }, 404, corsHeaders);
  const authorization = await authorizeManagedActorWrite(request, env, campaignId, corsHeaders, actor);
  if (authorization instanceof Response) return authorization;
  if (authorization.source === "site" && !authorization.isEditor) {
    return json({ ok: false, error: "Forbidden: companion relationships require campaign editor permissions" }, 403, corsHeaders);
  }
  if (String(actor.actorType || "").trim().toLowerCase() !== "npc") {
    return json({ ok: false, error: "Only NPC actors can be linked as companions" }, 400, corsHeaders);
  }

  const currentRelationshipRevision = Math.max(0, Math.floor(Number(actor.relationshipRevision) || 0));
  const hasExpectedRelationshipRevision = body?.expectedRelationshipRevision !== undefined && body?.expectedRelationshipRevision !== null;
  const expectedRelationshipRevision = Number(body?.expectedRelationshipRevision);
  if (authorization.source === "site" && !Number.isFinite(expectedRelationshipRevision)) {
    return json({ ok: false, error: "Missing expected relationship revision" }, 400, corsHeaders);
  }
  if (hasExpectedRelationshipRevision && (!Number.isFinite(expectedRelationshipRevision) || Math.floor(expectedRelationshipRevision) !== currentRelationshipRevision)) {
    return json({
      ok: false,
      error: "Managed actor relationship conflict",
      code: "RELATIONSHIP_VERSION_CONFLICT",
      currentRelationshipRevision,
    }, 409, corsHeaders);
  }

  const requestedOwnerCharacterId = sanitizeAssetId(body?.ownerCharacterId || "");
  const requestedRelationshipType = requestedOwnerCharacterId
    ? normalizeManagedActorRelationshipType(body?.relationshipType || "companion", actor.actorType, requestedOwnerCharacterId)
    : "";
  if (requestedOwnerCharacterId && requestedRelationshipType !== "companion") {
    return json({ ok: false, error: "Invalid companion relationship" }, 400, corsHeaders);
  }

  const indexDoc = safeJsonParse(indexRaw) || { version: 0, campaignId, data: [] };
  const currentEntries = Array.isArray(indexDoc.data) ? indexDoc.data : [];
  let ownerAccountIds = [];
  if (requestedOwnerCharacterId) {
    const playerEntry = currentEntries.find((entry) => {
      if (sanitizeManagedActorId(entry?.worldId) !== route.worldId) return false;
      if (sanitizeAssetId(entry?.ownerCharacterId || "") !== requestedOwnerCharacterId) return false;
      const type = String(entry?.actorType || "").trim().toLowerCase();
      const relationship = normalizeManagedActorRelationshipType(entry?.relationshipType, type, entry?.ownerCharacterId);
      return relationship === "player" || ["character", "player"].includes(type);
    });
    if (!playerEntry) {
      return json({ ok: false, error: "Target player character is not managed in this world" }, 400, corsHeaders);
    }
    ownerAccountIds = Array.from(new Set((Array.isArray(playerEntry.ownerAccountIds) ? playerEntry.ownerAccountIds : [])
      .map(sanitizeAccountId)
      .filter(Boolean))).slice(0, 16);
  }

  const unchanged = normalizeManagedActorRelationshipType(actor.relationshipType, actor.actorType, actor.ownerCharacterId) === requestedRelationshipType
    && sanitizeAssetId(actor.ownerCharacterId || "") === requestedOwnerCharacterId
    && JSON.stringify((actor.ownerAccountIds || []).map(sanitizeAccountId).filter(Boolean).sort()) === JSON.stringify([...ownerAccountIds].sort());
  if (unchanged) {
    return json({
      ok: true,
      saved: false,
      queued: false,
      campaignId,
      data: managedActorIndexEntry(actor, currentEntries.find((entry) => entry?.id === actor.id) || null),
    }, 200, { ...corsHeaders, "Cache-Control": "private, no-store" });
  }

  const now = new Date().toISOString();
  const updatedBy = authorization.source === "foundry"
    ? "foundry"
    : (getAuthenticatedAccountId(authorization.user, env) || "campaign-editor");
  const next = {
    ...actor,
    relationshipType: requestedRelationshipType,
    ownerCharacterId: requestedOwnerCharacterId,
    ownerAccountIds,
    relationshipRevision: currentRelationshipRevision + 1,
    relationshipUpdatedAt: now,
    relationshipUpdatedBy: updatedBy,
    revision: Number(actor.revision || 0),
    updatedAt: now,
    updatedBy: authorization.source,
  };
  const previousIndexEntry = currentEntries.find((entry) => entry?.id === next.id) || null;
  const nextIndexEntry = managedActorIndexEntry(next, previousIndexEntry);
  const nextEntries = [...currentEntries.filter((entry) => entry?.id !== next.id), nextIndexEntry]
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));

  await Promise.all([
    env.SIGILLO_KV.put(actorKey, JSON.stringify(next)),
    env.SIGILLO_KV.put(indexKey, JSON.stringify({
      ...indexDoc,
      version: Number(indexDoc.version || 0) + 1,
      campaignId,
      updatedAt: now,
      data: nextEntries,
    })),
  ]);
  let queued = false;
  if (authorization.source === "site") {
    await enqueueManagedActorRelationshipCommand(env, campaignId, next, next, updatedBy);
    queued = true;
  }
  if (authorization.source === "site") {
    scheduleFoundryLiveInvalidation(ctx, env, {
      campaignId,
      worldId: route.worldId,
      collections: ["managed-actors"],
      actorIds: [route.actorId],
      reason: "managed-actor-relationship",
      revision: next.relationshipRevision,
    });
  }
  return json({
    ok: true,
    saved: true,
    queued,
    campaignId,
    worldId: route.worldId,
    actorId: route.actorId,
    relationshipRevision: next.relationshipRevision,
    revision: next.revision,
    data: nextIndexEntry,
  }, 200, { ...corsHeaders, "Cache-Control": "private, no-store" });
}
async function handleManagedActorIndexGet(request, campaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  const reader = await getManagedActorReader(request, env, campaignId);
  const [raw, categoryRegistry] = await Promise.all([
    env.SIGILLO_KV.get(managedActorIndexKey(campaignId)),
    readNpcCategoryRegistry(env, campaignId),
  ]);
  const storedDoc = safeJsonParse(raw) || { version: 0, campaignId, data: [] };
  const doc = await hydrateManagedActorProfileIndex(storedDoc, campaignId, env);
  const entries = Array.isArray(doc.data) ? doc.data : [];
  const managedLegacyCharacterIds = Array.from(new Set(entries
    .map((entry) => sanitizeAssetId(entry?.profile?.legacyCharacterId || ""))
    .filter(Boolean)));
  const data = entries.flatMap((entry) => {
    const canReadStats = canReadManagedActor(entry, reader.user, reader.isEditor, env);
    const canReadProfile = canReadManagedActorProfileIndex(entry.profile, reader.user, reader.isEditor, entry, env);
    if (!canReadStats && !canReadProfile) return [];
    return [{
      ...entry,
      profile: canReadProfile ? enrichManagedActorProfileCategory(entry.profile, categoryRegistry) : null,
      permissions: {
        canReadStats,
        canReadProfile,
        isEditor: reader.isEditor === true,
      },
    }];
  });
  const visibleCategoryIds = new Set(data.flatMap((entry) => [
    sanitizeNpcCategoryId(entry?.profile?.categoryId || ""),
    sanitizeNpcCategoryId(entry?.profile?.categorySourceId || ""),
  ]).filter(Boolean));
  const npcCategories = categoryRegistry.categories.filter((category) => reader.isEditor || visibleCategoryIds.has(category.id));
  return json({ ok: true, campaignId, version: Number(doc.version || 0), updatedAt: doc.updatedAt || null, managedLegacyCharacterIds, npcCategoryRevision: categoryRegistry.revision, npcCategories, data }, 200, {
    ...corsHeaders,
    "Cache-Control": reader.user || reader.isEditor ? "private, no-store" : "public, max-age=60, must-revalidate",
  });
}

async function handleManagedActorGet(request, route, campaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  const reader = await getManagedActorReader(request, env, campaignId);
  const [documentRaw, runtimeRaw] = await Promise.all([
    env.SIGILLO_KV.get(managedActorDocumentKey(campaignId, route.worldId, route.actorId)),
    env.SIGILLO_KV.get(managedActorRuntimeKey(campaignId, route.worldId, route.actorId)),
  ]);
  const document = safeJsonParse(documentRaw);
  const runtimeRecord = safeJsonParse(runtimeRaw);
  if (!document) return json({ ok: false, error: "Managed actor not found" }, 404, corsHeaders);
  if (!canReadManagedActor(document, reader.user, reader.isEditor, env)) return json({ ok: false, error: "Forbidden" }, 403, corsHeaders);
  const isOwner = isManagedActorOwner(document, reader.user, env);
  const canEdit = Boolean(reader.isEditor || isOwner);
  const canEditStats = Boolean(canEdit || canEditPublicManagedNpcStats(document, reader.user));
  const baselineRuntimeAt = Date.parse(document.runtimeUpdatedAt || document.updatedAt || "") || 0;
  const overlayRuntimeAt = Date.parse(runtimeRecord?.updatedAt || "") || 0;
  const runtimeData = overlayRuntimeAt > baselineRuntimeAt
    ? {
      ...document,
      runtime: mergeManagedActorRuntime(document.runtime || {}, runtimeRecord.runtime || {}),
      runtimeUpdatedAt: runtimeRecord.updatedAt,
    }
    : document;
  const commandRaw = canEditStats
    ? await env.SIGILLO_KV.get(managedActorCommandQueueKey(campaignId, route.worldId))
    : null;
  const commandQueue = canEditStats ? readManagedActorCommandQueue(commandRaw, campaignId, route.worldId) : null;
  const commands = commandQueue
    ? commandQueue.commands.filter((command) => command.actorId === route.actorId && ["pending", "conflict", "failed"].includes(command.status)).slice(0, 64).map(publicManagedActorCommand)
    : [];
  const data = {
    ...runtimeData,
    permissions: {
      canEdit,
      canEditStats,
      isEditor: reader.isEditor,
      isOwner,
      canManageVisibility: reader.isEditor,
    },
    ...(commands.length ? { sync: { queueVersion: commandQueue.version, commands } } : {}),
  };
  return json({ ok: true, campaignId, data }, 200, {
    ...corsHeaders,
    "Cache-Control": reader.user || reader.isEditor ? "private, no-store" : "public, max-age=60, must-revalidate",
  });
}

async function handleFoundryAssetSnapshot(request, fallbackCampaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) {
    return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  }

  const inventoryAuth = requireInventorySyncSecret(request, env, corsHeaders);
  if (inventoryAuth instanceof Response) return inventoryAuth;

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }

  try {
    const result = await saveFoundryAssetSnapshotDocument(body, fallbackCampaignId, env);
    return json(result, 200, corsHeaders);
  } catch (error) {
    const status = Number(error?.status || 500);
    return json({ ok: false, error: error?.message || "Asset snapshot failed" }, status, corsHeaders);
  }
}

async function saveFoundryAssetSnapshotDocument(body, fallbackCampaignId, env) {
  const campaignId = sanitizeCampaignId(body?.campaignId || body?.campaign || fallbackCampaignId);
  const submittedAssets = Array.isArray(body?.assets) ? body.assets : [];
  if (!submittedAssets.length) {
    const error = new Error("Expected { assets: [...] }");
    error.status = 400;
    throw error;
  }

  const normalizedAssets = submittedAssets
    .map((asset) => normalizeFoundryAssetRecord(asset, campaignId))
    .filter(Boolean);

  if (!normalizedAssets.length) {
    const error = new Error("No valid assets in snapshot");
    error.status = 400;
    throw error;
  }

  const serializedAssets = JSON.stringify(normalizedAssets);
  if (serializedAssets.length > 1024 * 1024) {
    const error = new Error("Asset snapshot too large");
    error.status = 413;
    throw error;
  }

  const collection = "asset-registry";
  const key = dataCollectionKey(collection, campaignId);
  const existing = safeJsonParse(await env.SIGILLO_KV.get(key)) || {};
  const existingData = Array.isArray(existing.data) ? existing.data : [];
  const now = new Date().toISOString();
  const byId = new Map(existingData
    .filter((record) => record && typeof record === "object" && record.id)
    .map((record) => [String(record.id), record]));

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const asset of normalizedAssets) {
    const previous = byId.get(asset.id);
    if (!previous) {
      created += 1;
      byId.set(asset.id, {
        id: asset.id,
        campaignId,
        entityType: asset.entityType,
        entityId: asset.entityId,
        slot: asset.slot,
        label: asset.label,
        foundry: asset.foundry,
        foundryState: asset.state,
        syncStatus: asset.state?.hash ? "foundry-only" : "unlinked",
        createdAt: now,
        updatedAt: now,
        updatedBy: "foundry",
      });
      continue;
    }

    const next = {
      ...previous,
      campaignId,
      entityType: asset.entityType || previous.entityType,
      entityId: asset.entityId || previous.entityId,
      slot: asset.slot || previous.slot,
      label: asset.label || previous.label,
      foundry: { ...(previous.foundry || {}), ...(asset.foundry || {}) },
      foundryState: asset.state,
      syncStatus: getAssetSyncStatus(previous, asset),
      updatedAt: now,
      updatedBy: "foundry",
    };

    if (assetRecordsEquivalent(previous, next)) {
      unchanged += 1;
      continue;
    }

    updated += 1;
    byId.set(asset.id, next);
  }

  const nextData = Array.from(byId.values()).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const currentVersion = Number(existing.version || 0);

  if (!created && !updated) {
    return {
      ok: true,
      saved: false,
      campaignId,
      collection,
      version: currentVersion,
      received: normalizedAssets.length,
      created,
      updated,
      unchanged,
      skipped: submittedAssets.length - normalizedAssets.length,
    };
  }

  const doc = {
    version: currentVersion + 1,
    collection,
    campaignId,
    updatedAt: now,
    updatedBy: "foundry",
    data: nextData,
  };

  await env.SIGILLO_KV.put(key, JSON.stringify(doc));

  return {
    ok: true,
    saved: true,
    campaignId,
    collection,
    version: doc.version,
    received: normalizedAssets.length,
    created,
    updated,
    unchanged,
    skipped: submittedAssets.length - normalizedAssets.length,
  };
}

function normalizeFoundryAssetRecord(asset, campaignId) {
  if (!asset || typeof asset !== "object") return null;
  const entityType = sanitizeAssetToken(asset.entityType);
  const entityId = sanitizeAssetId(asset.entityId);
  const slot = sanitizeAssetToken(asset.slot);
  if (!entityType || !entityId || !slot) return null;
  const id = sanitizeAssetRecordId(asset.id) || `${campaignId}:${entityType}:${entityId}:${slot}`;
  const value = String(asset.value || asset.path || "").trim();
  const hash = sanitizeAssetHash(asset.hash);
  return {
    id,
    campaignId,
    entityType,
    entityId,
    slot,
    label: String(asset.label || "").trim().slice(0, 160),
    foundry: normalizeAssetFoundryRef(asset.foundry),
    state: {
      value: value.slice(0, 500),
      hash,
      source: "foundry",
      updatedAt: String(asset.updatedAt || "").trim() || new Date().toISOString(),
    },
  };
}

function normalizeAssetFoundryRef(foundry) {
  const raw = foundry && typeof foundry === "object" ? foundry : {};
  return {
    worldId: String(raw.worldId || "").trim().slice(0, 100),
    actorId: String(raw.actorId || "").trim().slice(0, 100),
    actorName: String(raw.actorName || "").trim().slice(0, 160),
    itemId: String(raw.itemId || "").trim().slice(0, 100),
    itemName: String(raw.itemName || "").trim().slice(0, 160),
    uuid: String(raw.uuid || "").trim().slice(0, 300),
  };
}

function getAssetSyncStatus(previous, asset) {
  const foundryHash = asset?.state?.hash || "";
  const previousFoundryHash = previous?.foundryState?.hash || "";
  const siteHash = previous?.siteState?.hash || "";
  if (siteHash && foundryHash && siteHash === foundryHash) return "in-sync";
  if (siteHash && foundryHash && siteHash !== foundryHash) return "different";
  if (previousFoundryHash && foundryHash && previousFoundryHash !== foundryHash) return "foundry-updated";
  return foundryHash ? "foundry-only" : "unlinked";
}

function assetRecordsEquivalent(previous, next) {
  return JSON.stringify({
    entityType: previous.entityType,
    entityId: previous.entityId,
    slot: previous.slot,
    label: previous.label,
    foundry: previous.foundry || {},
    foundryState: previous.foundryState || {},
    syncStatus: previous.syncStatus || "",
  }) === JSON.stringify({
    entityType: next.entityType,
    entityId: next.entityId,
    slot: next.slot,
    label: next.label,
    foundry: next.foundry || {},
    foundryState: next.foundryState || {},
    syncStatus: next.syncStatus || "",
  });
}

function sanitizeAssetToken(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function sanitizeAssetId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 180);
}

function sanitizeAssetRecordId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 260);
}

function sanitizeAssetHash(value) {
  const hash = String(value || "").trim().toLowerCase();
  return /^[a-z0-9:_-]{4,128}$/.test(hash) ? hash : "";
}

async function handleDataCollectionPost(request, collection, fallbackCampaignId, env, corsHeaders = {}, ctx = null) {
  if (!env.SIGILLO_KV) {
    return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  }

  const user = await requireUser(request, env, corsHeaders);
  if (user instanceof Response) return user;

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const campaignId = sanitizeCampaignId(body?.campaignId || body?.campaign || fallbackCampaignId);
  const isCampaignEditor = await isAuthenticatedCampaignEditor(user, env, campaignId);
  const isUserScopedCollection = ["calendar", "transformations", "skill-tree-states", "ability-overrides", "item-overrides", "media-overrides"].includes(collection);
  if (!isCampaignEditor && !isUserScopedCollection) {
    return json({ ok: false, error: "Forbidden: data editing requires campaign editor permissions" }, 403, corsHeaders);
  }

  const skillTreePatch = collection === "skill-trees"
    && body?.tree
    && typeof body.tree === "object"
    && !Array.isArray(body.tree);
  const data = skillTreePatch
    ? [body.tree]
    : Array.isArray(body)
      ? body
      : body?.data;
  if (!Array.isArray(data)) {
    return json({ ok: false, error: "Expected an array, { data: [...] }, or { tree: {...} } for skill trees" }, 400, corsHeaders);
  }

  const serializedData = JSON.stringify(data);
  if (serializedData.length > 1024 * 1024) {
    return json({ ok: false, error: "Payload too large" }, 413, corsHeaders);
  }

  const key = dataCollectionKey(collection, campaignId);
  const existing = safeJsonParse(await env.SIGILLO_KV.get(key)) || {};
  const existingData = Array.isArray(existing.data) ? existing.data : [];
  const expectedVersion = Number(body?.expectedVersion);
  const currentVersion = Number(existing.version || 0);
  if (Number.isFinite(expectedVersion) && expectedVersion !== currentVersion) {
    return json({
      ok: false,
      error: "Data conflict: online data changed since this editor loaded. Reload before saving.",
      code: "VERSION_CONFLICT",
      collection,
      campaignId,
      currentVersion,
      expectedVersion,
      updatedAt: existing.updatedAt || null,
      updatedBy: existing.updatedBy || null,
    }, 409, corsHeaders);
  }

  const authenticatedAccountId = getAuthenticatedAccountId(user, env);
  let nextData = collection === "transformations" && !isCampaignEditor
    ? mergeUserTransformations(existingData, data, authenticatedAccountId)
    : collection === "skill-tree-states" && !isCampaignEditor
      ? mergeUserSkillTreeStates(existingData, data, authenticatedAccountId)
      : collection === "calendar" && !isCampaignEditor
        ? mergeUserCalendarNotes(existingData, data, authenticatedAccountId, user)
      : ["ability-overrides", "item-overrides", "media-overrides"].includes(collection) && !isCampaignEditor
        ? await mergeUserOwnedOverrides(existingData, data, authenticatedAccountId, env, campaignId, collection)
        : data;

  if (skillTreePatch) {
    const treeId = String(body.tree.id || "").trim().slice(0, 180);
    if (!treeId) {
      return json({ ok: false, error: "Skill tree id is required" }, 400, corsHeaders);
    }
    const nextTree = { ...body.tree, id: treeId };
    const existingIndex = existingData.findIndex((entry) => String(entry?.id || "") === treeId);
    nextData = existingIndex >= 0
      ? existingData.map((entry, index) => index === existingIndex ? nextTree : entry)
      : [...existingData, nextTree];
  }

  const removedTransformationMedia = collection === "transformations"
    ? getRemovedTransformationMediaKeys(existingData, nextData)
    : [];
  if (collection === "transformations") {
    nextData = normalizeTransformationRecords(existingData, nextData);
  }
  if (collection === "items") {
    nextData = normalizeCampaignItemsForSiteSave(existingData, nextData);
  }

  const now = new Date().toISOString();
  const doc = {
    version: currentVersion + 1,
    collection,
    campaignId,
    updatedAt: now,
    updatedBy: String(user.global_name || user.username || user.sub || ""),
    updatedByDiscordId: String(user.sub || ""),
    data: nextData,
  };

  await env.SIGILLO_KV.put(key, JSON.stringify(doc));
  if (collection === "items") {
    const pendingItems = nextData.filter((record) => record?.sync?.pendingFoundry === true);
    if (pendingItems.length) {
      scheduleFoundryLiveInvalidation(ctx, env, {
        campaignId,
        worldIds: pendingItems.map((record) => record?.foundry?.worldId).filter(Boolean),
        collections: ["campaign-items"],
        reason: "campaign-items-site-save",
        revision: doc.version,
      });
    }
  } else if ([
    "transformations",
    "skill-trees",
    "skill-tree-states",
    "ability-overrides",
    "item-overrides",
    "media-overrides",
  ].includes(collection)) {
    scheduleFoundryLiveInvalidation(ctx, env, {
      campaignId,
      collections: ["light-sync"],
      reason: `data:${collection}`,
      revision: doc.version,
    });
  }

  const deletedMedia = [];
  const failedMediaDeletes = [];
  if (collection === "transformations" && env.MEDIA_BUCKET) {
    for (const mediaKey of removedTransformationMedia) {
      try {
        await env.MEDIA_BUCKET.delete(mediaKey);
        deletedMedia.push(mediaKey);
      } catch (error) {
        failedMediaDeletes.push({
          key: mediaKey,
          error: String(error?.message || error),
        });
      }
    }
  }

  return json({
    ok: true,
    saved: true,
    collection,
    campaignId,
    version: doc.version,
    updatedAt: doc.updatedAt,
    count: nextData.length,
    deletedMedia,
    failedMediaDeletes,
  }, 200, corsHeaders);
}

async function handleAssetCleanupDryRun(request, fallbackCampaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) {
    return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  }
  const user = await requireUser(request, env, corsHeaders);
  if (user instanceof Response) return user;

  const url = new URL(request.url);
  const campaignId = sanitizeCampaignId(url.searchParams.get("campaign") || fallbackCampaignId);
  if (!(await isAuthenticatedCampaignEditor(user, env, campaignId))) {
    return json({ ok: false, error: "Forbidden: cleanup requires campaign editor permissions" }, 403, corsHeaders);
  }

  const plan = await buildAssetCleanupPlan(campaignId, env);
  return json({ ok: true, ...plan }, 200, corsHeaders);
}

async function handleAssetCleanupApply(request, fallbackCampaignId, env, corsHeaders = {}) {
  if (!env.SIGILLO_KV) {
    return json({ ok: false, error: "Missing env.SIGILLO_KV" }, 500, corsHeaders);
  }
  if (!env.MEDIA_BUCKET) {
    return json({ ok: false, error: "Missing env.MEDIA_BUCKET" }, 500, corsHeaders);
  }
  const user = await requireUser(request, env, corsHeaders);
  if (user instanceof Response) return user;

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const campaignId = sanitizeCampaignId(body?.campaignId || body?.campaign || fallbackCampaignId);
  if (!(await isAuthenticatedCampaignEditor(user, env, campaignId))) {
    return json({ ok: false, error: "Forbidden: cleanup requires campaign editor permissions" }, 403, corsHeaders);
  }

  const selectedKvIds = new Set(normalizeCleanupStringArray(body?.kvIds || [], 320));
  const selectedR2Keys = new Set(normalizeCleanupStringArray(body?.r2Keys || [], 260).map(sanitizeMediaKey).filter(Boolean));
  if (!selectedKvIds.size && !selectedR2Keys.size) {
    return json({ ok: false, error: "No cleanup candidates selected" }, 400, corsHeaders);
  }

  const plan = await buildAssetCleanupPlan(campaignId, env);
  const allowedKv = new Map(plan.kvCandidates.map((candidate) => [candidate.id, candidate]));
  const allowedR2 = new Map(plan.r2Candidates.map((candidate) => [candidate.key, candidate]));
  const rejected = [];
  const kvByCollection = new Map();
  const r2Keys = [];

  selectedKvIds.forEach((id) => {
    const candidate = allowedKv.get(id);
    if (!candidate) {
      rejected.push({ type: "kv", id, reason: "Not in dry-run candidates" });
      return;
    }
    if (!kvByCollection.has(candidate.collection)) kvByCollection.set(candidate.collection, []);
    kvByCollection.get(candidate.collection).push(candidate);
  });

  selectedR2Keys.forEach((key) => {
    const candidate = allowedR2.get(key);
    if (!candidate) {
      rejected.push({ type: "r2", key, reason: "Not in dry-run candidates or still referenced" });
      return;
    }
    r2Keys.push(key);
  });

  const updatedCollections = [];
  for (const [collection, candidates] of kvByCollection.entries()) {
    const doc = await readDataCollectionDocument(collection, campaignId, env);
    const data = Array.isArray(doc?.data) ? doc.data : [];
    const before = data.length;
    const removeKeys = new Set(candidates.map((candidate) => candidate.matchKey));
    const nextData = data.filter((entry) => !removeKeys.has(getCleanupRecordMatchKey(collection, entry)));
    if (nextData.length === before) continue;
    await writeDataCollectionDocument(collection, campaignId, nextData, user, env);
    updatedCollections.push({ collection, removed: before - nextData.length });
  }

  const deletedR2 = [];
  for (const key of r2Keys) {
    await env.MEDIA_BUCKET.delete(key);
    deletedR2.push(key);
  }

  return json({
    ok: true,
    campaignId,
    deletedKv: updatedCollections.reduce((sum, entry) => sum + entry.removed, 0),
    deletedR2: deletedR2.length,
    updatedCollections,
    deletedR2Keys: deletedR2,
    rejected,
  }, 200, corsHeaders);
}

async function writeDataCollectionDocument(collection, campaignId, data, user, env) {
  const key = dataCollectionKey(collection, campaignId);
  const existing = safeJsonParse(await env.SIGILLO_KV.get(key)) || {};
  const now = new Date().toISOString();
  const doc = {
    version: Number(existing.version || 0) + 1,
    collection,
    campaignId,
    updatedAt: now,
    updatedBy: String(user?.global_name || user?.username || user?.sub || "cleanup"),
    updatedByDiscordId: String(user?.sub || ""),
    data,
  };
  await env.SIGILLO_KV.put(key, JSON.stringify(doc));
  return doc;
}

function normalizeCleanupStringArray(value, maxLength = 260) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((entry) => String(entry || "").trim())
    .filter((entry) => entry && entry.length <= maxLength && !/[\r\n]/.test(entry))
  )];
}

async function buildAssetCleanupPlan(campaignId, env) {
  const archiveDoc = await readDataCollectionDocument("asset-sync-archive", campaignId, env);
  const archive = Array.isArray(archiveDoc?.data) ? archiveDoc.data : [];
  const collections = [
    "media-overrides",
    "ability-overrides",
    "item-overrides",
    "asset-registry",
    "characters",
    "items",
    "bestiary",
    "skill-trees",
    "transformations",
  ];
  const docs = {};
  for (const collection of collections) {
    docs[collection] = await readDataCollectionDocument(collection, campaignId, env);
  }

  const liveReferences = buildLiveMediaReferenceIndex(docs, archive);
  const kvCandidates = [];
  const blockedKv = [];
  const r2ByKey = new Map();
  const blockedR2 = new Map();

  for (const archived of archive) {
    const sourceCandidates = getArchivedKvCandidates(archived, docs);
    if (!sourceCandidates.length) {
      blockedKv.push({
        archiveId: archived?.id || "",
        label: archived?.label || "",
        reason: "No matching live override found",
      });
    }
    sourceCandidates.forEach((candidate) => kvCandidates.push(candidate));

    getArchivedMediaKeys(archived).forEach((key) => {
      const references = liveReferences.get(key) || [];
      if (references.length) {
        blockedR2.set(key, {
          key,
          label: archived?.label || "",
          references,
          reason: "Still referenced by live data",
        });
        return;
      }
      if (!r2ByKey.has(key)) {
        r2ByKey.set(key, {
          key,
          label: archived?.label || "",
          archiveIds: [],
        });
      }
      r2ByKey.get(key).archiveIds.push(archived?.id || "");
    });
  }

  return {
    campaignId,
    archiveCount: archive.length,
    kvCandidates,
    r2Candidates: Array.from(r2ByKey.values()).sort((a, b) => a.key.localeCompare(b.key)),
    blockedKv,
    blockedR2: Array.from(blockedR2.values()).sort((a, b) => a.key.localeCompare(b.key)),
    counts: {
      kvCandidates: kvCandidates.length,
      r2Candidates: r2ByKey.size,
      blockedKv: blockedKv.length,
      blockedR2: blockedR2.size,
    },
  };
}

function getArchivedKvCandidates(archived, docs) {
  const integrityStatus = sanitizeAssetToken(archived?.integrityStatus || archived?.record?.integrityStatus || "");
  if (!["legacy", "orphan", "partial"].includes(integrityStatus)) return [];
  const entityType = sanitizeAssetToken(archived?.entityType || archived?.record?.entityType || "");
  if (entityType === "ability") return findArchivedOverrideCandidates("ability-overrides", archived, docs["ability-overrides"]);
  if (entityType === "item") return findArchivedOverrideCandidates("item-overrides", archived, docs["item-overrides"]);
  if (entityType === "player" || entityType === "companion") return findArchivedMediaOverrideCandidates(archived, docs["media-overrides"]);
  return [];
}

function findArchivedOverrideCandidates(collection, archived, doc) {
  const data = Array.isArray(doc?.data) ? doc.data : [];
  const record = archived?.record || {};
  const foundry = record.foundry || {};
  const actorId = String(foundry.actorId || "").trim();
  const itemId = String(foundry.itemId || "").trim();
  const slot = sanitizeAssetToken(archived?.slot || record.slot || "");
  const candidates = [];
  data.forEach((entry) => {
    const sameActor = actorId && String(entry?.actorId || "").trim() === actorId;
    const sameItem = itemId && String(entry?.itemId || entry?.abilityId || "").trim() === itemId;
    if (!sameActor || !sameItem) return;
    if (slot === "description" && !entry?.description) return;
    if ((slot === "image" || slot === "icon") && !entry?.image) return;
    candidates.push({
      id: `${collection}:${getCleanupRecordMatchKey(collection, entry)}:${slot}`,
      collection,
      archiveId: archived?.id || "",
      assetId: archived?.assetId || "",
      label: archived?.label || entry?.itemName || entry?.abilityName || "",
      slot,
      matchKey: getCleanupRecordMatchKey(collection, entry),
      actorId,
      itemId,
    });
  });
  return candidates;
}

function findArchivedMediaOverrideCandidates(archived, doc) {
  const data = Array.isArray(doc?.data) ? doc.data : [];
  const record = archived?.record || {};
  const foundry = record.foundry || {};
  const actorId = String(foundry.actorId || "").trim();
  const entityType = sanitizeAssetToken(archived?.entityType || record.entityType || "");
  const slot = sanitizeAssetToken(archived?.slot || record.slot || "");
  const candidates = [];
  data.forEach((entry) => {
    if (entityType && sanitizeAssetToken(entry?.entityType || "") !== entityType) return;
    if (actorId && String(entry?.actorId || "").trim() !== actorId) return;
    const images = entry?.images || {};
    const hasSlot = slot === "avatar"
      ? Boolean(images.avatar || images.portrait)
      : slot === "token"
        ? Boolean(images.token)
        : false;
    if (!hasSlot) return;
    candidates.push({
      id: `media-overrides:${getCleanupRecordMatchKey("media-overrides", entry)}:${slot}`,
      collection: "media-overrides",
      archiveId: archived?.id || "",
      assetId: archived?.assetId || "",
      label: archived?.label || entry?.name || "",
      slot,
      matchKey: getCleanupRecordMatchKey("media-overrides", entry),
      actorId,
    });
  });
  return candidates;
}

function getCleanupRecordMatchKey(collection, entry) {
  if (!entry || typeof entry !== "object") return "";
  if (collection === "ability-overrides") {
    return [
      entry.actorId || "",
      entry.abilityId || "",
      entry.key || entry.id || "",
    ].join("|");
  }
  if (collection === "item-overrides") {
    return [
      entry.actorId || "",
      entry.itemId || "",
      entry.key || entry.id || "",
    ].join("|");
  }
  if (collection === "media-overrides") {
    return [
      entry.entityType || "",
      entry.actorId || "",
      entry.entityId || entry.key || entry.id || "",
    ].join("|");
  }
  return String(entry.id || entry.key || "");
}

function getArchivedMediaKeys(archived) {
  const values = [
    archived?.record?.siteValue,
    archived?.record?.foundryValue,
    archived?.siteValue,
    archived?.foundryValue,
  ];
  const keys = new Set();
  values.forEach((value) => {
    const key = extractMediaKeyFromValue(value);
    if (key) keys.add(key);
  });
  return Array.from(keys);
}

function extractMediaKeyFromValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!/\.(webp|png|jpe?g|gif|avif)(\?|$)/i.test(raw)) return "";
  let text = raw.replace(/\\/g, "/");
  try {
    const url = new URL(text);
    text = url.pathname;
  } catch (_) {
    // Keep path-like values as-is.
  }
  text = decodeURIComponent(text)
    .replace(/^\/+/, "")
    .replace(/^media\//, "")
    .split("?")[0]
    .split("#")[0];
  return sanitizeMediaKey(text);
}

function buildLiveMediaReferenceIndex(docs, archive) {
  const archivedValues = new Set();
  (Array.isArray(archive) ? archive : []).forEach((entry) => {
    [entry?.record?.siteValue, entry?.record?.foundryValue, entry?.siteValue, entry?.foundryValue].forEach((value) => {
      const key = extractMediaKeyFromValue(value);
      if (key) archivedValues.add(key);
    });
  });

  const references = new Map();
  Object.entries(docs || {}).forEach(([collection, doc]) => {
    const data = Array.isArray(doc?.data) ? doc.data : [];
    data.forEach((entry, index) => {
      collectMediaKeysFromValue(entry).forEach((key) => {
        if (!archivedValues.has(key)) return;
        if (!references.has(key)) references.set(key, []);
        references.get(key).push({
          collection,
          index,
          id: String(entry?.id || entry?.key || ""),
          label: String(entry?.name || entry?.label || entry?.itemName || entry?.abilityName || ""),
        });
      });
    });
  });
  return references;
}

function collectMediaKeysFromValue(value, keys = new Set()) {
  if (typeof value === "string") {
    const key = extractMediaKeyFromValue(value);
    if (key) keys.add(key);
    return keys;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectMediaKeysFromValue(item, keys));
    return keys;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectMediaKeysFromValue(item, keys));
  }
  return keys;
}

function normalizeTransformationRecords(existingData, nextData) {
  const existingById = new Map((Array.isArray(existingData) ? existingData : [])
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => [String(entry.id || ""), entry]));

  return (Array.isArray(nextData) ? nextData : []).map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const id = String(entry.id || "");
    const previous = existingById.get(id) || null;
    const previousImage = String(previous?.tokenImage || previous?.image || "").trim();
    const nextImage = String(entry.tokenImage || entry.image || "").trim();
    const previousRevision = normalizePositiveRevision(previous?.revision || previous?.imageRevision);
    const submittedRevision = normalizePositiveRevision(entry.revision || entry.imageRevision);
    const revision = previous && previousImage !== nextImage
      ? Math.max(previousRevision + 1, submittedRevision)
      : Math.max(previousRevision, submittedRevision);

    return {
      ...entry,
      revision,
    };
  });
}

function getRemovedTransformationMediaKeys(existingData, nextData) {
  const current = collectTransformationMediaKeys(existingData);
  const next = collectTransformationMediaKeys(nextData);
  return Array.from(current).filter((key) => !next.has(key));
}

function collectTransformationMediaKeys(records) {
  const keys = new Set();
  for (const entry of Array.isArray(records) ? records : []) {
    const key = extractMediaKeyFromValue(entry?.tokenImage || entry?.image || "");
    if (!key) continue;
    if (key.includes("/transformations/") || key.includes("/companion-transformations/")) {
      keys.add(key);
    }
  }
  return keys;
}

function normalizePositiveRevision(value) {
  const revision = Math.floor(Number(value));
  return Number.isFinite(revision) && revision > 0 ? revision : 1;
}

function mergeUserTransformations(existingData, submittedData, accountId) {
  const cleanAccountId = sanitizeAccountId(accountId);
  if (!cleanAccountId) return existingData;
  const belongsToUser = (entry) => sanitizeAccountId(entry?.ownerAccountId || entry?.accountId || "") === cleanAccountId;
  const kept = (Array.isArray(existingData) ? existingData : []).filter((entry) => !belongsToUser(entry));
  const own = (Array.isArray(submittedData) ? submittedData : [])
    .filter((entry) => entry && typeof entry === "object" && belongsToUser(entry))
    .map((entry) => ({
      ...entry,
      ownerAccountId: cleanAccountId,
    }));
  return [...kept, ...own];
}

function isSharedSkillTreeStateEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  const scope = String(entry.scope || entry.stateScope || entry.visibility || "").trim().toLowerCase();
  const characterId = sanitizeAssetId(entry.characterId || entry.subjectId || "");
  return entry.shared === true
    || entry.campaignShared === true
    || ["campaign", "campagna", "shared", "condiviso", "global"].includes(scope)
    || ["campaign", "campagna", "global", "all", "tutti"].includes(characterId);
}

function mergeUserSkillTreeStates(existingData, submittedData, accountId) {
  const cleanAccountId = sanitizeAccountId(accountId);
  if (!cleanAccountId) return existingData;
  const belongsToUser = (entry) => sanitizeAccountId(entry?.ownerAccountId || entry?.accountId || "") === cleanAccountId;
  const kept = (Array.isArray(existingData) ? existingData : []).filter((entry) => isSharedSkillTreeStateEntry(entry) || !belongsToUser(entry));
  const own = (Array.isArray(submittedData) ? submittedData : [])
    .filter((entry) => entry && typeof entry === "object" && belongsToUser(entry) && !isSharedSkillTreeStateEntry(entry))
    .map((entry) => ({
      ...entry,
      ownerAccountId: cleanAccountId,
      scope: "character",
      shared: false,
      unlocked: normalizeStringList(entry.unlocked || entry.unlockedNodeIds || []).slice(0, 500),
    }));
  return [...kept, ...own];
}

function mergeUserCalendarNotes(existingData, submittedData, accountId, user = {}) {
  const cleanAccountId = sanitizeAccountId(accountId);
  if (!cleanAccountId) return existingData;
  const displayName = String(user.global_name || user.username || user.sub || "").trim();
  const belongsToUser = (entry) => (
    entry?.type === "note"
    && sanitizeAccountId(entry?.ownerAccountId || entry?.accountId || "") === cleanAccountId
  );
  const kept = (Array.isArray(existingData) ? existingData : []).filter((entry) => !belongsToUser(entry));
  const own = (Array.isArray(submittedData) ? submittedData : [])
    .filter((entry) => entry && typeof entry === "object" && belongsToUser(entry))
    .map((entry) => ({
      type: "note",
      id: sanitizeAssetId(entry.id) || `note-${crypto.randomUUID()}`,
      date: sanitizeCalendarDateKey(entry.date),
      title: String(entry.title || "").trim().slice(0, 160),
      text: String(entry.text || "").trim().slice(0, 4000),
      visibility: entry.visibility === "private" ? "private" : "shared",
      ownerAccountId: cleanAccountId,
      ownerDiscordId: String(user.sub || entry.ownerDiscordId || "").trim(),
      ownerName: String(entry.ownerName || displayName).trim().slice(0, 80),
      updatedAt: String(entry.updatedAt || new Date().toISOString())
    }))
    .filter((entry) => entry.date && (entry.title || entry.text));
  return [...kept, ...own];
}

function sanitizeCalendarDateKey(value) {
  const clean = String(value || "").trim();
  return /^-?\d{1,8}-\d{1,4}-\d{1,4}$/.test(clean) ? clean : "";
}

async function mergeUserOwnedOverrides(existingData, submittedData, accountId, env, campaignId, collection) {
  const cleanAccountId = sanitizeAccountId(accountId);
  if (!cleanAccountId) return existingData;

  const ownedCharacterIds = await getEditableCharacterIdsForAccount(env, campaignId, cleanAccountId);
  if (!ownedCharacterIds.size) return existingData;

  const isOwned = (entry) => isUserOwnedOverrideEntry(entry, collection, cleanAccountId, ownedCharacterIds);
  const kept = (Array.isArray(existingData) ? existingData : []).filter((entry) => !isOwned(entry));
  const own = (Array.isArray(submittedData) ? submittedData : [])
    .filter((entry) => entry && typeof entry === "object" && isOwned(entry))
    .map((entry) => ({
      ...entry,
      ownerAccountId: entry.ownerAccountId || cleanAccountId,
    }));
  return [...kept, ...own];
}

function isUserOwnedOverrideEntry(entry, collection, accountId, ownedCharacterIds) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const cleanAccountId = sanitizeAccountId(accountId);
  const explicitOwner = sanitizeAccountId(entry.ownerAccountId || entry.accountId || "");
  if (explicitOwner && explicitOwner !== cleanAccountId) return false;

  const candidateCharacterIds = [
    entry.characterId,
    entry.ownerCharacterId,
    collection === "media-overrides" && entry.entityType === "player" ? entry.entityId : "",
  ].map(sanitizeAssetToken).filter(Boolean);

  if (candidateCharacterIds.some((id) => ownedCharacterIds.has(id))) return true;

  const key = sanitizeAssetId(entry.key || entry.id || "");
  return [...ownedCharacterIds].some((characterId) => (
    key === characterId
    || key.startsWith(`${characterId}:`)
    || key.startsWith(`player:${characterId}`)
    || key.startsWith(`companion:${characterId}-`)
  ));
}

async function getEditableCharacterIdsForAccount(env, campaignId, accountId) {
  const cleanAccountId = sanitizeAccountId(accountId);
  const ids = new Set();
  if (!cleanAccountId || !env.SIGILLO_KV) return ids;

  const addId = (value) => {
    const id = sanitizeAssetToken(value);
    if (id) ids.add(id);
  };

  const charactersDoc = safeJsonParse(await env.SIGILLO_KV.get(dataCollectionKey("characters", campaignId))) || {};
  const characters = Array.isArray(charactersDoc.data) ? charactersDoc.data : [];
  for (const character of characters) {
    const ownerAccountId = sanitizeAccountId(character?.accountId || character?.ownerAccountId || "");
    if (ownerAccountId === cleanAccountId) addId(character?.id || character?.characterId || character?.name);
  }

  const inventoryRaw = await getCampaignKv(
    env.SIGILLO_KV,
    inventoryKey(campaignId),
    sanitizeCampaignId(campaignId) === DEFAULT_CAMPAIGN_ID ? "inventory/latest" : ""
  );
  const inventory = safeJsonParse(inventoryRaw) || {};
  const actors = [
    ...(Array.isArray(inventory.actors) ? inventory.actors : []),
    ...(Array.isArray(inventory.players) ? inventory.players : []),
  ];
  for (const actor of actors) {
    const ownerAccountId = sanitizeAccountId(actor?.ownerAccountId || actor?.accountId || "");
    if (ownerAccountId === cleanAccountId) addId(actor?.ownerCharacterId || actor?.characterId || actor?.id || actor?.name);
  }

  const companions = Array.isArray(inventory.companions) ? inventory.companions : [];
  for (const companion of companions) {
    const ownerAccountId = sanitizeAccountId(companion?.ownerAccountId || companion?.accountId || "");
    if (ownerAccountId === cleanAccountId) addId(companion?.ownerCharacterId || companion?.characterId);
  }

  return ids;
}

async function canAuthenticatedUserUploadMedia(user, env, campaignId, folder, filename) {
  const accountId = getAuthenticatedAccountId(user, env);
  const parts = String(folder || "").split("/");
  const root = parts[0] || "";

  if (root === "managed-actors") {
    const worldId = sanitizeManagedActorId(parts[1] || "");
    const actorId = sanitizeManagedActorId(parts[2] || "");
    if (!worldId || !actorId || !env.SIGILLO_KV) return false;
    const actor = safeJsonParse(await env.SIGILLO_KV.get(managedActorDocumentKey(campaignId, worldId, actorId)));
    return isManagedActorOwner(actor, user, env);
  }

  const ownedCharacterIds = await getEditableCharacterIdsForAccount(env, campaignId, accountId);
  if (!ownedCharacterIds.size) return false;

  if (folder === "transformations" || folder.startsWith("transformations/")) return true;
  if (folder === "companion-transformations" || folder.startsWith("companion-transformations/")) return true;

  const scopedCharacterId = sanitizeAssetToken(parts[1] || "");

  if (["ability-overrides", "item-overrides", "companions"].includes(root)) {
    return Boolean(scopedCharacterId && ownedCharacterIds.has(scopedCharacterId));
  }

  if (root === "players") {
    const name = String(filename || "").replace(/\.webp$/i, "");
    return [...ownedCharacterIds].some((characterId) => (
      name === characterId
      || name.startsWith(`${characterId}-`)
      || name.startsWith(`${characterId}_`)
    ));
  }

  return false;
}
function requireInventorySyncSecret(request, env, corsHeaders = {}) {
  const expected = String(env.INVENTORY_SYNC_SECRET || "").trim();
  if (!expected) return true;

  const provided = String(
    request.headers.get("X-Cripta-Inventory-Secret") ||
    request.headers.get("X-Inventory-Sync-Secret") ||
    ""
  ).trim();

  if (provided && provided === expected) return true;
  return json({ ok: false, error: "Unauthorized inventory sync" }, 401, corsHeaders);
}

async function handleMediaUpload(request, env, corsHeaders = {}) {
  if (!env.MEDIA_BUCKET) {
    return json({ ok: false, error: "Missing env.MEDIA_BUCKET" }, 500, corsHeaders);
  }

  let user = null;

  const contentLength = Number(request.headers.get("Content-Length") || "0");
  const maxBytes = 5 * 1024 * 1024;
  if (contentLength && contentLength > maxBytes) {
    return json({ ok: false, error: "File too large: max 5 MB" }, 413, corsHeaders);
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return json({ ok: false, error: "Missing file" }, 400, corsHeaders);
  }
  if (file.size > maxBytes) {
    return json({ ok: false, error: "File too large: max 5 MB" }, 413, corsHeaders);
  }
  if (!String(file.type || "").startsWith("image/")) {
    return json({ ok: false, error: "Unsupported file type: expected image/*" }, 415, corsHeaders);
  }

  const url = new URL(request.url);
  const campaignId = getCampaignIdFromBodyOrUrl(
    { campaignId: form.get("campaignId") || form.get("campaign") },
    url
  );
  const folder = sanitizeMediaFolder(form.get("folder") || url.searchParams.get("folder") || "items");
  if (!folder) {
    return json({ ok: false, error: "Invalid media folder" }, 400, corsHeaders);
  }

  const requestedName = String(form.get("filename") || file.name || "").trim();
  const filename = sanitizeWebpFilename(requestedName || "image.webp");
  if (!filename) {
    return json({ ok: false, error: "Invalid filename: expected .webp" }, 400, corsHeaders);
  }

  const isManagedActorFolder = folder.startsWith("managed-actors/");
  const foundrySyncAuthorized = (isManagedActorFolder || folder === "items") && isFoundrySyncSecretAuthorized(request, env);
  if (!foundrySyncAuthorized) {
    user = await requireUser(request, env, corsHeaders);
    if (user instanceof Response) return user;
  }
  const isCampaignEditor = foundrySyncAuthorized || (isManagedActorFolder
    ? await isAuthenticatedCampaignContentEditor(user, env, campaignId)
    : await isAuthenticatedCampaignEditor(user, env, campaignId));
  if (!isCampaignEditor && !(await canAuthenticatedUserUploadMedia(user, env, campaignId, folder, filename))) {
    return json({ ok: false, error: "Forbidden: media upload requires campaign editor permissions" }, 403, corsHeaders);
  }

  const key = mediaStorageKey(campaignId, folder, filename);
  const bytes = await file.arrayBuffer();
  await env.MEDIA_BUCKET.put(key, bytes, {
    httpMetadata: {
      contentType: "image/webp",
      cacheControl: mediaCacheControlForKey(key),
    },
    customMetadata: {
      uploadedBy: foundrySyncAuthorized ? "foundry-sync" : getAuthenticatedAccountId(user, env),
      campaignId,
      originalName: String(file.name || ""),
      uploadedAt: new Date().toISOString(),
    },
  });
  const stored = await env.MEDIA_BUCKET.head(key);
  if (!stored || stored.size !== bytes.byteLength) {
    return json(
      {
        ok: false,
        error: "R2 upload verification failed",
        key,
        expectedSize: bytes.byteLength,
        storedSize: stored?.size || 0,
      },
      500,
      corsHeaders
    );
  }

  return json(
    {
      ok: true,
      key,
      path: `media/${key}`,
      url: `${new URL(request.url).origin}/media/${key}`,
      size: bytes.byteLength,
      storedSize: stored.size,
      etag: stored.httpEtag,
    },
    200,
    corsHeaders
  );
}

async function handleMediaCopyFolder(request, env, corsHeaders = {}) {
  if (!env.MEDIA_BUCKET) {
    return json({ ok: false, error: "Missing env.MEDIA_BUCKET" }, 500, corsHeaders);
  }

  const user = await requireUser(request, env, corsHeaders);
  if (user instanceof Response) return user;

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const url = new URL(request.url);
  const campaignId = getCampaignIdFromBodyOrUrl(body, url);
  if (!(await isAuthenticatedCampaignEditor(user, env, campaignId))) {
    return json({ ok: false, error: "Forbidden: media folder copy requires campaign editor permissions" }, 403, corsHeaders);
  }

  const fromFolder = sanitizeMediaFolder(body?.fromFolder || body?.from || "");
  const toFolder = sanitizeMediaFolder(body?.toFolder || body?.to || "");
  if (!fromFolder || !toFolder || fromFolder === toFolder) {
    return json({ ok: false, error: "Invalid media folders" }, 400, corsHeaders);
  }
  if (!fromFolder.startsWith("characters/") || !toFolder.startsWith("characters/")) {
    return json({ ok: false, error: "Only character media folders can be copied" }, 400, corsHeaders);
  }

  const fromPrefix = mediaFolderStoragePrefix(campaignId, fromFolder);
  const toPrefix = mediaFolderStoragePrefix(campaignId, toFolder);
  const copied = [];
  const skipped = [];
  let cursor;

  do {
    const listed = await env.MEDIA_BUCKET.list({ prefix: fromPrefix, cursor, limit: 1000 });
    cursor = listed.truncated ? listed.cursor : undefined;
    for (const entry of listed.objects || []) {
      if (!entry?.key || !entry.key.startsWith(fromPrefix)) continue;
      const suffix = entry.key.slice(fromPrefix.length);
      if (!suffix || suffix.includes("/") || !sanitizeWebpFilename(suffix)) {
        skipped.push(entry.key);
        continue;
      }
      const destinationKey = `${toPrefix}${suffix}`;
      const sourceObject = await env.MEDIA_BUCKET.get(entry.key);
      if (!sourceObject) {
        skipped.push(entry.key);
        continue;
      }
      await env.MEDIA_BUCKET.put(destinationKey, sourceObject.body, {
        httpMetadata: sourceObject.httpMetadata,
        customMetadata: {
          ...(sourceObject.customMetadata || {}),
          copiedFrom: entry.key,
          copiedAt: new Date().toISOString(),
        },
      });
      copied.push({
        from: entry.key,
        to: destinationKey,
        fromPath: `media/${entry.key}`,
        toPath: `media/${destinationKey}`,
      });
    }
  } while (cursor);

  return json({
    ok: true,
    campaignId,
    fromFolder,
    toFolder,
    copied,
    skipped,
    copiedCount: copied.length,
    skippedCount: skipped.length,
  }, 200, corsHeaders);
}

async function handleMediaCheck(request, env, corsHeaders = {}) {
  if (!env.MEDIA_BUCKET) {
    return json({ ok: false, error: "Missing env.MEDIA_BUCKET" }, 500, corsHeaders);
  }

  const url = new URL(request.url);
  let body = {};
  if (request.method === "POST") {
    try {
      body = await request.json();
    } catch (_) {
      return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);
    }
  }

  const rawEntries = request.method === "GET"
    ? [url.searchParams.get("path") || url.searchParams.get("key") || ""]
    : [
        ...(Array.isArray(body?.paths) ? body.paths : []),
        ...(Array.isArray(body?.keys) ? body.keys : []),
        ...(Array.isArray(body?.media) ? body.media : []),
      ];
  const exact = request.method === "GET"
    ? url.searchParams.get("exact") === "1" || url.searchParams.get("exact") === "true"
    : body?.exact === true;
  const entries = Array.from(new Set(rawEntries.map(normalizeMediaCheckInput).filter(Boolean))).slice(0, 100);
  if (!entries.length) {
    return json({ ok: false, error: "Expected at least one media path/key" }, 400, corsHeaders);
  }

  const results = await Promise.all(entries.map(async (entry) => {
    const checked = await getMediaHead(env.MEDIA_BUCKET, entry.key, exact);
    const object = checked?.object || null;
    return {
      input: entry.input,
      key: checked?.key || entry.key,
      path: `media/${checked?.key || entry.key}`,
      exists: Boolean(object),
      size: object?.size || 0,
      etag: object?.httpEtag || null,
      uploadedAt: object?.uploaded?.toISOString?.() || null,
      contentType: object?.httpMetadata?.contentType || null,
      cacheControl: object?.httpMetadata?.cacheControl || mediaCacheControlForKey(checked?.key || entry.key),
      customMetadata: object?.customMetadata || null,
    };
  }));

  return json({
    ok: true,
    exact,
    count: results.length,
    found: results.filter((result) => result.exists).length,
    missing: results.filter((result) => !result.exists).length,
    results,
  }, 200, {
    ...corsHeaders,
    "Cache-Control": "no-store",
  });
}

async function handleMediaGet(request, env, corsHeaders = {}) {
  if (!env.MEDIA_BUCKET) {
    return json({ ok: false, error: "Missing env.MEDIA_BUCKET" }, 500, corsHeaders);
  }

  const url = new URL(request.url);
  const key = sanitizeMediaKey(decodeURIComponent(url.pathname.replace(/^\/media\//, "")));
  if (!key) {
    return json({ ok: false, error: "Invalid media key" }, 400, corsHeaders);
  }

  const exact = url.searchParams.get("exact") === "1" || url.searchParams.get("exact") === "true";
  const mediaResult = exact
    ? { key, object: await env.MEDIA_BUCKET.get(key) }
    : await getMediaObject(env.MEDIA_BUCKET, key);
  const object = mediaResult?.object || null;
  if (!object) {
    return json({ ok: false, error: "Media not found" }, 404, {
      ...corsHeaders,
      "Cache-Control": "no-store",
    });
  }

  const headers = new Headers(corsHeaders);
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", headers.get("Content-Type") || "image/webp");
  headers.set("Cache-Control", mediaCacheControlForRequest(url, mediaResult.key || key));
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  headers.set("X-Cripta-Media-Key", mediaResult.key);
  headers.set("X-Cripta-Media-Size", String(object.size || ""));
  headers.set("Access-Control-Expose-Headers", "ETag, X-Cripta-Media-Key, X-Cripta-Media-Size");
  if (object.httpEtag && ifNoneMatchIncludes(request.headers.get("If-None-Match"), object.httpEtag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

function normalizeMediaCheckInput(value) {
  const input = String(value?.path || value?.key || value || "").trim();
  if (!input) return null;
  const key = sanitizeMediaKey(input.replace(/^https?:\/\/[^/]+\/media\//i, "").replace(/^\/?media\//i, ""));
  return key ? { input, key } : null;
}

async function getMediaHead(bucket, key, exact = false) {
  const candidates = exact ? [key] : getMediaKeyCandidates(key);
  for (const candidate of candidates) {
    const object = await bucket.head(candidate);
    if (object) return { key: candidate, object };
  }
  return null;
}

function mediaCacheControlForRequest(url, key) {
  const version = String(url?.searchParams?.get("v") || "").trim();
  if (version) return "public, max-age=31536000, immutable";
  return mediaCacheControlForKey(key);
}

function mediaCacheControlForKey(key) {
  const cleanKey = String(key || "");
  const mutableSegments = [
    "players",
    "characters",
    "companions",
    "ability-overrides",
    "item-overrides",
    "media-overrides",
    "managed-actors",
    "transformations",
    "skill-trees",
    "locations",
    "items",
  ];
  if (
    mutableSegments.some((segment) => mediaKeyHasSegment(cleanKey, segment))
    || cleanKey.includes("creatures/bestiary/")
  ) {
    return "no-cache, must-revalidate";
  }
  // Static wiki media can be cached briefly, but most assets are edited in-place.
  return "public, max-age=300, must-revalidate";
}

function mediaKeyHasSegment(key, segment) {
  const cleanKey = String(key || "").replace(/^\/+|\/+$/g, "");
  const cleanSegment = String(segment || "").replace(/^\/+|\/+$/g, "");
  return cleanKey === cleanSegment || cleanKey.startsWith(`${cleanSegment}/`) || cleanKey.includes(`/${cleanSegment}/`);
}

function ifNoneMatchIncludes(header, etag) {
  const requested = String(header || "").trim();
  const current = normalizeHttpEtag(etag);
  if (!requested || !current) return false;
  if (requested === "*") return true;
  return requested
    .split(",")
    .some((value) => normalizeHttpEtag(value) === current);
}

function normalizeHttpEtag(value) {
  return String(value || "")
    .trim()
    .replace(/^W\//i, "")
    .replace(/^"|"$/g, "");
}

async function getMediaObject(bucket, key) {
  const candidates = getMediaKeyCandidates(key);
  for (const candidate of candidates) {
    const object = await bucket.get(candidate);
    if (object) return { key: candidate, object };
  }
  return null;
}

function getMediaKeyCandidates(key) {
  const cleanKey = String(key || "").replace(/^\/+/, "");
  if (!cleanKey) return [];
  if (cleanKey.startsWith("campaigns/")) return [cleanKey];
  if (cleanKey.startsWith("ui/")) return [cleanKey, `campaigns/${DEFAULT_CAMPAIGN_ID}/${cleanKey}`];
  return [`campaigns/${DEFAULT_CAMPAIGN_ID}/${cleanKey}`];
}

function mediaStorageKey(campaignId, folder, filename) {
  const cleanCampaignId = sanitizeCampaignId(campaignId);
  return `campaigns/${cleanCampaignId}/${folder}/${filename}`;
}

function mediaFolderStoragePrefix(campaignId, folder) {
  const cleanCampaignId = sanitizeCampaignId(campaignId);
  const cleanFolder = sanitizeMediaFolder(folder);
  return `campaigns/${cleanCampaignId}/${cleanFolder}/`;
}

function sanitizeMediaFolder(value) {
  const folder = String(value || "").trim().toLowerCase().replace(/[^a-z0-9/_-]+/g, "-").replace(/^\/+|\/+$/g, "");
  if (/^characters(\/[a-z0-9_-]+)?$/.test(folder)) return folder;
  if (/^managed-actors(?:\/[a-z0-9_-]+){2,5}$/.test(folder)) return folder;
  if (/^ability-icons(\/[a-z0-9_-]+)?$/.test(folder)) return folder;
  if (/^ability-overrides(\/[a-z0-9_-]+)?$/.test(folder)) return folder;
  if (/^item-overrides(\/[a-z0-9_-]+)?$/.test(folder)) return folder;
  if (/^transformations(\/[a-z0-9_-]+)?$/.test(folder)) return folder;
  if (/^companion-transformations(\/[a-z0-9_-]+)?$/.test(folder)) return folder;
  if (/^companions(\/[a-z0-9_-]+)?$/.test(folder)) return folder;
  if (/^skill-trees(\/[a-z0-9_-]+)?$/.test(folder)) return folder;
  const allowed = new Set([
    "items",
    "bestiary",
    "players",
    "creatures",
    "creatures/bestiary",
    "creatures/bestiary/tokens",
    "monster-abilities",
    "monster-conditions",
    "creatures/transp",
    "documents",
    "maps",
    "maps/main_maps",
    "ui",
    "drops",
  ]);
  return allowed.has(folder) ? folder : "";
}

function sanitizeWebpFilename(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/").split("/").pop();
  const withoutExt = raw.replace(/\.[^.]+$/, "");
  const slug = withoutExt
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug || slug.length > 120) return "";
  return `${slug}.webp`;
}

function sanitizeMediaKey(value) {
  const key = String(value || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!key || key.includes("..") || key.length > 260) return "";
  if (key.startsWith("campaigns/")) {
    const [, rawCampaignId, folder, ...rest] = key.split("/");
    const campaignId = sanitizeCampaignId(rawCampaignId);
    const policyFolder = folder === "managed-actors" ? [folder, ...rest.slice(0, -1)].join("/") : folder;
    if (!campaignId || campaignId !== rawCampaignId || !sanitizeMediaFolder(policyFolder) || rest.length < 1) return "";
    const filename = sanitizeWebpFilename(rest[rest.length - 1]);
    if (!filename || filename !== rest[rest.length - 1].toLowerCase()) return "";
    const subfolders = rest.slice(0, -1).map((part) => {
      const clean = String(part || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
      return clean;
    });
    if (subfolders.some((part) => !part)) return "";
    return ["campaigns", campaignId, folder, ...subfolders, filename].join("/");
  }
  const [folder, ...rest] = key.split("/");
  const policyFolder = folder === "managed-actors" ? [folder, ...rest.slice(0, -1)].join("/") : folder;
  if (!sanitizeMediaFolder(policyFolder) || rest.length < 1) return "";
  const filename = sanitizeWebpFilename(rest[rest.length - 1]);
  if (!filename || filename !== rest[rest.length - 1].toLowerCase()) return "";
  const subfolders = rest.slice(0, -1).map((part) => {
    const clean = String(part || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
    return clean;
  });
  if (subfolders.some((part) => !part)) return "";
  return [folder, ...subfolders, filename].join("/");
}

function compactInventoryObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => {
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.trim() !== "";
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return true;
  }));
}

function normalizeInventoryText(value, maxLength = 2400) {
  if (value === undefined || value === null) return "";
  const text = String(value)
    .replace(/\s(?:class|style|data-[\w-]+)="[^"]*"/gi, "")
    .replace(/\s(?:class|style|data-[\w-]+)='[^']*'/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function normalizeInventoryRecord(value, maxKeys = 32) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, maxKeys).filter(([, entry]) => {
    if (entry === undefined || entry === null) return false;
    if (typeof entry === "string") return entry.trim() !== "";
    if (Array.isArray(entry)) return false;
    if (typeof entry === "object") return Object.keys(entry).length > 0;
    return true;
  }));
}

function normalizeInventoryItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const normalized = compactInventoryObject({
    id: String(item.id || ""),
    name: String(item.name || "Elemento"),
    type: item.type ? String(item.type) : undefined,
    quantity: item.quantity,
    container: normalizeInventoryRecord(item.container, 4),
    description: normalizeInventoryText(item.description),
    level: item.level,
    school: item.school,
    activation: normalizeInventoryRecord(item.activation, 4),
    range: normalizeInventoryRecord(item.range, 4),
    duration: normalizeInventoryRecord(item.duration, 4),
    prepared: item.prepared,
    concentration: item.concentration,
    rarity: item.rarity,
    identified: item.identified,
    equipped: item.equipped,
    attuned: item.attuned,
    attunement: item.attunement,
    uses: normalizeInventoryRecord(item.uses, 4),
  });
  return normalized.name ? normalized : null;
}

function normalizeStatusItems(items, max = 100, options = {}) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, max).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    if (options.onlyAttuned && item.attuned !== true) return null;
    return compactInventoryObject({
      id: String(item.id || ""),
      name: String(item.name || "Elemento"),
      type: item.type ? String(item.type) : undefined,
      quantity: item.quantity,
      container: normalizeInventoryRecord(item.container, 4),
      equipped: item.equipped,
      attuned: item.attuned,
      attunement: item.attunement,
    });
  }).filter(Boolean);
}

function normalizeSpellSlots(slots) {
  if (!slots || typeof slots !== "object" || Array.isArray(slots)) return {};
  return compactInventoryObject({
    perLevel: Array.isArray(slots.perLevel)
      ? slots.perLevel.slice(0, 12).map((slot) => normalizeInventoryRecord(slot, 8)).filter((slot) => Object.keys(slot).length)
      : [],
    totals: normalizeInventoryRecord(slots.totals, 8),
  });
}

function normalizeInventoryActor(actor) {
  const inventory = Array.isArray(actor.inventory)
    ? actor.inventory.slice(0, 500).map(normalizeInventoryItem).filter(Boolean)
    : [];

  return compactInventoryObject({
    id: String(actor.id || ""),
    name: String(actor.name || "Senza nome"),
    displayName: actor.displayName ? String(actor.displayName) : undefined,
    type: actor.type ? String(actor.type) : undefined,
    img: actor.img ? String(actor.img) : undefined,
    token: normalizeInventoryRecord(actor.token, 8),
    ownerCharacterId: actor.ownerCharacterId ? String(actor.ownerCharacterId) : undefined,
    ownerAccountId: actor.ownerAccountId ? String(actor.ownerAccountId) : undefined,
    ownerDiscordId: actor.ownerDiscordId ? String(actor.ownerDiscordId) : undefined,
    foundryName: actor.foundryName ? String(actor.foundryName) : undefined,
    owners: Array.isArray(actor.owners)
      ? actor.owners.slice(0, 8).map((owner) => compactInventoryObject({
        id: String(owner?.id || ""),
        name: String(owner?.name || ""),
      })).filter((owner) => owner.name)
      : [],
    details: normalizeInventoryRecord(actor.details, 12),
    vitals: normalizeInventoryRecord(actor.vitals, 16),
    xp: normalizeInventoryRecord(actor.xp, 8),
    abilities: normalizeInventoryRecord(actor.abilities, 12),
    resources: normalizeInventoryRecord(actor.resources, 12),
    currency: normalizeInventoryRecord(actor.currency, 16),
    spellSlots: normalizeSpellSlots(actor.spellSlots),
    equippedItems: normalizeStatusItems(actor.equippedItems),
    attunementItems: normalizeStatusItems(actor.attunementItems, 100, { onlyAttuned: true }),
    weight: normalizeInventoryRecord(actor.weight, 8),
    inventory,
  });
}

function normalizeInventorySnapshot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Invalid inventory snapshot: expected object" };
  }

  const actors = Array.isArray(input.actors) ? input.actors : null;
  if (!actors) return { ok: false, error: "Invalid inventory snapshot: actors must be an array" };
  if (actors.length > 32) return { ok: false, error: "Invalid inventory snapshot: too many actors" };
  const companions = Array.isArray(input.companions) ? input.companions : [];
  if (companions.length > 64) return { ok: false, error: "Invalid inventory snapshot: too many companions" };

  const normalizedActors = actors
    .filter((actor) => actor && typeof actor === "object" && !Array.isArray(actor))
    .map(normalizeInventoryActor);
  const normalizedCompanions = companions
    .filter((actor) => actor && typeof actor === "object" && !Array.isArray(actor))
    .map(normalizeInventoryActor);

  const now = new Date().toISOString();
  return {
    ok: true,
    data: {
      schemaVersion: Number(input.schemaVersion) || 1,
      moduleId: String(input.moduleId || "unknown"),
      world: normalizeInventoryRecord(input.world, 8),
      gm: normalizeInventoryRecord(input.gm, 8),
      generatedAt: input.generatedAt || now,
      savedAt: now,
      actors: normalizedActors,
      companions: normalizedCompanions,
      summary: {
        actorCount: normalizedActors.length,
        companionCount: normalizedCompanions.length,
        itemCount: [...normalizedActors, ...normalizedCompanions].reduce((sum, actor) => sum + (actor.inventory?.length || 0), 0),
      },
    },
  };
}

async function requireUser(request, env, corsHeaders = {}) {
  let token = "";
  const auth = request.headers.get("Authorization");

  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    token = auth.slice(7).trim();
  }

  if (!token) {
    return json({ ok: false, error: "Unauthorized: missing bearer token" }, 401, corsHeaders);
  }

  const user = await verifyJWT(String(env.JWT_SECRET), token);

  if (!user) {
    return json({ ok: false, error: "Unauthorized: invalid or expired token" }, 401, corsHeaders);
  }

  return user;
}

function sanitizePageSlug(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "");

  if (!slug) return "";
  if (slug.length > 160) return "";

  return slug;
}

function sanitizeNoteOwnerId(value) {
  const id = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!id) return "";
  if (id.length > 80) return "";
  return id;
}

function isNotesAdmin(discordId, env) {
  const raw = [env.NOTES_ADMIN_ACCOUNT_IDS, env.NOTES_ADMIN_DISCORD_IDS]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(",");
  if (!raw) return false;

  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  return ids.includes(String(discordId));
}

function isAuthenticatedAdmin(user, env) {
  return isNotesAdmin(getAuthenticatedAccountId(user, env), env)
    || isNotesAdmin(getAuthenticatedDiscordId(user), env);
}

async function isAuthenticatedCampaignContentEditor(user, env, campaignId) {
  const cleanCampaignId = sanitizeCampaignId(campaignId);
  const accountId = getAuthenticatedAccountId(user, env);
  const discordId = getAuthenticatedDiscordId(user);
  if (isExplicitCampaignEditor(cleanCampaignId, accountId, discordId, env)) return true;
  if (!env.SIGILLO_KV) return false;

  const raw = await getCampaignKv(
    env.SIGILLO_KV,
    sessionCurrentKey(cleanCampaignId),
    cleanCampaignId === DEFAULT_CAMPAIGN_ID ? "session/current" : ""
  );
  const session = safeJsonParse(raw);
  if (!session || typeof session !== "object") return false;

  const dmAccountId = sanitizeAccountId(session.dmAccountId || "");
  const dmDiscordId = String(session.dmDiscordId || "").trim();
  return Boolean(
    (dmAccountId && accountId === dmAccountId)
    || (dmDiscordId && discordId === dmDiscordId)
  );
}


async function isAuthenticatedCampaignEditor(user, env, campaignId) {
  if (isAuthenticatedAdmin(user, env)) return true;

  const cleanCampaignId = sanitizeCampaignId(campaignId);
  const accountId = getAuthenticatedAccountId(user, env);
  const discordId = getAuthenticatedDiscordId(user);
  if (isExplicitDataAdmin(accountId, discordId, env)) return true;
  if (isExplicitCampaignEditor(cleanCampaignId, accountId, discordId, env)) return true;

  if (!env.SIGILLO_KV) return false;

  const raw = await getCampaignKv(
    env.SIGILLO_KV,
    sessionCurrentKey(cleanCampaignId),
    cleanCampaignId === DEFAULT_CAMPAIGN_ID ? "session/current" : ""
  );
  const session = safeJsonParse(raw);
  if (!session || typeof session !== "object") return false;

  const dmAccountId = sanitizeAccountId(session.dmAccountId || "");
  const dmDiscordId = String(session.dmDiscordId || "").trim();
  const pollManagerAccountIds = normalizeStringList(session.pollManagerAccountIds || session.sessionManagerAccountIds || [])
    .map(sanitizeAccountId);
  const pollManagerDiscordIds = normalizeDiscordIdList(session.pollManagerDiscordIds || session.sessionManagerDiscordIds || []);

  return (dmAccountId && accountId === dmAccountId)
    || (dmDiscordId && discordId === dmDiscordId)
    || pollManagerAccountIds.includes(accountId)
    || (discordId && pollManagerDiscordIds.includes(discordId));
}

function isExplicitDataAdmin(accountId, discordId, env) {
  const accountIds = normalizeDelimitedStringList(env.DATA_ADMIN_ACCOUNT_IDS || env.SITE_ADMIN_ACCOUNT_IDS || "")
    .map(sanitizeAccountId);
  const discordIds = normalizeDelimitedStringList(env.DATA_ADMIN_DISCORD_IDS || env.SITE_ADMIN_DISCORD_IDS || "")
    .filter((entry) => /^\d{5,32}$/.test(entry));
  return (accountId && accountIds.includes(accountId))
    || (discordId && discordIds.includes(discordId));
}

function isExplicitCampaignEditor(campaignId, accountId, discordId, env) {
  const accountIds = getCampaignScopedList(env.CAMPAIGN_EDITOR_ACCOUNT_IDS || env.CAMPAIGN_DATA_EDITOR_ACCOUNT_IDS || "", campaignId)
    .map(sanitizeAccountId);
  const discordIds = getCampaignScopedList(env.CAMPAIGN_EDITOR_DISCORD_IDS || env.CAMPAIGN_DATA_EDITOR_DISCORD_IDS || "", campaignId)
    .filter((entry) => /^\d{5,32}$/.test(entry));

  return (accountId && accountIds.includes(accountId))
    || (discordId && discordIds.includes(discordId));
}

function getCampaignScopedList(value, campaignId) {
  const cleanCampaignId = sanitizeCampaignId(campaignId);
  const entries = String(value || "")
    .split(/[\r\n;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const out = [];

  for (const entry of entries) {
    const [rawCampaignId, rawIds = ""] = entry.split(":", 2);
    if (sanitizeCampaignId(rawCampaignId) !== cleanCampaignId) continue;
    out.push(...normalizeDelimitedStringList(rawIds));
  }

  return [...new Set(out)];
}

function normalizeDelimitedStringList(value) {
  return [...new Set(
    String(value || "")
      .split(/[\s,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
  )];
}

function normalizeDeviceCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map((entry) => String(entry || "").trim())
      .filter((entry) => entry && entry.length <= 80 && !/[\r\n]/.test(entry))
  )];
}

function normalizeDiscordIdList(value) {
  return normalizeStringList(value).filter((entry) => /^\d{5,32}$/.test(entry));
}

function sanitizeAccountId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function getAuthenticatedAccountId(user, env) {
  const explicitAccountId = sanitizeAccountId(user?.accountId || "");
  if (explicitAccountId) return explicitAccountId;

  const rawId = String(user?.id || user?.sub || "").trim();
  if (rawId && !/^\d{5,32}$/.test(rawId)) return sanitizeAccountId(rawId);

  const mappedAccount = findDeviceLoginAccountByDiscordId(getAuthenticatedDiscordId(user), env);
  if (mappedAccount?.accountId) return mappedAccount.accountId;

  return sanitizeAccountId(rawId);
}

function getAuthenticatedDiscordId(user) {
  const id = String(user?.discordId || "").trim();
  if (/^\d{5,32}$/.test(id)) return id;
  const legacyId = String(user?.id || user?.sub || "").trim();
  return /^\d{5,32}$/.test(legacyId) ? legacyId : "";
}

function findDeviceLoginAccount(code, env) {
  if (!code) return null;

  const raw = String(env.DEVICE_LOGIN_CODES_SECRET || env.DEVICE_LOGIN_CODES || "").trim();
  if (!raw) return null;

  const entries = raw
    .split(/\r?\n|;/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const [rawCode, rawDiscordId, rawAccountId, rawGlobalName] = entry
      .split("|")
      .map((part) => String(part || "").trim());

    if (normalizeDeviceCode(rawCode) !== code) continue;

    const discordId = String(rawDiscordId || "").trim();
    if (discordId && !/^\d{5,32}$/.test(discordId)) return null;

    const accountId = sanitizeAccountId(rawAccountId || discordId || rawCode);
    if (!accountId) return null;

    return {
      accountId,
      discordId,
      username: accountId,
      globalName: rawGlobalName || accountId,
    };
  }

  return null;
}

function findDeviceLoginAccountByDiscordId(discordId, env) {
  const id = String(discordId || "").trim();
  if (!/^\d{5,32}$/.test(id)) return null;

  const raw = String(env.DEVICE_LOGIN_CODES_SECRET || env.DEVICE_LOGIN_CODES || "").trim();
  if (!raw) return null;

  const entries = raw
    .split(/\r?\n|;/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const [rawCode, rawDiscordId, rawAccountId, rawGlobalName] = entry
      .split("|")
      .map((part) => String(part || "").trim());

    if (String(rawDiscordId || "").trim() !== id) continue;

    const accountId = sanitizeAccountId(rawAccountId || id || rawCode);
    if (!accountId) return null;

    return {
      accountId,
      discordId: id,
      username: accountId,
      globalName: rawGlobalName || accountId,
    };
  }

  return null;
}

function noteUserKey(discordId, page, campaignId = "") {
  const key = `notes:user:${String(discordId)}:${page}`;
  return campaignId ? campaignKey(campaignId, key) : key;
}

function noteSharedKey(page, campaignId = "") {
  const key = `notes:shared:${page}`;
  return campaignId ? campaignKey(campaignId, key) : key;
}

function parseStoredNoteDocument(raw) {
  if (!raw) {
    return { notes: [], updatedAt: null };
  }

  try {
    const parsed = JSON.parse(raw);
    return normalizeIncomingNoteDocument(parsed);
  } catch {
    return { notes: [], updatedAt: null };
  }
}

function normalizeIncomingNoteDocument(content) {
  let doc = content;

  if (typeof content === "string") {
    try {
      doc = JSON.parse(content);
    } catch {
      doc = { notes: [], text: content };
    }
  }

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    doc = { notes: [] };
  }

  if (!Array.isArray(doc.notes)) {
    doc.notes = [];
  }

  doc.notes = doc.notes
    .filter((note) => note && typeof note === "object" && !Array.isArray(note))
    .map((note, index) => ({
      ...note,
      id: String(note.id || note.noteId || `note-${index}`),
      shared: note.shared === true,
    }));

  return doc;
}

function mergeNoteDocuments(personalDoc, sharedDoc) {
  const personalNotes = Array.isArray(personalDoc?.notes) ? personalDoc.notes : [];
  const sharedNotes = Array.isArray(sharedDoc?.notes) ? sharedDoc.notes : [];

  return {
    ...personalDoc,
    notes: [...personalNotes, ...sharedNotes.map((note) => ({ ...note, shared: true }))],
    updatedAt: maxIsoDate(personalDoc?.updatedAt, sharedDoc?.updatedAt),
  };
}

function splitIncomingNotes(incomingDoc, options) {
  const authenticatedDiscordId = String(options.authenticatedDiscordId);
  const authenticatedUsername = options.authenticatedUsername || null;
  const targetDiscordId = String(options.targetDiscordId);
  const existingSharedDoc = options.existingSharedDoc || { notes: [] };

  const incomingNotes = Array.isArray(incomingDoc?.notes) ? incomingDoc.notes : [];
  const incomingPersonalNotes = [];
  const incomingSharedNotes = [];

  for (const note of incomingNotes) {
    if (note.shared === true) {
      const authorDiscordId = String(
        note.authorDiscordId || note.ownerDiscordId || authenticatedDiscordId
      );

      const authorUsername =
        note.authorUsername || note.ownerUsername || authenticatedUsername;

      incomingSharedNotes.push({
        ...note,
        shared: true,
        authorDiscordId,
        authorUsername,
        ownerDiscordId: authorDiscordId,
        ownerUsername: authorUsername,
      });
    } else {
      incomingPersonalNotes.push({
        ...note,
        shared: false,
        ownerDiscordId: targetDiscordId,
      });
    }
  }

  const existingSharedById = new Map();
  for (const note of existingSharedDoc.notes || []) {
    existingSharedById.set(String(note.id), note);
  }

  const incomingSharedById = new Map();
  for (const note of incomingSharedNotes) {
    incomingSharedById.set(String(note.id), note);
  }

  // Se un appunto condiviso esistente sparisce dalla richiesta, significa delete.
  // Solo il suo autore può eliminarlo.
  // Se non è autore, lo preserviamo.
  for (const existing of existingSharedDoc.notes || []) {
    const id = String(existing.id);

    if (!incomingSharedById.has(id)) {
      const existingAuthor = String(existing.authorDiscordId || existing.ownerDiscordId || "");

      if (existingAuthor && existingAuthor !== authenticatedDiscordId) {
        incomingSharedById.set(id, existing);
      }
    }
  }

  const finalSharedNotes = [];

  for (const [id, note] of incomingSharedById.entries()) {
    const existing = existingSharedById.get(id);

    if (existing) {
      const existingAuthor = String(existing.authorDiscordId || existing.ownerDiscordId || "");

      // Nota condivisa esistente di un altro autore:
      // non blocchiamo il salvataggio con 403, ma preserviamo la versione salvata.
      if (existingAuthor && existingAuthor !== authenticatedDiscordId) {
        finalSharedNotes.push(existing);
        continue;
      }

      const authorDiscordId = existingAuthor || String(
        note.authorDiscordId || note.ownerDiscordId || authenticatedDiscordId
      );

      const authorUsername =
        note.authorUsername ||
        note.ownerUsername ||
        existing.authorUsername ||
        existing.ownerUsername ||
        authenticatedUsername;

      finalSharedNotes.push({
        ...existing,
        ...note,
        shared: true,
        authorDiscordId,
        authorUsername,
        ownerDiscordId: authorDiscordId,
        ownerUsername: authorUsername,
      });
    } else {
      // Nuova nota condivisa:
      // l'autore viene sempre forzato all'utente autenticato.
      finalSharedNotes.push({
        ...note,
        shared: true,
        authorDiscordId: authenticatedDiscordId,
        authorUsername: authenticatedUsername,
        ownerDiscordId: authenticatedDiscordId,
        ownerUsername: authenticatedUsername,
      });
    }
  }

  return {
    personalNotes: incomingPersonalNotes,
    sharedNotes: finalSharedNotes,
  };
}

function maxIsoDate(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;

  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function safeJsonParse(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function sanitizeBridgeState(value) {
  const state = String(value || "").trim();
  return /^[A-Za-z0-9_-]{8,128}$/.test(state) ? state : "";
}

function foundryAuthKey(state) {
  return `foundry-auth:${state}`;
}

function parseCookies(request) {
  const cookie = request.headers.get("Cookie") || "";
  const out = {};

  for (const part of cookie.split(";")) {
    const p = part.trim();
    if (!p) continue;

    const i = p.indexOf("=");
    if (i === -1) continue;

    const k = p.slice(0, i);
    const v = p.slice(i + 1);

    out[k] = decodeURIComponent(v);
  }

  return out;
}

function randomState(len = 24) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);

  return btoa(s)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlFromString(str) {
  return b64url(new TextEncoder().encode(str));
}

function bytesFromB64url(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);

  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }

  return bytes;
}

async function hmacSHA256(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}

async function makeJWT(secret, payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const h = b64urlFromString(JSON.stringify(header));
  const p = b64urlFromString(JSON.stringify(payload));
  const unsigned = `${h}.${p}`;
  const s = await hmacSHA256(secret, unsigned);

  return `${unsigned}.${s}`;
}

async function verifyJWT(secret, token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [h, p, s] = parts;
    const unsigned = `${h}.${p}`;
    const expected = await hmacSHA256(secret, unsigned);

    if (expected !== s) return null;

    const payloadJson = new TextDecoder().decode(bytesFromB64url(p));
    const payload = JSON.parse(payloadJson);

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === "number" && now > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * CORS SENZA VINCOLI:
 * - permette chiamate da qualunque origine
 *
 * Nota: per maggiore sicurezza, in produzione puoi sostituire "*"
 * con il dominio esatto della tua wiki.
 */
function corsHeadersFor(request) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Cache-Control, X-Cripta-Inventory-Secret, X-Inventory-Sync-Secret",
    "Access-Control-Max-Age": "86400",
  };
}
