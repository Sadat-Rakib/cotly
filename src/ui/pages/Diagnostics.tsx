import { useEffect, useState } from 'react';
import { ApiError, api, providerLabel, type Diagnostics, type Me } from '../api';
import { fmtFullDateTime } from '../time';

interface Props {
  me: Me;
}

export function DiagnosticsPage({ me }: Props) {
  const [d, setD] = useState<Diagnostics | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<Diagnostics>('/api/diagnostics')
      .then((data) => { if (alive) setD(data); })
      .catch((e) => { if (alive) setErr(e instanceof ApiError ? e.message : 'Could not load diagnostics'); });
    return () => { alive = false; };
  }, []);

  if (err) return <div className="empty card"><p className="error-text">{err}</p></div>;
  if (!d) return <div className="skeleton" style={{ height: 220 }} />;

  const stats: { label: string; value: string }[] = [
    { label: 'Last tick', value: d.lastTickAt ? fmtFullDateTime(d.lastTickAt, me.timezone) : 'never' },
    { label: 'Due', value: String(d.dueCount ?? 0) },
    { label: 'Active', value: String(d.activeCount ?? 0) },
    { label: 'Failed', value: String(d.failedCount ?? 0) },
    { label: 'Needs reconnect', value: String(d.needsReconnectCount ?? 0) },
    { label: 'R2 storage', value: d.r2Ok === undefined ? 'unknown' : d.r2Ok ? 'ok' : 'down' },
  ];

  const providers = Object.entries(d.providers ?? {});

  return (
    <div className="diagnostics">
      <h1>Diagnostics</h1>
      <div className="stat-grid">
        {stats.map((st) => (
          <div key={st.label} className="card stat-card">
            <span className="stat-label">{st.label}</span>
            <span className={`stat-value${st.label === 'R2 storage' && d.r2Ok === false ? ' error-text' : ''}`}>{st.value}</span>
          </div>
        ))}
      </div>

      {providers.length > 0 && (
        <section className="card">
          <h2>Provider health</h2>
          <div className="chips">
            {providers.map(([name, result]) => (
              <span key={name} className="chip chip-neutral">{providerLabel(name as Parameters<typeof providerLabel>[0])}: {String(result)}</span>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h2>Recent attempts</h2>
        {d.recentAttempts.length === 0 ? (
          <p className="empty-line">No publish attempts yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Time</th><th>Provider</th><th>Result</th><th>Error</th></tr>
              </thead>
              <tbody>
                {d.recentAttempts.map((a, i) => (
                  <tr key={i}>
                    <td>{a.attemptedAt ? fmtFullDateTime(a.attemptedAt, me.timezone) : '—'}</td>
                    <td>{a.provider ?? '—'}</td>
                    <td>{a.result ?? '—'}</td>
                    <td className="td-error">{a.errorMessage ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
