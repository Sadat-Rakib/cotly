import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ApiError,
  api,
  providerLabel,
  type Account,
  type Me,
  type PostTargetInput,
  type Provider,
} from '../api';
import { CAPABILITIES } from '../../contracts/capabilities';
import { MediaPicker, type MediaItem } from '../components/MediaPicker';
import { ScheduleSection, type ScheduleMode } from '../components/ScheduleSection';
import { ReviewScreen, type ReviewDraft } from '../components/ReviewScreen';
import { WelcomePanel } from '../components/WelcomePanel';
import { StatusBadge } from '../components/Badge';
import { useToast } from '../components/Toasts';
import type { SetupStatus } from '../setupStatus';

interface Props {
  me: Me;
  navigate: (p: string) => void;
}

export function ComposePage({ me, navigate }: Props) {
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [caption, setCaption] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mode, setMode] = useState<ScheduleMode>('now');
  const [slots, setSlots] = useState<number[]>([]);
  const [tz, setTz] = useState(me.timezone);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [noAccounts, setNoAccounts] = useState(false);
  const overrideDetails = useRef(new Map<Provider, HTMLDetailsElement>());

  useEffect(() => {
    let alive = true;
    api<Account[]>('/api/accounts')
      .then((rows) => {
        if (!alive) return;
        const connected = rows.filter((a) => a.status !== 'disabled');
        setAccounts(rows);
        setSelection(Object.fromEntries(connected.map((a) => [a.id, a.status === 'connected'])));
      })
      .catch((e) => { if (alive) setErr(e instanceof ApiError ? e.message : 'Could not load accounts'); })
      .finally(() => { if (alive) setLoaded(true); });
    // Onboarding gate comes from the setup status source of truth.
    api<SetupStatus>('/api/setup/status')
      .then((s) => { if (alive) setNoAccounts(s.accounts.length === 0); })
      .catch(() => { /* onboarding panel is optional — skip silently */ });
    return () => { alive = false; };
  }, []);

  const selected = useMemo(() => accounts.filter((a) => selection[a.id]), [accounts, selection]);
  const selectedProviders = useMemo(() => [...new Set(selected.map((a) => a.provider))], [selected]);
  const uploading = media.some((m) => m.status === 'uploading');
  const failedMedia = media.some((m) => m.status === 'error');
  const readyMediaIds = media.filter((m) => m.status === 'ready' && m.mediaId).map((m) => m.mediaId);

  // Effective caption per provider = non-empty override ?? base caption.
  const effective = (p: Provider): string => {
    const ov = overrides[p];
    return ov !== undefined && ov.trim() !== '' ? ov : caption;
  };

  const videoWarnings = useMemo(() => {
    const warns: string[] = [];
    for (const item of media) {
      if (!item.mime.startsWith('video/')) continue;
      const mb = item.size / (1024 * 1024);
      for (const p of selectedProviders) {
        const cap = CAPABILITIES[p];
        if (!cap) continue;
        if (!cap.video) warns.push(`${providerLabel(p)} does not support video (${item.filename}).`);
        else if (mb > cap.maxVideoMB) {
          warns.push(`${item.filename} is ${mb.toFixed(0)} MB — over the ${providerLabel(p)} limit of ${cap.maxVideoMB} MB.`);
        }
      }
    }
    return [...new Set(warns)];
  }, [media, selectedProviders]);

  // Caption overflow per selected platform — surfaced, never truncated.
  const overflowProviders = useMemo(() => selectedProviders.filter((p) => {
    const cap = CAPABILITIES[p];
    return cap ? [...effective(p)].length > cap.maxCaptionChars : false;
  }), [selectedProviders, overrides, caption]);

  const openOverride = (p: Provider, open: boolean) => {
    if (open && overrides[p] === undefined) {
      setOverrides((prev) => ({ ...prev, [p]: caption }));
    }
  };

  // "Edit" on an overflow warning: open that platform's override and focus it.
  const editOverride = (p: Provider) => {
    setOverrides((prev) => (prev[p] === undefined ? { ...prev, [p]: caption } : prev));
    const det = overrideDetails.current.get(p);
    if (det) {
      det.open = true;
      const ta = det.querySelector('textarea');
      if (ta) ta.focus();
      det.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

  // Entry to the mandatory review step — nothing is POSTed here.
  const beginReview = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setFieldErrors({});
    setSuccess(null);
    if (selected.length === 0) { setErr('Pick at least one destination account.'); return; }
    if (uploading) { setErr('Hang on — media is still uploading.'); return; }
    if (failedMedia) { setErr('A media item failed to upload — remove it or try again before reviewing.'); return; }
    if (mode !== 'now' && slots.length === 0) { setErr('No scheduled times — generate or set the slots first.'); return; }
    setReviewing(true);
    window.scrollTo(0, 0);
  };

  // The only place POST /api/posts happens — after an explicit confirm click.
  const confirmSend = async () => {
    setErr(null);
    setFieldErrors({});
    const targets: PostTargetInput[] = selected.map((a) => {
      const ov = overrides[a.provider];
      return ov !== undefined && ov.trim() !== '' ? { accountId: a.id, captionOverride: ov } : { accountId: a.id };
    });
    const run: (number | null)[] = mode === 'now' ? [null] : slots; // 'now' -> single slotless post
    setBusy(true);
    let ok = 0;
    try {
      for (const slot of run) {
        await api('/api/posts', {
          method: 'POST',
          body: slot === null
            ? { baseCaption: caption, mediaIds: readyMediaIds, targets, mode: 'now' }
            : { baseCaption: caption, mediaIds: readyMediaIds, targets, mode: 'scheduled', scheduledAt: slot, timezone: tz },
        });
        ok += 1;
      }
      const msg = ok === 1 ? (mode === 'now' ? 'Post published.' : 'Post scheduled.') : `${ok} posts scheduled.`;
      setSuccess(msg);
      toast('ok', msg);
      setReviewing(false);
      setCaption('');
      setOverrides({});
      setSelection({});
      setMedia([]);
      setSlots([]);
      setMode('now');
    } catch (ex) {
      if (ex instanceof ApiError) {
        setErr(ex.message);
        if (ex.fieldErrors) setFieldErrors(ex.fieldErrors);
      } else {
        setErr('Could not create the post.');
      }
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo(() => {
    const g = new Map<Provider, Account[]>();
    for (const a of accounts) {
      const list = g.get(a.provider) ?? [];
      list.push(a);
      g.set(a.provider, list);
    }
    return [...g.entries()];
  }, [accounts]);

  const draft: ReviewDraft = {
    destinations: selected,
    caption,
    overrides,
    media,
    mode,
    slots,
    tz,
  };

  return (
    <form className="compose" onSubmit={beginReview}>
      {!reviewing && <h1>Compose</h1>}

      {noAccounts && !reviewing && <WelcomePanel navigate={navigate} />}

      {success && (
        <div className="banner banner-ok" role="status">
          <span>{success}</span>
          <button type="button" className="btn btn-sm" onClick={() => navigate('/app/queue')}>View queue</button>
        </div>
      )}

      {!reviewing ? (
        <>
          <section className="card" id="compose-media">
            <h2>Media</h2>
            <MediaPicker items={media} setItems={setMedia} />
            {videoWarnings.length > 0 && (
              <ul className="warn-list">
                {videoWarnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
          </section>

          <section className="card">
            <h2>Caption</h2>
            <textarea
              className="textarea caption-input"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="What are you posting today?"
              rows={5}
            />
            {selectedProviders.length > 0 && (
              <div className="char-chips">
                {selectedProviders.map((p) => {
                  const cap = CAPABILITIES[p];
                  const len = [...effective(p)].length;
                  const over = cap ? len > cap.maxCaptionChars : false;
                  return (
                    <span key={p} className={`char-chip${over ? ' over' : ''}`}>
                      {providerLabel(p)} {len}/{cap ? cap.maxCaptionChars : '?'}
                    </span>
                  );
                })}
              </div>
            )}
            {overflowProviders.map((p) => {
              const cap = CAPABILITIES[p];
              const len = [...effective(p)].length;
              return (
                <div key={p} className="overflow-warn">
                  <span className="error-text">
                    {`Your ${providerLabel(p)} caption exceeds the current allowed length (${len} > ${cap.maxCaptionChars}).`}
                  </span>
                  <button type="button" className="btn btn-sm" onClick={() => editOverride(p)}>Edit</button>
                </div>
              );
            })}
            {selectedProviders.map((p) => (
              <details
                key={p}
                className="override"
                ref={(el) => {
                  if (el) overrideDetails.current.set(p, el);
                  else overrideDetails.current.delete(p);
                }}
                onToggle={(e) => openOverride(p, (e.target as HTMLDetailsElement).open)}
              >
                <summary>Caption override — {providerLabel(p)}</summary>
                <textarea
                  className="textarea"
                  rows={4}
                  value={overrides[p] ?? ''}
                  placeholder="Leave empty to use the base caption"
                  onChange={(e) => setOverrides((prev) => ({ ...prev, [p]: e.target.value }))}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setOverrides((prev) => ({ ...prev, [p]: '' }))}
                >
                  Use base caption
                </button>
              </details>
            ))}
          </section>

          <section className="card">
            <h2>Destinations</h2>
            {!loaded && <div className="skeleton" style={{ height: 48 }} />}
            {loaded && accounts.length === 0 && (
              <p className="empty-line">No accounts yet — connect one under Accounts.</p>
            )}
            {groups.map(([provider, list]) => (
              <div key={provider} className="dest-group">
                <span className="dest-provider">{providerLabel(provider)}</span>
                {list.map((a) => {
                  const blocked = a.status !== 'connected';
                  return (
                    <label key={a.id} className={`dest-row${blocked ? ' dest-blocked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={selection[a.id] === true}
                        disabled={blocked}
                        onChange={(e) => setSelection((prev) => ({ ...prev, [a.id]: e.target.checked }))}
                      />
                      <span className="dest-name">
                        {a.displayName}
                        {a.handle ? <span className="dest-handle">@{a.handle}</span> : null}
                      </span>
                      <StatusBadge status={a.status} />
                    </label>
                  );
                })}
              </div>
            ))}
            {selected.some((a) => a.status !== 'connected') && (
              <p className="error-text">Some selected accounts are not connected — deselect or reconnect them.</p>
            )}
          </section>

          <div id="compose-schedule">
            <ScheduleSection
              defaultTz={me.timezone}
              mode={mode}
              onModeChange={setMode}
              slots={slots}
              onSlotsChange={setSlots}
              tz={tz}
              onTzChange={setTz}
            />
          </div>

          {err && <p className="error-text banner-error" role="alert">{err}</p>}
          {Object.keys(fieldErrors).length > 0 && (
            <ul className="warn-list">
              {Object.entries(fieldErrors).map(([f, m]) => <li key={f}>{f}: {m}</li>)}
            </ul>
          )}

          <div className="compose-actions" id="compose-review">
            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {mode === 'now' ? 'Review & publish' : 'Review & schedule'}
            </button>
          </div>
        </>
      ) : (
        <>
          {err && <p className="error-text banner-error" role="alert">{err}</p>}
          {Object.keys(fieldErrors).length > 0 && (
            <ul className="warn-list">
              {Object.entries(fieldErrors).map(([f, m]) => <li key={f}>{f}: {m}</li>)}
            </ul>
          )}
          <ReviewScreen
            draft={draft}
            me={me}
            busy={busy}
            onBack={() => { setReviewing(false); setErr(null); }}
            onConfirm={() => void confirmSend()}
          />
        </>
      )}
    </form>
  );
}
