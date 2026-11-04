import {cp,mkdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const source=resolve('integrations/khuzoe-tiles-creator');
const root=resolve('C:/Program Files/Foundry DEV TEST/FoundryVTT-WindowsPortable-14.367/Data/modules');
const target=join(root,'khuzoe-tiles-creator');
if(!target.startsWith(root+'\\')&&!target.startsWith(root+'/'))throw new Error('Invalid module destination');
const manifest=JSON.parse(await readFile(join(source,'module.json'),'utf8'));
if(manifest.id!=='khuzoe-tiles-creator')throw new Error('Invalid manifest');
await mkdir(target,{recursive:true});
// Only module runtime files are copied. No world settings, Scene or Actor data.
for(const file of ['module.json','README.md','scripts','styles','templates'])await cp(join(source,file),join(target,file),{recursive:true});
console.log(`Installed ${manifest.title} ${manifest.version} in ${target}`);
