import { useState } from 'react';
import { ArrowDown, ArrowUpRight, Check, Plus, Search } from 'lucide-react';
import type { PrivacyEvent } from '../types';
export function Timeline({ events }: { events: PrivacyEvent[] }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const filtered = [...events].sort((a, b) => a.timestamp - b.timestamp).filter(event =>
    (event.domain + ' ' + event.category + ' ' + event.pageUrl).toLowerCase().includes(query.toLowerCase()) &&
    (status === 'all' || (status === 'blocked' ? event.blocked : !event.blocked)));
  const visible = showAll ? filtered : filtered.slice(0, 5);
  return <section className="timeline-section section-width" id="timeline">
    <div className="timeline-heading"><div><p className="eyebrow">Privacy Time Machine</p><h2>Behind the page.<br/><span>Moment by moment.</span></h2></div><p>Follow the requests in the order they happened.<br/>Your browsing session, with the invisible parts included.</p></div>
    <div className="timeline-tools"><span className="eyebrow">Oldest to newest · {events.length} requests</span><div className="filters">
      <label className="search"><Search size={15}/><input aria-label="Search privacy events" placeholder="Find a domain or category" value={query} onChange={e => { setQuery(e.target.value); setShowAll(false); }}/></label>
      <select aria-label="Filter request status" value={status} onChange={e => { setStatus(e.target.value); setShowAll(false); }}><option value="all">All requests</option><option value="allowed">Allowed</option><option value="blocked">Blocked</option></select>
    </div></div>
    <ol className="event-stream">{visible.map(event => <li key={event.id} className={'stream-event ' + (event.blocked ? 'blocked' : '')}>
      <time dateTime={new Date(event.timestamp).toISOString()}><span>{new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span><small>{new Date(event.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}</small></time>
      <span className="stream-dot">{event.blocked ? <Check size={13}/> : <ArrowUpRight size={13}/>}</span>
      <div className="stream-body"><button className="stream-trigger" onClick={() => setExpanded(expanded === event.id ? null : event.id)} aria-expanded={expanded === event.id} aria-controls={'event-' + event.id}>
        <span><span className="stream-verb">{event.blocked ? 'Shield stopped a request to' : 'Your browser reached out to'}</span><strong>{event.domain}</strong><span className="event-meta">{event.category}<span className={'risk-' + event.risk}>{event.risk} risk</span></span></span>
        <span className={'request-status ' + (event.blocked ? 'state-blocked' : '')}>{event.blocked ? 'Blocked' : 'Allowed'}</span><Plus size={17} className={expanded === event.id ? 'rotated' : ''}/>
      </button><div className="stream-explanation" id={'event-' + event.id} hidden={expanded !== event.id}><p>{event.explanation}</p><small>Sample page: {event.pageUrl}</small></div></div>
    </li>)}</ol>
    {!filtered.length && <p className="empty-state">No matching requests. Try another search or filter.</p>}
    <div className="stream-footer"><span>Showing {visible.length} of {filtered.length} sample requests</span>{filtered.length > 5 && <button onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer requests' : 'Continue through the session'}<ArrowDown size={15}/></button>}</div>
  </section>;
}
