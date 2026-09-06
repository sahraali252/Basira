/* global BASIRA, UI */
// In-memory diagnostics only: no browsing data, storage writes, or telemetry.
const popupDiagnostics = {
  build: "popup-debug-3", instance: crypto.randomUUID(),
  startedAt: new Date().toISOString(), renders: 0, refreshCalls: 0,
  storageNotifications: 0, lifecycle: [], errors: []
};
window.basiraPopupDiagnostics = () => JSON.parse(JSON.stringify(popupDiagnostics));
const POPUP_DEBUG = false;
if (POPUP_DEBUG) console.info("[BASIRA popup startup]", popupDiagnostics.build, popupDiagnostics.instance);
for (const name of ["pageshow", "pagehide"]) {
  window.addEventListener(name, event => {
    popupDiagnostics.lifecycle.push({ event: name, persisted: event.persisted, at: Date.now() });
    popupDiagnostics.lifecycle = popupDiagnostics.lifecycle.slice(-10);
    if (POPUP_DEBUG) console.info("[BASIRA popup lifecycle]", popupDiagnostics.instance, name);
  });
}
for (const name of ["error", "unhandledrejection"]) {
  window.addEventListener(name, event => {
    popupDiagnostics.errors.push(String(event.message || event.reason?.message || event.reason));
    popupDiagnostics.errors = popupDiagnostics.errors.slice(-10);
  });
}
const elements = {
  toggle: document.querySelector("#shield-toggle"), status: document.querySelector("#shield-status"),
  detected: document.querySelector("#detected-count"), blocked: document.querySelector("#blocked-count"),
  list: document.querySelector("#event-list"), clear: document.querySelector("#clear-events"),
  pause: document.querySelector("#pause-site"), menuPause: document.querySelector("#menu-pause"),
  menu: document.querySelector("#action-menu"), menuToggle: document.querySelector("#menu-toggle")
};
let currentTab = null;
let hostname = null;
let preferences = null;
let refreshVersion = 0;
let pendingRefresh;
let recoveryTimer;
const storageUpdates = {};
let renderedState;
let tabPromise;
const rows = new Map();
function setText(node, value) {
  if (node.textContent !== String(value)) node.textContent = value;
}

function render({ events, preferences: prefs }) {
  popupDiagnostics.renders++;
  renderedState = { events, preferences: prefs };
  preferences = prefs;
  elements.toggle.checked = prefs.shieldEnabled;
  setText(elements.status, prefs.shieldEnabled ? "Shield ON" : "Shield OFF");
  document.body.dataset.shield = prefs.shieldEnabled ? "on" : "off";
  setText(elements.detected, events.length);
  setText(elements.blocked, events.filter(event => event.blocked).length);

  const filtered = events.filter(event => prefs.showLowRisk || event.risk !== "low");
  setText(document.querySelector("#activity-caption"), prefs.showLowRisk
    ? "Latest 30 saved requests · All sites" : "Low-risk hidden · Counts include all requests");
  let empty = elements.list.querySelector(".empty");
  if (filtered.length) empty?.remove();
  else {
    if (!empty) { empty = UI.text("li", "", "empty"); elements.list.append(empty); }
    setText(empty, events.length ? "No requests match your display settings." : "No third-party requests detected yet.");
  }
  const visible = filtered.slice(0, 30);
  const ids = new Set(visible.map(event => event.id));
  for (const [id, row] of rows) {
    if (!ids.has(id)) { row.item.remove(); rows.delete(id); }
  }
  visible.forEach((event, index) => {
    const existing = rows.get(event.id);
    if (existing && existing.signature === JSON.stringify(event)) {
      if (elements.list.children[index] !== existing.item) elements.list.insertBefore(existing.item, elements.list.children[index] || null);
      return;
    }
    if (existing) {
      setText(existing.item.querySelector(".domain"), event.domain);
      const meta = existing.item.querySelector(".meta");
      setText(meta, event.category + " \u00b7 " + event.risk + " risk \u00b7 " + (event.blocked ? "Blocked" : "Allowed"));
      meta.className = event.blocked ? "meta blocked" : "meta";
      setText(existing.item.querySelector(".event-explanation"), event.explanation);
      existing.signature = JSON.stringify(event);
      if (elements.list.children[index] !== existing.item) elements.list.insertBefore(existing.item, elements.list.children[index] || null);
      return;
    }
    const item = document.createElement("li");
    const details = document.createElement("details");
    details.dataset.eventId = event.id;
    details.open = existing?.item.querySelector("details").open || false;
    const summary = document.createElement("summary");
    summary.append(UI.text("div", event.domain, "domain"), UI.text("div", event.category + " · " + event.risk + " risk · " + (event.blocked ? "Blocked" : "Allowed"), event.blocked ? "meta blocked" : "meta"));
    details.append(summary, UI.text("p", event.explanation, "event-explanation"));
    item.append(details);

    rows.set(event.id, { item, signature: JSON.stringify(event) });
    if (elements.list.children[index] !== item) elements.list.insertBefore(item, elements.list.children[index] || null);
  });
  const paused = hostname && prefs.pausedSites.includes(hostname);
  const activeCategory = Object.values(prefs.categories).some(Boolean);
  setText(document.querySelector("#site-host"), hostname || "No supported website");
  setText(document.querySelector("#site-status"), !hostname ? "Open an http or https website" :
    paused ? "Protection paused on" : !prefs.shieldEnabled ? "Global Shield is off on" :
    !activeCategory ? "Blocking categories are off on" : "Protection active on");
  setText(elements.pause, paused ? "Resume protection" : "Pause on this site");
  setText(elements.menuPause, paused ? "Resume protection on this site" : "Pause on this site");
  elements.pause.disabled = elements.menuPause.disabled = !hostname;
  document.querySelector("#open-cookies").disabled = !hostname;
}

