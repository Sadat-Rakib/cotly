import { memo } from 'react';
import { CAPABILITIES } from '../../contracts/capabilities';
import { providerLabel, type Account, type Me, type Provider } from '../api';
import type { MediaItem } from './MediaPicker';
import type { ScheduleMode } from './ScheduleSection';
import { fmtLongDateTime } from '../time';

export interface ReviewDraft {
  destinations: Account[];
  caption: string;
  overrides: Record<string, string>;
  media: MediaItem[];
  mode: ScheduleMode;
  slots: number[]; // epoch seconds; empty for mode 'now'
  tz: string;
}

export interface PlatformIssue {
  provider: Provider;
  messages: string[];
}

// The exact caption that will be sent: override ?? base.
export function effectiveCaption(d: ReviewDraft, p: Provider): string {
  const ov = d.overrides[p];
  return ov !== undefined && ov.trim() !== '' ? ov : d.caption;
}

// Blocking incompatibilities per selected platform (same checks the API runs),
// so confirm can be prevented before a doomed request is made.
export function platformIssues(d: ReviewDraft): PlatformIssue[] {
  const byProvider = new Map<Provider, string[]>();
  const providers = [...new Set(d.destinations.map((a) => a.provider))];
  for (const p of providers) {
    const cap = CAPABILITIES[p];
    if (!cap) continue;
    const label = providerLabel(p);
    const msgs: string[] = [];
    const videos = d.media.filter((m) => m.mime.startsWith('video/'));
    if (!cap.video) {
      for (const v of videos) msgs.push(`${label} does not support video (${v.filename}).`);
    } else {
      for (const v of videos) {
        const mb = v.size / (1024 * 1024);
        if (mb > cap.maxVideoMB) {
          msgs.push(`${v.filename} is ${mb.toFixed(0)} MB — over the ${label} limit of ${cap.maxVideoMB} MB.`);
        }
      }
    }
    if (cap.mediaRequired && d.media.length === 0) {
      msgs.push(`${label} requires at least one image or video.`);
    }
    const images = d.media.filter((m) => m.mime.startsWith('image/')).length;
    if (images > cap.maxImages) {
      msgs.push(`${label} allows at most ${cap.maxImages} images per post.`);
    }
    const len = [...effectiveCaption(d, p)].length;
    if (len > cap.maxCaptionChars) {
      msgs.push(`Your ${label} caption exceeds the current allowed length (${len} > ${cap.maxCaptionChars}).`);
    }
    if (msgs.length > 0) byProvider.set(p, [...new Set(msgs)]);
  }
  return [...byProvider.entries()].map(([provider, messages]) => ({ provider, messages }));
}

interface Props {
  draft: ReviewDraft;
  me: Me;
  busy: boolean;
  onBack: () => void;
  onConfirm: () => void;
}

// Memoized with a useMemo'd draft in the parent: composing keystrokes and
// upload progress must not reconcile the review tree.
export const ReviewScreen = memo(function ReviewScreen({ draft, me, busy, onBack, onConfirm }: Props) {
  const issues = platformIssues(draft);
  const blocked = issues.length > 0;
  const forProvider = (p: Provider): string[] =>
    issues.find((i) => i.provider === p)?.messages ?? [];

  const confirmLabel = draft.mode === 'now'
    ? 'Confirm & Publish Now'
    : draft.slots.length > 1
      ? `Confirm & Schedule (${draft.slots.length} posts)`
      : 'Confirm & Schedule';

  return (
    <div className="review">
      <h1>Review</h1>
      <p className="hint">Nothing is sent until you confirm.</p>

      <section className="card">
        <h2>Schedule</h2>
        {draft.mode === 'now' ? (
          <p className="review-when">Publish now</p>
        ) : (
          <>
            {draft.slots.length > 1 && (
              <p className="hint">{draft.slots.length} posts will be created with this content.</p>
            )}
            <ul className="slot-times">
              {draft.slots.map((s, i) => (
                <li key={`${s}-${i}`}>{fmtLongDateTime(s, me.timezone)} — {me.timezone}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      {draft.destinations.map((a) => {
        const msgs = forProvider(a.provider);
        return (
          <section key={a.id} className={`card review-dest${msgs.length > 0 ? ' review-blocked' : ''}`}>
            <div className="review-dest-head">
              <strong>{providerLabel(a.provider)}</strong>
              <span className="dest-name">{a.displayName}</span>
            </div>
            {draft.media.length > 0 && (
              <div className="review-media">
                {draft.media.map((m, i) => (
                  <div key={m.previewUrl || `${a.id}-${i}`} className="review-media-item">
                    <span className="media-order">{i + 1}</span>
                    <div className="thumb">
                      {m.previewUrl && m.mime.startsWith('image/')
                        ? <img src={m.previewUrl} alt={m.filename} />
                        : <span className="thumb-file">{m.mime.startsWith('video/') ? 'video' : 'file'}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="review-caption">{effectiveCaption(draft, a.provider) || <em>(no caption)</em>}</p>
            {msgs.map((m) => <span key={m} className="error-text">{m}</span>)}
          </section>
        );
      })}

      {blocked && (
        <p className="hint review-blocked-hint">
          Resolve the highlighted issues to enable publishing — Cotly will not send a post a
          platform would reject.
        </p>
      )}

      <div className="review-actions">
        <button type="button" className="btn" onClick={onBack} disabled={busy}>Back</button>
        <button type="button" className="btn btn-primary btn-block" onClick={onConfirm} disabled={busy || blocked}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </div>
  );
});
