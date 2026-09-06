/* Shared by extension pages only. */
const UI = {
  async send(type, fields = {}) {
    const readOnly = ["BASIRA_GET_STATE", "BASIRA_GET_EVENTS", "BASIRA_GET_COOKIES"].includes(type);
    for (let attempt = 0; ; attempt++) {
      try {
        let response;
        try {
          response = await chrome.runtime.sendMessage({ type, ...fields });
        } catch (error) {
          error.transportFailure = true;
          throw error;
        }
        if (response?.ok === false) {
          const error = new Error(response.error || "Background rejected " + type);
          error.backgroundRejected = true;
          throw error;
        }
        if (!response) {
          const error = new Error("No background response for " + type);
          error.transportFailure = true;
          throw error;
        }
        return response;
      } catch (error) {
        console.warn("[BASIRA] " + type, error);
        // Never retry mutations: they may already have been applied.
        if (!readOnly || error.backgroundRejected || attempt >= 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
  },
  text(tag, value, className) {
    const node = document.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    return node;
  },
  error(error) {
    console.error("[BASIRA] Page action failed", error);
    const node = document.querySelector("#notice");
    node.textContent = error?.message || String(error);
    node.hidden = false;
  },
  async action(control, task) {
    control.disabled = true;
    try {
      document.querySelector("#notice").hidden = true;
      return await task();
    } catch (error) { UI.error(error); }
    finally { control.disabled = false; }
  }
};
