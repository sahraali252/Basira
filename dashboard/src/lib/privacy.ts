import type { PrivacyEvent } from '../types';
const weights = { low: 2, medium: 4, high: 7 };
export function summarize(events: PrivacyEvent[]) {
  const allowed = events.filter(event => !event.blocked);
  const score = Math.max(0, 100 - allowed.reduce((total, event) => total + weights[event.risk], 0));
  const risk: PrivacyEvent['risk'] = allowed.some(event => event.risk === 'high') ? 'high' : allowed.some(event => event.risk === 'medium') ? 'medium' : 'low';
  return { score, risk, detected: new Set(events.map(event => event.domain)).size, active: new Set(allowed.map(event => event.domain)).size, blocked: events.filter(event => event.blocked).length };
}
// Demo-only policy. Preserve the input and any requests already blocked.
export function simulateShield(events: PrivacyEvent[], enabled: boolean): PrivacyEvent[] {
  return events.map(event => ({ ...event, blocked: event.blocked || (enabled && event.risk !== 'low') }));
}
