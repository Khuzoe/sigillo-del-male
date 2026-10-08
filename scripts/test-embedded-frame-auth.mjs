import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/js/layout.js', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('function handleEmbeddedAuthMessage('), source.indexOf('function resolveEmbeddedParentOrigin('));
let stored = 'existing-test-token', writes = 0, reloads = 0;
const parent = {}, origin = 'http://localhost:30000';
const sandbox = {URL, DISCORD_WORKER_URL: 'https://worker.test', embeddedDiscordPopup: null,
    embeddedParentOrigin: origin, window: {parent, location: {reload() {reloads++;}}},
    readStoredToken: () => stored, storeToken(token) {stored = token; writes++;}};
vm.runInNewContext(handler + '\nglobalThis.receive = handleEmbeddedAuthMessage;', sandbox);
const event = token => ({source: parent, origin, data: {type: 'cripta-auth-token', token}});
sandbox.receive(event(stored));
assert.equal(reloads, 0, 'The initial load must not reload an already authenticated page');
assert.equal(writes, 0, 'An identical session keeps caches intact');
for (const incoming of [{...event('changed'), source: {}}, {...event('changed'), origin: 'https://other.test'}, event('')]) sandbox.receive(incoming);
assert.equal(writes, 0, 'Empty or untrusted messages never authenticate the page');
sandbox.receive(event('new-test-token'));
assert.equal(stored, 'new-test-token'); assert.equal(reloads, 1);
// Simulate load -> ready -> token after the first authenticated reload.
for (let i = 0; i < 5; i++) sandbox.receive(event('new-test-token'));
assert.equal(reloads, 1, 'The Foundry/page load handshake cannot create a reload loop');
assert.equal(writes, 1);
sandbox.receive(event('rotated-test-token')); assert.equal(reloads, 2);
assert.equal(writes, 2, 'A changed session still reinitializes page permissions');
assert.ok(source.indexOf('window.addEventListener("message", handleEmbeddedAuthMessage);') < source.indexOf('postEmbeddedParentMessage({ type: "cripta-embed-ready" });'), 'The ready message follows installation of the auth listener');
console.log('Embedded frame authentication: checks passed.');
