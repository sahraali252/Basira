import { useState } from 'react';
import { Eye } from 'lucide-react';
import { mockEvents } from './data/mockEvents';
import { simulateShield, summarize } from './lib/privacy';
import type { PrivacyEvent } from './types';
import { BrowserXRay } from './components/BrowserXRay';
import { ShieldControl } from './components/ShieldControl';
import { DigitalMirror } from './components/DigitalMirror';
import { Timeline } from './components/Timeline';
import { Comparison } from './components/Comparison';

export function Dashboard({ events }: { events: PrivacyEvent[] }) {
  const [shieldOn, setShieldOn] = useState(false);
  const current = simulateShield(events, shieldOn);
  const stats = summarize(current);
  return (
    <div className={shieldOn ? 'inspection shield-enabled' : 'inspection'}>
      <header className="site-header">
        <a href="#xray" className="brand"><Eye size={27} strokeWidth={1.4}/> BASIRA</a>
        <nav aria-label="Page sections"><a href="#xray">Digital Mirror</a><a href="#timeline">Time Machine</a></nav>
        <ShieldControl enabled={shieldOn} onChange={setShieldOn} compact/>
      </header>
      <main>
        <section className="hero section-width" id="xray">
          <div className="hero-intro">
            <div><p className="eyebrow">Your digital mirror <span className="demo-label">Sample session</span></p>
              <h1>See what the internet sees about you.</h1>
            </div>
          </div>
          <div className="observation" aria-live="polite">
            <p>{shieldOn ? <><strong>{stats.blocked}</strong> requests blocked. <strong>{current.length - stats.blocked}</strong> remain allowed.</> : <><strong>{stats.active}</strong> {stats.active === 1 ? 'third party can' : 'third parties can'} observe this sample session.</>}</p>
            <span>{shieldOn ? 'Medium- and high-risk requests are blocked in this simulation.' : current.length + ' sample requests. Select a domain to inspect what it could reveal.'}</span>
          </div>
          <div className="shield-console" id="shield">
            <ShieldControl enabled={shieldOn} onChange={setShieldOn}/>
            <p>Simulated protection · Extension not connected</p>
          </div>
          <BrowserXRay events={current} shieldOn={shieldOn}/>
        </section>
        <DigitalMirror events={current}/>
        <Comparison baseline={events} protectedEvents={simulateShield(events, true)} enabled={shieldOn}/>
        <Timeline events={current}/>
      </main>
      <footer className="section-width"><a href="#xray" className="brand"><Eye size={22}/> BASIRA</a><span>Sample data · No browsing data collected</span><span>Built for MuslimHacks · Frontend demo</span></footer>
    </div>
  );
}
export default function App() { return <Dashboard events={mockEvents}/>; }
