import { getCapabilities } from '../contracts/capabilities';
import type { PlatformAdapter, PublishOutcome } from '../contracts/types';

// Assisted mode never auto-publishes: the engine parks the target for manual posting.
export class AssistedAdapter implements PlatformAdapter {
  readonly provider = 'assisted' as const;
  readonly capabilities = getCapabilities('assisted');

  async publish(): Promise<PublishOutcome> {
    return { kind: 'assisted', reason: 'Post ready for manual publishing.' };
  }
}
