/* global BASIRA, TRACKERS, findTracker */
importScripts("shared.js", "tracker-rules.js");

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

function dynamicRules() {
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
  }));
}

async function applyShield(enabled) {
  const oldRuleIds = TRACKERS.map((_, index) => DNR_RULE_ID_START + index);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldRuleIds,
    addRules: enabled ? dynamicRules() : []
  });
  await chrome.storage.local.set({ [BASIRA.SHIELD_KEY]: enabled });
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get({ [BASIRA.EVENTS_KEY]: [], [BASIRA.SHIELD_KEY]: false });
  await chrome.storage.local.set({
    [BASIRA.EVENTS_KEY]: Array.isArray(stored[BASIRA.EVENTS_KEY]) ? stored[BASIRA.EVENTS_KEY] : [],
    [BASIRA.SHIELD_KEY]: Boolean(stored[BASIRA.SHIELD_KEY])
  });
  await applyShield(Boolean(stored[BASIRA.SHIELD_KEY]));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
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
  if (details.tabId < 0 || details.type === "main_frame") return;
  const event = buildEvent(details, false);
  if (!event) return;
  eventIdByRequestId.set(details.requestId, event.id);
  saveEvent(event).catch(console.warn);
}, { urls: ["<all_urls>"] });

// This feedback event confirms that Chrome's declarative rule matched. It is
// the preferred source for `blocked: true`; error handling below is a fallback.
chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
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
});

chrome.webRequest.onErrorOccurred.addListener((details) => {
  if (details.error === "net::ERR_BLOCKED_BY_CLIENT") {
    markEventBlocked(eventIdByRequestId.get(details.requestId)).catch(console.warn);
  }
}, { urls: ["<all_urls>"] });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "BASIRA_GET_EVENTS") {
    chrome.storage.local.get({ [BASIRA.EVENTS_KEY]: [], [BASIRA.SHIELD_KEY]: false })
      .then((data) => sendResponse({ events: data[BASIRA.EVENTS_KEY], shieldEnabled: data[BASIRA.SHIELD_KEY] }));
    return true;
  }
  if (message?.type === "BASIRA_SET_SHIELD") {
    applyShield(Boolean(message.enabled))
      .then(() => sendResponse({ ok: true, shieldEnabled: Boolean(message.enabled) }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "BASIRA_CLEAR_EVENTS") {
    storageQueue = storageQueue.then(() => chrome.storage.local.set({ [BASIRA.EVENTS_KEY]: [] }));
    storageQueue
      .then(() => sendResponse({ ok: true }));
    return true;
  }
});
