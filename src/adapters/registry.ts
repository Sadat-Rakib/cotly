import { getCapabilities } from '../contracts/capabilities';
import type { PlatformAdapter, Provider } from '../contracts/types';
import { MockSocialAdapter } from '../engine/providers/mock';
import { AssistedAdapter } from './assisted';
import { BlueskyAdapter } from './bluesky';
import { FacebookAdapter } from './facebook';
import { LinkedInAdapter } from './linkedin';
import { ThreadsAdapter } from './threads';
import { XAdapter } from './x';

const registry: Partial<Record<Provider, PlatformAdapter>> = {};
for (const adapter of [
  new FacebookAdapter(),
  new ThreadsAdapter(),
  new LinkedInAdapter(),
  new BlueskyAdapter(),
  new XAdapter(),
  new AssistedAdapter(),
  new MockSocialAdapter(),
]) {
  registry[adapter.provider] = adapter;
}

export function getAdapter(provider: Provider): PlatformAdapter {
  const adapter = registry[provider];
  if (!adapter) throw new Error(`No adapter registered for ${provider}`);
  return adapter;
}

export function registerAdapter(adapter: PlatformAdapter): void {
  registry[adapter.provider] = adapter;
}

export function oauthConfigured(
  provider: Provider,
  env: { META_CLIENT_ID?: string; THREADS_CLIENT_ID?: string; LINKEDIN_CLIENT_ID?: string; X_CLIENT_ID?: string },
): boolean {
  switch (provider) {
    case 'facebook':
      return Boolean(env.META_CLIENT_ID);
    case 'threads':
      return Boolean(env.THREADS_CLIENT_ID);
    case 'linkedin':
      return Boolean(env.LINKEDIN_CLIENT_ID);
    case 'x':
      return Boolean(env.X_CLIENT_ID);
    default:
      return false;
  }
}
