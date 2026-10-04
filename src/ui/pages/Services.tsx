import { LegalShell, Section } from '../components/LegalShell';

// Platform review teams (Meta, Google, TikTok) ask for a plain description of
// what a service does before granting permissions. This page is that
// description, written for humans.

export function ServicesPage() {
  return (
    <LegalShell title="What Cotly" accent="does." updated="October 3, 2026">
      <p className="text-white/70">
        Cotly is a scheduling tool for your own social media content. You write a post once, attach media, choose the
        accounts it should go to, and either publish it immediately or schedule it for a specific time. Cotly then
        publishes it for you through official platform APIs.
      </p>

      <Section heading="How publishing works">
        <p>
          For each platform, Cotly uses that platform's official, documented API and the access token you granted it
          during login. When you schedule a post, Cotly stores the content and the time, and its scheduler publishes
          the post at that time. Cotly does not use browser automation, does not emulate logins, and does not use
          unofficial or reverse engineered endpoints.
        </p>
      </Section>

      <Section heading="Permissions Cotly requests">
        <p>
          Cotly requests only the scopes it needs to publish and read basic account identity. For example, for
          Facebook Pages it requests the ability to show the Pages you manage and to create posts on those Pages. It
          never posts to personal profiles. For Threads it requests basic profile and content publishing. Each
          platform's requested scopes are listed on its connection screen before you approve them.
        </p>
      </Section>

      <Section heading="What Cotly does not do">
        <p>
          Cotly does not read your feeds, does not analyze your audience, does not send messages on your behalf, and
          does not sell data. It publishes exactly the content you confirmed, to exactly the accounts you selected.
        </p>
      </Section>

      <Section heading="Bridges">
        <p>
          Some platforms can be reached through a bridge service, such as Buffer, when you explicitly connect one.
          When a post is published through a bridge instead of the platform's own API, Cotly shows it plainly, for
          example "via Buffer", in the account and diagnostics screens. Native official APIs are always the default
          route.
        </p>
      </Section>

      <Section heading="Data handling">
        <p>
          Cotly stores your login email, your captions and media, your schedule, and the encrypted access tokens of
          the accounts you connect. Tokens are encrypted at rest and are used only to publish what you scheduled.
          Full details are in the Privacy Policy.
        </p>
      </Section>

      <Section heading="Contact">
        <p>Questions about the service: support@cotly.app.</p>
      </Section>
    </LegalShell>
  );
}
