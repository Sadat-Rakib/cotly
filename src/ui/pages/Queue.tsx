import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  api,
  asRows,
  providerLabel,
  type Account,
  type Me,
  type PostRow,
  type TargetRow,
} from '../api';
import { StatusBadge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { MediaThumb } from '../components/MediaThumb';
import { MediaPicker, type MediaItem } from '../components/MediaPicker';
import { TimezoneSelect } from '../components/TimezoneSelect';
import { useToast } from '../components/Toasts';
import { dayKey, epochToLocalInput, fmtDateTime, localToEpoch } from '../time';

type Tab = 'today' | 'tomorrow' | 'later' | 'failed' | 'published';

const TABS: Tab[] = ['today', 'tomorrow', 'later', 'failed', 'published'];

interface Props {
  me: Me;
  navigate: (p: string) => void;
}

function captionPreview(p: PostRow): string {
  const t = p.baseCaption.replace(/\s+/g, ' ').trim();
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}

function badTargets(p: PostRow): TargetRow[] {
  return p.targets.filter((t) => t.status === 'failed' || t.status === 'needs_reconnect');
}

export function QueuePage({ me, navigate }: Props) {
  const toast = useToast();
  const tz = me.timezone;
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [tab, setTab] = useState<Tab>('today');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PostRow | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const load = useCallback(async () => {
    try {
      const [q, f, p] = await Promise.all([
        api<unknown>('/api/posts?view=queue&limit=200'),
        api<unknown>('/api/posts?view=failed&limit=200'),
        api<unknown>('/api/posts?view=published&limit=100'),
      ]);
      const byId = new Map<string, PostRow>();
      for (const row of [...asRows<PostRow>(q), ...asRows<PostRow>(f), ...asRows<PostRow>(p)]) {
        byId.set(row.id, row);
      }
      setPosts([...byId.values()].sort((a, b) => b.scheduledAt - a.scheduledAt));
    } catch (e) {
      if (e instanceof ApiError && e.status !== 401) toast('err', e.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    api<Account[]>('/api/accounts').then(setAccounts).catch(() => {});
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => { void load(); }, 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const bucketed = useMemo(() => {
    const today = dayKey(Date.now() / 1000, tz);
    const tomorrow = dayKey(Date.now() / 1000 + 86_400, tz);
    const out: Record<Tab, PostRow[]> = { today: [], tomorrow: [], later: [], failed: [], published: [] };
    for (const p of posts) {
      const isPublished = p.status === 'published' || (p.targets.length > 0 && p.targets.every((t) => t.status === 'published' || t.status === 'cancelled' || t.status === 'assisted'));
      if (isPublished) { out.published.push(p); continue; }
      if (p.status === 'cancelled') continue;
      if (p.status === 'failed' || badTargets(p).length > 0) { out.failed.push(p); continue; }
      const k = dayKey(p.scheduledAt, tz);
      if (k === today) out.today.push(p);
      else if (k === tomorrow) out.tomorrow.push(p);
      else out.later.push(p);
    }
    return out;
  }, [posts, tz]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast('ok', label);
      await load();
    } catch (e) {
      toast('err', e instanceof ApiError ? e.message : `${label} failed`);
    }
  };

  const retryTarget = (t: TargetRow) =>
    act(`Retry queued for ${t.accountName ?? providerLabel(t.provider)}`, () =>
      api(`/api/targets/${t.id}/retry`, { method: 'POST' }));

  const list = bucketed[tab];
  const needsReconnect = posts.flatMap((p) => p.targets).filter((t) => t.status === 'needs_reconnect');

  return (
    <div className="queue">
      <h1>Queue</h1>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`tab${tab === t ? ' tab-active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'later' ? 'Later' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {needsReconnect.length > 0 && (
        <div className="banner banner-warn">
          <span>
            {new Set(needsReconnect.map((t) => t.provider)).size} account(s) need reconnection.
          </span>
          <button className="btn btn-sm" onClick={() => navigate('/app/profile')}>Reconnect</button>
        </div>
      )}

      {loading && <div className="skeleton" style={{ height: 96 }} />}
      {!loading && list.length === 0 && (
        <div className="empty card">
          <p>Nothing here yet. Compose a post to fill this queue.</p>
          <button className="btn btn-primary" onClick={() => navigate('/app/compose')}>Compose</button>
        </div>
      )}

      <div className="qlist">
        {list.map((p) => {
          const bad = badTargets(p);
          const editable = p.status === 'draft' || p.status === 'scheduled';
          return (
            <article key={p.id} className="card qitem">
              <MediaThumb media={p.media?.[0]} className="qthumb" />
              <div className="qitem-body">
                <div className="qitem-top">
                  <time className="qtime">{fmtDateTime(p.scheduledAt, tz)}</time>
                  <StatusBadge status={p.status} />
                </div>
                <p className="qcaption">{captionPreview(p) || <em>(no caption)</em>}</p>
                <div className="chips">
                  {p.targets.map((t) => (
                    <span
                      key={t.id}
                      className={`chip chip-${t.status}`}
                      title={t.lastError ?? undefined}
                    >
                      {providerLabel(t.provider)}{t.accountName ? ` · ${t.accountName}` : ''} · {t.status.replace('_', ' ')}
                    </span>
                  ))}
                </div>
                {bad.length > 0 && (
                  <div className="banner banner-warn qretry">
                    <div className="qretry-msgs">
                      {bad.map((t) => (
                        <span key={t.id} className="error-text">
                          {providerLabel(t.provider)}: {t.lastError ?? 'failed'}
                        </span>
                      ))}
                    </div>
                    <div className="qretry-actions">
                      {bad.map((t) => (
                        <button key={t.id} className="btn btn-sm btn-danger" onClick={() => void retryTarget(t)}>
                          Retry {providerLabel(t.provider)}
                        </button>
                      ))}
                      <button className="btn btn-sm" onClick={() => navigate('/app/profile')}>
                        {(() => {
                        const badProviders = [...new Set(bad.map((t) => t.provider))];
                        const single = badProviders.length === 1 ? badProviders[0] : undefined;
                        return single ? `Reconnect ${providerLabel(single)}` : 'Reconnect accounts';
                      })()}
                      </button>
                    </div>
                  </div>
                )}
                <div className="qactions">
                  {editable && <button className="btn btn-sm" onClick={() => setEditing(p)}>Edit</button>}
                  <button
                    className="btn btn-sm"
                    onClick={() => void act('Copied to drafts', () => api(`/api/posts/${p.id}/duplicate`, { method: 'POST' }))}
                  >
                    Duplicate
                  </button>
                  {editable && (
                    <button className="btn btn-sm" onClick={() => void act('Publishing now', () => api(`/api/posts/${p.id}/publish-now`, { method: 'POST' }))}>
                      Publish now
                    </button>
                  )}
                  {editable || p.status === 'publishing' ? (
                    <button className="btn btn-sm" onClick={() => void act('Post cancelled', () => api(`/api/posts/${p.id}/cancel`, { method: 'POST' }))}>
                      Cancel
                    </button>
                  ) : null}
                  {(p.status === 'draft' || p.status === 'cancelled') && (
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => {
                        if (window.confirm('Delete this post?')) void act('Post deleted', () => api(`/api/posts/${p.id}`, { method: 'DELETE' }));
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {editing && (
        <EditModal
          post={editing}
          accounts={accounts}
          tz={tz}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            toast('ok', 'Post updated');
            await load();
          }}
        />
      )}
    </div>
  );
}

interface EditProps {
  post: PostRow;
  accounts: Account[];
  tz: string;
  onClose: () => void;
  onSaved: () => void;
}

function EditModal({ post, accounts, tz, onClose, onSaved }: EditProps) {
  const toast = useToast();
  const [caption, setCaption] = useState(post.baseCaption);
  const [keptIds, setKeptIds] = useState<string[]>(() => (post.media ?? []).map((m) => m.id));
  const [targets, setTargets] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const t of post.targets) m[t.accountId] = true;
    return m;
  });
  const [tzSel, setTzSel] = useState(post.timezone || tz);
  const [when, setWhen] = useState(() => epochToLocalInput(post.scheduledAt, post.timezone || tz));
  const [newMedia, setNewMedia] = useState<MediaItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const existing = (post.media ?? []).filter((m) => keptIds.includes(m.id));
  const newIds = newMedia.filter((m) => m.status === 'ready' && m.mediaId).map((m) => m.mediaId);
  const uploading = newMedia.some((m) => m.status === 'uploading');

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/posts/${post.id}`, {
        method: 'PATCH',
        body: {
          baseCaption: caption,
          mediaIds: [...keptIds, ...newIds],
          targets: Object.entries(targets).filter(([, v]) => v).map(([accountId]) => ({ accountId })),
        },
      });
      const newEpoch = localToEpoch(when, tzSel);
      if (newEpoch !== post.scheduledAt) {
        await api(`/api/posts/${post.id}/reschedule`, { method: 'POST', body: { scheduledAt: newEpoch } });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save changes');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Edit post" onClose={onClose}>
      <div className="field">
        <label className="label" htmlFor="edit-caption">Caption</label>
        <textarea id="edit-caption" className="textarea" rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} />
      </div>
      <div className="field">
        <span className="label">Media</span>
        {existing.map((m) => (
          <div key={m.id} className="media-item media-ready">
            <div className="thumb">
              {m.url && m.mime.startsWith('image/') ? <img src={m.url} alt="" /> : <span className="thumb-file">{m.mime.startsWith('video/') ? 'video' : 'media'}</span>}
            </div>
            <div className="media-meta"><span className="media-name">{m.filename ?? m.id}</span></div>
            <button className="btn btn-ghost btn-sm" onClick={() => setKeptIds((ids) => ids.filter((x) => x !== m.id))}>Remove</button>
          </div>
        ))}
        <MediaPicker items={newMedia} setItems={setNewMedia} />
      </div>
      <div className="field">
        <span className="label">Destinations</span>
        {accounts.map((a) => (
          <label key={a.id} className={`dest-row${a.status !== 'connected' ? ' dest-blocked' : ''}`}>
            <input
              type="checkbox"
              checked={targets[a.id] === true}
              disabled={a.status !== 'connected'}
              onChange={(e) => setTargets((prev) => ({ ...prev, [a.id]: e.target.checked }))}
            />
            <span className="dest-name">{providerLabel(a.provider)} · {a.displayName}</span>
            <StatusBadge status={a.status} />
          </label>
        ))}
      </div>
      <div className="field">
        <label className="label" htmlFor="edit-when">Scheduled time</label>
        <input id="edit-when" className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        <div className="field">
          <span className="label">Timezone</span>
          <TimezoneSelect value={tzSel} onChange={setTzSel} />
        </div>
      </div>
      {err && <p className="error-text" role="alert">{err}</p>}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Discard</button>
        <button className="btn btn-primary" onClick={() => void save()} disabled={busy || uploading}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </Modal>
  );
}
