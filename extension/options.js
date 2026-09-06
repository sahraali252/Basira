/* global UI */
let refreshVersion = 0;
async function refresh() {
  const version = ++refreshVersion;
  const { preferences, categories } = await UI.send("BASIRA_GET_STATE");
  if (version !== refreshVersion) return;
  document.querySelector("#global-shield").checked = preferences.shieldEnabled;
  document.querySelector("#show-low").checked = preferences.showLowRisk;
  if (document.activeElement.id !== "dashboard-url") document.querySelector("#dashboard-url").value = preferences.dashboardUrl;
  const categoryList = document.querySelector("#categories");
  categoryList.replaceChildren();
  categories.forEach(category => {
    const row = UI.text("label", category, "setting-row");
    const input = document.createElement("input");
    input.type = "checkbox"; input.setAttribute("role", "switch"); input.checked = preferences.categories[category];
    input.addEventListener("change", () => save(input, { categories: { [category]: input.checked } }));
    row.append(input); categoryList.append(row);
  });
  const sites = document.querySelector("#paused-sites");
  sites.replaceChildren();
  if (!preferences.pausedSites.length) sites.append(UI.text("li", "No paused websites.", "help"));
  preferences.pausedSites.forEach(hostname => {
    const row = document.createElement("li");
    const button = UI.text("button", "Resume");
    button.setAttribute("aria-label", "Resume protection on " + hostname);
    button.addEventListener("click", () => UI.action(button, async () => {
      const result = await UI.send("BASIRA_SET_SITE_PAUSE", { hostname, paused: false });
      await refresh();
      if (result.reloadFailed) UI.error("Preference saved. Reload matching tabs to apply it.");
    }));
    row.append(UI.text("span", hostname), button); sites.append(row);
  });
  document.querySelector("#revoke-cookies").disabled = !await chrome.permissions.contains({ permissions: ["cookies"] });
}
function save(control, patch) {
  return UI.action(control, async () => {
    try { await UI.send("BASIRA_UPDATE_SETTINGS", { patch }); }
    finally { await refresh(); }
  });
}
document.querySelector("#global-shield").addEventListener("change", event => UI.action(event.target, async () => {
  try { await UI.send("BASIRA_SET_SHIELD", { enabled: event.target.checked }); }
  finally { await refresh(); }
}));
document.querySelector("#show-low").addEventListener("change", event => save(event.target, { showLowRisk: event.target.checked }));
document.querySelector("#dashboard-form").addEventListener("submit", event => {
  event.preventDefault();
  save(event.submitter, { dashboardUrl: document.querySelector("#dashboard-url").value });
});
document.querySelector("#clear-data").addEventListener("click", event => UI.action(event.target, async () => {
  await UI.send("BASIRA_CLEAR_EVENTS");
  const notice = document.querySelector("#notice");
  notice.textContent = "Stored privacy activity cleared."; notice.hidden = false;
}));
document.querySelector("#revoke-cookies").addEventListener("click", event => UI.action(event.target, async () => {
  await chrome.permissions.remove({ permissions: ["cookies"] });
  await refresh();
}));
let timer;
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") { clearTimeout(timer); timer = setTimeout(() => refresh().catch(UI.error), 100); }
});
refresh().catch(UI.error);
