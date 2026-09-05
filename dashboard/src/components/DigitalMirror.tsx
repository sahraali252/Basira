import { Plus, Minus, ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import type { PrivacyEvent } from '../types';
const stories = {
  Advertising: 'Your interests and browsing habits', Analytics: 'Pages you visit and how you interact',
  Location: 'Your approximate city or region', Device: 'Your browser, screen, and operating system',
  Fingerprinting: 'Device details that could identify your browser', Identifiers: 'Activity that could connect separate visits',
  'Extension Probing': 'Signs of installed browser extensions', Other: 'Requests whose purpose is unknown',
};
export function DigitalMirror({ events }: { events: PrivacyEvent[] }) {
  const [selected, setSelected] = useState<PrivacyEvent['category'] | null>('Advertising');
  const categories = [...new Set(events.map(event => event.category))];
  return <section className="editorial section-width" id="mirror">
    <div className="section-intro"><p className="eyebrow">{categories.length} categories in this session</p><h2>What they could<br/>learn about you.</h2><p>Expand a category to read the explanations for its requests, including their risk and blocking status.</p><span className="annotation">Possible inferences, not confirmed collection. This is a fictional sample session.</span></div>
    <div className="story-list">{categories.map((category, index) => {
      const entries = events.filter(event => event.category === category);
      const open = selected === category;
      return <article className={'story ' + (open ? 'open' : '')} key={category}>
        <button className="story-trigger" onClick={() => setSelected(open ? null : category)} aria-expanded={open} aria-controls={'story-' + index}>
          <span className="story-number">{String(index + 1).padStart(2, '0')}</span>
          <span className="story-name"><strong>{category}</strong><small>{stories[category]}</small></span>
          <span className="signal-count">{entries.length} {entries.length === 1 ? 'signal' : 'signals'}</span>
          {open ? <Minus size={18}/> : <Plus size={18}/>}
        </button>
        <div id={'story-' + index} hidden={!open} className="story-details">{entries.map(event => <div key={event.id}>
          <p>{event.explanation}</p><span className="event-meta"><ArrowUpRight size={12}/>{event.domain}<span>{event.risk} risk</span><span className={event.blocked ? 'state-blocked' : ''}>{event.blocked ? 'Blocked' : 'Allowed'}</span></span>
        </div>)}</div>
      </article>;
    })}{!events.length && <p className="empty-state">No events yet. Your digital mirror will appear here.</p>}</div>
  </section>;
}
