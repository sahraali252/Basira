/* global BASIRA, TRACKERS, DASHBOARD_URL */
const PREFERENCES_KEY = "basiraPreferences";
const SUPPORTED_CATEGORIES = [...new Set(TRACKERS.map(tracker => tracker.category))];
const PAUSE_RULE_START = 2000;
const MAX_PAUSED_SITES = 100;
let preferenceQueue = Promise.resolve();

async function readPreferences() {
  const saved = await chrome.storage.local.get({
    [PREFERENCES_KEY]: {}, [BASIRA.SHIELD_KEY]: false
  });
  const value = saved[PREFERENCES_KEY] || {};
  return {
    shieldEnabled: Boolean(saved[BASIRA.SHIELD_KEY]),
    categories: Object.fromEntries(SUPPORTED_CATEGORIES.map(category => [category, value.categories?.[category] !== false])),
    showLowRisk: value.showLowRisk !== false,
    pausedSites: Array.isArray(value.pausedSites) ? value.pausedSites : [],
    dashboardUrl: value.dashboardUrl || DASHBOARD_URL
  };
}

function validateDashboardUrl(value) {
  if (!value) return "";
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Use an http:// or https:// dashboard URL without credentials.");
  }
  return url.href;
}

function validateHostname(value) {
  if (typeof value !== "string" || !value || /[\s/\\?#@]/.test(value)) throw new Error("Invalid hostname.");
  const hostname = BASIRA.hostnameFromUrl("https://" + value + "/");
  if (!hostname || hostname !== value.toLowerCase()) throw new Error("Invalid hostname.");
  return hostname;
}

function pauseRules(preferences) {
  return preferences.pausedSites.map((hostname, index) => ({
    id: PAUSE_RULE_START + index,
    priority: 100,
    action: { type: "allowAllRequests" },
    condition: {
      regexFilter: "^https?://" + hostname.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&") + "(:[0-9]+)?/",
      resourceTypes: ["main_frame"]
    }
  }));
}

function managedRule(id) {
  return (id >= 1000 && id < 1000 + TRACKERS.length) ||
    (id >= PAUSE_RULE_START && id < PAUSE_RULE_START + MAX_PAUSED_SITES);
}

async function installProtection(preferences) {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: rules.filter(rule => managedRule(rule.id)).map(rule => rule.id),
    addRules: preferences.shieldEnabled ? [...dynamicRules(preferences), ...pauseRules(preferences)] : []
  });
}

function updatePreferences(patch) {
  const work = preferenceQueue.catch(() => {}).then(async () => {
    const previous = await readPreferences();
    const next = { ...previous, categories: { ...previous.categories } };
    if ("shieldEnabled" in patch) next.shieldEnabled = Boolean(patch.shieldEnabled);
    if ("showLowRisk" in patch) next.showLowRisk = Boolean(patch.showLowRisk);
    if ("dashboardUrl" in patch) next.dashboardUrl = validateDashboardUrl(patch.dashboardUrl.trim());
    if (patch.categories) {
      for (const [category, value] of Object.entries(patch.categories)) {
        if (!SUPPORTED_CATEGORIES.includes(category)) throw new Error("This category has no blocking rules.");
        next.categories[category] = Boolean(value);
      }
    }
    if (patch.site) {
      const hostname = validateHostname(patch.site.hostname);
      const sites = new Set(next.pausedSites);
      patch.site.paused ? sites.add(hostname) : sites.delete(hostname);
      if (sites.size > MAX_PAUSED_SITES) throw new Error("The MVP supports up to 100 paused hostnames.");
      next.pausedSites = [...sites].sort();
    }
    const protectionChanged = "shieldEnabled" in patch || Boolean(patch.categories) || Boolean(patch.site);
    if (protectionChanged) await installProtection(next);
    try {
      const { shieldEnabled, ...stored } = next;
      await chrome.storage.local.set({ [PREFERENCES_KEY]: stored, [BASIRA.SHIELD_KEY]: shieldEnabled });
    } catch (error) {
      if (protectionChanged) await installProtection(previous);
      throw error;
    }
    // Frame allow rules match top-level navigations. Reapply them in already
    // open paused tabs when global Shield/category rules are changed.
    if (protectionChanged && next.shieldEnabled && !patch.site) {
      const tabs = await chrome.tabs.query({});
      await Promise.allSettled(tabs.filter(tab => next.pausedSites.includes(BASIRA.hostnameFromUrl(tab.url)))
        .map(tab => chrome.tabs.reload(tab.id)));
    }
    return next;
  });
  preferenceQueue = work;
  return work;
}

async function setSitePause(hostname, paused) {
  hostname = validateHostname(hostname);
  const preferences = await updatePreferences({ site: { hostname, paused } });
  const tabs = await chrome.tabs.query({});
  const reloads = await Promise.allSettled(tabs
    .filter(tab => BASIRA.hostnameFromUrl(tab.url) === hostname)
    .map(tab => chrome.tabs.reload(tab.id)));
  return { preferences, reloadFailed: reloads.some(result => result.status === "rejected") };
}

async function openDigitalMirror() {
  const { dashboardUrl } = await readPreferences();
  if (!dashboardUrl) {
    await chrome.tabs.create({ url: chrome.runtime.getURL("options.html#dashboard") });
    return { configured: false };
  }
  await chrome.tabs.create({ url: validateDashboardUrl(dashboardUrl) });
  return { configured: true };
}
