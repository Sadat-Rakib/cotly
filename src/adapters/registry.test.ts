import { describe, expect, it } from 'vitest';
import type { Env } from '../contracts/env';
import type { PublishInput } from '../contracts/types';
import { getAdapter, oauthConfigured, registerAdapter } from './registry';

const env = { MOCK_SOCIAL_ENABLED: 'true' } as unknown as Env;

const input = (): PublishInput => ({
  account: {
    id: 'acc1',
    provider: 'mock',
    externalId: 'ext1',
    displayName: 'Mock',
    accessToken: 'token',
    meta: {},
    status: 'connected',
  } as PublishInput['account'],
  caption: 'Hello registry',
  media: [],
  idempotencyKey: 'reg:1',
  scheduledAt: 1_000,
});

describe('adapter registry', () => {
  it('covers all eight working providers', () => {
    for (const provider of ['facebook', 'threads', 'linkedin', 'bluesky', 'x', 'instagram', 'mock', 'assisted'] as const) {
      expect(getAdapter(provider).provider).toBe(provider);
    }
  });

  it('has no adapter for unimplemented providers', () => {
    for (const provider of ['reddit'] as const) {
      expect(() => getAdapter(provider)).toThrow(/No adapter registered/);
    }
  });

  it('exposes testConnection on the four real providers', () => {
    for (const provider of ['facebook', 'threads', 'linkedin', 'bluesky'] as const) {
      expect(typeof getAdapter(provider).testConnection).toBe('function');
    }
  });

  it('assisted never publishes and reports the handoff reason', async () => {
    const out = await getAdapter('assisted').publish(env, input());
    expect(out).toEqual({ kind: 'assisted', reason: 'Post ready for manual publishing.' });
  });

  it('mock publishes a confirmed post with provider evidence', async () => {
    const out = await getAdapter('mock').publish(env, input());
    expect(out.kind).toBe('confirmed');
    expect((out as { externalId: string }).externalId).toMatch(/^mock_/);
  });

  it('registers additional adapters at runtime', () => {
    const custom = { ...getAdapter('mock'), provider: 'x' as const };
    registerAdapter(custom);
    expect(getAdapter('x').provider).toBe('x');
  });

  it('reports which providers have OAuth configured', () => {
    expect(oauthConfigured('facebook', { META_CLIENT_ID: 'id' })).toBe(true);
    expect(oauthConfigured('facebook', {})).toBe(false);
    expect(oauthConfigured('threads', { THREADS_CLIENT_ID: 'id' })).toBe(true);
    expect(oauthConfigured('linkedin', { LINKEDIN_CLIENT_ID: 'id' })).toBe(true);
    // AT Protocol OAuth: the Bluesky client identity derives from APP_URL,
    // so it is always configured.
    expect(oauthConfigured('bluesky', {})).toBe(true);
    expect(oauthConfigured('mock', {})).toBe(false);
    expect(oauthConfigured('assisted', {})).toBe(false);
  });
});
