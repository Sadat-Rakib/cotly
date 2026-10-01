import type { AccountStatus, PostStatus, TargetStatus } from '../api';

type AnyStatus = TargetStatus | PostStatus | AccountStatus;

const LABELS: Partial<Record<AnyStatus, string>> = {
  needs_reconnect: 'needs reconnect',
};

export function StatusBadge({ status }: { status: AnyStatus }) {
  return <span className={`badge badge-${status}`}>{LABELS[status] ?? status}</span>;
}
