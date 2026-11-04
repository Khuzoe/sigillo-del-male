import {mkdir,cp,writeFile,readFile} from 'node:fs/promises';
const directory=process.argv[2]||'output/tiles-creator-qa';await mkdir(directory,{recursive:true});
await cp('C:/Program Files/Foundry DEV TEST/FoundryVTT-WindowsPortable-14.367/App/resources/app/node_modules/pixi.js/dist/pixi.min.js',`${directory}/pixi.min.js`);
const html=`<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Khuzoe Tiles Creator · prova locale</title>
<link rel="stylesheet" href="/integrations/khuzoe-tiles-creator/styles/tiles-creator.css">
<style>body{margin:0;background:#121316;color:#eee;font-family:Arial,sans-serif}#scene{position:fixed;inset:0;display:grid;place-items:center}#scene canvas{max-width:100vw;max-height:100vh}#app{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(1000px,97vw);max-height:96vh;background:#17181e;border:1px solid #66604b;border-radius:12px;box-shadow:0 15px 100px #000b;overflow:auto;z-index:10}.window-header{height:38px;padding:0 15px;display:flex;align-items:center;justify-content:space-between;background:#0f1014;border-bottom:1px solid #ffffff18;font-size:13px}.window-header button{border:0;color:#ddd;background:none;font-size:20px;cursor:pointer}.ktc-heading h2{font-family:Georgia,serif}#qa{position:fixed;bottom:8px;left:10px;color:#d5b46e;font:12px Arial;z-index:100}#open{position:fixed;left:12px;top:12px;z-index:5;background:#d5b46e;color:#211b12;border:0;border-radius:8px;padding:12px 18px;cursor:pointer}.ktc-content .ktc-art,.ktc-placeholder{height:230px}.ktc-content{padding:20px;gap:16px}.ktc-heading h2{font-size:25px}.ktc-content textarea{box-sizing:border-box}.ktc-content select{box-sizing:border-box}</style>
<div id="scene"></div><button id="open">Apri Tiles Creator</button><div id="app" class="khuzoe-tiles-creator"></div><output id="qa">Prova simulata · nessuna API a pagamento · nessuna scena reale</output><script src="pixi.min.js"></script><script type="module" src="fixture.mjs"></script></html>`;
await writeFile(`${directory}/page.html`,html);
const coreResize=await readFile('C:/Program Files/Foundry DEV TEST/FoundryVTT-WindowsPortable-14.367/App/resources/app/client/canvas/primary/primary-sprite-mesh.mjs','utf8');
const start=coreResize.indexOf('  resize(baseWidth');
const resize=coreResize.slice(start,coreResize.indexOf('  /* -------------------------------------------- */',start));
await writeFile(`${directory}/core-resize.mjs`,`export class PrimarySpriteMesh {\n${resize}\n}`);
await cp('scripts/fixtures/tiles-creator-browser.mjs',`${directory}/fixture.mjs`);
console.log('Tiles Creator UI preview ready; uses production module UI, capture, compositing and controller with fake network/scene.');
