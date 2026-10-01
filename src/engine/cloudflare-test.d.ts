/// <reference types="@cloudflare/vitest-pool-workers" />
import type { Env } from '../contracts/env';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}
