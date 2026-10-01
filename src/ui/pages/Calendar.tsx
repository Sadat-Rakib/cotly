import { useEffect, useMemo, useState } from 'react';
import { ApiError, api, asRows, providerLabel, type Me, type PostRow } from '../api';
import { StatusBadge } from '../components/Badge';
import { dayKey, dayLabel, fmtTime } from '../time';

interface Props {
  me: Me;
}

export function CalendarPage({ me }: Props) {
  const tz = me.timezone;
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const from = Math.floor(Date.now() / 1000) - 3_600;
    const to = from + 30 * 86_400;
    api<unknown>(`/api/posts?from=${from}&to=${to}`)
      .then((rows) => {
        if (alive) setPosts(asRows<PostRow>(rows).filter((p) => p.status !== 'draft' && p.status !== 'cancelled'));
      })
      .catch((e) => { if (alive) setErr(e instanceof ApiError ? e.message : 'Could not load the calendar'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const days = useMemo(() => {
    const map = new Map<string, PostRow[]>();
    for (const p of posts) {
      const k = dayKey(p.scheduledAt, tz);
      const list = map.get(k) ?? [];
      list.push(p);
      map.set(k, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [posts, tz]);

  return (
    <div className="calendar">
      <h1>Calendar</h1>
      <p className="hint">Next 30 days, times shown in {tz}.</p>
      {err && <p className="error-text" role="alert">{err}</p>}
      {loading && <div className="skeleton" style={{ height: 96 }} />}
      {!loading && days.length === 0 && <div className="empty card"><p>Nothing scheduled in the next 30 days.</p></div>}
      {days.map(([key, list]) => (
        <section key={key} className="cal-day">
          <h2 className="cal-heading">{dayLabel(key, tz)}</h2>
          {list
            .slice()
            .sort((a, b) => a.scheduledAt - b.scheduledAt)
            .map((p) => (
              <article key={p.id} className="card cal-item">
                <time className="cal-time">{fmtTime(p.scheduledAt, tz)}</time>
                <div className="cal-body">
                  <p className="qcaption">{p.baseCaption.replace(/\s+/g, ' ').trim().slice(0, 60) || <em>(no caption)</em>}</p>
                  <div className="chips">
                    {p.targets.map((t) => (
                      <span key={t.id} className={`chip chip-${t.status}`}>
                        {providerLabel(t.provider)} · {t.status.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                </div>
                <StatusBadge status={p.status} />
              </article>
            ))}
        </section>
      ))}
    </div>
  );
}
