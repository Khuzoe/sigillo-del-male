// One serial writer per campaign. Existing KV documents are imported lazily and
// left intact; calendar writes subsequently live in Durable Object storage.
export class CalendarStoreBase {
  constructor(state, env) { this.state = state; this.env = env; this.queue = Promise.resolve(); }
  async readCalendar(key, legacyKey) {
    if (this.calendar) return this.calendar;
    const storage = this.state.storage;
    const saved = await storage.get(key);
    if (saved != null) return (this.calendar = { value: saved, legacy: null });
    let imported = await storage.get("calendar-import");
    if (!imported) {
      const value = await this.env.SIGILLO_KV.get(key);
      imported = { value: value ?? null, legacy: value ? null : await this.env.SIGILLO_KV.get(legacyKey) };
      // Persist even an absent calendar: eviction must not restart KV polling.
      await storage.put("calendar-import", imported);
    }
    return (this.calendar = imported);
  }
  async saveReceipt(storage, key, digest) {
    let index = await storage.get("receipt-index");
    if (!index) {
      // One-time upgrade of the previous ledger, never a scan per clock tick.
      const receipts = [...await storage.list({ prefix: "operation:" })].sort((a, b) => a[1].at - b[1].at);
      const expired = receipts.slice(0, Math.max(0, receipts.length - 512)).map(([name]) => name);
      for (let i = 0; i < expired.length; i += 128) await storage.delete(expired.slice(i, i + 128));
      index = { keys: receipts.slice(-512).map(([name]) => name), next: 0 };
    }
    // Copy before mutation so a failed transaction cannot alter a cached index.
    index = { keys: [...index.keys], next: index.next };
    if (index.keys.length < 512) index.keys.push(key);
    else {
      await storage.delete(index.keys[index.next]);
      index.keys[index.next] = key;
      index.next = (index.next + 1) % 512;
    }
    await storage.put(key, { digest, at: Date.now() });
    await storage.put("receipt-index", index);
  }
  fetch(request) {
    const run = this.queue.then(() => this.handle(request));
    this.queue = run.catch(() => {});
    return run;
  }
  async handle(request) {
    const { campaignId, corsHeaders, services, handler, readHandler } = this.context(request);
    if (!handler) return new Response("Not found", { status: 404 });
    const key = `campaign:${campaignId}:calendar:v2`;
    const legacyKey = `campaign:${campaignId}:data:calendar:override`;
    let pending;
    const kv = this.env.SIGILLO_KV;
    const env = { ...this.env, SIGILLO_KV: {
      get: async (name, ...args) => {
        // Only canonical data is shared in memory. Authorization lookups still
        // use KV for every request, and responses are filtered for their reader.
        if (name !== key && name !== legacyKey) return kv.get(name, ...args);
        const calendar = await this.readCalendar(key, legacyKey);
        return name === key ? pending ?? calendar.value : calendar.legacy;
      },
      put: async (name, value) => {
        if (name !== key) throw new Error("Calendar storage cannot write other collections");
        pending = value;
      }
    } };
    let operationKey, digest;
    if (request.method === "POST") {
      const body = await request.clone().json().catch(() => null);
      if (body?.operationId) {
        if (!/^[a-zA-Z0-9_-]{8,100}$/.test(body.operationId)) return new Response("Invalid operation id", { status: 400 });
        const user = await services.requireUser(request, env, corsHeaders);
        if (user instanceof Response) return user;
        operationKey = `operation:${body.operationId}`;
        const encoded = new TextEncoder().encode(JSON.stringify([new URL(request.url).pathname, services.getAuthenticatedAccountId(user, env), body]));
        digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoded)), n => n.toString(16).padStart(2, "0")).join("");
        const previous = await this.state.storage.get(operationKey);
        if (previous) {
          if (previous.digest !== digest) return Response.json({ ok: false, code: "OPERATION_CONFLICT", error: "Operazione già usata da un altro account o con dati diversi." }, { status: 409, headers: corsHeaders });
          return this.decorate(await readHandler(request, campaignId, env, corsHeaders, services), true);
        }
      }
    }
    const result = await handler(request, campaignId, env, corsHeaders, services);
    if (result.ok && pending !== undefined) {
      // Save the document and its retry receipt atomically, including on crashes.
      await this.state.storage.transaction(async (storage) => {
        await storage.put(key, pending);
        if (operationKey) await this.saveReceipt(storage, operationKey, digest);
      });
      // Publish the cache only after the atomic write succeeded.
      this.calendar = { value: pending, legacy: null };
    }
    return this.decorate(result);
  }
  async decorate(response, replayed = false) {
    if (!response.ok) return response;
    const body = await response.json();
    return Response.json({ ...body, capabilities: { seconds: true, coordinatedWrites: true, idempotency: true }, ...(replayed ? { replayed: true } : {}) }, { status: response.status, headers: response.headers });
  }
}
