import type { Provider } from '../contracts/types';

export const nowS = (): number => Math.floor(Date.now() / 1000);

export const PROVIDER_LABEL: Record<Provider, string> = {
  facebook: 'Facebook',
  threads: 'Threads',
  linkedin: 'LinkedIn',
  bluesky: 'Bluesky',
  instagram: 'Instagram',
  x: 'X',
  reddit: 'Reddit',
  mock: 'MockSocial',
  assisted: 'Assisted',
};

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
