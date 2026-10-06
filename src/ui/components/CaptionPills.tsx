import { memo, useEffect, useMemo, useState } from 'react';
import { CAPABILITIES } from '../../contracts/capabilities';
import { providerLabel, type Provider } from '../api';

export type CaptionPill = 'base' | Provider;

interface Props {
  baseCaption: string;
  onBaseChange: (v: string) => void;
  overrides: Record<string, string>;
  onOverrideChange: (p: Provider, v: string) => void;
  onClearOverride: (p: Provider) => void;
  selectedProviders: Provider[];
  disabled?: boolean;
}

const count = (s: string): number => [...s].length;

// One visible editor, independent text per platform. The pill switches which
// stored caption the editor shows; switching never discards text.
export const CaptionPills = memo(function CaptionPills({
  baseCaption,
  onBaseChange,
  overrides,
  onOverrideChange,
  onClearOverride,
  selectedProviders,
  disabled,
}: Props) {
  const [active, setActive] = useState<CaptionPill>('base');
  useEffect(() => {
    if (active !== 'base' && !selectedProviders.includes(active)) setActive('base');
  }, [selectedProviders, active]);

  const pills = useMemo<CaptionPill[]>(() => ['base', ...selectedProviders], [selectedProviders]);

  const value = active === 'base' ? baseCaption : (overrides[active] ?? baseCaption);
  const dirty = active !== 'base' && overrides[active] !== undefined && overrides[active] !== '';

  // Limits only for currently selected platforms — never a wall of counters.
  const limit = useMemo(() => {
    if (active === 'base') {
      let min = Number.POSITIVE_INFINITY;
      let tightest: Provider | null = null;
      for (const p of selectedProviders) {
        const cap = CAPABILITIES[p]?.maxCaptionChars;
        if (cap !== undefined && cap < min) {
          min = cap;
          tightest = p;
        }
      }
      return min === Number.POSITIVE_INFINITY ? null : { max: min, tightest };
    }
    const cap = CAPABILITIES[active]?.maxCaptionChars;
    return cap === undefined ? null : { max: cap, tightest: null as Provider | null };
  }, [active, selectedProviders]);

  const len = count(value);
  const over = limit !== null && len > limit.max;
  const near = !over && limit !== null && limit.max > 0 && len / limit.max >= 0.9;

  return (
    <div className="caption-pills">
      <div className="pill-row" role="tablist" aria-label="Caption per platform">
        {pills.map((p) => {
          const isBase = p === 'base';
          const label = isBase ? 'Base' : providerLabel(p);
          const dot = !isBase && overrides[p] !== undefined && overrides[p] !== '';
          return (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={active === p}
              className={`pill${active === p ? ' pill-active' : ''}`}
              onClick={() => setActive(p)}
            >
              {label}
              {dot && <span className="pill-dot" aria-label="customized">•</span>}
            </button>
          );
        })}
      </div>
      <textarea
        className={`textarea caption-input${over ? ' caption-over' : ''}`}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          if (active === 'base') onBaseChange(e.target.value);
          else onOverrideChange(active, e.target.value);
        }}
        placeholder={active === 'base' ? 'What are you posting today?' : `Caption for ${providerLabel(active as Provider)} (starts from Base)`}
        rows={5}
        role="tabpanel"
      />
      <div className="caption-foot">
        {limit !== null ? (
          <span className={`char-count${over ? ' over' : ''}${near ? ' near' : ''}`} aria-live="polite">
            {active === 'base' && limit.tightest
              ? `Base ${len}/${limit.max} (tightest: ${providerLabel(limit.tightest)})`
              : `${len}/${limit.max}`}
          </span>
        ) : (
          <span className="char-count">{len} chars</span>
        )}
        {dirty && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onClearOverride(active as Provider)}>
            Use base caption
          </button>
        )}
      </div>
      {over && limit !== null && (
        <p className="error-text" role="alert">
          {active === 'base'
            ? `This caption exceeds the tightest selected limit (${len} > ${limit.max}). Shorten it or trim a per-platform caption.`
            : `Your ${providerLabel(active as Provider)} caption exceeds the limit (${len} > ${limit.max}).`}
        </p>
      )}
    </div>
  );
});
