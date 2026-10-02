/** Tailwind runs alongside the hand-written styles.css. Preflight is off so the
 *  existing app UI is untouched — utilities are only used by the landing page. */
export default {
  content: ['./src/ui/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  plugins: [],
};
