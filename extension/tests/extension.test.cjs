const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const copy = value => JSON.parse(JSON.stringify(value));
function harness(seed = {}, options = {}) {
  const data = { privacyEvents: [], shieldEnabled: false, ...copy(seed) };
  const hook = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
  let rules = [], failRules = false, failStorage = false;
  const reloads = [], opened = [];
  const tabs = [{ id: 1, url: "https://example.com/page" }, { id: 2, url: "https://other.test/" }, { id: 3, url: "https://sub.example.com/" }];
  const chrome = {
    storage: { local: {
      async get(defaults) { return copy({ ...defaults, ...data }); },
      async set(update) { if (failStorage) { failStorage = false; throw new Error("storage failure"); } Object.assign(data, copy(update)); }
    }},
    runtime: { onInstalled: hook(), onMessage: hook(), getURL: name => "chrome-extension://basira/" + name },
    tabs: { onUpdated: hook(), onRemoved: hook(), async query() { return copy(tabs); }, async get(id) { const tab = tabs.find(t => t.id === id); if (!tab) throw new Error("Closed tab"); return copy(tab); }, async reload(id) { reloads.push(id); }, async create(value) { opened.push(value); } },
    declarativeNetRequest: {
      onRuleMatchedDebug: hook(),
      async getDynamicRules() { return copy(rules); },
      async updateDynamicRules(update) {
        if (failRules) { failRules = false; throw new Error("rule failure"); }
        rules = rules.filter(rule => !update.removeRuleIds.includes(rule.id)).concat(copy(update.addRules));
      }
    },
    webRequest: { onBeforeRequest: hook(), onErrorOccurred: hook() },
    permissions: { async contains() { return true; } },
    cookies: {
      async getAllCookieStores() { return [{ id: "0", tabIds: [1, 2, 3] }]; },
      async getAll() { return [
        { name: "_ga", value: "secret", domain: ".example.com", path: "/", secure: true, httpOnly: false, sameSite: "lax", session: false, expirationDate: 1900000000, hostOnly: false },
        { name: "IDE", value: "secret2", domain: ".doubleclick.net", path: "/", secure: true, httpOnly: true, sameSite: "no_restriction", session: true, hostOnly: false },
        { name: "unrelated", value: "secret3", domain: ".other.test", path: "/", hostOnly: false },
        { name: "partitioned", value: "secret4", domain: ".example.com", path: "/", hostOnly: false, partitionKey: { topLevelSite: "https://other.test" } }
      ]; }
    }
  };
  if (options.noDebugFeedback) delete chrome.declarativeNetRequest.onRuleMatchedDebug;
  const context = vm.createContext({ chrome, URL, console, setTimeout, clearTimeout });
  context.importScripts = (...files) => files.forEach(file => { if (file === options.failedImport) throw new Error("Import failed: " + file); vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file }); });
  context.importScripts("background.js");
  const run = expression => vm.runInContext(expression, context);
  const message = payload => new Promise(resolve => chrome.runtime.onMessage.listeners[0](payload, {}, resolve));
  return { data, chrome, run, message, reloads, opened, rules: () => rules, failRules: () => { failRules = true; }, failStorage: () => { failStorage = true; } };
}
test("legacy Shield toggles retain the original six rules and event API", async () => {
  const h = harness();
  assert.equal((await h.message({ type: "BASIRA_SET_SHIELD", enabled: true })).ok, true);
  assert.equal(h.rules().length, 6);
  assert.deepEqual(h.rules().map(rule => rule.id), [1000,1001,1002,1003,1004,1005]);
  assert.ok(h.rules().every(rule => rule.action.type === "block" && rule.condition.domainType === "thirdParty" && !rule.condition.resourceTypes.includes("main_frame")));
  assert.equal((await h.message({ type: "BASIRA_GET_EVENTS" })).shieldEnabled, true);
  await h.message({ type: "BASIRA_SET_SHIELD", enabled: false });
  assert.equal(h.rules().length, 0);
});
test("site pause is exact-host, persists, preserves detection and global Shield", async () => {
  const h = harness();
  await h.run("applyShield(true)");
  const result = await h.message({ type: "BASIRA_SET_SITE_PAUSE", hostname: "example.com", paused: true });
  assert.equal(result.ok, true);
  assert.equal(h.data.shieldEnabled, true);
  const allow = h.rules().find(rule => rule.action.type === "allowAllRequests");
  const match = new RegExp(allow.condition.regexFilter);
  assert.ok(match.test("https://example.com/page"));
  assert.ok(match.test("http://example.com:8080/page"));
  assert.ok(!match.test("https://exampleXcom/"));
  assert.ok(!match.test("https://sub.example.com/"));
  assert.ok(!match.test("https://other.test/?next=https://example.com/"));
  assert.deepEqual(h.reloads, [1]);
  assert.deepEqual(h.data.basiraPreferences.pausedSites, ["example.com"]);
  const restarted = harness(h.data);
  assert.deepEqual(copy(await restarted.run("readPreferences()")).pausedSites, ["example.com"]);
  h.chrome.tabs.onUpdated.listeners[0](1, { url: "https://example.com/page" });
  h.chrome.webRequest.onBeforeRequest.listeners[0]({ tabId: 1, requestId: "r1", type: "script", url: "https://doubleclick.net/a", initiator: "https://example.com" });
  await h.run("storageQueue");
  assert.equal(h.data.privacyEvents.length, 1);
  assert.equal(h.data.privacyEvents[0].blocked, false);
  h.chrome.declarativeNetRequest.onRuleMatchedDebug.listeners[0]({ rule: { ruleId: 2000 }, request: { requestId: "r1" } });
  await h.run("storageQueue");
  assert.equal(h.data.privacyEvents[0].blocked, false);
  await h.run("applyShield(false)");
  assert.equal(h.rules().length, 0);
  assert.deepEqual(h.data.basiraPreferences.pausedSites, ["example.com"]);
  await h.run("applyShield(true)");
  assert.ok(h.rules().some(rule => rule.action.type === "allowAllRequests"));
  await h.message({ type: "BASIRA_SET_SITE_PAUSE", hostname: "example.com", paused: false });
  assert.equal(h.rules().length, 6);
  assert.equal(h.data.shieldEnabled, true);
  assert.deepEqual(h.data.basiraPreferences.pausedSites, []);
});
test("categories control actual rules; display filtering never deletes events", async () => {
  const h = harness({ privacyEvents: [{ id: "low", risk: "low" }] });
  await h.run("applyShield(true)");
  await h.message({ type: "BASIRA_UPDATE_SETTINGS", patch: { categories: { Analytics: false }, showLowRisk: false } });
  assert.deepEqual(h.rules().map(rule => rule.id), [1002, 1003]);
  assert.equal(h.data.privacyEvents.length, 1);
  assert.equal(h.data.basiraPreferences.showLowRisk, false);
  assert.equal((await h.message({ type: "BASIRA_UPDATE_SETTINGS", patch: { categories: { Identifiers: false } } })).ok, false);
  await h.message({ type: "BASIRA_CLEAR_EVENTS" });
  assert.equal(h.data.privacyEvents.length, 0);
  assert.equal(h.data.basiraPreferences.showLowRisk, false);
});
test("failed rule or storage updates do not save misleading Shield state", async () => {
  const h = harness();
  h.failRules();
  assert.equal((await h.message({ type: "BASIRA_SET_SHIELD", enabled: true })).ok, false);
  assert.equal(h.data.shieldEnabled, false);
  h.failStorage();
  assert.equal((await h.message({ type: "BASIRA_SET_SHIELD", enabled: true })).ok, false);
  assert.equal(h.data.shieldEnabled, false);
  assert.equal(h.rules().length, 0);
  await h.run("applyShield(true)");
  assert.equal(h.rules().length, 6);
});
test("concurrent preference updates are serialized and dashboard URLs validated", async () => {
  const h = harness();
  await Promise.all([h.run("updatePreferences({showLowRisk:false})"), h.run("updatePreferences({categories:{Analytics:false}})")]);
  assert.equal(h.data.basiraPreferences.showLowRisk, false);
  assert.equal(h.data.basiraPreferences.categories.Analytics, false);
  await h.message({ type: "BASIRA_OPEN_MIRROR" });
  assert.match(h.opened[0].url, /options.html#dashboard$/);
  assert.equal((await h.message({ type: "BASIRA_UPDATE_SETTINGS", patch: { dashboardUrl: "javascript:alert(1)" } })).ok, false);
  await h.message({ type: "BASIRA_UPDATE_SETTINGS", patch: { dashboardUrl: "http://localhost:4321" } });
  await h.message({ type: "BASIRA_OPEN_MIRROR" });
  assert.equal(h.opened[1].url, "http://localhost:4321/");
});
test("cookie scope excludes unrelated/partitioned cookies and never returns values", async () => {
  const h = harness({ privacyEvents: [{ pageUrl: "https://example.com/page", domain: "doubleclick.net" }] });
  const result = await h.message({ type: "BASIRA_GET_COOKIES", tabId: 1 });
  assert.equal(result.cookies.length, 2);
  assert.equal(result.cookies.filter(cookie => cookie.thirdParty).length, 1);
  assert.ok(result.cookies.every(cookie => !("value" in cookie)));
  assert.ok(!JSON.stringify(result).includes("secret"));
  assert.match(result.cookies[1].explanation, /may help/);
  h.chrome.permissions.contains = async () => false;
  const denied = await h.message({ type: "BASIRA_GET_COOKIES", tabId: 1 });
  assert.equal(denied.permissionRequired, true);
  assert.equal(denied.cookies.length, 0);
});


test("missing optional debug feedback must not abort worker or suppress state responses", async () => {
  const h = harness({}, { noDebugFeedback: true });
  assert.equal(h.chrome.runtime.onMessage.listeners.length, 1);
  const response = await h.message({type: "BASIRA_GET_STATE"});
  assert.equal(response.ok, true);
  assert.deepEqual(response.events, []);
});


test("import failure still registers a listener and returns an explicit error", async () => {
  const h = harness({}, {failedImport: "insights.js"});
  const response = await h.message({type: "BASIRA_GET_STATE"});
  assert.equal(response.ok, false);
  assert.match(response.error, /Import failed: insights/);
});

test("async state responses keep the message channel open before installation finishes", async () => {
  const h = harness(); let release;
  h.chrome.storage.local.get = () => new Promise(resolve => { release = resolve; });
  let response;
  assert.equal(h.chrome.runtime.onMessage.listeners[0]({type:"BASIRA_GET_STATE"}, {}, value => {response = value;}), true);
  await Promise.resolve();
  assert.equal(response, undefined);
  h.chrome.storage.local.get = async defaults => copy(defaults);
  release({privacyEvents: []});
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(response.ok, true);
  assert.equal(response.preferences.shieldEnabled, false);
});

test("storage and Clear failures respond and do not poison later requests", async () => {
  const h = harness(); const get = h.chrome.storage.local.get;
  h.chrome.storage.local.get = async () => {throw new Error("read unavailable");};
  assert.equal((await h.message({type:"BASIRA_GET_STATE"})).ok, false);
  assert.equal((await h.message({type:"BASIRA_GET_EVENTS"})).ok, false);
  h.chrome.storage.local.get = get;
  h.failStorage();
  assert.equal((await h.message({type:"BASIRA_CLEAR_EVENTS"})).ok, false);
  assert.equal((await h.message({type:"BASIRA_CLEAR_EVENTS"})).ok, true);
  assert.equal((await h.message({type:"BASIRA_GET_STATE"})).ok, true);
});

test("installation rejection is contained and state stays available", async () => {
  const h = harness(); h.failRules();
  await h.chrome.runtime.onInstalled.listeners[0]();
  assert.equal((await h.message({type:"BASIRA_GET_STATE"})).ok, true);
});
