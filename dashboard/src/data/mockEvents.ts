import type { PrivacyEvent } from '../types';
// Fictional sample session, not findings about the listed services.
const start = new Date('2026-09-05T14:42:00').getTime();
const samples: Array<[string, PrivacyEvent['category'], PrivacyEvent['risk'], string]> = [
  ['doubleclick.net', 'Advertising', 'high', 'Could connect the pages you visit to an advertising profile of your interests.'],
  ['google-analytics.com', 'Analytics', 'low', 'Could reveal which pages you read, what you click, and how long you stay.'],
  ['connect.facebook.net', 'Identifiers', 'high', 'Could link activity on different websites to the same browser or account.'],
  ['geo.example.net', 'Location', 'medium', 'Could estimate your city or region from your internet connection.'],
  ['device.example.net', 'Device', 'medium', 'Could learn your browser, screen size, and operating system.'],
  ['fingerprint.example.net', 'Fingerprinting', 'high', 'Could combine device details to recognize your browser on later visits.'],
  ['ads.example.net', 'Advertising', 'high', 'Could use your browsing interests to choose the ads you see.'],
  ['metrics.example.net', 'Analytics', 'low', 'Could measure visits and the path you take through a website.'],
  ['identity.example.net', 'Identifiers', 'high', 'Could use a persistent identifier to connect separate visits.'],
  ['extensions.example.net', 'Extension Probing', 'medium', 'Could look for signs of installed browser extensions to distinguish your browser.'],
  ['beacon.example.net', 'Other', 'medium', 'Could share that your browser visited this page. Its exact purpose is unknown.'],
  ['audience.example.net', 'Advertising', 'high', 'Could group your visits into an audience based on inferred interests.'],
];
export const mockEvents: PrivacyEvent[] = samples.map(([domain, category, risk, explanation], index) => ({
  id: 'demo-' + (index + 1), timestamp: start + index * 47000,
  pageUrl: index < 6 ? 'https://daily.example.com/stories/a-slower-weekend' : 'https://shop.example.com/everyday-essentials',
  domain, category, risk, blocked: false, explanation,
}));
