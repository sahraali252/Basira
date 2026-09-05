# BASIRA dashboard

React + TypeScript + Vite. Everything in this folder is frontend-only.

## Run

Requires Node.js 20.19+ or 22.12+.
Run npm install, then npm run dev from this folder.
Use npm test for calculation tests, npm run build for production, and npm run preview to serve the build.

## Demo

The Digital Mirror places your browser inside a field of translucent tracker labels. Select a tracker to inspect it; toggle the floating Shield control to fade blocked connections and update the score. The visualization covers the whole sample session (two pages), with the latest sample site in the browser address bar.

Expand the editorial category list for plain-English explanations. Search/filter the oldest-first Time Machine event stream, expand requests, and continue through the full session. The before/after section marks the active simulated state. The fixed fictional session includes 12 third-party domains; Shield blocks 10 medium/high-risk requests, leaving two low-risk requests.

The layout adapts to small screens with a browser above branching tracker labels. Reduced-motion preferences disable transitions. Glass surfaces are limited to floating navigation, controls, tracker labels, filters, and contextual explanations.

For an optional browser smoke check, run node scripts/check-ui.mjs from this folder. It uses installed Chrome (or CHROME_PATH), temporary local ports 5197/9397, and writes screenshots/profile files under the ignored node_modules/.cache/basira-ui directory.

The illustrative score starts at 100 and subtracts 2/4/7 points for each allowed low/medium/high-risk event, clamped at zero. It is 38 without Shield and 96 with Shield. Exposure is the highest allowed event risk. This score is a demo heuristic, not a security assessment. Tracker counts are unique domains; blocked counts are requests. All mock examples and simulated protection are labeled in the UI.

## Extension handoff

- src/types.ts exports the agreed PrivacyEvent type unchanged.
- src/data/mockEvents.ts is the only sample-data source.
- Dashboard in src/App.tsx accepts events: PrivacyEvent[]. Replace the mockEvents passed by App with your extension-fed state array; updates rerender the UI.
- DigitalMirror and Timeline consume event props without fetching, storage, or extension dependencies.
- src/lib/privacy.ts owns summary calculations and the separate simulateShield demo policy.

When connecting real data, replace the demo Shield transform with actual events and wire the switch to the extension's real protection state. Supply actual baseline/protected sessions for the comparison and replace sample-session/demo copy. Do not treat simulated blocked values as real network outcomes. A data source and Shield state adapter will be needed; the event display components can stay.

No login, backend, database, analytics, external fonts, or AI services are used. UI state resets on refresh.
