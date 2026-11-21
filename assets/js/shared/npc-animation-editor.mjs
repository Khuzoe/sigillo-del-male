import {animationPaths, managedAnimationDigest, primaryAnimationSource, MAX_ANIMATION_BYTES} from './npc-activity-animation.mjs';
import {animationWithFile, repairAnimationMenu} from './npc-animation-config.mjs?v=20261121-audio';
export {animationWithFile};

function appendSequenceSettings({body, config, setting, make, redraw, useVideoSound, locked}) {
  const supportsVideoOptions = ['melee','range','ontoken','templatefx','aura'].includes(config.menu);
  if (!supportsVideoOptions && !config.primary?.video?.wikiSyncAudio) return;
  const options = config.primary?.options ?? {};
  const controls = make('div','npc-sheet-fields');
  function toggle(path, label, value) {
    const row = setting(path, label, value === true);
    row.querySelector('input').addEventListener('change', redraw);
    controls.append(row);
  }
  function number(path, label, value, min, step, max) {
    const row = setting(path, label, Number(value));
    const input = row.querySelector('input');
    input.min = String(min);
    input.step = String(step);
    if (max !== undefined) input.max = String(max);
    input.required = true;
    controls.append(row);
  }

  const onlySound = config.soundOnly?.sound?.enable === true;
  toggle('soundOnly.sound.enable', 'Riproduci solo il suono', onlySound);
  if (!onlySound && supportsVideoOptions) {
    const canPersist = ['ontoken', 'templatefx'].includes(config.menu);
    if (canPersist) toggle('primary.options.persistent', 'Effetto persistente (loop in scena)', options.persistent);
    if (config.menu === 'aura') controls.append(make('p','npc-sheet-muted','L’aura è persistente in Foundry.'));
    else if (!canPersist || !options.persistent) {
      number('primary.options.repeat', 'Riproduzioni totali del video', options.repeat ?? 1, 1, 1);
      number('primary.options.repeatDelay', 'Intervallo tra riproduzioni (ms)', options.repeatDelay ?? 1, 0, 'any');
    }
  }
  if (!onlySound) {
    const {video, sound} = config.primary || {};
    const linked = video?.enableCustom && video.customPath && sound?.file === video.customPath;
    toggle('primary.sound.enable', linked ? 'Audio del WebM' : 'Suono attivo', sound?.enable);
    if (video?.enableCustom && /\.webm$/i.test(video.customPath) && video.wikiSyncAudio?.hasTrack && !linked) {
      const button = make('button','npc-sheet-button','Usa l’audio del WebM');
      button.type = 'button';
      button.disabled = locked();
      button.addEventListener('click', useVideoSound);
      controls.append(button);
    } else if (video?.enableCustom && video.wikiSyncAudio?.hasTrack === false) {
      controls.append(make('small','','Il WebM è privo di traccia audio.'));
    }
  }
  const sound = onlySound ? config.soundOnly.sound : config.primary?.sound;
  if (sound?.enable) {
    const path = onlySound ? 'soundOnly.sound' : 'primary.sound';
    const file = setting(path + '.file', 'File audio in Foundry (percorso o URL)', sound.file ?? '');
    const input = file.querySelector('input, textarea');
    input.placeholder = 'es. worlds/mondo/audio/effetto.ogg';
    const hint = make('small','','Per sentire il suono in Foundry, indica un file audio.');
    const updateHint = () => { hint.hidden = Boolean(input.value?.trim()); };
    input.addEventListener('input', updateHint);
    if (!onlySound) input.addEventListener('change', redraw);
    updateHint();
    file.append(hint);
    controls.append(file);
    number(path + '.volume', 'Volume (0–1)', sound.volume ?? (onlySound ? 0.75 : 1), 0, 'any', 1);
    number(path + '.repeat', 'Riproduzioni totali del suono', sound.repeat ?? 1, 1, 1);
    number(path + '.repeatDelay', 'Intervallo tra suoni (ms)', sound.repeatDelay ?? 250, 0, 'any');
  }
  body.append(controls);
}

