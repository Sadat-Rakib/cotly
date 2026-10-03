// Single source of truth for platform availability. The landing page reads
// this; the Accounts page and composer get their live connection state from
// the API on top of it. Never represent an unfinished integration as available.

export type PlatformState = 'available' | 'ready' | 'adapter' | 'coming';

export interface PlatformInfo {
  id: string;
  label: string;
  state: PlatformState;
  note: string;
}

export const STATE_LABEL: Record<PlatformState, string> = {
  available: 'Available',
  ready: 'Ready to connect',
  adapter: 'Adapter ready',
  coming: 'Coming soon',
};

export const PLATFORM_REGISTRY: PlatformInfo[] = [
  { id: 'bluesky', label: 'Bluesky', state: 'available', note: 'Connected and publishing end to end over AT Protocol.' },
  { id: 'facebook', label: 'Facebook Pages', state: 'ready', note: 'Publisher built. Add Meta app credentials, then connect a Page.' },
  { id: 'threads', label: 'Threads', state: 'ready', note: 'Publisher built on the official Threads API. Add Meta app credentials to connect.' },
  { id: 'linkedin', label: 'LinkedIn', state: 'adapter', note: 'Publisher built. Waiting on LinkedIn app credentials.' },
  { id: 'x', label: 'X', state: 'coming', note: 'Official pay-per-use API. Ships with hard spending guardrails.' },
  { id: 'mastodon', label: 'Mastodon', state: 'coming', note: 'Official API with native scheduling support on most servers.' },
  { id: 'telegram', label: 'Telegram', state: 'coming', note: 'Official Bot API for channels and groups.' },
  { id: 'instagram', label: 'Instagram', state: 'coming', note: 'Planned after the Meta app review is complete.' },
  { id: 'youtube', label: 'YouTube', state: 'coming', note: 'Uploads stay private until the Google API audit is done.' },
  { id: 'tiktok', label: 'TikTok', state: 'coming', note: 'Direct posting API, private posts until TikTok approves the client.' },
  { id: 'pinterest', label: 'Pinterest', state: 'coming', note: 'Pin creation through the official API is planned.' },
  { id: 'reddit', label: 'Reddit', state: 'coming', note: 'Developer Platform posting, approval required.' },
];
