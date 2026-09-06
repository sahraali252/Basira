/* global BASIRA, findTracker */
function cookieInsight(cookie, hostname) {
  const domain = cookie.domain.replace(/^\./, "");
  const tracker = findTracker(domain);
  let category = tracker?.category || "Other";
  let explanation = tracker
    ? "This domain is associated with " + tracker.category.toLowerCase() + ". The purpose of this particular cookie is not confirmed."
    : "Its purpose cannot be determined from this metadata alone.";
  if (/^_ga(_|$)|^_gid$/.test(cookie.name)) {
    category = "Analytics";
    explanation = "This name is commonly associated with Google Analytics and may help distinguish repeat visits or measure usage.";
  } else if (cookie.name === "IDE" && BASIRA.isSameSite(domain, "doubleclick.net")) {
    category = "Advertising";
    explanation = "This cookie is associated with advertising measurement and may help recognize repeat visits.";
  }
  // Deliberately omit cookie.value. Presence does not establish transmission.
  return {
    name: cookie.name, domain: cookie.domain, path: cookie.path,
    thirdParty: !BASIRA.isSameSite(domain, hostname),
    secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite,
    session: cookie.session, expirationDate: cookie.expirationDate ?? null,
    hostOnly: cookie.hostOnly, partitionKey: cookie.partitionKey || null,
    category, explanation
  };
}

async function getCookieInsights(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const hostname = BASIRA.hostnameFromUrl(tab.url);
  if (!hostname) throw new Error("Open an http or https website to inspect related cookies.");
  const granted = await chrome.permissions.contains({ permissions: ["cookies"] });
  if (!granted) return { hostname, permissionRequired: true, cookies: [] };
  const stores = await chrome.cookies.getAllCookieStores();
  const store = stores.find(item => item.tabIds.includes(tabId));
  if (!store) throw new Error("The cookie store for this tab is unavailable.");
  const saved = await chrome.storage.local.get({ [BASIRA.EVENTS_KEY]: [] });
  const related = new Set([hostname]);
  for (const event of saved[BASIRA.EVENTS_KEY]) {
    if (BASIRA.hostnameFromUrl(event.pageUrl) === hostname) related.add(event.domain);
  }
  const cookies = await chrome.cookies.getAll({ storeId: store.id });
  const scoped = cookies.filter(cookie => {
    // This MVP reports unpartitioned cookies only; do not mix other partitions.
    if (cookie.partitionKey) return false;
    const domain = cookie.domain.replace(/^\./, "");
    return [...related].some(host => host === domain || (!cookie.hostOnly && host.endsWith("." + domain)));
  }).map(cookie => cookieInsight(cookie, hostname));
  return {
    hostname, permissionRequired: false, cookies: scoped,
    observedAt: Date.now(),
    scope: "Unpartitioned cookies stored for this hostname and domains in its retained request history. Not proof that cookies were sent during this visit."
  };
}
