import { useState, type CSSProperties } from 'react';
import { ArrowUpRight, LockKeyhole, X } from 'lucide-react';
import type { PrivacyEvent } from '../types';
import { summarize } from '../lib/privacy';

export function BrowserXRay({ events, shieldOn }: { events: PrivacyEvent[]; shieldOn: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const stats = summarize(events);
  const chosen = events.find(event => event.id === selected);
  const latest = [...events].sort((a, b) => b.timestamp - a.timestamp)[0];
  const sites = new Set(events.map(event => event.pageUrl)).size;
  let hostname = 'No sample page';
  try { if (latest) hostname = new URL(latest.pageUrl).hostname; } catch { hostname = 'Sample page'; }
  // Risk determines the side; domain-derived offsets keep positions stable
  // through Shield changes, without suggesting a measured geographic location.
  const highRisk = events.filter(event => event.risk === 'high');
  const otherRisk = events.filter(event => event.risk !== 'high');
  const rows = Math.max(6, highRisk.length, otherRisk.length);
  const height = Math.max(620, rows * 90 + 80);
  const position = (index: number) => {
    const event = events[index];
    const left = event.risk === 'high';
    const row = (left ? highRisk : otherRisk).findIndex(item => item.id === event.id);
    const hash = [...event.domain].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return { x: left ? 14 + hash % 8 : 77 + hash % 9, y: (left ? 45 : 76) + row * 90, left };
  };
  return (
    <div className={'xray ' + (shieldOn ? 'protected ' : '') + (chosen ? 'has-selection' : '')} style={{ '--map-height': height + 'px' } as CSSProperties} onKeyDown={event => { if (event.key === 'Escape') setSelected(null); }}>
      <div className="map-caption"><span>High-risk requests</span><span>{stats.detected} domains · {sites} sample pages</span><span>Medium- and low-risk requests</span></div>
      <div className="map-stage">
        <svg className="connections" viewBox={'0 0 1200 ' + height} preserveAspectRatio="none" aria-hidden="true">
          <rect className="boundary" x="390" y={height / 2 - 185} width="420" height="370" rx="70"/>
          {events.map((event, i) => {
            const { x, y, left } = position(i);
            return <path key={event.id} className={'connection ' + event.risk + (event.blocked ? ' severed' : '') + (selected === event.id ? ' highlighted' : '')}
              d={'M ' + x * 12 + ' ' + y + ' C ' + (left ? 400 : 800) + ' ' + y + ', ' + (left ? 340 : 860) + ' ' + height / 2 + ', ' + (event.blocked ? (left ? 385 : 815) : (left ? 445 : 755)) + ' ' + height / 2}/>;
          })}
        </svg>
        <div className="browser-object">
          <div className="browser-chrome"><span className="window-dots"><i/><i/><i/></span><LockKeyhole size={11}/><span>{hostname}</span></div>
          <div className="browser-content"><span className="eyebrow">Your browser</span><div className="score-number" key={stats.score}>{stats.score}<small>/100</small></div><span className="score-label">Privacy score</span>
            <div className="score-meter"><span style={{ width: stats.score + '%' }}/></div>
            <div className={'browser-exposure risk-' + stats.risk}><span className="signal-dot"/>{events.length ? stats.risk + ' exposure' : 'No activity yet'}</div>
          </div>
          <div className="browser-bottom">{shieldOn ? 'Shield on · simulated' : 'Shield off · connections open'}</div>
        </div>
        <div className="tracker-field">
          {events.map((event, i) => <button key={event.id}
            className={'tracker-node ' + event.risk + (event.blocked ? ' blocked' : '') + (selected === event.id ? ' selected' : '')}
            style={{ '--x': position(i).x + '%', '--y': position(i).y + 'px' } as CSSProperties}
            aria-expanded={selected === event.id} aria-controls={selected === event.id ? 'tracker-inspector' : undefined}
            aria-pressed={selected === event.id}
            onClick={() => setSelected(selected === event.id ? null : event.id)}>
            <span className="node-dot"/>
            <span className="node-copy"><strong>{event.domain}</strong><span>{event.category} <b>· {event.risk} risk</b></span></span>
            <span className="node-state">{event.blocked ? 'Blocked' : <ArrowUpRight size={14}/>}</span>
          </button>)}
        </div>
      </div>
      {chosen && <div className="tracker-inspector" id="tracker-inspector" role="region" aria-label="Selected tracker details" aria-live="polite"><div><span className="eyebrow">Selected request</span><h3>{chosen.domain}</h3><div className="inspector-facts"><span>{chosen.category}</span><span className={'risk-' + chosen.risk}>{chosen.risk} risk</span><strong className={chosen.blocked ? 'state-blocked' : ''}>{chosen.blocked ? 'Blocked · simulated Shield' : 'Allowed'}</strong></div><p>{chosen.explanation}</p><small>Sample page: {chosen.pageUrl}</small></div><button aria-label="Close tracker explanation" onClick={() => setSelected(null)}><X size={19}/></button></div>}
      <div className="map-legend"><span><i className="legend-line"/> Allowed connection <i className="legend-line broken"/> Blocked connection</span><span>Select any domain to inspect · Illustrative score, higher is better</span></div>
    </div>
  );
}
