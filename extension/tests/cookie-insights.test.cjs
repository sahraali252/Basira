const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const script = fs.readFileSync(path.join(__dirname, "..", "cookie-insights.js"), "utf8");

class Node {
  constructor() { this.children = []; this.textContent = ""; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
}
async function read(options = {}) {
  const count = new Node(), list = new Node();
  const query = [];
  const tab = { id: 4, url: options.url || "https://shop.example.com/cart" };
  const cookies = options.cookies || [];
  const forbidden = () => { throw new Error("Unexpected mutation or log"); };
  const context = {
    URL,
    document: {
      querySelector: id => id === "#cookie-count" ? count : list,
      createElement: () => new Node(), createDocumentFragment: () => new Node()
    },
    console: { log: forbidden, warn: forbidden, error: forbidden },
    chrome: {
      tabs: { query: async () => [tab], get: async () => ({ ...tab, url: options.changedUrl || tab.url }) },
      cookies: {
        getAllCookieStores: async () => options.noStore ? [] : [{ id: "private", tabIds: [4] }],
        getAll: async filter => { query.push(filter); if (options.fail) throw new Error("PRIVATE_API_ERROR"); return cookies; },
        set: forbidden, remove: forbidden
      },
      storage: { local: { set: forbidden }, session: { set: forbidden } },
      runtime: { sendMessage: forbidden }
    }
  };
  await vm.runInNewContext(script, context);
  return { count: count.textContent, content: JSON.stringify(list), query };
}
test("reads the active URL's store and displays only metadata", async () => {
  const cookie = { name: "session", domain: ".example.com", hostOnly: false, secure: true, httpOnly: true, sameSite: "lax" };
  Object.defineProperty(cookie, "value", { get() { throw new Error("Cookie value accessed"); } });
  const result = await read({ cookies: [cookie] });
  assert.equal(result.count, "— 1 cookie");
  assert.equal(result.query[0].url, "https://shop.example.com/cart");
  assert.equal(result.query[0].storeId, "private");
  for (const text of ["session", ".example.com", "First-party", "Secure: Yes", "HttpOnly: Yes", "SameSite: Lax"]) assert.ok(result.content.includes(text));
});
test("uses exact or dot-boundary parent matching, respecting host-only cookies", async () => {
  for (const [domain, hostOnly, party] of [
    ["shop.example.com", true, "First-party"], [".example.com", false, "First-party"],
    ["example.com", true, "Third-party"], ["ample.com", false, "Third-party"],
    ["other.example.com", false, "Third-party"]
  ]) {
    const result = await read({ cookies: [{ name: "test", domain, hostOnly, secure: false, httpOnly: false, sameSite: "no_restriction" }] });
    assert.ok(result.content.includes(party), domain);
    assert.ok(result.content.includes("SameSite: None"));
  }
});
test("empty results and partition exclusion are explicit", async () => {
  const result = await read({ cookies: [{ name: "not-this-scope", partitionKey: { topLevelSite: "https://other.test" } }] });
  assert.equal(result.count, "— 0 cookies");
  assert.ok(result.content.includes("No matching cookies found."));
  assert.ok(!result.content.includes("not-this-scope"));
});
test("errors, unsupported pages and navigation races stay within Cookie Insights", async () => {
  for (const options of [{ fail: true }, { noStore: true }, { url: "chrome://settings" }, { changedUrl: "https://other.test" }]) {
    const result = await read(options);
    assert.equal(result.count, "Cookie insights unavailable.");
    assert.ok(!result.content.includes("PRIVATE_API_ERROR"));
  }
});
