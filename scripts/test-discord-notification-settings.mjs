import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../assets/js/layout.js", import.meta.url), "utf8");
const helpers = source.slice(source.indexOf("function openDiscordNotificationSettings()"), source.indexOf("function readStoredToken()"));
let mounted = null, saved = null;
const status = { textContent: "", classList: { toggle() {} } };
const inputs = new Map();
const modal = {
  dataset: {}, hidden: true, innerHTML: "", addEventListener() {},
  querySelector(selector) {
    if (selector === "[data-discord-notification-status]") return status;
    if (selector === "[data-discord-notification-save]") return { addEventListener() {} };
    const pref = selector.match(/^\[data-discord-pref="([^"]+)"\]$/)?.[1];
    if (!pref || !this.innerHTML.includes(`data-discord-pref="${pref}"`)) return null;
    if (!inputs.has(pref)) inputs.set(pref, { checked: false, value: "" });
    return inputs.get(pref);
  },
  querySelectorAll() { return [{ addEventListener() {} }]; },
};
const context = vm.createContext({
  document: {
    querySelector: () => mounted,
    createElement: () => modal,
    body: { appendChild: node => { mounted = node; } },
  },
  readStoredToken: () => "local-fixture",
  redirectToDiscordLogin: () => { throw new Error("Unexpected login"); },
  requestApi: async (_path, options) => {
    if (options.method === "POST") {
      saved = JSON.parse(JSON.stringify(options.body));
      return { preferences: saved };
    }
    return { preferences: { pollRemindersEnabled: false, dmEnabled: false, sessionDayReminderEnabled: true,
      sessionAdvanceReminderEnabled: false, sessionReminderMinutes: 60 } };
  },
});
vm.runInContext(helpers, context);
context.openDiscordNotificationSettings();
await new Promise(resolve => setImmediate(resolve));
assert.equal(modal.hidden, false);
assert.equal(modal.dataset.loading, undefined);
assert.equal(modal.querySelector('[data-discord-pref="pollRemindersEnabled"]'), null, "No opt-out control exists");
assert.match(modal.innerHTML, /obbligatori.*tutte le caselle.*voto parziale/s);
assert.match(modal.innerHTML, /Ricevere gli altri promemoria/);
assert.equal(inputs.get("dmEnabled").checked, false, "Legacy preferences load without accessing a removed checkbox");
assert.equal(status.textContent, "");
await context.saveDiscordNotificationSettings(modal);
assert.equal(saved.pollRemindersEnabled, true, "Saving with the general DM switch off still requires poll reminders");
assert.equal(saved.dmEnabled, false);
assert.equal(saved.sessionDayReminderEnabled, true);
assert.equal(status.textContent, "Preferenze salvate.");
console.log("Discord notification settings: mandatory notice, removed opt-out and legacy preferences passed.");
