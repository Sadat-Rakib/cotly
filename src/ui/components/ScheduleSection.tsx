import { memo, useState } from 'react';
import { epochToLocalInput, evenSlots, localToEpoch, spacedSlots } from '../time';
import { TimezoneSelect } from './TimezoneSelect';

export type ScheduleMode = 'now' | 'exact' | 'smart';

interface Props {
  defaultTz: string;
  mode: ScheduleMode;
  onModeChange: (m: ScheduleMode) => void;
  slots: number[]; // epoch seconds; exact mode holds one slot
  onSlotsChange: (s: number[]) => void;
  tz: string;
  onTzChange: (tz: string) => void;
}

const MAX_SLOTS = 50;

function nowPlus(hours: number, tz: string): string {
  return epochToLocalInput(Math.floor(Date.now() / 1000) + hours * 3600, tz);
}

export const ScheduleSection = memo(function ScheduleSection({ defaultTz, mode, onModeChange, slots, onSlotsChange, tz, onTzChange }: Props) {
  const [exactAt, setExactAt] = useState(() => nowPlus(1, defaultTz));
  const [variant, setVariant] = useState<'even' | 'spacing'>('even');
  const [count, setCount] = useState(4);
  const [startAt, setStartAt] = useState(() => nowPlus(2, defaultTz));
  const [endAt, setEndAt] = useState(() => nowPlus(8, defaultTz));
  const [intervalMin, setIntervalMin] = useState(90);
  const [err, setErr] = useState<string | null>(null);

  const setExact = (v: string) => {
    setExactAt(v);
    onSlotsChange(v ? [localToEpoch(v, tz)] : []);
  };

  const generate = () => {
    setErr(null);
    const list = variant === 'even'
      ? evenSlots(count, startAt, endAt, tz)
      : spacedSlots(count, startAt, intervalMin, tz);
    if (list.length === 0) {
      setErr('Could not build slots — check the start/end times.');
      return;
    }
    onSlotsChange(list.slice(0, MAX_SLOTS));
  };

  return (
    <section className="card">
      <h2>Schedule</h2>
      <div className="mode-row" role="radiogroup" aria-label="Schedule mode">
        {(['now', 'exact', 'smart'] as const).map((m) => (
          <label key={m} className={`mode-pill${mode === m ? ' mode-active' : ''}`}>
            <input
              type="radio"
              name="schedule-mode"
              value={m}
              checked={mode === m}
              onChange={() => onModeChange(m)}
            />
            {m === 'now' ? 'Publish now' : m === 'exact' ? 'Exact time' : 'Smart distribution'}
          </label>
        ))}
      </div>

      {mode === 'exact' && (
        <div className="field">
          <label className="label" htmlFor="exact-at">Publish at</label>
          <input
            id="exact-at"
            className="input"
            type="datetime-local"
            value={exactAt}
            onChange={(e) => setExact(e.target.value)}
          />
          <div className="field">
            <span className="label">Timezone</span>
            <TimezoneSelect value={tz} onChange={onTzChange} />
          </div>
        </div>
      )}

      {mode === 'smart' && (
        <div className="smart">
          <div className="mode-row" role="radiogroup" aria-label="Distribution variant">
            <label className={`mode-pill${variant === 'even' ? ' mode-active' : ''}`}>
              <input type="radio" name="smart-variant" checked={variant === 'even'} onChange={() => setVariant('even')} />
              Between start &amp; end
            </label>
            <label className={`mode-pill${variant === 'spacing' ? ' mode-active' : ''}`}>
              <input type="radio" name="smart-variant" checked={variant === 'spacing'} onChange={() => setVariant('spacing')} />
              Fixed spacing
            </label>
          </div>
          <div className="grid-2">
            <div className="field">
              <label className="label" htmlFor="smart-count">Number of posts</label>
              <input id="smart-count" className="input" type="number" min={1} max={MAX_SLOTS} value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(MAX_SLOTS, Number(e.target.value) || 1)))} />
            </div>
            <div className="field">
              <label className="label" htmlFor="smart-start">Start</label>
              <input id="smart-start" className="input" type="datetime-local" value={startAt}
                onChange={(e) => setStartAt(e.target.value)} />
            </div>
            {variant === 'even' ? (
              <div className="field">
                <label className="label" htmlFor="smart-end">End</label>
                <input id="smart-end" className="input" type="datetime-local" value={endAt}
                  onChange={(e) => setEndAt(e.target.value)} />
              </div>
            ) : (
              <div className="field">
                <label className="label" htmlFor="smart-interval">Interval (minutes)</label>
                <input id="smart-interval" className="input" type="number" min={5} step={5} value={intervalMin}
                  onChange={(e) => setIntervalMin(Math.max(1, Number(e.target.value) || 1))} />
              </div>
            )}
            <div className="field">
              <span className="label">Timezone</span>
              <TimezoneSelect value={tz} onChange={onTzChange} />
            </div>
          </div>
          <button type="button" className="btn" onClick={generate}>Generate slots</button>
          {err && <p className="error-text">{err}</p>}
        </div>
      )}

      {mode !== 'now' && slots.length > 0 && (
        <div className="slot-list">
          <span className="label">{slots.length} slot{slots.length === 1 ? '' : 's'} — editable</span>
          {slots.map((epoch, idx) => (
            <div key={`${epoch}-${idx}`} className="slot-row">
              <input
                className="input"
                type="datetime-local"
                value={epochToLocalInput(epoch, tz)}
                onChange={(e) => {
                  const next = [...slots];
                  next[idx] = localToEpoch(e.target.value, tz);
                  onSlotsChange(next);
                }}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Remove slot ${idx + 1}`}
                onClick={() => onSlotsChange(slots.filter((_, i) => i !== idx))}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
});
