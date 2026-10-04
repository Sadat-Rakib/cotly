import { LegalShell, Section } from '../components/LegalShell';

export function TermsPage() {
  return (
    <LegalShell title="Terms of" accent="Service." updated="October 3, 2026">
      <p className="text-white/70">
        These terms govern your use of Cotly, a personal scheduling tool that publishes your content to the social
        accounts you connect. By creating an account or using Cotly you agree to them.
      </p>

      <Section heading="What Cotly is">
        <p>
          Cotly lets you write a post, attach media, choose the accounts it should go to, and publish it now or at a
          time you pick. Cotly publishes through the official APIs of each platform, or through a bridge service you
          have explicitly connected. Cotly never posts through browser automation, scraping, or unofficial endpoints.
        </p>
      </Section>

      <Section heading="Your accounts">
        <p>
          You are responsible for the accounts you connect and for keeping your Cotly password safe. You must be
          allowed to publish to those accounts, and whatever you publish must comply with the terms of the platform
          it goes to. Cotly stores your platform access tokens encrypted and uses them only to publish what you
          scheduled.
        </p>
      </Section>

      <Section heading="Acceptable use">
        <p>
          Do not use Cotly to break a platform's rules, to spam, to harass, to spread malware, or to publish content
          you do not have the rights to. Do not use Cotly to circumvent platform rate limits or review processes. We
          may suspend accounts that put Cotly's ability to use official APIs at risk.
        </p>
      </Section>

      <Section heading="Your content">
        <p>
          You keep all rights to the captions and media you publish through Cotly. You give Cotly only the limited
          permission needed to store that content and deliver it to the platforms you selected, at the time you
          selected.
        </p>
      </Section>

      <Section heading="Scheduling and delivery">
        <p>
          Cotly schedules on your behalf and retries temporary failures automatically. Platforms can still reject a
          post, and scheduled publishing is best effort, not guaranteed. When a platform fails, Cotly shows exactly
          which target failed and why, and your successful posts stay successful.
        </p>
      </Section>

      <Section heading="Availability and changes">
        <p>
          We work to keep Cotly available, but we may change, suspend, or discontinue parts of the service. If we
          change these terms materially, we will tell you in the app before the change takes effect.
        </p>
      </Section>

      <Section heading="Liability">
        <p>
          Cotly is provided as is. To the extent permitted by law, Cotly is not liable for indirect or consequential
          damages, lost posts, platform account restrictions, or lost profits. Our total liability for any claim is
          limited to the amount you paid Cotly in the twelve months before it, or 50 USD if you paid nothing.
        </p>
      </Section>

      <Section heading="Termination">
        <p>
          You can stop using Cotly at any time by disconnecting your accounts and deleting your account. We may
          terminate accounts that violate these terms. On termination, we delete your stored platform tokens and
          scheduled posts, except where we must keep records by law.
        </p>
      </Section>

      <Section heading="Contact">
        <p>Questions about these terms: support@cotly.app.</p>
      </Section>
    </LegalShell>
  );
}
