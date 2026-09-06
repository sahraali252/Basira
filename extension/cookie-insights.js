/* Isolated popup reader. No background messages, storage, logging, or writes. */
(async () => {
  const count = document.querySelector("#cookie-count");
  const list = document.querySelector("#cookie-list");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab?.url);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsupported page");
    const stores = await chrome.cookies.getAllCookieStores();
    const store = stores.find(item => item.tabIds.includes(tab.id));
    if (!store) throw new Error("Cookie store unavailable");
    // Select metadata immediately. Cookie values never enter the view model.
    const cookies = (await chrome.cookies.getAll({ url: url.href, storeId: store.id }))
      .filter(cookie => !cookie.partitionKey)
      .map(({ name, domain, hostOnly, secure, httpOnly, sameSite }) => {
        const normalizedDomain = domain.replace(/^\./, "").toLowerCase();
        const hostname = url.hostname.toLowerCase();
        const firstParty = hostname === normalizedDomain ||
          (!hostOnly && hostname.endsWith("." + normalizedDomain));
        return { name, domain, firstParty, secure, httpOnly, sameSite };
      });
    // Do not show the previous page's cookies if navigation raced the read.
    const current = await chrome.tabs.get(tab.id);
    if (current.url !== tab.url) throw new Error("Page changed");
    const sameSiteLabels = { no_restriction: "None", lax: "Lax", strict: "Strict", unspecified: "Unspecified" };
    const fragment = document.createDocumentFragment();
    for (const cookie of cookies) {
      const item = document.createElement("li");
      const name = document.createElement("div");
      name.className = "domain";
      name.textContent = cookie.name || "(unnamed cookie)";
      const domain = document.createElement("div");
      domain.className = "meta";
      domain.textContent = cookie.domain + " · " + (cookie.firstParty ? "First-party" : "Third-party");
      const flags = document.createElement("div");
      flags.className = "meta";
      flags.textContent = `Secure: ${cookie.secure ? "Yes" : "No"} · HttpOnly: ${cookie.httpOnly ? "Yes" : "No"} · SameSite: ${sameSiteLabels[cookie.sameSite] || "Unspecified"}`;
      item.append(name, domain, flags);
      fragment.append(item);
    }
    if (!cookies.length) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "No matching cookies found.";
      fragment.append(empty);
    }
    list.replaceChildren(fragment);
    count.textContent = `— ${cookies.length} ${cookies.length === 1 ? "cookie" : "cookies"}`;
  } catch {
    // Never report raw API errors: a failure must remain local to this section.
    list.replaceChildren();
    count.textContent = "Cookie insights unavailable.";
  }
})();
