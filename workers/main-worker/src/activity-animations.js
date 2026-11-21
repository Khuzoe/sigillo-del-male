import { animationPaths, hostedAnimationPath, managedAnimationDigest, primaryAnimationSource, MAX_ANIMATION_BYTES } from '../../../assets/js/shared/npc-activity-animation.mjs';
import { nativeGet } from '../../../assets/js/shared/npc-native-model.mjs';
import { webmAudioTrack } from '../../../assets/js/shared/webm-audio-track.mjs';

const hostedAnimationRoute = /^\/media\/campaigns\/[^/]+\/managed-actors\/[^/]+\/[^/]+\/animations\//;

// Older clients return the activity flags but don't export media descriptors.
export function activityAnimationPreviews(activities, existing, campaign, route, origin) {
  const previews = {...existing};
  for (const [key, activity] of Object.entries(activities || {})) {
    const source = primaryAnimationSource(activity);
    const path = hostedAnimationPath(source, campaign, route.worldId, route.actorId, origin);
    if (path) previews[activity._id || key] = {source, path};
  }
  return previews;
}

// Use the latest snapshot at enqueue time. A client without a file installer
// can apply the same native patch and Sequencer streams the uploaded WebM.
export async function prepareActivityAnimationPatches(original, next, patches, {campaign, route, origin, bucket, canInstall}) {
  for (const [id, activity] of Object.entries(next.system?.activities || {})) {
    const clip = primaryAnimationSource(activity);
    if (!clip || clip === primaryAnimationSource(original?.[id])) continue;
    const local = clip.startsWith('worlds/') && clip.includes('/wiki-sync-animations/');
    const hosted = clip.startsWith(origin + '/') && hostedAnimationRoute.test(clip.slice(origin.length));
    if (!local && !hosted) continue;
    const digest = local && managedAnimationDigest(clip, campaign, route.worldId, route.actorId);
    const path = local
      ? digest && animationPaths(campaign, route.worldId, route.actorId, digest).path
      : hostedAnimationPath(clip, campaign, route.worldId, route.actorId, origin);
    if (!path) throw new Error('Percorso WebM non valido per questo NPC.');
    if (!await bucket.head(path.slice(6))) throw new Error('Il WebM da inviare a Foundry non è disponibile.');
    if (!local || canInstall) continue;
    const primary = activity.flags.autoanimations.primary;
    const fields = ['video.customPath'];
    if (primary.sound?.file === clip) fields.push('sound.file');
    for (const suffix of fields) {
      const field = `system.activities.${id}.flags.autoanimations.primary.${suffix}`;
      const patch = patches.find(p => p.op === 'set' && (p.path === field || field.startsWith(p.path + '.')));
      if (!patch) continue;
      const [section, key] = suffix.split('.');
      primary[section][key] = origin + '/' + path;
      patch.value = nativeGet(next, patch.path);
    }
  }
}

export async function storeActivityAnimation(request, bucket, campaign, route, headers) {
  const fail = (error, status) => Response.json({ok:false, error}, {status, headers});
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'video/webm') return fail('Scegli un file WebM.', 415);
  const tooLarge = () => fail('Il video supera 16 MiB.', 413);
  if (Number(request.headers.get('Content-Length')) > MAX_ANIMATION_BYTES) return tooLarge();
  const reader = request.body?.getReader();
  if (!reader) return fail('File mancante.', 400);
  const chunks = [];
  let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_ANIMATION_BYTES) { void reader.cancel().catch(() => {}); return tooLarge(); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const hasAudio = webmAudioTrack(bytes);
  if (hasAudio === null) return fail('Il file non contiene un video WebM valido.', 415);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const digest = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2,'0')).join('');
  const paths = animationPaths(campaign, route.worldId, route.actorId, digest);
  const key = paths.path.slice(6);
  if (!(await bucket.head(key))) await bucket.put(key, bytes, {httpMetadata:{contentType:'video/webm'}});
  return Response.json({ok:true, digest, ...paths, hasAudio}, {headers});
}

export async function readActivityAnimation(request, bucket, key, corsHeaders) {
  const meta = await bucket.head(key);
  if (!meta) return new Response(null, {status:404, headers:{...corsHeaders,'Cache-Control':'no-store'}});
  const headers = new Headers({...corsHeaders, 'Content-Type':'video/webm', 'Accept-Ranges':'bytes',
    'Cache-Control':'public, max-age=31536000, immutable', 'Content-Length':String(meta.size), ETag:meta.httpEtag});
  if (request.headers.get('If-None-Match') === meta.httpEtag) {
    headers.delete('Content-Length');
    return new Response(null, {status:304, headers});
  }
  if (request.method === 'HEAD') return new Response(null, {headers});
  let range;
  const requested = request.headers.get('Range');
  if (requested) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(requested);
    const start = match?.[1] ? Number(match[1]) : Math.max(0, meta.size - Number(match?.[2]));
    const end = match?.[1] && match[2] ? Math.min(meta.size - 1, Number(match[2])) : meta.size - 1;
    if (!match || !match[1] && !match[2] || !Number.isSafeInteger(start) || start > end) {
      headers.set('Content-Range', `bytes */${meta.size}`);
      headers.set('Content-Length','0');
      return new Response(null, {status:416, headers});
    }
    range = {offset:start, length:end-start+1};
    headers.set('Content-Range', `bytes ${start}-${end}/${meta.size}`);
    headers.set('Content-Length',String(range.length));
  }
  const object = await bucket.get(key, range ? {range} : undefined);
  return new Response(object?.body, {status:object ? range ? 206 : 200 : 404, headers:object ? headers : corsHeaders});
}
