# BASIRA Chrome extension MVP

This is a self-contained Manifest V3 extension. It observes browser requests locally, stores a maximum of 200 `PrivacyEvent` objects in `chrome.storage.local`, and optionally blocks a very small set of known analytics/advertising domains with `declarativeNetRequest`.

## Load it

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this `extension` folder.
4. Pin **BASIRA Privacy Shield** from Chrome's extensions menu.

## Test it

1. Leave Shield off and visit a site with third-party resources, for example a news site. Open the BASIRA popup to see detected events.
2. To test a predictable tracker request, open DevTools on any normal web page and run:
   ```js
   new Image().src = 'https://www.google-analytics.com/g/collect?v=2&tid=G-TEST123&cid=123.456&en=page_view&z=' + Date.now()
   ```
3. Open the popup: with Shield off, an Analytics event for `google-analytics.com` should appear without **BLOCKED**.
4. Turn Shield on, reload the page, then run the same command again. The browser request is blocked by a dynamic declarativeNetRequest rule and the corresponding event should be marked **BLOCKED**. Chrome DevTools Network commonly shows `(blocked:other)`.
5. Use **Clear** before each pass if you want a clean before/after count.

## Dashboard handoff

The service worker responds to these internal messages:

- `BASIRA_GET_EVENTS` → `{ events: PrivacyEvent[], shieldEnabled: boolean }`
- `BASIRA_SET_SHIELD` with `{ enabled: boolean }`
- `BASIRA_CLEAR_EVENTS`

An ordinary web dashboard cannot directly read extension storage because Chrome isolates extension origins. The simplest later integration is to make the dashboard an extension page (or have a content script/page use `chrome.runtime.sendMessage`) and call `BASIRA_GET_EVENTS`. No backend is needed.
