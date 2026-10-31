export const GENERATION_WAIT_MS = 15 * 60 * 1000;
export const GENERATION_PENDING_MS = 2 * 60 * 1000;
const pending = job => ["pending", "icon-pending", "running", "icon-running"].includes(job?.status);

export async function generationStopResponse(response) {
  if (response.status !== 409) return response;
  const data = await response.clone().json().catch(() => null);
  if (data?.error !== "Operazione non disponibile.") return response;
  return Response.json({ok: false, code: "GENERATOR_UPDATING", error: "Il servizio di generazione non ha ancora ricevuto l’aggiornamento per interrompere l’attesa. Riprova fra pochi secondi; non è stata avviata un’altra generazione."}, {
    status: 503, headers: {"Cache-Control": "private, no-store", "Retry-After": "5"}
  });
}

export function generationDeadline(job) {
  if (Number.isFinite(job?.deadlineAt)) return job.deadlineAt;
  // Existing jobs have only createdAt. Give them the full previous watchdog period.
  const start = Date.parse(job?.startedAt || job?.createdAt);
  return Number.isFinite(start) ? start + GENERATION_WAIT_MS : 0;
}

// Runs inside each coordinator's serial section. Reading state can release an
// expired lock even if an alarm was lost; it never calls the paid provider.
export async function recoverGeneration(state, recover) {
  const storage = state.storage;
  const id = await storage.get("active");
  if (!id) return;
  const job = await storage.get(`job:${id}`);
  if (pending(job) && generationDeadline(job) > Date.now()) {
    if (storage.getAlarm && !await storage.getAlarm()) {
      await storage.setAlarm(job.status.includes("pending") ? Date.now() + 100 : generationDeadline(job));
    }
    return;
  }
  if (pending(job)) {
    await recover(job);
    job.finishedAt = new Date().toISOString();
    await storage.put(`job:${id}`, job);
  }
  await storage.delete("active");
  await storage.deleteAlarm();
}

export async function ownsGeneration(state, job, runningStatus) {
  const storage = state.storage;
  if (await storage.get("active") !== job.id) return false;
  const current = await storage.get(`job:${job.id}`);
  return current?.status === runningStatus && current.iconAttempt === job.iconAttempt;
}
