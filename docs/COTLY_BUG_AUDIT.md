# COTLY_BUG_AUDIT

Honest audit of the real Cotly repo (not the previous wrong-folder work). Each
item: issue, root cause, files, change, reason, test, outcome, limitations.

## Context correction
The mission PRD describes a broken app (1,322 TS errors, Publish Now dead,
scheduling broken). Those symptoms belong to the WRONG folder. This repo's
verified baseline is GREEN (0 TS errors, 152 tests pass, clean build). The real
work was targeted hardening + verification, documented truthfully below.

## BUG-1 (Phase 1): Modal lacked accessibility + scroll hardening
- Issue: base Modal had no body scroll-lock, no focus trap, no focus restore,
  relied on CSS-only stacking. Per PRD Phase 1 these are required.
- Root cause: minimal initial implementation (overlay + Esc only, Esc actually
  lived in Lightbox not Modal).
- Files: src/ui/components/Modal.tsx.
- Change: ref-counted body overflow lock (safe for stacked modals), Tab focus
  trap, focus save on open + restore on unmount, Escape handled in Modal via
  capture-phase listener, optional disableDismiss + onBeforeClose for unsaved
  changes. Props kept backward-compatible (title/onClose/children).
- Reason: WCAG-aligned dialog semantics; prevents background scroll/focus escape.
- Test: typecheck PASS, build PASS, full suite 152 PASS (no regression). No DOM
  test runtime is configured (vitest uses workers+node projects only), so the
  a11y behavior is verified by typecheck/build + manual review, NOT a unit test.
- Limitation: no automated DOM test for focus trap; add happy-dom project later.

## BUG-2 (Phase 1): Lightbox could not navigate multiple attachments
- Issue: PRD requires multi-attachment support; Lightbox showed one item only.
- Files: src/ui/components/Lightbox.tsx, src/ui/components/MediaPicker.tsx,
  src/ui/styles.css.
- Change: optional items/index/onNavigate props; prev/next buttons + Left/Right
  arrow keys + "n of N" counter; MediaPicker passes the full ordered list and
  current index. Single-item callers unchanged.
- Reason: carousel posts have multiple media; reviewers must inspect each.
- Test: typecheck/build/suite green. Manual review of nav logic (wrap-around).
- Limitation: same as BUG-1 (no DOM unit test).

## VERIFIED-OK (audited, no defect found — NOT changed)
- Phase 2 account/reconnect lifecycle: correct. needs_reconnect only on genuine
  credential invalidation; transient 429/5xx/timeout -> retryable, status
  untouched; recovery resets connected. (publish.ts, accounts.ts, _shared.ts;
  reliability.test.ts.)
- Phase 3 Publish Now: single authority, duplicate-submit guard, idempotent,
  truthful DB-backed outcome, no swallowed success. (posts.ts, cron.ts;
  publish-verify.test.ts.)
- Phase 4 scheduling/cron/retries: atomic claim, bounded backoff, stale reclaim
  with generation safety, pending never republished, 24h cap, server-cron
  (browser-independent). (cron.ts, claim.ts, publish.ts; engine.test.ts,
  reliability.test.ts.)
