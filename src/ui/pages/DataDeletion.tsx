import { LegalShell, Section } from '../components/LegalShell';

// Meta app review requires a live "data deletion instructions URL". This page
// is that URL: it tells people exactly how their Cotly data (including the
// Meta platform data Cotly stores) gets deleted.

export function DataDeletionPage() {
  return (
    <LegalShell title="Data" accent="deletion." updated="October 4, 2026">
      <p className="text-white/70">
        Cotly stores a small amount of data when you connect a social account: your account identity on that platform
        (name, username or page name, profile picture), an encrypted access token so Cotly can publish for you, and
        the posts and media you create. Here is how to have all of it deleted.
      </p>

      <Section heading="Delete everything (recommended)">
        <p>
          Sign in to Cotly, open <strong className="text-white/80">Settings</strong>, and use the delete-account
          action. This deletes your Cotly profile, every connected account and its stored tokens, all posts, and all
          uploaded media immediately.
        </p>
      </Section>

      <Section heading="Disconnect one platform">
        <p>
          Sign in to Cotly, open <strong className="text-white/80">Accounts</strong>, and choose Disconnect on the
          account you want removed. The stored token and the platform account data are deleted from Cotly right away.
          You can also revoke Cotly from the platform's own settings at any time:
        </p>
        <p>
          Facebook and Instagram: Settings &gt; Apps and websites &gt; remove Cotly. Threads: Settings &gt; Website
          permissions &gt; remove Cotly.
        </p>
      </Section>

      <Section heading="Without signing in">
        <p>
          If you cannot sign in, email <strong className="text-white/80">support@cotly.app</strong> from the address
          on your Cotly account (or the address visible to the connected platform) and ask for deletion. We verify
          ownership and delete the data, and confirm by reply.
        </p>
      </Section>

      <Section heading="What deletion covers">
        <p>
          Deleting removes: your Cotly account details, the encrypted platform access tokens Cotly stored, the
          platform identity fields Cotly stored, your posts, captions and schedules, and your uploaded media.
          Deletion on Cotly's side does not remove posts that were already published to a platform; remove those on
          the platform itself if you want them gone.
        </p>
      </Section>

      <Section heading="Timing">
        <p>
          Deletion requests are processed immediately upon request. Platform-side revocations take effect as soon as
          you remove the app there.
        </p>
      </Section>
    </LegalShell>
  );
}
