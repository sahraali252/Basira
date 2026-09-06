// Run from repository root: node extension/tests/browser-check.cjs
// Uses an isolated Chrome profile and a local test server. No real sites contacted.
const { spawn } = require("node:child_process");
const { resolve, sep } = require("node:path");
const fs = require("node:fs/promises");
const http = require("node:http");
const assert = require("node:assert/strict");
const root = resolve(__dirname, "..");
const output = resolve(root, ".test-artifacts");
const profile = resolve(output, "profile");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sockets = [];
const runtimeErrors = [];
const workerVersions = new Map();
const workerErrors = [];
async function connect(url) {
  const socket = new WebSocket(url);
  sockets.push(socket);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let next = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") runtimeErrors.push(message.params.exceptionDetails.text);
    if (message.method === "ServiceWorker.workerVersionUpdated") {
      for (const version of message.params.versions) workerVersions.set(version.versionId, version);
    }
    if (message.method === "ServiceWorker.workerErrorReported") workerErrors.push(message.params.errorMessage);
    const task = pending.get(message.id);
    if (task) { pending.delete(message.id); clearTimeout(task.timer); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); }
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Timed out: " + method)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function targets() { return (await fetch("http://127.0.0.1:9399/json")).json(); }
async function targetClient(id) {
  for (let i = 0; i < 60; i++) {
    const target = (await targets()).find(target => target.id === id);
    if (target?.webSocketDebuggerUrl) {
      const client = await connect(target.webSocketDebuggerUrl);
      await client("Runtime.enable");
      return client;
    }
    await pause(100);
  }
  throw new Error("Target unavailable " + id);
}
async function evaluate(client, expression) {
  const result = await client("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function until(client, expression) {
  for (let i = 0; i < 80; i++) { if (await evaluate(client, expression)) return; await pause(100); }
  throw new Error("Condition failed: " + expression);
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  let received = 0;
  const server = http.createServer((request, response) => {
    if (request.url.startsWith("/probe")) received++;
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Cache-Control", "no-store");
    response.end("<!doctype html><title>Local BASIRA check</title>Local extension test");
  });
  await new Promise(resolve => server.listen(5199, "0.0.0.0", resolve));
  const browser = spawn(process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--enable-unsafe-extension-debugging", "--remote-debugging-port=9399", "--user-data-dir=" + profile,
    "--no-proxy-server", "--host-resolver-rules=MAP doubleclick.net 127.0.0.1", "about:blank"
  ], { windowsHide: true, stdio: "ignore" });
  try {
    let version;
    for (let i = 0; i < 80; i++) { try { version = await (await fetch("http://127.0.0.1:9399/json/version")).json(); break; } catch {} await pause(100); }
    assert.ok(version, "Chrome startup");
    const browserClient = await connect(version.webSocketDebuggerUrl);
    const { id: extensionId } = await browserClient("Extensions.loadUnpacked", { path: root });
    console.log("Loaded real extension: " + extensionId);
    const base = "chrome-extension://" + extensionId + "/";
    const sample = await browserClient("Target.createTarget", { url: "http://localhost:5199/" });
    const site = await targetClient(sample.targetId);
    await until(site, "document.readyState === 'complete'");
    const popupTarget = await browserClient("Target.createTarget", { url: base + "popup.html", background: true });
    const popup = await targetClient(popupTarget.targetId);
    await browserClient("Target.activateTarget", { targetId: sample.targetId });
    await evaluate(popup, "chrome.tabs.query({url:'http://localhost:5199/'}).then(t => chrome.tabs.update(t[0].id,{active:true}))");
    // A toolbar popup opens after the website is active. Recreate that order
    // explicitly: CDP target creation can briefly activate the extension tab.
    await popup("Page.reload");
    await popup("Emulation.setDeviceMetricsOverride", { width: 350, height: 600, deviceScaleFactor: 1, mobile: false });
    await until(popup, "!!document.querySelector('#menu-toggle') && !document.querySelector('#shield-toggle').disabled");
    await evaluate(popup, "refresh()");
    await until(popup, "document.querySelector('#site-host').textContent === 'localhost'");
    const send = (type, fields = {}) => evaluate(popup, "UI.send(" + JSON.stringify(type) + "," + JSON.stringify(fields) + ")");
    await send("BASIRA_SET_SHIELD", { enabled: true });
    const rules = await evaluate(popup, "chrome.declarativeNetRequest.getDynamicRules()");
    assert.equal(rules.filter(rule => rule.action.type === "block").length, 6);
    const probe = () => evaluate(site, "fetch('http://doubleclick.net:5199/probe?' + Date.now(), {mode:'no-cors'}).then(()=>true,()=>false)");
    assert.equal(await probe(), false, "Known tracker blocked");
    await pause(300);
    const initial = await send("BASIRA_GET_EVENTS");
    assert.ok(initial.events.some(event => event.blocked && event.domain === "doubleclick.net"), "Real blocked event saved");
    const pauseResult = await send("BASIRA_SET_SITE_PAUSE", { hostname: "localhost", paused: true });
    assert.equal(pauseResult.preferences.shieldEnabled, true);
    await pause(500);
    await until(site, "document.readyState === 'complete'");
    assert.equal(await probe(), true, "Paused site's tracker allowed");
    assert.ok(received > 0, "Allowed request reached local server");
    await popup("Page.reload");
    await until(popup, "!!document.querySelector('#pause-site') && document.querySelector('#pause-site').textContent === 'Resume protection'");
    assert.equal((await send("BASIRA_GET_STATE")).preferences.shieldEnabled, true, "Pause persists after popup reopening");
    const other = await browserClient("Target.createTarget", { url: "http://127.0.0.1:5199/", background: true });
    const otherClient = await targetClient(other.targetId);
    await until(otherClient, "document.readyState === 'complete'");
    assert.equal(await evaluate(otherClient, "fetch('http://doubleclick.net:5199/probe?other', {mode:'no-cors'}).then(()=>true,()=>false)"), false, "Other hostname remains protected");
    await send("BASIRA_SET_SITE_PAUSE", { hostname: "localhost", paused: false });
    await pause(500);
    await until(site, "document.readyState === 'complete'");
    assert.equal(await probe(), false, "Resume blocks again");
    await send("BASIRA_SET_SHIELD", { enabled: false });
    assert.equal(await probe(), true, "Global OFF allows tracker");
    await send("BASIRA_SET_SHIELD", { enabled: true });
    await evaluate(popup, "refresh()");
    await pause(250);
    // Exercise the actual popup controls, not just their background messages.
    await evaluate(popup, "document.querySelector('#shield-toggle').click()");
    await until(popup, "document.querySelector('#shield-status').textContent === 'Shield OFF' && !document.querySelector('#shield-toggle').disabled");
    await evaluate(popup, "document.querySelector('#shield-toggle').click()");
    await until(popup, "document.querySelector('#shield-status').textContent === 'Shield ON' && !document.querySelector('#shield-toggle').disabled");
    await evaluate(popup, "document.querySelector('#pause-site').click()");
    await until(popup, "document.querySelector('#pause-site').textContent === 'Resume protection' && !document.querySelector('#pause-site').disabled");
    await evaluate(popup, "document.querySelector('#pause-site').click()");
    await until(popup, "document.querySelector('#pause-site').textContent === 'Pause on this site' && !document.querySelector('#pause-site').disabled");
    // Menu behavior uses real DOM events and keyboard navigation.
    await evaluate(popup, "document.querySelector('#menu-toggle').click()");
    assert.equal(await evaluate(popup, "document.querySelector('#action-menu').hidden"), false);
    await popup("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    assert.equal(await evaluate(popup, "document.querySelector('#action-menu').hidden"), true);
    await evaluate(popup, "document.querySelector('#menu-toggle').click(); document.body.click()");
    assert.equal(await evaluate(popup, "document.querySelector('#action-menu').hidden"), true);
    await evaluate(popup, "document.querySelector('#menu-toggle').click()");
    await popup("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown" });
    assert.equal(await evaluate(popup, "document.activeElement.id"), "menu-pause");
    await evaluate(popup, "document.querySelector('#menu-toggle').click()");
    await send("BASIRA_UPDATE_SETTINGS", { patch: { categories: { Advertising: false }, showLowRisk: false } });
    assert.ok((await evaluate(popup, "chrome.declarativeNetRequest.getDynamicRules()")).every(rule => ![1002,1003].includes(rule.id)));
    assert.equal((await send("BASIRA_GET_STATE")).preferences.showLowRisk, false);
    const optionsTarget = await browserClient("Target.createTarget", { url: base + "options.html", background: true });
    const options = await targetClient(optionsTarget.targetId);
    await until(options, "document.querySelectorAll('#categories input').length === 2");
    assert.equal(await evaluate(options, "document.querySelector('#show-low').checked"), false);
    await evaluate(options, "document.querySelector('#show-low').click()");
    await until(options, "document.querySelector('#show-low').checked && !document.querySelector('#show-low').disabled");
    await options("Page.reload");
    await until(options, "document.querySelectorAll('#categories input').length === 2");
    assert.equal(await evaluate(options, "document.querySelector('#show-low').checked"), true, "Setting persists after reload");
    await send("BASIRA_UPDATE_SETTINGS", { patch: { dashboardUrl: "http://localhost:5199/mirror" } });
    await evaluate(popup, "document.querySelector('#menu-toggle').click(); document.querySelector('[data-action=mirror]').click()");
    await pause(200);
    assert.ok((await targets()).some(target => target.url === "http://localhost:5199/mirror"));
    assert.equal(await evaluate(popup, "document.querySelector('#action-menu').hidden"), true);
    await evaluate(popup, "document.querySelector('#menu-toggle').click(); document.querySelector('[data-action=settings]').click()");
    await pause(200);
    assert.ok((await targets()).some(target => target.url === base + "options.html"));
    // Metadata only; permissions are tested without granting to the isolated profile.
    const tab = await evaluate(popup, "chrome.tabs.query({url:'http://localhost:5199/'}).then(t=>t[0])");
    assert.equal((await send("BASIRA_GET_COOKIES", { tabId: tab.id })).permissionRequired, true);
    const cookieTarget = await browserClient("Target.createTarget", { url: base + "cookies.html?tab=" + tab.id, background: true });
    const cookiePage = await targetClient(cookieTarget.targetId);
    await until(cookiePage, "document.querySelector('#cookie-host')?.textContent === 'localhost'");
    assert.equal(await evaluate(cookiePage, "document.querySelector('#grant-cookies').hidden"), false);
    await browserClient("Target.activateTarget", { targetId: sample.targetId });
    await send("BASIRA_UPDATE_SETTINGS", { patch: { showLowRisk: true } });
    // Seed only this isolated browser profile to exercise a full list and wrapping.
    await evaluate(popup, "chrome.storage.local.set({privacyEvents:Array.from({length:41},(_,i)=>({id:'test-'+i,timestamp:Date.now(),pageUrl:'http://localhost:5199/',domain:i===0?'a-very-long-third-party-domain-for-layout-testing.example.com':'tracker-'+i+'.example.com',category:'Analytics',risk:'low',blocked:i===0,explanation:'Test-only activity in an isolated profile.'}))})");
    await evaluate(popup, "refresh()");
    await until(popup, "document.querySelector('#detected-count').textContent === '41'");
    assert.equal(await evaluate(popup, "document.querySelector('#blocked-count').textContent"), "1");
    assert.equal(await evaluate(popup, "document.querySelectorAll('#event-list li').length"), 30);
    assert.ok(await evaluate(popup, "document.documentElement.scrollWidth <= 350"), "No horizontal overflow");
    const { data } = await popup("Page.captureScreenshot", { format: "png" });
    await fs.writeFile(resolve(output, "popup.png"), Buffer.from(data, "base64"));
    const popupHeight = await evaluate(popup, "document.documentElement.scrollHeight");
    assert.ok(popupHeight <= 600, "Fits popup height: " + popupHeight);
    // Regression: bursts share one read and keep existing DOM/focus intact.
    const stability = await evaluate(popup, `(async () => {
      await refresh();
      const row = document.querySelector('#event-list details');
      row.open = true;
      const summary = row.querySelector('summary'); summary.focus();
      const original = UI.send; let reads = 0; let cookies = 0;
      UI.send = async (type, fields) => {
        if (type === 'BASIRA_GET_STATE') { reads++; await new Promise(r => setTimeout(r, 40)); }
        if (type === 'BASIRA_GET_COOKIES') cookies++;
        return original(type, fields);
      };
      try {
        await Promise.all(Array.from({length: 30}, () => refresh()));
        await chrome.storage.local.set({unrelatedTestPreference: Date.now()});
        await new Promise(r => setTimeout(r, 200));
        return {reads, cookies, same: row === document.querySelector('#event-list details'), open: row.open,
          focus: document.activeElement === summary, notice: document.querySelector('#notice').hidden};
      } finally { UI.send = original; }
    })()`);
    assert.deepEqual(stability, {reads:1, cookies:0, same:true, open:true, focus:true, notice:true});
    // Continuous activity must update the UI without requesting background state.
    assert.equal(await evaluate(popup, `(async () => {
      const original = UI.send; let reads = 0;
      UI.send = async (...args) => { if (args[0] === 'BASIRA_GET_STATE') reads++; return original(...args); };
      try {
        for (let i = 0; i < 12; i++) {
          const saved = await chrome.storage.local.get('privacyEvents');
          saved.privacyEvents[0].timestamp++;
          await chrome.storage.local.set(saved);
          await new Promise(r => setTimeout(r, 25));
        }
        await new Promise(r => setTimeout(r, 150));
        return reads;
      } finally { UI.send = original; }
    })()`), 0);
    // A stale in-flight snapshot must not win over a newer storage notification.
    await evaluate(popup, `(async () => {
      const original = UI.send; let injected = false;
      UI.send = async (type, fields) => {
        const result = await original(type, fields);
        if (type === 'BASIRA_GET_STATE' && !injected) {
          injected = true;
          await chrome.storage.local.set({privacyEvents:result.events.map(e => ({...e, blocked:true}))});
          await new Promise(r => setTimeout(r, 150));
        }
        return result;
      };
      try { await refresh(); } finally { UI.send = original; }
    })()`);
    assert.equal(await evaluate(popup, "document.querySelector('#blocked-count').textContent"), "41");
    // A transient undefined response is retried without an error banner.
    assert.equal(await evaluate(popup, `(async () => {
      const original = chrome.runtime.sendMessage; let calls = 0;
      chrome.runtime.sendMessage = async (...args) => ++calls === 1 ? undefined : original(...args);
      try { await refresh(); return calls; } finally { chrome.runtime.sendMessage = original; }
    })()`), 2);
    for (let i = 0; i < 3; i++) {
      await popup('Page.reload');
      await until(popup, "!!document.querySelector('#shield-toggle') && !document.querySelector('#shield-toggle').disabled");
      assert.equal(await evaluate(popup, "document.querySelector('#detected-count').textContent"), '41');
    }
    await evaluate(popup, "document.querySelector('#clear-events').click()");
    await until(popup, "document.querySelector('#detected-count').textContent === '0'");
    assert.equal(await evaluate(popup, "document.querySelector('#blocked-count').textContent"), "0");
    assert.ok(await evaluate(popup, "document.querySelector('#notice').hidden"), "No popup error");
    // Close previous UI pages so their queued storage refreshes cannot wake the worker.
    const driverTarget = await browserClient("Target.createTarget", {url:base + "tests/runtime-driver.html", background:true});
    const driver = await targetClient(driverTarget.targetId);
    await until(driver, "document.readyState === 'complete'");
    for (const target of await targets()) {
      if (target.type === 'page' && target.url.startsWith(base) && target.id !== driverTarget.targetId)
        await browserClient("Target.closeTarget", {targetId:target.id});
    }
    await pause(1000);
    // Real action popup: no synthetic viewport and no popup-as-tab lifecycle.
    await browserClient("Target.activateTarget", {targetId: sample.targetId});
    await site("ServiceWorker.enable");
    await pause(300);

    for (let cycle = 0; cycle < 3; cycle++) {
      console.log("Testing toolbar wake cycle", cycle + 1);
      await browserClient("Target.activateTarget", {targetId: sample.targetId});
      const worker = [...workerVersions.values()].find(v => v.scriptURL === base + "background.js" && v.runningStatus === "running");
      assert.ok(worker, "Extension worker found before stop");
      await site("ServiceWorker.stopWorker", {versionId: worker.versionId});
      for (let i = 0; i < 50 && workerVersions.get(worker.versionId)?.runningStatus !== "stopped"; i++) await pause(100);
      assert.equal(workerVersions.get(worker.versionId).runningStatus, "stopped");
      const previousTargets = new Set((await targets()).map(t => t.id));
      await evaluate(driver, "chrome.action.openPopup()");
      let actionTarget;
      for (let i = 0; i < 50; i++) {
        actionTarget = (await targets()).find(t => t.url === base + "popup.html" && !previousTargets.has(t.id));
        if (actionTarget) break;
        await pause(100);
      }
      assert.ok(actionTarget, "Actual action popup created");
      const action = await targetClient(actionTarget.id);
      await until(action, "!!document.querySelector('#shield-toggle') && !document.querySelector('#shield-toggle').disabled");
      assert.equal(await evaluate(action, "chrome.runtime.sendMessage({type:'BASIRA_GET_STATE'}).then(r => r.ok)"), true);
      await until(action, "innerWidth === 350 && innerHeight === 500");
      const size = await evaluate(action, "[innerWidth,innerHeight]");
      assert.deepEqual(size, [350,500], "Native popup viewport");
      // Disconnect a read after content exists. Its last UI remains visible.
      await evaluate(action, `(async () => {
        const original = UI.send;
        const before = document.querySelector('main').innerHTML;
        UI.send = async () => { const error = new Error('Test-only disconnected worker'); error.transportFailure = true; throw error; };
        try {
          await refresh();
          if (document.querySelector('main').innerHTML !== before) throw new Error('Transient read changed rendered UI');
        } finally { UI.send = original; }
        await refresh();
      })()`);
      await evaluate(action, "UI.error(new Error('Test-only persistent error'))");
      await pause(150);
      assert.deepEqual(await evaluate(action, "[innerWidth,innerHeight]"), size, "Error cannot resize popup");
      await evaluate(action, "setTimeout(() => window.close(), 0)");
      for (let i = 0; i < 50 && (await targets()).some(t => t.id === actionTarget.id); i++) await pause(100);
      assert.ok(!(await targets()).some(t => t.id === actionTarget.id), "Toolbar popup closed");
      await pause(200);
    }
    console.log("Waiting for natural worker idle (35 seconds)...");
    await pause(35000);
    const idleWorker = [...workerVersions.values()].find(v => v.scriptURL === base + "background.js");
    assert.equal(idleWorker.runningStatus, "stopped", "Worker suspends naturally with popup closed");
    const beforeIdleOpen = new Set((await targets()).map(t => t.id));
    await browserClient("Target.activateTarget", {targetId:sample.targetId});
    await evaluate(driver, "chrome.action.openPopup()");
    let idleActionTarget;
    for (let i = 0; i < 50; i++) {
      idleActionTarget = (await targets()).find(t => t.url === base + "popup.html" && !beforeIdleOpen.has(t.id));
      if (idleActionTarget) break;
      await pause(100);
    }
    assert.ok(idleActionTarget, "Toolbar popup opens after natural idle");
    const idleAction = await targetClient(idleActionTarget.id);
    await until(idleAction, "!!document.querySelector('#shield-toggle') && !document.querySelector('#shield-toggle').disabled");
    assert.equal(await evaluate(idleAction, "chrome.runtime.sendMessage({type:'BASIRA_GET_STATE'}).then(r => r.ok)"), true);
    assert.equal(await evaluate(idleAction, "document.querySelector('#notice').hidden"), true);
    await evaluate(idleAction, "setTimeout(() => window.close(),0)");
    console.log("PASS: natural idle suspension and immediate toolbar-popup wake response.");
    assert.deepEqual(workerErrors, [], "No service-worker errors during wake cycles");
    console.log("PASS: three stopped-worker wakes using actual chrome.action.openPopup; stable native dimensions.");
    assert.deepEqual(runtimeErrors, [], "No uncaught browser JavaScript exceptions");
    console.log("PASS: real extension load; actual blocking; exact-host pause/resume; detection; another hostname protected; global Shield; menu/outside/Escape/keyboard; settings; Mirror tab; optional cookie permission; counts; Clear; 350x600 layout.");
  } finally {
    sockets.forEach(socket => socket.close());
    browser.kill();
    server.close();
    await pause(700);
    if (profile.startsWith(root + sep)) await fs.rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 300 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
