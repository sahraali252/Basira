/* global UI */
const tabId = Number(new URLSearchParams(location.search).get("tab"));
async function refresh() {
  if (!Number.isInteger(tabId) || tabId <= 0) throw new Error("Open Cookie Insights from the BASIRA popup on a website.");
  const data = await UI.send("BASIRA_GET_COOKIES", { tabId });
  document.querySelector("#cookie-host").textContent = data.hostname;
  document.querySelector("#grant-cookies").hidden = !data.permissionRequired;
  const list = document.querySelector("#cookies");
  list.replaceChildren();
  document.querySelector("#cookie-count").textContent = data.permissionRequired ? "Cookie permission is optional and can be revoked in Settings." :
    data.cookies.length + " stored cookies · " + data.cookies.filter(cookie => cookie.thirdParty).length + " third-party · Read at " + new Date(data.observedAt).toLocaleTimeString();
  if (data.permissionRequired) return;
  if (!data.cookies.length) list.append(UI.text("p", "No accessible unpartitioned cookies matched this scope.", "help"));
  data.cookies.forEach(cookie => {
    const section = document.createElement("section");
    section.append(UI.text("h2", cookie.name || "(unnamed cookie)"), UI.text("p", cookie.domain, "cookie-domain"),
      UI.text("p", cookie.category + " · " + (cookie.thirdParty ? "Third-party" : "First-party"), "meta"),
      UI.text("p", cookie.explanation, "help"));
    const facts = document.createElement("dl");
    const entries = {
      "Expires": cookie.session ? "Session cookie" : cookie.expirationDate ? new Date(cookie.expirationDate * 1000).toLocaleString() : "Unavailable",
      "Secure": cookie.secure ? "Yes" : "No", "HttpOnly": cookie.httpOnly ? "Yes" : "No",
      "SameSite": cookie.sameSite, "Host only": cookie.hostOnly ? "Yes" : "No", "Path": cookie.path
    };
    for (const [label, value] of Object.entries(entries)) facts.append(UI.text("dt", label), UI.text("dd", value));
    section.append(facts); list.append(section);
  });
}
document.querySelector("#grant-cookies").addEventListener("click", event => UI.action(event.target, async () => {
  const granted = await chrome.permissions.request({ permissions: ["cookies"] });
  if (!granted) throw new Error("Cookie Insights remains off. No cookie permission was granted.");
  await refresh();
}));
document.querySelector("#refresh-cookies").addEventListener("click", event => UI.action(event.target, refresh));
chrome.permissions.onRemoved.addListener(() => refresh().catch(UI.error));
refresh().catch(UI.error);
