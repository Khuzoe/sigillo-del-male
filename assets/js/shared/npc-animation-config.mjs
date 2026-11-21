// The AA 7 Item menu mounts the video, audio and options editors even for
// disabled effects. These are the branches of its v5 activity flag format.
const sound = {enable:false, delay:0, repeat:1, repeatDelay:250, startTime:0, volume:0.75};
const staticVideo = {dbSection:'static', menuType:'spell', animation:'curewounds', variant:'01', color:'blue'};
const rangeVideo = {dbSection:'range', menuType:'weapon', animation:'arrow', variant:'regular', color:'regular'};
const meleeVideo = {dbSection:'melee', menuType:'weapon', animation:'club', variant:'01', color:'white'};
const effectOptions = {contrast:0, delay:0, elevation:1000, opacity:1, repeat:1, repeatDelay:250,
  saturate:0, tint:false, tintColor:'#FFFFFF', zIndex:1};
const tokenOptions = {...effectOptions, addTokenWidth:false, anchor:'0.5', fadeIn:250, fadeOut:500,
  isMasked:false, isRadius:false, size:1};
const attachment = {persistent:false, unbindAlpha:false, unbindVisibility:false};
const videos = {melee:meleeVideo, range:rangeVideo, ontoken:staticVideo};
const primaryOptions = {
  melee:{...effectOptions, isWait:false, playbackRate:1, size:1},
  range:{...effectOptions, isReturning:false, isWait:false, onlyX:false, playbackRate:1},
  ontoken:{...tokenOptions, ...attachment, isWait:false, playbackRate:1, playOn:'default'}
};
const particles = {color01:'#FFFFFF', color02:'#FFFFFF', spritePath:'modules/levels-3d-preview/assets/particles/dust.png'};
const levels3d = {type:'explosion', data:particles, sound:{enable:false}, secondary:{enable:false,data:{...particles}}};
const component = options => ({enable:false, video:{...staticVideo, enableCustom:false, customPath:''}, sound:{...sound}, options});

function menuBranches(menu) {
  return {
    primary:{video:{...videos[menu], enableCustom:false, customPath:''}, options:primaryOptions[menu], sound},
    ...(menu === 'melee' ? {meleeSwitch:{video:rangeVideo, sound:{...sound},
      options:{detect:'automatic', range:2, returning:false, switchType:'off'}}} : {}),
    secondary:component({...tokenOptions, isRadius:true, isWait:false, size:1.5}),
    source:component({...tokenOptions, isWait:true}),
    target:component({...tokenOptions, ...attachment}),
    macro:{enable:false}, soundOnly:{sound:{...sound}}
  };
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const videoKeys = new Set(['dbSection','menuType','animation','variant','color']);

// Fill missing containers. Keep existing scalar options (including false,
// zero and empty values) so opening or replacing a clip cannot reset an effect.
function restoreBranches(current, defaults, section) {
  if (!isObject(current)) return structuredClone(defaults);
  let result = current;
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = current[key];
    let next = value;
    if (isObject(fallback)) next = restoreBranches(value, fallback, key);
    else if (section === 'video' && videoKeys.has(key) && value == null) next = fallback;
    if (next === value) continue;
    if (result === current) result = {...current};
    result[key] = next;
  }
  return result;
}

// An unchanged result is the original object. No repair is staged on render.
export function repairAnimationMenu(config) {
  if (!config || !Object.hasOwn(videos, config.menu) || (config.version != null && config.version !== 5)) return config;
  const result = restoreBranches(config, menuBranches(config.menu));
  // Native 2D configurations can legitimately omit the optional 3D section.
  if (result === config && config.levels3d == null) return config;
  return restoreBranches(result, {levels3d});
}

export function animationWithFile(activity, name, path, hasAudio) {
  const config = structuredClone(activity.flags?.autoanimations || {});
  if (!config.menu) {
    const menu = activity.type !== 'attack' ? 'ontoken' : activity.attack?.type?.value === 'ranged' ? 'range' : 'melee';
    const defaults = {menu, version:5, label:activity.name || name, isEnabled:true, fromAmmo:false,
      ...menuBranches(menu), levels3d};
    config.id ??= crypto.randomUUID();
    for (const [key, value] of Object.entries(defaults)) config[key] ??= structuredClone(value);
  }
  const complete = repairAnimationMenu(config);
  complete.isCustomized = true;
  complete.primary ??= {};
  const previousVideo = complete.primary.video;
  const video = {...previousVideo, enableCustom:true, customPath:path};
  complete.primary.video = video;
  const track = complete.primary.sound;
  const linked = previousVideo?.enableCustom && previousVideo.customPath && track?.file === previousVideo.customPath;
  if (typeof hasAudio === 'boolean') {
    video.wikiSyncAudio = {hasTrack:hasAudio};
    if (!track?.file || linked) {
      const muted = linked ? track.enable === false : previousVideo?.wikiSyncAudio?.keepMuted === true;
      // Remember an explicit mute across an intervening clip without audio.
      if (!hasAudio && muted) video.wikiSyncAudio.keepMuted = true;
      if (hasAudio || linked || track?.enable) {
        complete.primary.sound = {...track, file:hasAudio ? path : '', enable:hasAudio && !muted};
      }
    }
  } else if (previousVideo?.customPath !== path) {
    // An older Worker can confirm the upload without inspecting the new tracks.
    delete video.wikiSyncAudio;
    if (linked) complete.primary.sound = {...track, file:'', enable:false};
  }
  return complete;
}
