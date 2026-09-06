# BASIRA Chrome extension MVP

This is a self-contained Manifest V3 extension. It observes browser requests locally, stores a maximum of 200 `PrivacyEvent` objects in `chrome.storage.local`, and optionally blocks a very small set of known analytics/advertising domains with `declarativeNetRequest`.

## Load it

Reload the unpacked extension after updating these files to register the options page and optional cookies permission.

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

### New controls and configuration

The three-dot popup menu opens Digital Mirror, pauses/resumes the current hostname, opens Settings, or clears activity. It supports arrow keys, Home/End, Escape, outside-click dismissal, and keyboard activation. Counts include all retained requests across sites; the list displays up to 30 matching requests. Expand a request to read its original explanation.

config.js defines DASHBOARD_URL, empty by default. Set it there or save an HTTP(S) URL in Settings → Digital Mirror. No production or development address is assumed. If unset, Open Digital Mirror opens the configuration section; if set, it opens that address in a new tab. This is navigation only: extension data is not automatically transferred to an external dashboard.

Global Shield retains its original storage key and message API. Advertising and Analytics switches filter the existing six blocking rules without changing their IDs or request types. Identifiers blocking is omitted because the rule list has no Identifier entries. Show low-risk activity is a persisted display filter only: detection, saved events, and counts are unchanged.

### Site pause

Paused hostnames are stored locally in basiraPreferences, independently of global Shield. Higher-priority allowAllRequests rules match top-level HTTP(S) navigation to the exact hostname on any port. example.com does not pause sub.example.com or another hostname. Detection continues.

Pause/resume reloads open tabs on that hostname so the frame rules apply consistently. Reload can reset unsaved page state; the popup explains the reload behavior next to the action. Global/category rule updates also reload already-open paused hosts when Shield is enabled. Preferences and rule updates are serialized; previous rules are restored if saving preferences fails.

Allow-rule debug matches are excluded from blocked-event rendering. The original event shape, detection listeners, event storage, and legacy Chrome message handlers remain in place.

Rule semantics: [Chrome declarativeNetRequest documentation](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest).

### Cookie Insights

The dedicated page requests the optional cookies permission only when the user clicks Enable Cookie Insights. Revoke it in Settings. The popup shows stored-cookie counts after permission is granted.

Inspection reads the current tab's cookie store and limits results to unpartitioned cookies matching the hostname or domains in its retained request history. It shows name, domain, path, session/expiration, Secure, HttpOnly, SameSite, host-only scope, and cautious classification. Cookie values are not returned to pages, displayed, or persisted. No cookies are modified or deleted.

This is a stored-cookie inventory, not proof of transmission or consent. The 200-event history can include earlier visits to the same hostname; unobserved related domains are not included. First/third-party uses the existing approximate site-domain helper, not a complete public suffix list. Partitioned cookies are excluded. Unknown cookies remain Other rather than being guessed Essential.

API scope: [Chrome cookies documentation](https://developer.chrome.com/docs/extensions/reference/api/cookies).

### Deferred work

- Consent/banner automation and before/after snapshots. TODO: add independent, bounded per-host snapshot counters and timestamps before comparing intervals; the rolling event log can otherwise undercount requests.
- Partitioned-cookie, localStorage, and IndexedDB inspection.
- Full public-suffix classification and Identifier rules.
- Automatically connecting external dashboard data.

### Automated checks

From the repository root, run:

- node --test extension/tests/extension.test.cjs
- node extension/tests/browser-check.cjs
- node --check extension/background.js
- git diff --check

Unit tests use Chrome API doubles for original rules, exact-host pause, detection preservation, persisted settings, failure rollback, navigation, and cookie scoping/value exclusion.

The browser check requires installed Chrome with CDP unpacked-extension support (or CHROME_PATH). It creates an isolated profile inside ignored extension/.test-artifacts/, loads the real extension, and tests real blocking against a local server. doubleclick.net resolves to loopback only inside that test browser; ports 5199 and 9399 must be available. It checks pause/resume isolation, menus, options, persisted settings, navigation, counts, Clear, the cookie permission screen, and popup layout. The profile is removed afterward; a screenshot remains. Granting cookie permission is a manual Chrome prompt; permitted metadata behavior is covered by unit tests.

### Existing event API

The service worker responds to these internal messages:

- `BASIRA_GET_EVENTS` → `{ events: PrivacyEvent[], shieldEnabled: boolean }`
- `BASIRA_SET_SHIELD` with `{ enabled: boolean }`
- `BASIRA_CLEAR_EVENTS`

An ordinary web dashboard cannot directly read extension storage because Chrome isolates extension origins. The simplest later integration is to make the dashboard an extension page (or have a content script/page use `chrome.runtime.sendMessage`) and call `BASIRA_GET_EVENTS`. No backend is needed.
