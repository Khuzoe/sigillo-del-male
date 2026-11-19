import {webpSize} from './avatar-generation.js';

export const UPLOAD_ID = /^[a-f0-9]{64}\.(?:png|jpg|webp)$/;
export const imageMime = key => /\.png$/i.test(key) ? "image/png" : /\.jpe?g$/i.test(key) ? "image/jpeg" : "image/webp";
export const MAX_BYTES = 12 * 1024 * 1024;

const reply = (value, status = 200) => Response.json(value, {status, headers: {'Cache-Control': 'private, no-store'}});
const fail = (error, status = 400) => reply({ok: false, error}, status);

export async function handleConceptImage(request, id, bucket, keyFor) {
  const headers = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"};
  if (request.method === 'GET' && UPLOAD_ID.test(id)) {
    const object = await bucket.get(keyFor(id));
    return object ? new Response(object.body, {headers: {...headers, 'Content-Type': imageMime(id)}}) : fail('Concept non disponibile.', 404);
  }
  if (request.method !== 'POST' || id) return fail('Operazione non supportata.', 405);
  const tooLarge = () => fail('Ogni immagine può pesare al massimo 12 MB.', 413);
  if (Number(request.headers.get('Content-Length')) > MAX_BYTES) return tooLarge();
  const reader = request.body?.getReader();
  if (!reader) return fail('Immagine vuota.');
  const chunks = [];
  let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); return tooLarge(); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const png = size >= 33 && [137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82].every((byte, i) => bytes[i] === byte);
  const jpeg = size >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const extension = png ? 'png' : jpeg ? 'jpg' : webpSize(bytes) ? 'webp' : '';
  if (!extension || imageMime('.' + extension) !== request.headers.get('Content-Type')) return fail('Scegli un’immagine PNG, JPEG o WebP valida.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const uploadId = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') + '.' + extension;
  const key = keyFor(uploadId);
  if (!await bucket.head(key)) await bucket.put(key, bytes, {httpMetadata: {contentType: imageMime(uploadId)}});
  return reply({ok: true, uploadId});
}
