import { memo, useMemo, useState } from 'react';

interface Props {
  id?: string;
  value: string;
  onChange: (tz: string) => void;
}

let cachedZones: string[] | null = null;

function timeZones(): string[] {
  if (cachedZones) return cachedZones;
  try {
    cachedZones = Intl.supportedValuesOf('timeZone');
  } catch {
    cachedZones = ['UTC', Intl.DateTimeFormat().resolvedOptions().timeZone];
  }
  return cachedZones;
}

export const TimezoneSelect = memo(function TimezoneSelect({ id, value, onChange }: Props) {
  const [filter, setFilter] = useState('');
  const zones = useMemo(() => {
    const all = timeZones();
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!filter) {
      // Local zone first for quick access.
      return [local, ...all.filter((z) => z !== local)];
    }
    const q = filter.toLowerCase();
    return all.filter((z) => z.toLowerCase().includes(q)).slice(0, 400);
  }, [filter]);

  return (
    <div className="tzselect">
      <input
        className="input tz-filter"
        type="search"
        placeholder="Filter timezones…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="Filter timezones"
      />
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)} size={1}>
        {zones.includes(value) ? null : <option value={value}>{value}</option>}
        {zones.map((z) => (
          <option key={z} value={z}>{z}</option>
        ))}
      </select>
    </div>
  );
});
