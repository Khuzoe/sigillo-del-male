// Only controlled messages and allowlisted metadata leave the Worker. Never expose
// provider payloads, prompts, credentials or arbitrary exception messages.
export class GenerationError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.detail = {code, ...detail};
  }
}

export async function fetchGeneration(url, options) {
  try { return await fetch(url, options); }
  catch (error) {
    const timeout = ["AbortError", "TimeoutError"].includes(error?.name);
    throw new GenerationError(timeout ? "timeout" : "network", timeout
      ? "Il servizio non ha risposto entro il tempo previsto. L’esito della chiamata non è noto."
      : "Connessione al servizio AI interrotta. L’esito della chiamata non è noto.");
  }
}

export function responseMetadata(response) {
  const id = response.headers.get("x-request-id") || "";
  return {httpStatus: response.status, ...(/^req_[a-zA-Z0-9_-]{1,100}$/.test(id) ? {requestId: id} : {})};
}

export async function readGenerationResponse(response) {
  const detail = responseMetadata(response);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = data?.error?.code;
    if (["invalid_json_schema", "invalid_value", "unsupported_value", "unsupported_parameter", "missing_required_parameter", "model_not_found", "insufficient_quota", "rate_limit_exceeded"].includes(code)) detail.providerCode = code;
    if (["model", "text.format", "text.format.schema", "reasoning.effort", "max_output_tokens", "input", "images", "size", "quality"].includes(data?.error?.param)) detail.parameter = data.error.param;
    let category = "service_error", message = "Il servizio AI ha restituito un errore. Riprova più tardi.";
    if (response.status === 401) { category = "authentication"; message = "La chiave API non è accettata. L’amministratore deve controllare la configurazione del Worker."; }
    else if (code === "model_not_found" || response.status === 404) { category = "model_unavailable"; message = "Il modello o il servizio richiesto non è disponibile per questo progetto API. L’amministratore deve controllare modello e accesso."; }
    else if (response.status === 403) { category = "access_denied"; message = "Il progetto API non è autorizzato a usare questo servizio. L’amministratore deve verificare i permessi."; }
    else if (code === "insufficient_quota" || code === "billing_hard_limit_reached") { category = "quota"; message = "Il servizio segnala credito o quota API esauriti. Controlla la fatturazione e i limiti del progetto prima di riprovare."; }
    else if (response.status === 429) { category = "rate_limit"; message = "Troppe richieste al servizio AI in questo momento. Attendi prima di riprovare."; }
    else if (["content_policy_violation", "moderation_blocked"].includes(code)) { category = "refused"; message = "Il servizio non ha accettato questa richiesta. Rivedi la descrizione o l’immagine di riferimento."; }
    else if ([400, 422].includes(response.status)) { category = "request_invalid"; message = "Il servizio ha rifiutato il formato o i parametri inviati dal generatore. Va verificata l’integrazione nel Worker prima di riprovare."; }
    else if (response.status === 413) { category = "input_too_large"; message = "I dati inviati sono troppo grandi per il servizio. Riduci l’immagine o la richiesta prima di riprovare."; }
    throw new GenerationError(category, message, detail);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new GenerationError("response_invalid", "Il servizio ha restituito una risposta illeggibile.", detail);
  return data;
}

export function readStructuredGeneration(data, validator, detail = {}) {
  const parts = (Array.isArray(data.output) ? data.output : []).flatMap(item => Array.isArray(item?.content) ? item.content : []);
  if (parts.some(part => part?.type === "refusal") || data.incomplete_details?.reason === "content_filter")
    throw new GenerationError("refused", "Il modello non ha accettato questa richiesta. Rivedi la descrizione o l’immagine di riferimento.", detail);
  if (data.status !== "completed") {
    const limited = data.incomplete_details?.reason === "max_output_tokens";
    throw new GenerationError(limited ? "output_limit" : "response_incomplete", limited
      ? "La risposta ha raggiunto il limite di lunghezza prima di completare la proposta. Va rivisto il limite del generatore o semplificata la richiesta."
      : "Il servizio non ha completato la risposta. Non è disponibile una proposta utilizzabile.", detail);
  }
  const text = parts.filter(part => part?.type === "output_text" && typeof part.text === "string").map(part => part.text).join("");
  if (!text.trim()) throw new GenerationError("output_empty", "Il servizio ha risposto senza una proposta utilizzabile.", detail);
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new GenerationError("output_json", "La risposta generata non rispetta il formato richiesto dal sito.", detail); }
  // Validators are local, controlled functions; they must never echo input values.
  try { return validator(parsed); }
  catch (error) { throw new GenerationError("validation", `I dati generati non superano i controlli del sito. ${String(error.message).slice(0, 300)}`, detail); }
}

export function generationFailure(error, stage) {
  const known = error instanceof GenerationError;
  return {
    message: `${known ? error.message : "Errore interno durante la preparazione o il salvataggio della proposta. Va verificato il Worker."} Nessun tentativo automatico. Un nuovo tentativo può avere un costo.`,
    detail: {...(known ? error.detail : {code: "internal"}), stage}
  };
}
