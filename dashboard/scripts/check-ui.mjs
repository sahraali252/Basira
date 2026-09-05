// Dependency-free local browser smoke check. Requires Chrome or CHROME_PATH.
// Run from dashboard/: node scripts/check-ui.mjs
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const output = resolve('node_modules/.cache/basira-ui');
await mkdir(output, { recursive: true });
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5197', '--strictPort'], { windowsHide: true, stdio: 'ignore' });
const browser = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9397', '--user-data-dir=' + resolve(output, 'profile'), 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
let socket;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready(url) {
  for (let i = 0; i < 80; i++) {
    try { const response = await fetch(url); if (response.ok) return response; } catch {}
    await pause(150);
  }
  throw new Error('Timed out: ' + url);
}
try {
  await ready('http://127.0.0.1:5197');
  const targets = await (await ready('http://127.0.0.1:9397/json')).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let nextId = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    }
  });
  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  async function screenshot(name) {
    const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(resolve(output, name + '.png'), Buffer.from(data, 'base64'));
  }
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1150, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: 'http://127.0.0.1:5197' });
  for (let i = 0; i < 60; i++) {
    if (await evaluate("!!document.querySelector('.tracker-node')")) break;
    await pause(150);
  }
  assert.equal(await evaluate("document.querySelectorAll('.tracker-node').length"), 12);
  assert.equal(await evaluate("document.querySelector('.score-number').textContent"), '38/100');
  await pause(600);
  await screenshot('desktop-off');
  await evaluate("document.querySelector('.tracker-node').click()");
  await pause(650);
  assert.match(await evaluate("document.querySelector('.tracker-inspector').textContent"), /advertising profile/);
  assert.equal(await evaluate("document.querySelectorAll('.connection.highlighted').length"), 1);
  assert.equal(await evaluate("document.querySelectorAll('.tracker-node.selected').length"), 1);
  assert.ok(await evaluate("Number(getComputedStyle(document.querySelector('.tracker-node:not(.selected)')).opacity) < .5"));
  assert.ok(await evaluate("Number(getComputedStyle(document.querySelector('.connection:not(.highlighted)')).opacity) < .1"));
  assert.match(await evaluate("document.querySelector('.inspector-facts').textContent"), /Advertising.*high risk.*Allowed/);
  await screenshot('desktop-selected');
  await evaluate("document.querySelector('[aria-label=\"Close tracker explanation\"]').click(); document.querySelector('.shield-control').click()");
  await pause(700);
  assert.equal(await evaluate("document.querySelector('.score-number').textContent"), '96/100');
  assert.equal(await evaluate("document.querySelectorAll('.connection.severed').length"), 10);
  assert.equal(await evaluate("document.querySelectorAll('.tracker-node.blocked').length"), 10);
  assert.match(await evaluate("document.querySelector('.observation').textContent"), /10 requests blocked. 2 remain allowed/);
  assert.equal(await evaluate("document.querySelectorAll('[role=switch][aria-checked=true]').length"), 2);
  await evaluate("document.querySelector('.tracker-node.blocked').click()");
  await pause(650);
  assert.match(await evaluate("document.querySelector('.inspector-facts').textContent"), /Blocked/);
  assert.equal(await evaluate("document.querySelectorAll('.connection.highlighted.severed').length"), 1);
  await evaluate("document.querySelector('[aria-label=\"Close tracker explanation\"]').click()");
  await screenshot('desktop-on');
  await evaluate("document.querySelectorAll('.story-trigger')[1].click()");
  await pause(100);
  assert.equal(await evaluate("document.querySelectorAll('.story-trigger')[1].getAttribute('aria-expanded')"), 'true');
  assert.match(await evaluate("document.querySelector('#story-1').textContent"), /which pages you read/);
  await evaluate("document.querySelector('#mirror').scrollIntoView()");
  await pause(600);
  await screenshot('editorial');
  await evaluate("document.querySelector('#proof').scrollIntoView()");
  await pause(600);
  await screenshot('comparison');
  await evaluate("document.querySelector('#timeline').scrollIntoView()");
  await pause(600);
  await screenshot('timeline');
  await evaluate("const select = document.querySelector('select'); select.value = 'blocked'; select.dispatchEvent(new Event('change', {bubbles:true}));");
  await pause(100);
  assert.equal(await evaluate("document.querySelectorAll('.stream-event:not(.blocked)').length"), 0);
  await evaluate("document.querySelector('.stream-footer button').click()");
  await pause(100);
  assert.equal(await evaluate("document.querySelectorAll('.stream-event').length"), 10);
  await evaluate("document.querySelector('.stream-trigger').click()");
  await pause(100);
  assert.equal(await evaluate("document.querySelector('.stream-explanation').hidden"), false);
  await evaluate("const input = document.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'no-such-domain'); input.dispatchEvent(new Event('input',{bubbles:true}));");
  await pause(100);
  assert.equal(await evaluate("document.querySelectorAll('.stream-event').length"), 0);
  await evaluate("document.querySelector('.shield-control').click()");
  await pause(600);
  assert.equal(await evaluate("document.querySelector('.score-number').textContent"), '38/100');
  assert.equal(await evaluate("document.querySelectorAll('.connection.severed').length"), 0);
  await evaluate("document.querySelector('.shield-control').click(); window.scrollTo({top:0,behavior:'instant'})");
  await pause(600);
  for (const width of [1440, 900, 760, 390, 320]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await pause(100);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow at ' + width);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 1200, deviceScaleFactor: 1, mobile: false });
  await screenshot('mobile-on');
  assert.deepEqual(errors, []);
  console.log('UI checks passed: Shield, score, 12 trackers, 10 blocked connections, inspection, timeline expansion/filter/search, and five responsive widths.');
  console.log('Screenshots: ' + output);
} finally {
  socket?.close();
  browser.kill();
  vite.kill();
}
