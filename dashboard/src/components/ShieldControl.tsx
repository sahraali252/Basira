import { Shield, Check } from 'lucide-react';
export function ShieldControl({ enabled, onChange, compact = false }: {
  enabled: boolean; onChange: (value: boolean) => void; compact?: boolean;
}) {
  return <button className={'shield-control ' + (compact ? 'compact ' : '') + (enabled ? 'on' : '')}
    role="switch" aria-checked={enabled} aria-label={compact ? 'Header simulated Shield' : 'Simulated Shield protection'}
    onClick={() => onChange(!enabled)}>
    {!compact && <Shield size={18}/>}<span>Shield <strong>{enabled ? 'ON' : 'OFF'}</strong></span>
    <span className="switch-track"><span>{enabled && <Check size={13}/>}</span></span>
  </button>;
}

