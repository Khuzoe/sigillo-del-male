import { discordBotPreferencesKey, handleDiscordBotDmNotifications, normalizeDiscordBotPreferences } from "./discord-bot/notifications.js";

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
          return handleDataCollectionPost(request, collection, queryCampaignId, env, corsHeaders);
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
const WORKER_CODE_VERSION = "2026-06-18-quests-v1";
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

async function handleDataCollectionPost(request, collection, fallbackCampaignId, env, corsHeaders = {}) {
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

  const data = Array.isArray(body) ? body : body?.data;
  if (!Array.isArray(data)) {
    return json({ ok: false, error: "Expected an array or { data: [...] }" }, 400, corsHeaders);
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
  const nextData = collection === "transformations" && !isCampaignEditor
    ? mergeUserTransformations(existingData, data, authenticatedAccountId)
    : collection === "skill-tree-states" && !isCampaignEditor
      ? mergeUserSkillTreeStates(existingData, data, authenticatedAccountId)
      : collection === "calendar" && !isCampaignEditor
        ? mergeUserCalendarNotes(existingData, data, authenticatedAccountId, user)
      : ["ability-overrides", "item-overrides", "media-overrides"].includes(collection) && !isCampaignEditor
        ? await mergeUserOwnedOverrides(existingData, data, authenticatedAccountId, env, campaignId, collection)
        : data;

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

  return json({
    ok: true,
    saved: true,
    collection,
    campaignId,
    version: doc.version,
    updatedAt: doc.updatedAt,
    count: nextData.length,
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
  const ownedCharacterIds = await getEditableCharacterIdsForAccount(env, campaignId, accountId);
  if (!ownedCharacterIds.size) return false;

  if (folder === "transformations" || folder.startsWith("transformations/")) return true;
  if (folder === "companion-transformations" || folder.startsWith("companion-transformations/")) return true;

  const parts = String(folder || "").split("/");
  const root = parts[0] || "";
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

  const user = await requireUser(request, env, corsHeaders);
  if (user instanceof Response) return user;

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

  const isCampaignEditor = await isAuthenticatedCampaignEditor(user, env, campaignId);
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
      uploadedBy: getAuthenticatedAccountId(user, env),
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
    if (!campaignId || campaignId !== rawCampaignId || !sanitizeMediaFolder(folder) || rest.length < 1) return "";
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
  if (!sanitizeMediaFolder(folder) || rest.length < 1) return "";
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
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Cache-Control",
    "Access-Control-Max-Age": "86400",
  };
}