export function appendAnimationControls({body, activity, entity, id, source, context, set, field, make, locked, upload, pending, update, redraw}) {
  const prefix = `system.activities.${id}.flags.autoanimations`;
  const config = activity.flags?.autoanimations;
  const src = primaryAnimationSource(activity);
  const preview = source.animationMedia?.[entity.target.id]?.[id];
  const hash = managedAnimationDigest(src, context.campaign, context.world, context.actor);
  const path = preview?.source === src ? preview.path : hash ? animationPaths(context.campaign,context.world,context.actor,hash).path : '';
  let video;
  if (path) {
    video = make('video','npc-activity-video');
    video.controls = true; video.playsInline = true; video.preload = 'none';
    video.setAttribute('aria-label', `Anteprima animazione di ${activity.name || entity.name}`);
    video.src = context.resolve(path);
    if (config?.primary?.video?.wikiSyncAudio) video.muted = !(config.primary.sound?.enable && config.primary.sound.file === src);
    video.loop = config?.menu === 'aura' || (['ontoken','templatefx'].includes(config?.menu) && config.primary?.options?.persistent === true);
    const rate = Number(config?.primary?.options?.playbackRate);
    if (rate >= 0.25 && rate <= 4) video.defaultPlaybackRate = video.playbackRate = rate;
    body.append(video);
  } else if (src) body.append(make('p','npc-sheet-muted','Anteprima in attesa della sincronizzazione del WebM da Foundry.'));
  if (config?.menu === 'preset') {
    body.append(make('p','npc-sheet-muted','Questa attività usa un preset di Automated Animations. Puoi configurarlo in Foundry.'));
    return;
  }
  if (config?.menu) {
    const repair = () => {
      const current = entity.draft.system.activities[id].flags.autoanimations;
      const complete = repairAnimationMenu(current);
      if (complete !== current) set(entity,prefix,complete);
    };
    if (repairAnimationMenu(config) !== config) {
      body.append(make('p','npc-sheet-muted','Mancano alcuni campi richiesti dal menu di Automated Animations in Foundry.'));
      const button = make('button','npc-sheet-button','Ripara menu Foundry');
      button.type = 'button';
      button.disabled = locked() || entity.activityReadOnly === true;
      button.addEventListener('click', () => {
        if (locked() || entity.activityReadOnly) return;
        repair();
        redraw();
      });
      body.append(button);
    }
    // Automated Animations gives the activity precedence over Item/autorec
    // settings only when it is customized. Opening the panel is read-only.
    const write = (target, path, value) => {
      repair();
      set(target,path,value);
      if (!config.isCustomized) set(target,prefix+'.isCustomized',true);
    };
    const setting = (path, label, value) => field(entity, prefix+'.'+path, label, value, write);
    const enabled = setting('isEnabled','Animazione attiva',config.isEnabled !== false);
    const speed = setting('primary.options.playbackRate','Velocità di riproduzione',config.primary?.options?.playbackRate ?? 1);
    const number = speed.querySelector('input');
    number.min=String(Math.min(0.25,Number(number.value) || 0.25)); number.max=String(Math.max(4,Number(number.value) || 4)); number.step='any'; number.required=true;
    number.addEventListener('input',()=>{const rate=Number(number.value);if(video && rate>=0.25 && rate<=4) video.playbackRate=rate;});
    body.append(enabled,speed);
    const useVideoSound = () => {
      if (locked() || entity.activityReadOnly) return;
      write(entity, prefix+'.primary.sound.file', src);
      write(entity, prefix+'.primary.sound.enable', true);
      redraw();
    };
    appendSequenceSettings({body, config, setting, make, redraw, useVideoSound, locked:()=>locked() || entity.activityReadOnly});
  }
  const key = `${entity.key}:${id}`;
  const label = make('label','npc-sheet-field');
  label.append(make('span','',src ? 'Sostituisci video WebM' : 'Aggiungi video WebM'));
  const file = make('input'); file.type='file'; file.accept='.webm,video/webm'; file.disabled=locked() || pending.has(key);
  const message = make('p','npc-sheet-muted',pending.has(key) ? 'Caricamento del video…' : entity.animationErrors?.get(id) || '');
  message.setAttribute('role','status');
  file.addEventListener('change',async()=>{
    const selected = file.files?.[0];
    if (!selected || pending.has(key)) return;
    if (selected.size > MAX_ANIMATION_BYTES) {message.textContent='Il video supera 16 MiB.'; file.value=''; return;}
    entity.animationErrors?.delete(id);
    file.disabled=true; pending.add(key); update(); message.textContent='Caricamento del video…';
    try {
      const result = await upload(selected);
      const current = entity.draft.system.activities[id];
      if (current === activity && !locked()) set(entity,prefix,animationWithFile(current,entity.name,result.localPath,result.hasAudio));
    } catch (error) {
      entity.animationErrors ??= new Map();
      entity.animationErrors.set(id,error.message || 'Caricamento del video fallito.');
      message.textContent=entity.animationErrors.get(id); file.value='';
    } finally {
      pending.delete(key); file.disabled=locked(); update();
    }
    redraw();
  });
  label.append(file); body.append(label,message);
}
