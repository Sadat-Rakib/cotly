import { LegalShell, Section } from '../components/LegalShell';

export function PrivacyPage() {
  return (
    <LegalShell title="Privacy" accent="Policy." updated="October 3, 2026">
      <p className="text-white/70">
        Cotly is a scheduling tool. This policy explains what it collects, why, how long it is kept, and how to get
        rid of it. The short version: Cotly stores only what it needs to publish what you scheduled, encrypts your
        platform tokens, and does not track you or sell anything.
      </p>

      <Section heading="What we collect">
        <p>
          <strong className="text-white/80">Account details.</strong> Your name (if you give it), email address,
          timezone, and a hashed password.
        </p>
        <p>
          <strong className="text-white/80">Connected platform tokens.</strong> The OAuth access and refresh tokens
          each platform returns when you connect an account, plus the account's display name, handle, and avatar URL.
          Tokens are encrypted at rest with AES-GCM and never shown in the app or sent to your browser.
        </p>
        <p>
          <strong className="text-white/80">Your content.</strong> Captions you write, images and videos you upload,
          and the schedule you choose. Media files are stored in object storage; metadata lives in the database.
        </p>
        <p>
          <strong className="text-white/80">Publishing records.</strong> Which platform each post went to, when it
          was published, and error messages returned by the platform, so failures can be shown and retried safely.
        </p>
      </Section>

      <Section heading="What we do not collect">
        <p>
          No analytics or tracking cookies, no advertising identifiers, no feed reading, no contact scraping, no
          behavioral profiling. The only cookie Cotly sets is your own login session.
        </p>
      </Section>

      <Section heading="How your data is used">
        <p>
          Only to run the service: to publish what you scheduled, to show you the state of your posts, to retry
          temporary failures, and to keep your sessions secure. Your access tokens are used solely to publish to the
          account they came from.
        </p>
      </Section>

      <Section heading="Sharing">
        <p>
          Your content is shared only with the platforms you selected for that post, through their official APIs, and
          with a bridge service if you explicitly connected one for that account (shown as "via Buffer" and similar).
          We do not sell data, and we do not share it with advertisers or data brokers. We may disclose information
          where the law requires it.
        </p>
      </Section>

      <Section heading="Storage and retention">
        <p>
          Account and publishing data are stored in a managed Postgres database; media files in private object
          storage. Uploaded media is kept while it is needed by a draft, a schedule, an active publish, or a retry,
          and cleaned up after a configurable retention window once a post reaches a final state. You can delete a
          post and its media at any time.
        </p>
      </Section>

      <Section heading="Your choices">
        <p>
          Disconnecting an account deletes its stored tokens immediately. Deleting a post deletes its content and
          media. Deleting your account deletes your profile, posts, media, and any remaining tokens. You can also
          revoke Cotly's access at any time from the connected platform's own settings; after that Cotly cannot
          publish to that account and marks it as needing reconnection.
        </p>
      </Section>

      <Section heading="Security">
        <p>
          Passwords are hashed, sessions are signed HttpOnly cookies, CSRF is enforced on every mutating request, and
          platform tokens are encrypted with a key held only on the server. No system is perfect; if you believe an
          account is compromised, change your Cotly password and revoke Cotly in the platform's settings.
        </p>
      </Section>

      <Section heading="Changes and contact">
        <p>
          If this policy changes materially, we will tell you in the app. Questions or deletion requests:
          support@cotly.app.
        </p>
      </Section>
    </LegalShell>
  );
}
