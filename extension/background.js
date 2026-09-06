/* global BASIRA, TRACKERS, findTracker */
// Register the response channel before any imported/optional code can throw.
const BACKGROUND_DEBUG = false; // Enable locally to trace worker wakes/messages.
let startupError = null;
if (BACKGROUND_DEBUG) console.info("[BASIRA BG] service worker started", Date.now());
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (BACKGROUND_DEBUG) console.debug("[BASIRA BG] message", message?.type);
  if (startupError) {
    sendResponse({ ok: false, error: "Background startup failed: " + startupError.message });
    return false;
  }
  const extendedActions = {
    BASIRA_GET_STATE: async () => {
      const data = await chrome.storage.local.get({ [BASIRA.EVENTS_KEY]: [] });
      return { events: Array.isArray(data[BASIRA.EVENTS_KEY]) ? data[BASIRA.EVENTS_KEY] : [], preferences: await readPreferences(), categories: SUPPORTED_CATEGORIES };
    },
    BASIRA_UPDATE_SETTINGS: () => updatePreferences(message.patch || {}).then(preferences => ({ preferences })),
    BASIRA_SET_SITE_PAUSE: () => setSitePause(message.hostname, Boolean(message.paused)),
    BASIRA_OPEN_MIRROR: () => openDigitalMirror(),
    BASIRA_GET_COOKIES: () => getCookieInsights(message.tabId)
  };
  if (Object.hasOwn(extendedActions, message?.type)) {
    Promise.resolve().then(extendedActions[message.type])
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error => { console.error("[BASIRA BG] request failed", message.type, error); sendResponse({ ok: false, error: error.message }); });
    return true;
  }
  if (message?.type === "BASIRA_GET_EVENTS") {
    chrome.storage.local.get({ [BASIRA.EVENTS_KEY]: [], [BASIRA.SHIELD_KEY]: false })
      .then((data) => sendResponse({ events: data[BASIRA.EVENTS_KEY], shieldEnabled: data[BASIRA.SHIELD_KEY] }))
      .catch(error => { console.error("[BASIRA BG] GET_EVENTS failed", error); sendResponse({ ok: false, error: error.message }); });
    return true;
  }
  if (message?.type === "BASIRA_SET_SHIELD") {
    applyShield(Boolean(message.enabled))
      .then(() => sendResponse({ ok: true, shieldEnabled: Boolean(message.enabled) }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "BASIRA_CLEAR_EVENTS") {
    storageQueue = storageQueue.catch(() => {}).then(() => chrome.storage.local.set({ [BASIRA.EVENTS_KEY]: [] }));
    storageQueue
      .then(() => sendResponse({ ok: true }))
      .catch(error => { console.error("[BASIRA BG] Clear failed", error); sendResponse({ ok: false, error: error.message }); });
    return true;
  }
});

try {
  importScripts("shared.js", "tracker-rules.js", "config.js", "preferences.js", "insights.js");
} catch (error) {
  startupError = error;
  console.error("[BASIRA BG] script initialization failed", error);
}

// Service workers are short-lived, so this cache is only a convenience. The
// stored event remains the source of truth and is safe if Chrome restarts us.
const pageHostsByTab = new Map();
const pageUrlsByTab = new Map();
const eventIdByRequestId = new Map();
const DNR_RULE_ID_START = 1000;
let storageQueue = Promise.resolve();

function getPageHost(details) {
  // Prefer the tab's top-level page. `initiator` can instead be the URL of a
  // nested third-party iframe, which would make that iframe look first-party.
  if (details.tabId >= 0 && pageHostsByTab.has(details.tabId)) {
    return pageHostsByTab.get(details.tabId);
  }
  const fromInitiator = BASIRA.hostnameFromUrl(details.initiator);
  if (fromInitiator) return fromInitiator;
  return null;
}

function buildEvent(details, blocked) {
  const requestHost = BASIRA.hostnameFromUrl(details.url);
  const pageHost = getPageHost(details);
  if (!requestHost || !pageHost || BASIRA.isSameSite(pageHost, requestHost)) return null;

  const tracker = findTracker(requestHost);
  return {
    id: BASIRA.makeId(),
    timestamp: Date.now(),
    // initiator is normally the page origin. A full tab URL is deliberately
    // not retained when it is unavailable, rather than guessing one.
    pageUrl: (details.tabId >= 0 && pageUrlsByTab.get(details.tabId)) || details.initiator || `https://${pageHost}/`,
    domain: tracker ? tracker.domain : requestHost,
    category: tracker ? tracker.category : "Other",
    risk: tracker ? tracker.risk : "low",
    blocked: Boolean(blocked),
    explanation: tracker
      ? tracker.explanation
      : `This website contacted the third-party domain ${requestHost}.`
  };
}