function refresh({ recoveryAttempt = 0 } = {}) {
  popupDiagnostics.refreshCalls++;
  clearTimeout(refreshTimer);
  refreshTimer = null;
  if (pendingRefresh) return pendingRefresh;
  pendingRefresh = Promise.resolve().then(async () => {
    tabPromise ||= chrome.tabs.query({ active: true, currentWindow: true }).catch(error => { tabPromise = null; throw error; });
    await tabPromise;
    // Overlay notifications received during the read; never wait for a quiet
    // network before showing the popup. Busy sites may write continuously.
    for (const key of Object.keys(storageUpdates)) delete storageUpdates[key];
    const state = await UI.send("BASIRA_GET_STATE");
    currentTab = (await tabPromise)[0];
    hostname = BASIRA.hostnameFromUrl(currentTab?.url);
    render(withStorageUpdates(state));
    clearTimeout(recoveryTimer);
    recoveryTimer = null;
  }).catch(error => {
    // A disconnected worker must not erase an already rendered snapshot or
    // insert a banner for a single transient read failure. Mutations still fail
    // visibly, and sustained read failures surface after bounded recovery.
    if (!renderedState || !error.transportFailure || recoveryAttempt >= 2) throw error;
    console.warn("[BASIRA] Keeping last rendered state while reconnecting", error);
    if (!recoveryTimer) recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      refresh({ recoveryAttempt: recoveryAttempt + 1 }).catch(UI.error);
    }, 500);
  }).finally(() => { pendingRefresh = null; });
  return pendingRefresh;
}

async function refreshCookies() {
  const version = ++refreshVersion;
  if (hostname) {
    try {
      const data = await UI.send("BASIRA_GET_COOKIES", { tabId: currentTab.id });
      if (version !== refreshVersion) return;
      document.querySelector("#cookie-summary").textContent = data.permissionRequired ? "Permission needed to inspect" :
        data.cookies.length + " stored · " + data.cookies.filter(cookie => cookie.thirdParty).length + " third-party";
    } catch (error) {
      console.warn("[BASIRA] Cookie summary unavailable", error);
      if (version === refreshVersion) document.querySelector("#cookie-summary").textContent = "Unavailable for this tab";
    }
  } else document.querySelector("#cookie-summary").textContent = "Open a website to inspect";
}

