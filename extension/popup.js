const elements = {
  toggle: document.querySelector("#shield-toggle"),
  status: document.querySelector("#shield-status"),
  detected: document.querySelector("#detected-count"),
  blocked: document.querySelector("#blocked-count"),
  list: document.querySelector("#event-list"),
  clear: document.querySelector("#clear-events")
};

function render({ events, shieldEnabled }) {
  elements.toggle.checked = shieldEnabled;
  elements.status.textContent = shieldEnabled ? "Shield ON" : "Shield OFF";
  elements.status.style.color = shieldEnabled ? "#047857" : "#b45309";
  elements.detected.textContent = events.length;
  elements.blocked.textContent = events.filter((event) => event.blocked).length;
  elements.list.replaceChildren();
  if (!events.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No third-party requests detected yet.";
    elements.list.append(empty);
    return;
  }
  events.slice(0, 30).forEach((event) => {
    const item = document.createElement("li");
    const domain = document.createElement("div");
    domain.className = "domain";
    domain.textContent = event.domain;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${event.category} · ${event.risk} risk${event.blocked ? " · BLOCKED" : ""}`;
    if (event.blocked) meta.classList.add("blocked");
    item.append(domain, meta);
    elements.list.append(item);
  });
}

function refresh() {
  chrome.runtime.sendMessage({ type: "BASIRA_GET_EVENTS" }, render);
}

elements.toggle.addEventListener("change", () => {
  elements.toggle.disabled = true;
  chrome.runtime.sendMessage({ type: "BASIRA_SET_SHIELD", enabled: elements.toggle.checked }, (response) => {
    elements.toggle.disabled = false;
    if (!response?.ok) {
      alert(`Could not update Shield: ${response?.error || "unknown error"}`);
    }
    refresh();
  });
});
elements.clear.addEventListener("click", () => chrome.runtime.sendMessage({ type: "BASIRA_CLEAR_EVENTS" }, refresh));
refresh();
