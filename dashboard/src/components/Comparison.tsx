import { ArrowRight, Check } from 'lucide-react';
import type { PrivacyEvent } from '../types';
import { summarize } from '../lib/privacy';
export function Comparison({ baseline, protectedEvents, enabled }: { baseline: PrivacyEvent[]; protectedEvents: PrivacyEvent[]; enabled: boolean }) {
  const before = summarize(baseline);
  const after = summarize(protectedEvents);
  const reduction = before.active ? Math.round((before.active - after.active) / before.active * 100) : 0;
  return <section className="proof-band" id="proof"><div className="section-width">
    <div className="proof-heading"><div><p className="eyebrow">Before and after simulated Shield</p><h2>{enabled ? 'Shield blocked' : 'Shield would block'} {after.blocked} of {protectedEvents.length}<br/>sample requests.</h2></div><span className="proof-mode">{enabled ? <Check size={15}/> : <ArrowRight size={15}/>} {enabled ? 'Protected state active' : 'Preview of simulated protection'}</span></div>
    <div className="proof-comparison">
      <div className={'proof-side ' + (!enabled ? 'current' : '')}><span className="eyebrow">Before Shield {!enabled && '· Current'}</span><p className="proof-number">{before.active}<span>trackers allowed</span></p><div className="proof-bars" aria-hidden="true">{Array.from({length: Math.min(before.detected, 40)}, (_, i) => <i key={i}/>)}</div><p className="proof-score">Privacy score <strong>{before.score}<small>/100</small></strong></p></div>
      <ArrowRight className="proof-arrow" size={36} strokeWidth={1}/>
      <div className={'proof-side after ' + (enabled ? 'current' : '')}><span className="eyebrow">After Shield {enabled && '· Current'}</span><p className="proof-number">{after.active}<span>trackers allowed <b>· {after.blocked} requests blocked</b></span></p><div className="proof-bars" aria-hidden="true">{Array.from({length: Math.min(before.detected, 40)}, (_, i) => <i className={i >= after.active ? 'cut' : ''} key={i}/>)}</div><p className="proof-score">Privacy score <strong>{after.score}<small>/100</small></strong></p></div>
    </div>
    <div className="proof-result"><strong>{reduction}% fewer allowed trackers. <span>+{after.score - before.score} privacy points.</span></strong><p>Simulated on the same sample events. Shield blocks medium- and high-risk requests.</p></div>
  </div></section>;
}
