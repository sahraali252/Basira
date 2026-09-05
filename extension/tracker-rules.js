/*
 * Intentionally small, high-confidence MVP rule set. Each entry is used for
 * both event classification and an optional declarativeNetRequest block rule.
 */
const TRACKERS = [
  {
    domain: "google-analytics.com",
    category: "Analytics",
    risk: "medium",
    explanation: "Google Analytics was contacted to measure activity on this website."
  },
  {
    domain: "googletagmanager.com",
    category: "Analytics",
    risk: "medium",
    explanation: "Google Tag Manager was contacted; it is commonly used to load analytics and marketing tags."
  },
  {
    domain: "doubleclick.net",
    category: "Advertising",
    risk: "high",
    explanation: "DoubleClick was contacted for advertising or ad-measurement purposes."
  },
  {
    domain: "connect.facebook.net",
    category: "Advertising",
    risk: "high",
    explanation: "Meta's Facebook Connect service was contacted for advertising or tracking features."
  },
  {
    domain: "bat.bing.com",
    category: "Analytics",
    risk: "medium",
    explanation: "Microsoft Advertising's tracking service was contacted for conversion or audience measurement."
  },
  {
    domain: "hotjar.com",
    category: "Analytics",
    risk: "medium",
    explanation: "Hotjar was contacted to analyze how visitors use this website."
  }
];

function findTracker(hostname) {
  if (!hostname) return null;
  return TRACKERS.find((tracker) => hostname === tracker.domain || hostname.endsWith(`.${tracker.domain}`)) || null;
}
