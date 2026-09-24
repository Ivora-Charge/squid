import Link from "next/link";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  ScanLine,
  Zap,
  Plug,
  Heart,
  Code2,
  Leaf,
} from "lucide-react";
import { Brand, Footer, SquidMark } from "@/components/ui";
export default function Home() {
  return (
    <div className="landing">
      <nav className="landing-nav">
        <Brand />
        <div className="nav-links">
          <a href="#how-it-works">How it works</a>
          <Link href="/developers">
            Built in the open <ArrowUpRight size={14} />
          </Link>
        </div>
        <Link className="button subtle" href="/login">
          Host sign in <ArrowRight size={16} />
        </Link>
      </nav>
      <main id="main">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="status-dot" /> GOOD ENERGY FOR GREAT HOSTS
            </div>
            <h1>
              A little charge.
              <br />A <em>better stay.</em>
            </h1>
            <p>
              Make your EV charger part of the welcome.
              <br className="desktop-only" /> Your guests scan, pay, and plug
              in. You earn a little
              <br className="desktop-only" /> extra, without the extra work.
            </p>
            <div className="hero-actions">
              <Link href="/login" className="button primary">
                Put your charger to work <ArrowUpRight size={19} />
              </Link>
              <Link className="text-link" href="/demo">
                Take a look around <ArrowRight size={17} />
              </Link>
            </div>
            <div className="hero-notes">
              <span>
                <Check size={15} /> No monthly subscription
              </span>
              <span>
                <Check size={15} /> Just a 6% Squid fee
              </span>
            </div>
          </div>
          <div className="hero-visual">
            <img
              src="/images/cabin.jpg"
              alt="A welcoming woodland vacation home"
              className="hero-photo"
            />
            <div className="photo-shade" />
            <div className="photo-caption">
              <span>LESS LIFE ADMIN.</span>
              <strong>More weekend.</strong>
            </div>
            <div className="floating-charge">
              <div className="mini-brand">
                <SquidMark />
                <span>squid</span>
                <span className="live-pill">
                  <span className="status-dot" /> Charging
                </span>
              </div>
              <div className="charge-amount">
                12.8 <span>kWh</span>
                <Zap size={32} />
              </div>
              <div className="mini-progress">
                <span />
              </div>
              <div className="mini-summary">
                <span>The Weekender</span>
                <strong>$4.48</strong>
              </div>
              <div className="mini-bottom">
                <Check size={13} /> A full battery for the next adventure.
              </div>
            </div>
            <div className="visual-tag">
              <Heart size={15} /> Small details. Happy guests.
            </div>
          </div>
        </section>
        <div className="trust-strip">
          <span>MADE FOR YOUR PLACE</span>
          <span>
            <Plug size={19} /> Your OCPP charger
          </span>
          <span>
            <ScanLine size={19} /> One little QR code
          </span>
          <span>
            <Leaf size={19} /> A lighter footprint
          </span>
          <span>
            <Code2 size={19} /> 100% open source
          </span>
        </div>
        <section id="how-it-works" className="how-section">
          <div className="section-top">
            <div>
              <p className="eyebrow">SIMPLE BY DESIGN</p>
              <h2>
                From driveway to paid charging.
                <br />
                <span className="muted">In three small steps.</span>
              </h2>
            </div>
            <Link href="/c/demo" className="text-link">
              Try the guest experience <ArrowUpRight size={17} />
            </Link>
          </div>
          <div className="step-grid">
            {[
              {
                number: "01",
                icon: Plug,
                title: "Connect your charger",
                text: "Bring your OCPP-compatible charger. We’ll walk you through connecting it to Squid.",
              },
              {
                number: "02",
                icon: ScanLine,
                title: "Give it a little sticker",
                text: "Set your price, print your unique QR code, and put it where guests can find it.",
              },
              {
                number: "03",
                icon: Zap,
                title: "Let good energy flow",
                text: "Guests scan and pay. Charging is measured, and your earnings go to your Stripe account.",
              },
            ].map((item) => (
              <article className="how-card" key={item.number}>
                <div className="how-card-top">
                  <item.icon size={25} />
                  <span>{item.number}</span>
                </div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="open-banner">
          <div className="open-icon">
            <Code2 size={30} />
          </div>
          <div>
            <p className="eyebrow">SMALL SQUID. OPEN OCEAN.</p>
            <h2>Your charging experience. Your code.</h2>
            <p>
              Built on the Ivora API. Powered by Supabase and Stripe Connect.
              <br />
              Open source and ready to make your own on Vercel.
            </p>
          </div>
          <Link href="/developers" className="button secondary">
            Explore the project <ArrowUpRight size={17} />
          </Link>
        </section>
      </main>
      <Footer />
    </div>
  );
}
