import type { AccountStatus, PostStatus, TargetStatus } from '../api';

type AnyStatus = TargetStatus | PostStatus | AccountStatus;

const LABELS: Partial<Record<AnyStatus, string>> = {
  needs_reconnect: 'needs reconnect',
};

export function StatusBadge({ status }: { status: AnyStatus }) {
  // Unknown/corrupt status strings degrade to the reconnect state instead of
  // rendering raw values in the UI.
  const label = LABELS[status] ?? (status === 'connected' || status === 'draft' || status === 'scheduled' || status === 'published' ? status : 'needs reconnect');
  return <span className={`badge badge-${status}`}>{label}</span>;
}
