import Image from "next/image";
import { ContactForm } from "./contact-form";

const features = [
  { title: "Live dashboards", body: "Stream events from your product and watch metrics update in real time." },
  { title: "Funnels & cohorts", body: "Find out where users drop off and which cohorts retain best." },
  { title: "Privacy first", body: "EU hosting, no cookies required, and full control over retention." },
];

const plans = [
  { name: "Starter", price: "$0", items: ["10k events / month", "3 dashboards", "Community support"] },
  { name: "Team", price: "$49", items: ["1M events / month", "Unlimited dashboards", "Email support"], featured: true },
  { name: "Scale", price: "Custom", items: ["Unlimited events", "SSO & audit log", "Dedicated success manager"] },
];

const changelog = Array.from({ length: 14 }, (_, i) => ({
  version: `2.${14 - i}.0`,
  note: [
    "Faster chart rendering on large datasets",
    "New retention heatmap",
    "CSV export for every table",
    "Dark mode for embedded dashboards",
    "Slack alerts for anomaly detection",
    "Improved funnel step editor",
    "Team-level permissions",
  ][i % 7],
}));

export default function HomePage() {
  return (
    <>
      <header className="site-header">
        <a className="logo" href="#">
          <span className="logo-mark" aria-hidden /> Northwind
        </a>
        <nav>
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <a href="#changelog">Changelog</a>
          <a href="#contact">Contact</a>
        </nav>
      </header>

      <main>
        <section className="hero" data-testid="hero">
          <div>
            <p className="eyebrow">Product analytics</p>
            <h1>Understand your users without drowning in data.</h1>
            <p className="lead">
              Northwind turns raw product events into clear, shareable answers. Set up in minutes and invite your
              whole team.
            </p>
            <div className="hero-actions">
              <a className="button primary" href="#pricing">
                Start free trial
              </a>
              <a className="button" href="#features">
                See features
              </a>
            </div>
          </div>
          <Image src="/dashboard.svg" alt="Northwind dashboard preview" width={720} height={440} priority />
        </section>

        <section id="features" className="features">
          {features.map((f) => (
            <article key={f.title} className="card">
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </section>

        <section id="pricing">
          <h2>Pricing</h2>
          <div className="plans">
            {plans.map((p) => (
              <article key={p.name} className={`card plan${p.featured ? " featured" : ""}`}>
                <h3>{p.name}</h3>
                <p className="price">
                  {p.price}
                  {p.price.startsWith("$") && <small>/mo</small>}
                </p>
                <ul>
                  {p.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="split">
          <div id="changelog">
            <h2>Changelog</h2>
            <div className="scroll-box" data-testid="changelog">
              <ol>
                {changelog.map((c) => (
                  <li key={c.version}>
                    <strong>v{c.version}</strong> {c.note}
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <div>
            <h2>Docs preview</h2>
            <p className="muted">Embedded third-party content (cross-origin iframes can&apos;t be captured).</p>
            <iframe title="Embedded docs" src="https://example.com" className="embed" />
          </div>
        </section>

        <section id="contact">
          <h2>Talk to sales</h2>
          <ContactForm />
        </section>
      </main>

      <footer className="site-footer">© {new Date().getFullYear()} Northwind Analytics. Demo site for Pinpoint Feedback.</footer>
    </>
  );
}
