import { memo, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
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
import { CaptionPills } from '../components/CaptionPills';
import { CollapsibleCard } from '../components/CollapsibleCard';
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

// Memoized so caption keystrokes (parent re-render) never reconcile this
// list. Props change identity only when accounts/selection actually change.
const DestinationsBody = memo(function DestinationsBody({
  accounts,
  groups,
  selection,
  onToggle,
  loaded,
}: {
  accounts: Account[];
  groups: Array<[Provider, Account[]]>;
  selection: Record<string, boolean>;
  onToggle: (id: string, checked: boolean) => void;
  loaded: boolean;
}) {
  if (!loaded) return <div className="skeleton" style={{ height: 48 }} />;
  if (accounts.length === 0) {
    return <p className="empty-line">No accounts yet — connect one under Profile.</p>;
  }
  return (
    <>
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
                  onChange={(e) => onToggle(a.id, e.target.checked)}
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
    </>
  );
});

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

  // Stable callbacks keep the memoized sections (destinations, caption pills)
  // from re-rendering on unrelated state changes.
  const toggleSelection = useCallback((id: string, checked: boolean) => {
    setSelection((prev) => ({ ...prev, [id]: checked }));
  }, []);
  const handleOverrideChange = useCallback((p: Provider, v: string) => {
    setOverrides((prev) => ({ ...prev, [p]: v }));
  }, []);
  const handleClearOverride = useCallback((p: Provider) => {
    setOverrides((prev) => {
      if (!(p in prev)) return prev;
      const next = { ...prev };
      delete next[p];
      return next;
    });
  }, []);

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
  // Publish Now calls the immediate publish endpoint and reports the REAL
  // provider-confirmed result. Never claim Published from creation alone.
  const confirmSend = async () => {
    setErr(null);
    setFieldErrors({});
    const targets: PostTargetInput[] = selected.map((a) => {
      const ov = overrides[a.provider];
      return ov !== undefined && ov.trim() !== '' ? { accountId: a.id, captionOverride: ov } : { accountId: a.id };
    });
    const run: (number | null)[] = mode === 'now' ? [null] : slots; // 'now' -> single slotless post
    setBusy(true);
    // Yield one frame so the disabled "Working" state paints before the
    // network calls below occupy the interaction; otherwise the whole
    // request duration lands in the button's INP render span.
    await new Promise((r) => setTimeout(r, 0));
    let ok = 0;
    try {
      for (const slot of run) {
        const created = await api<{ postId: string }>('/api/posts', {
          method: 'POST',
          body: slot === null
            ? { baseCaption: caption, mediaIds: readyMediaIds, targets, mode: 'now' }
            : { baseCaption: caption, mediaIds: readyMediaIds, targets, mode: 'scheduled', scheduledAt: slot, timezone: tz },
        });
        if (slot === null) {
          // Publish Now: wait for the real provider response before reporting.
          const res = await api<{
            status: string; published?: number; failed?: number;
            needsReconnect?: number; errors?: string[];
          }>(`/api/posts/${created.postId}/publish-now`, { method: 'POST' });
          if (res.status === 'published' && (res.published ?? 0) > 0) {
            ok += 1;
          } else if ((res.failed ?? 0) > 0 || (res.needsReconnect ?? 0) > 0) {
            const detail = (res.errors ?? []).filter(Boolean).join(' ');
            throw new ApiError(502, detail ? `Publishing failed: ${detail}` : 'Publishing failed. Check the Queue for details.');
          } else {
            // Still in flight (pending provider confirmation / retrying):
            // truthful transitional state, never "Published".
            const msg = 'Publishing — waiting for platform confirmation. Track it in the Queue.';
            setSuccess(msg);
            toast('ok', msg);
            navigate('/app/queue');
            setReviewing(false);
            setCaption('');
            setOverrides({});
            setSelection({});
            setMedia([]);
            setSlots([]);
            setMode('now');
            return;
          }
        } else {
          ok += 1;
        }
      }
      const msg = ok === 1 ? (mode === 'now' ? 'Post published — confirmed by the platform.' : 'Post scheduled.') : `${ok} posts scheduled.`;
      setSuccess(msg);
      toast('ok', msg);
      if (mode === 'now') navigate('/app/queue?tab=published');
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

  // Stable identity for the memoized review screen: same contents, no
  // re-render of the review tree on unrelated parent updates.
  const draft: ReviewDraft = useMemo(
    () => ({ destinations: selected, caption, overrides, media, mode, slots, tz }),
    [selected, caption, overrides, media, mode, slots, tz],
  );
  const handleBack = useCallback(() => { setReviewing(false); setErr(null); }, []);

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
          <CollapsibleCard
            title="Media"
            id="compose-media"
            badge={media.length > 0 ? `${media.length} file${media.length === 1 ? '' : 's'}` : undefined}
          >
            <MediaPicker items={media} setItems={setMedia} />
            {videoWarnings.length > 0 && (
              <ul className="warn-list">
                {videoWarnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
          </CollapsibleCard>

          <CollapsibleCard
            title="Caption"
            badge={caption.trim() !== '' ? `${[...caption].length} chars` : undefined}
          >
            <CaptionPills
              baseCaption={caption}
              onBaseChange={setCaption}
              overrides={overrides}
              onOverrideChange={handleOverrideChange}
              onClearOverride={handleClearOverride}
              selectedProviders={selectedProviders}
              disabled={busy}
            />
          </CollapsibleCard>

          <CollapsibleCard
            title="Destinations"
            badge={selected.length > 0 ? `${selected.length} selected` : undefined}
          >
            <DestinationsBody
              accounts={accounts}
              groups={groups}
              selection={selection}
              onToggle={toggleSelection}
              loaded={loaded}
            />
            {selected.some((a) => a.status !== 'connected') && (
              <p className="error-text">Some selected accounts are not connected — deselect or reconnect them.</p>
            )}
          </CollapsibleCard>

          <CollapsibleCard title="Schedule" id="compose-schedule" badge={mode === 'now' ? 'Publish now' : `${slots.length} slot${slots.length === 1 ? '' : 's'}`}>
            <ScheduleSection
              defaultTz={me.timezone}
              mode={mode}
              onModeChange={setMode}
              slots={slots}
              onSlotsChange={setSlots}
              tz={tz}
              onTzChange={setTz}
            />
          </CollapsibleCard>

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
            onBack={handleBack}
            onConfirm={() => void confirmSend()}
          />
        </>
      )}
    </form>
  );
}
