import { createFileRoute } from "@tanstack/react-router";
import { LegalPage, KivotosLegalIdentity } from "~/components/legal-page";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/privacy")({
  head: () =>
    pageMeta(
      "Privacy Policy - Kivotos",
      "What stays on your machines, and what the encrypted relay can see.",
      "/privacy",
    ),
  component: Privacy,
});

function Privacy() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="August 29, 2026">
      <p>
        Kivotos is local-first. Installing or using the open-source software does not send us your
        code, prompts, files, terminal output, or agent conversations. This policy explains the
        separate data boundaries for local Kivotos and the optional official relay.
      </p>

      <section>
        <h2>Who is responsible</h2>
        <KivotosLegalIdentity />
        <p>
          Mohamed Boudra Ziani is the data controller for personal data processed through the
          official Kivotos website and relay. Independently self-hosted daemons and relays are
          controlled by their operators and are not covered by this policy.
        </p>
      </section>

      <section>
        <h2>Local Kivotos apps and daemons</h2>
        <p>
          Kivotos runs on your machines. It does not send us analytics, telemetry, advertising
          identifiers, or crash reports.
        </p>
        <p>
          Packaged desktop apps check GitHub Releases for updates. GitHub receives the ordinary
          network information needed to answer that request under its own privacy policy.
        </p>
        <p>
          Agents such as Claude Code, Codex, and OpenCode communicate with their providers using
          credentials on your machine. Kivotos does not manage or intercept those provider API
          calls.
        </p>
      </section>

      <section>
        <h2>The official relay</h2>
        <p>The relay is optional. To connect your client and daemon, it processes:</p>
        <ul>
          <li>IP addresses and connection timing</li>
          <li>Session identifiers and public handshake keys</li>
          <li>Message sizes and aggregate bandwidth</li>
          <li>Temporary connection and routing state</li>
        </ul>
        <p>
          Your client and daemon encrypt application traffic end-to-end with NaCl box encryption.
          The relay carries ciphertext and cannot read your code, prompts, terminal output, or agent
          conversations. Payloads exist in relay memory only while being forwarded. We do not store
          message contents. Infrastructure may retain limited operational logs and aggregate metrics
          for security, capacity planning, and troubleshooting.
        </p>
      </section>

      <section>
        <h2>Why we process data</h2>
        <p>We process data to:</p>
        <ul>
          <li>Provide relay connectivity and support</li>
          <li>Authenticate users, daemons, and connected services</li>
          <li>Prevent abuse and protect the services</li>
          <li>Maintain operational and audit records</li>
          <li>Meet accounting, tax, and other legal obligations</li>
        </ul>
        <p>
          The legal bases are performance of our contract with you, our legitimate interests in
          operating and protecting the services, and compliance with legal obligations.
        </p>
      </section>

      <section>
        <h2>Service providers</h2>
        <p>
          We use Fly.io for hosted infrastructure, Stripe for subscriptions and payments, and GitHub
          for software releases and connected GitHub features. Slack, Discord, Linear, and other
          services receive data only when you choose to connect or use them.
        </p>
        <p>
          Some providers may process data outside the European Economic Area. Where required, we use
          appropriate contractual safeguards for those transfers.
        </p>
        <p>
          We do not sell personal data, share it with advertisers, or use it to train AI models.
        </p>
      </section>

      <section>
        <h2>Retention and deletion</h2>
        <p>
          We keep account and organization data while your account remains active. We retain
          operational, workflow, and audit records while needed to provide and protect the service.
          Billing records may be kept for legally required accounting and tax periods. Short-lived
          authorization codes and sessions expire automatically.
        </p>
        <p>
          You can request account deletion by emailing us. Some records may remain where the law
          requires it or where they form part of another organization&apos;s legitimate audit
          history.
        </p>
      </section>

      <section>
        <h2>Cookies</h2>
        <p>The marketing website does not use analytics or advertising cookies.</p>
      </section>

      <section>
        <h2>Your rights</h2>
        <p>
          Depending on applicable law, you may request access, correction, deletion, restriction,
          objection, or portability of your personal data. Email{" "}
          <a href="mailto:hello@moboudra.com">hello@moboudra.com</a>. You may also complain to the{" "}
          <a href="https://www.aepd.es/" target="_blank" rel="noopener noreferrer">
            Spanish Data Protection Agency
          </a>
          .
        </p>
      </section>

      <section>
        <h2>Security</h2>
        <p>
          We use access controls, encrypted transport, and limited service permissions. No online
          service can guarantee absolute security. Read Kivotos&apos;s{" "}
          <a
            href="https://github.com/getpaseo/paseo/blob/main/SECURITY.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            security model
          </a>{" "}
          or report a vulnerability privately to{" "}
          <a href="mailto:hello@moboudra.com">hello@moboudra.com</a>.
        </p>
      </section>

      <section>
        <h2>Children</h2>
        <p>
          The official services are for professional developers and are not directed at children
          under 16.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          We will update this page and its date when our services or data practices materially
          change.
        </p>
      </section>
    </LegalPage>
  );
}
