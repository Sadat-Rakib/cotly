import { getCapabilities } from '../../contracts/capabilities';
import type { Env } from '../../contracts/env';
import type { PlatformAdapter, PublishInput, PublishOutcome, SocialAccountRecord } from '../../contracts/types';
import { randomId } from '../../lib/crypto';

// In-memory only: proves idempotent replay + pending resolution within one isolate.
const idempotencyMap = new Map<string, string>(); // idempotencyKey -> externalId
const pendingCreated = new Map<string, number>(); // containerId -> epoch seconds

export class MockSocialAdapter implements PlatformAdapter {
  readonly provider = 'mock' as const;
  readonly capabilities = getCapabilities('mock');

  async publish(env: Env, input: PublishInput): Promise<PublishOutcome> {
    const m = input.caption.match(/\[mock:(429|500|timeout|expire|invalidmedia|delay|dupe)\]/);
    const fault = m?.[1];
    const existing = idempotencyMap.get(input.idempotencyKey);
    if (existing) return { kind: 'confirmed', externalId: existing, permalink: `https://mock.social/p/${existing}` };

    switch (fault) {
      case '429':
        return { kind: 'failed', retryable: true, errorCode: '429', errorMessage: 'MockSocial temporarily rate-limited publishing. Retrying automatically.' };
      case '500':
        return { kind: 'failed', retryable: true, errorCode: '500', errorMessage: 'MockSocial is temporarily unavailable. Retrying automatically.' };
      case 'timeout':
        return { kind: 'failed', retryable: true, errorCode: 'ETIMEDOUT', errorMessage: 'MockSocial did not respond in time. Retrying automatically.' };
      case 'expire':
        return { kind: 'needs_reconnect', reason: 'MockSocial token expired. Reconnect the account and retry.' };
      case 'invalidmedia':
        return { kind: 'failed', retryable: false, errorCode: 'UNSUPPORTED_MEDIA', errorMessage: 'MockSocial rejected this media because its format is unsupported.' };
      case 'delay': {
        const containerId = `mockc_${randomId(8)}`;
        idempotencyMap.set(input.idempotencyKey, containerId);
        pendingCreated.set(containerId, Math.floor(Date.now() / 1000));
        return { kind: 'pending', externalId: containerId };
      }
      default: {
        const id = `mock_${randomId(8)}`;
        idempotencyMap.set(input.idempotencyKey, id);
        return { kind: 'confirmed', externalId: id, permalink: `https://mock.social/p/${id}` };
      }
    }
  }

  async resolvePending(env: Env, account: SocialAccountRecord, externalId: string): Promise<PublishOutcome> {
    const created = pendingCreated.get(externalId);
    if (created === undefined) {
      return { kind: 'failed', retryable: false, errorCode: 'UNKNOWN_CONTAINER', errorMessage: 'MockSocial no longer knows this container; it may have already been resolved.' };
    }
    if (Math.floor(Date.now() / 1000) - created < 60) {
      return { kind: 'pending', externalId };
    }
    return { kind: 'confirmed', externalId, permalink: `https://mock.social/p/${externalId}` };
  }
}