async function saveEvent(event) {
  storageQueue = storageQueue.then(async () => {
    const stored = await chrome.storage.local.get({ [BASIRA.EVENTS_KEY]: [] });
    const events = [event, ...stored[BASIRA.EVENTS_KEY]].slice(0, BASIRA.MAX_EVENTS);
    await chrome.storage.local.set({ [BASIRA.EVENTS_KEY]: events });
  });
  return storageQueue;
}

async function markEventBlocked(eventId) {
  if (!eventId) return;
  storageQueue = storageQueue.then(async () => {
    const stored = await chrome.storage.local.get({ [BASIRA.EVENTS_KEY]: [] });
    const events = stored[BASIRA.EVENTS_KEY];
    const event = events.find((item) => item.id === eventId);
    if (event && !event.blocked) {
      event.blocked = true;
      await chrome.storage.local.set({ [BASIRA.EVENTS_KEY]: events });
    }
  });
  return storageQueue;
}

function dynamicRules(preferences) {
  // Restrict blocks to typical third-party subresources. This avoids blocking
  // a top-level visit should a domain ever be opened directly.
  const resourceTypes = ["script", "image", "xmlhttprequest", "ping", "sub_frame", "stylesheet", "font", "media", "other"];
  return TRACKERS.map((tracker, index) => ({
    id: DNR_RULE_ID_START + index,
    priority: 1,
    action: { type: "block" },
    condition: {
      urlFilter: `||${tracker.domain}^`,
      // Chrome performs the full public-suffix-based first/third-party check
      // here, so Shield will not block a same-site request.
      domainType: "thirdParty",
      resourceTypes
    }
  })).filter((rule, index) => preferences.categories[TRACKERS[index].category] !== false);
}

async function applyShield(enabled) {
  await updatePreferences({ shieldEnabled: enabled });
}

chrome.runtime.onInstalled.addListener(() => {
  return initializeStorage().catch(error => console.error("[BASIRA BG] installation initialization failed", error));
});

async function initializeStorage() {
  if (startupError) throw startupError;
  const stored = await chrome.storage.local.get({ [BASIRA.EVENTS_KEY]: [], [BASIRA.SHIELD_KEY]: false });
  await chrome.storage.local.set({
    [BASIRA.EVENTS_KEY]: Array.isArray(stored[BASIRA.EVENTS_KEY]) ? stored[BASIRA.EVENTS_KEY] : [],
    [BASIRA.SHIELD_KEY]: Boolean(stored[BASIRA.SHIELD_KEY])
  });
  await applyShield(Boolean(stored[BASIRA.SHIELD_KEY]));
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (startupError) return;
  if (changeInfo.url) {
    const host = BASIRA.hostnameFromUrl(changeInfo.url);
    if (host) {
      pageHostsByTab.set(tabId, host);
      pageUrlsByTab.set(tabId, changeInfo.url);
    }
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  pageHostsByTab.delete(tabId);
  pageUrlsByTab.delete(tabId);
});

// Observation-only webRequest listener: MV3 blocking is handled exclusively
// by declarativeNetRequest, never by the deprecated blocking webRequest flow.
chrome.webRequest.onBeforeRequest.addListener((details) => {
  if (startupError) return;
  if (details.tabId < 0 || details.type === "main_frame") return;
  const event = buildEvent(details, false);
  if (!event) return;
  eventIdByRequestId.set(details.requestId, event.id);
  saveEvent(event).catch(console.warn);
}, { urls: ["<all_urls>"] });

// This feedback event confirms that Chrome's declarative rule matched. It is
// the preferred source for `blocked: true`; error handling below is a fallback.
function onRuleMatched(info) {
  if (startupError) return;
  // Pause allow rules are not blocked requests.
  if (info.rule.ruleId < DNR_RULE_ID_START || info.rule.ruleId >= DNR_RULE_ID_START + TRACKERS.length) return;
  const requestId = info.request.requestId;
  const existingEventId = eventIdByRequestId.get(requestId);
  if (existingEventId) {
    markEventBlocked(existingEventId).catch(console.warn);
    return;
  }
  const event = buildEvent({
    url: info.request.url,
    initiator: info.request.initiator,
    tabId: info.request.tabId
  }, true);
  if (event) saveEvent(event).catch(console.warn);
}

// This development-only API can be absent; observation/error listeners still work.
try {
  chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(onRuleMatched);
} catch (error) {
  console.warn("[BASIRA BG] debug feedback unavailable", error);
}

chrome.webRequest.onErrorOccurred.addListener((details) => {
  if (details.error === "net::ERR_BLOCKED_BY_CLIENT") {
    markEventBlocked(eventIdByRequestId.get(details.requestId)).catch(console.warn);
  }
}, { urls: ["<all_urls>"] });