function closeMenu(focus = false) {
  elements.menu.hidden = true;
  elements.menuToggle.setAttribute("aria-expanded", "false");
  if (focus) elements.menuToggle.focus();
}
function openMenu() {
  elements.menu.hidden = false;
  elements.menuToggle.setAttribute("aria-expanded", "true");
  elements.menu.querySelector("button:not(:disabled)").focus();
}
elements.menuToggle.addEventListener("click", () => elements.menu.hidden ? openMenu() : closeMenu(true));
elements.menuToggle.addEventListener("keydown", event => {
  if (event.key === "ArrowDown") { event.preventDefault(); openMenu(); }
});
document.addEventListener("click", event => {
  if (!elements.menu.contains(event.target) && !elements.menuToggle.contains(event.target)) closeMenu();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !elements.menu.hidden) { event.preventDefault(); closeMenu(true); }
});
elements.menu.addEventListener("keydown", event => {
  const items = [...elements.menu.querySelectorAll("button:not(:disabled)")];
  const index = items.indexOf(document.activeElement);
  if (event.key === "Tab") { closeMenu(); return; }
  let next;
  if (event.key === "ArrowDown") next = (index + 1) % items.length;
  if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = items.length - 1;
  if (next !== undefined) { event.preventDefault(); items[next].focus(); }
});
async function clearActivity() { await UI.send("BASIRA_CLEAR_EVENTS"); await refresh(); }
async function pauseSite() {
  if (!hostname) return;
  const result = await UI.send("BASIRA_SET_SITE_PAUSE", { hostname, paused: !preferences.pausedSites.includes(hostname) });
  await refresh();
  if (result.reloadFailed) UI.error("Preference saved. Reload this website to apply it.");
}
elements.menu.addEventListener("click", event => {
  const item = event.target.closest("button[data-action]");
  if (!item || item.disabled) return;
  closeMenu(true);
  UI.action(elements.menuToggle, async () => {
    if (item.dataset.action === "mirror") await UI.send("BASIRA_OPEN_MIRROR");
    if (item.dataset.action === "settings") await chrome.runtime.openOptionsPage();
    if (item.dataset.action === "pause") await pauseSite();
    if (item.dataset.action === "clear") await clearActivity();
  });
});
elements.toggle.addEventListener("change", () => UI.action(elements.toggle, async () => {
  try { await UI.send("BASIRA_SET_SHIELD", { enabled: elements.toggle.checked }); }
  finally { await refresh(); }
}));
elements.clear.addEventListener("click", () => UI.action(elements.clear, clearActivity));
elements.pause.addEventListener("click", () => UI.action(elements.pause, pauseSite));
document.querySelector("#open-cookies").addEventListener("click", event => UI.action(event.currentTarget, () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("cookies.html") + "?tab=" + currentTab.id })));
let refreshTimer;
function withStorageUpdates(state) {
  const prefs = { ...state.preferences };
  if ("basiraPreferences" in storageUpdates) {
    const stored = storageUpdates.basiraPreferences || {};
    prefs.categories = { ...prefs.categories, ...stored.categories };
    prefs.showLowRisk = stored.showLowRisk !== false;
    prefs.pausedSites = stored.pausedSites || [];
  }
  if ("shieldEnabled" in storageUpdates) prefs.shieldEnabled = Boolean(storageUpdates.shieldEnabled);
  return {
    events: "privacyEvents" in storageUpdates ? storageUpdates.privacyEvents || [] : state.events,
    preferences: prefs
  };
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !["privacyEvents", "shieldEnabled", "basiraPreferences"].some(key => key in changes)) return;
  popupDiagnostics.storageNotifications++;
  for (const key of ["privacyEvents", "shieldEnabled", "basiraPreferences"]) {
    if (key in changes) storageUpdates[key] = changes[key].newValue;
  }
  if (!renderedState || refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    render(withStorageUpdates(renderedState));
  }, 100);
});
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  if (id !== currentTab?.id || !change.url) return;
  tabPromise = Promise.resolve([tab]);
  refresh().then(refreshCookies).catch(UI.error);
});
refresh().then(() => {
  elements.toggle.disabled = false;
  return refreshCookies();
}).catch(UI.error);
