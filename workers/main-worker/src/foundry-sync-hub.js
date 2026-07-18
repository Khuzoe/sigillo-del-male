const MAX_EVENT_BYTES = 32 * 1024;
const MAX_ID_LENGTH = 96;

export class FoundrySyncHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/connect" && request.method === "GET") {
      return this.connect(request);
    }
    if (url.pathname === "/publish" && request.method === "POST") {
      return this.publish(request);
    }
    if (url.pathname === "/status" && request.method === "GET") {
      return this.status();
    }
    return json({ ok: false, error: "Not found" }, 404);
  }

  connect(request) {
    if (String(request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
      return json({ ok: false, error: "Expected WebSocket upgrade" }, 426);
    }

    const campaignId = cleanId(request.headers.get("X-Sigillo-Campaign"));
    const worldId = cleanId(request.headers.get("X-Sigillo-World"));
    const clientId = cleanId(request.headers.get("X-Sigillo-Client")) || crypto.randomUUID();
    if (!campaignId || !worldId) {
      return json({ ok: false, error: "Missing live sync identity" }, 400);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      schemaVersion: 1,
      campaignId,
      worldId,
      clientId,
      connectedAt: new Date().toISOString(),
    });
    server.send(JSON.stringify({
      type: "hello",
      schemaVersion: 1,
      campaignId,
      worldId,
      clientId,
      connectedAt: new Date().toISOString(),
    }));

    return new Response(null, { status: 101, webSocket: client });
  }

  async publish(request) {
    const raw = await request.text();
    if (!raw || raw.length > MAX_EVENT_BYTES) {
      return json({ ok: false, error: raw ? "Live event too large" : "Missing live event" }, raw ? 413 : 400);
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ ok: false, error: "Invalid live event" }, 400);
    }
    const event = normalizeEvent(parsed);
    if (!event) return json({ ok: false, error: "Invalid live event" }, 400);

    let delivered = 0;
    let stale = 0;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = safeAttachment(socket);
      if (!matchesWorld(event, attachment)) continue;
      try {
        socket.send(JSON.stringify(event));
        delivered += 1;
      } catch {
        stale += 1;
        try { socket.close(1011, "Live sync delivery failed"); } catch {}
      }
    }
    return json({ ok: true, delivered, stale, eventId: event.eventId });
  }

  status() {
    const connections = [];
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = safeAttachment(socket);
      if (!attachment.worldId) continue;
      connections.push({
        worldId: attachment.worldId,
        clientId: attachment.clientId || "",
        connectedAt: attachment.connectedAt || null,
      });
    }
    return json({
      ok: true,
      connected: connections.length,
      worlds: Array.from(new Set(connections.map((entry) => entry.worldId))).sort(),
      connections,
    });
  }

  webSocketMessage(socket, message) {
    if (typeof message !== "string" || message.length > 2_048) return;
    let data;
    try { data = JSON.parse(message); } catch { return; }
    if (data?.type !== "ping") return;
    const attachment = safeAttachment(socket);
    socket.send(JSON.stringify({
      type: "pong",
      clientId: attachment.clientId || "",
      at: new Date().toISOString(),
    }));
  }

  webSocketClose(socket, code, reason) {
    try { socket.close(code, reason); } catch {}
  }

  webSocketError(socket) {
    try { socket.close(1011, "Live sync socket error"); } catch {}
  }
}

function normalizeEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const campaignId = cleanId(input.campaignId);
  if (!campaignId) return null;
  const worldId = cleanId(input.worldId);
  const worldIds = Array.from(new Set((Array.isArray(input.worldIds) ? input.worldIds : [])
    .map(cleanId)
    .filter(Boolean)))
    .slice(0, 32);
  const collections = Array.from(new Set((Array.isArray(input.collections) ? input.collections : [])
    .map(cleanCollection)
    .filter(Boolean)))
    .slice(0, 16);
  if (!collections.length) return null;
  const actorIds = Array.from(new Set((Array.isArray(input.actorIds) ? input.actorIds : [])
    .map(cleanId)
    .filter(Boolean)))
    .slice(0, 128);
  return {
    type: "invalidate",
    schemaVersion: 1,
    eventId: cleanEventId(input.eventId) || crypto.randomUUID(),
    campaignId,
    ...(worldId ? { worldId } : {}),
    ...(worldIds.length ? { worldIds } : {}),
    collections,
    ...(actorIds.length ? { actorIds } : {}),
    reason: String(input.reason || "site-update").trim().slice(0, 96),
    revision: Math.max(0, Math.floor(Number(input.revision) || 0)),
    emittedAt: String(input.emittedAt || new Date().toISOString()).slice(0, 64),
  };
}

function matchesWorld(event, attachment) {
  const target = cleanId(attachment?.worldId);
  if (!target) return false;
  if (event.worldId) return event.worldId === target;
  if (event.worldIds?.length) return event.worldIds.includes(target);
  return true;
}

function safeAttachment(socket) {
  try {
    const value = socket.deserializeAttachment();
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function cleanId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, MAX_ID_LENGTH);
}

function cleanCollection(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function cleanEventId(value) {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9_-]{8,128}$/.test(id) ? id : "";
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
