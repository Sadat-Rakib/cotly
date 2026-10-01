// Timezone helpers. All persisted timestamps are UTC epoch SECONDS (contract rule);
// conversion to/from wall-clock happens here, client-side, via Intl.

function zonedParts(date: Date, tz: string, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', ...opts });
  const out: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) out[p.type] = p.value;
  return out;
}

// Offset of tz from UTC (ms) at the given instant.
function tzOffsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const asUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour), Number(p.minute), Number(p.second),
  );
  return asUtc - date.getTime();
}

// Interpret a local 'YYYY-MM-DDTHH:mm[:ss]' wall-clock string in tz -> epoch seconds.
export function localToEpoch(local: string, tz: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return 0;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5]);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes to land on the correct offset across DST boundaries.
  let epoch = wall - tzOffsetMs(new Date(wall), tz);
  epoch = wall - tzOffsetMs(new Date(epoch), tz);
  return Math.floor(epoch / 1000);
}

// Epoch seconds -> 'YYYY-MM-DDTHH:mm' wall clock in tz (for datetime-local inputs).
export function epochToLocalInput(epochSec: number, tz: string): string {
  const p = zonedParts(new Date(epochSec * 1000), tz, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function fmtTime(epochSec: number, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(epochSec * 1000));
}

export function fmtDateTime(epochSec: number, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(epochSec * 1000));
}

export function fmtFullDateTime(epochSec: number, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(epochSec * 1000));
}

// Local calendar day key in tz: 'YYYY-MM-DD'.
export function dayKey(epochSec: number, tz: string): string {
  const p = zonedParts(new Date(epochSec * 1000), tz, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

// 'Today' / 'Tomorrow' / 'Mon, Oct 5' for a day key relative to now in tz.
export function dayLabel(key: string, tz: string): string {
  const now = Date.now() / 1000;
  if (key === dayKey(now, tz)) return 'Today';
  if (key === dayKey(now + 86400, tz)) return 'Tomorrow';
  const midday = localToEpoch(`${key}T12:00`, tz);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric',
  }).format(new Date(midday * 1000));
}

export function evenSlots(count: number, start: string, end: string, tz: string): number[] {
  const s = localToEpoch(start, tz);
  const e = localToEpoch(end, tz);
  if (count < 1 || e <= s) return [];
  if (count === 1) return [s];
  const step = (e - s) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(s + step * i));
}

export function spacedSlots(count: number, start: string, intervalMin: number, tz: string): number[] {
  const s = localToEpoch(start, tz);
  if (count < 1 || intervalMin <= 0) return [];
  return Array.from({ length: count }, (_, i) => s + i * Math.round(intervalMin * 60));
}
