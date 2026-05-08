"use client";

import { useEffect } from "react";

const styles = `
  .muneem-root {
    --cream: #F5F0E8;
    --cream-2: #EFE8DC;
    --ink: #1A1614;
    --ink-2: #2B2521;
    --muted: #8B7E6E;
    --rule: #D9CFBF;
    --crimson: #7A1818;
    --crimson-deep: #5E1010;
    --crimson-soft: #9B2828;
    background: var(--cream);
    color: var(--ink);
    font-family: "DM Sans", ui-sans-serif, system-ui, sans-serif;
    font-feature-settings: "ss01";
    -webkit-font-smoothing: antialiased;
    min-height: 100vh;
  }
  .muneem-root .font-display { font-family: "Fraunces", ui-serif, Georgia, serif; font-optical-sizing: auto; font-variation-settings: "SOFT" 50, "WONK" 0; letter-spacing: -0.015em; }
  .muneem-root .font-display-wonk { font-family: "Fraunces", ui-serif, Georgia, serif; font-optical-sizing: auto; font-variation-settings: "SOFT" 100, "WONK" 1; }
  .muneem-root .text-crimson { color: var(--crimson); }
  .muneem-root .bg-crimson { background: var(--crimson); }
  .muneem-root .border-crimson { border-color: var(--crimson); }
  .muneem-root .text-ink { color: var(--ink); }
  .muneem-root .text-muted { color: var(--muted); }
  .muneem-root .bg-cream { background: var(--cream); }
  .muneem-root .bg-cream-2 { background: var(--cream-2); }
  .muneem-root .border-rule { border-color: var(--rule); }

  .muneem-root .hairline { height: 1px; background: var(--rule); }
  .muneem-root .hairline-strong { height: 1px; background: var(--ink); opacity: .85; }

  .muneem-root .reveal { opacity: 0; transform: translateY(14px); transition: opacity .9s cubic-bezier(.2,.7,.2,1), transform .9s cubic-bezier(.2,.7,.2,1); }
  .muneem-root .reveal.in { opacity: 1; transform: none; }

  .muneem-root .btn-primary {
    background: var(--crimson);
    color: #FBF7F0;
    transition: background .25s ease, transform .25s ease, box-shadow .25s ease;
    box-shadow: 0 1px 0 rgba(0,0,0,.04);
  }
  .muneem-root .btn-primary:hover { background: var(--crimson-deep); transform: translateY(-1px); }
  .muneem-root .btn-ghost {
    border: 1px solid var(--ink);
    color: var(--ink);
    transition: background .25s ease, color .25s ease, transform .25s ease;
  }
  .muneem-root .btn-ghost:hover { background: var(--ink); color: var(--cream); transform: translateY(-1px); }

  .muneem-root .ulink { position: relative; }
  .muneem-root .ulink::after { content:""; position:absolute; left:0; right:0; bottom:-3px; height:1px; background: currentColor; transform: scaleX(0); transform-origin: left center; transition: transform .35s cubic-bezier(.2,.7,.2,1); }
  .muneem-root .ulink:hover::after { transform: scaleX(1); }

  .muneem-root .entry-card {
    background: var(--cream);
    border: 1px solid var(--rule);
    transition: border-color .3s ease, transform .3s ease, background .3s ease;
    display: block;
  }
  .muneem-root .entry-card:hover {
    border-color: var(--ink);
    transform: translateY(-2px);
  }
  .muneem-root .entry-card .arrow { transition: transform .35s cubic-bezier(.2,.7,.2,1); display:inline-block; }
  .muneem-root .entry-card:hover .arrow { transform: translateX(6px); }
  .muneem-root .entry-card.crimson:hover { background: var(--crimson); color: #FBF7F0; border-color: var(--crimson); }
  .muneem-root .entry-card.crimson:hover .role-meta,
  .muneem-root .entry-card.crimson:hover .role-list li::before { color: #E9C9C9; }
  .muneem-root .entry-card.crimson:hover .role-list { border-color: rgba(255,255,255,.18); }

  .muneem-root .glyph {
    width: 22px; height: 22px; border-radius: 999px;
    background: var(--crimson);
    display: inline-block; position: relative;
  }
  .muneem-root .glyph::after {
    content:""; position:absolute; left: 50%; top: 50%;
    width: 8px; height: 8px; border-radius: 999px;
    background: var(--cream); transform: translate(-50%,-50%);
  }

  .muneem-root .step-num {
    font-family: "Fraunces", serif; font-variation-settings: "SOFT" 100;
    font-size: 56px; line-height: 1; color: var(--crimson); font-weight: 400;
  }

  .muneem-root .trust-row { letter-spacing: .14em; text-transform: uppercase; font-size: 11px; color: var(--muted); }

  .muneem-root .noise::before {
    content:""; position:absolute; inset:0; pointer-events:none; opacity:.04;
    background-image: radial-gradient(rgba(0,0,0,.6) 1px, transparent 1px);
    background-size: 3px 3px;
  }

  .muneem-root .nav-blur { backdrop-filter: saturate(140%) blur(8px); background: rgba(245,240,232,0.78); }

  .muneem-root .flink { color: var(--ink); opacity: .75; }
  .muneem-root .flink:hover { opacity: 1; }

  .muneem-root .h-display { font-size: clamp(44px, 7.4vw, 112px); line-height: 0.96; letter-spacing: -0.025em; }
  .muneem-root .h-section { font-size: clamp(30px, 3.6vw, 52px); line-height: 1.04; letter-spacing: -0.02em; }
  .muneem-root .h-eyebrow { font-size: 11px; letter-spacing: .22em; text-transform: uppercase; color: var(--muted); }

  .muneem-root .doc-chip {
    border: 1px solid var(--rule); background: var(--cream);
    border-radius: 6px; padding: 10px 12px; font-size: 12px; color: var(--ink-2);
    display: inline-flex; align-items: center; gap: 8px;
  }
  .muneem-root .doc-chip .dot { width:6px; height:6px; border-radius:999px; background: var(--crimson); }

  .muneem-root .ledger { font-family: "DM Sans"; font-size: 12.5px; }
  .muneem-root .ledger .row { display: grid; grid-template-columns: 88px 1fr 96px 96px; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--rule); }
  .muneem-root .ledger .row.head { color: var(--muted); font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; border-bottom-color: var(--ink); }
  .muneem-root .num { font-variant-numeric: tabular-nums; text-align: right; }

  .muneem-root .sec-divider { display:flex; align-items:center; gap: 16px; }
  .muneem-root .sec-divider .line { flex:1; height:1px; background: var(--rule); }

  .muneem-root .sq { width:8px; height:8px; background: var(--crimson); display:inline-block; }

  .muneem-root .index-num { font-family:"Fraunces"; font-variation-settings:"SOFT" 100; color: var(--muted); font-size: 12px; letter-spacing: .14em; }

  .muneem-root .pill {
    border: 1px solid var(--ink);
    transition: background .25s ease, color .25s ease;
  }
  .muneem-root .pill:hover { background: var(--ink); color: var(--cream); }

  .muneem-root .ba-card { background: var(--ink); color: #F1ECE3; border-radius: 4px; }

  .muneem-root ::selection { background: var(--crimson); color: #FBF7F0; }

  /* Layout helpers (replacing Tailwind CDN) */
  .muneem-root .container-x { max-width: 1280px; margin-left: auto; margin-right: auto; padding-left: 24px; padding-right: 24px; }
  @media (min-width: 768px) { .muneem-root .container-x { padding-left: 40px; padding-right: 40px; } }

  .muneem-root .nav-wrap { position: fixed; top:0; left:0; right:0; z-index:50; border-bottom: 1px solid var(--rule); }
  .muneem-root .nav-inner { max-width:1280px; margin:0 auto; padding: 0 24px; height:64px; display:flex; align-items:center; justify-content:space-between; }
  @media (min-width: 768px) { .muneem-root .nav-inner { padding: 0 40px; } }
  .muneem-root .nav-links { display:none; gap: 32px; align-items:center; font-size: 14px; }
  @media (min-width: 768px) { .muneem-root .nav-links { display:flex; } }
  .muneem-root .nav-brand { display:flex; align-items:center; gap: 12px; text-decoration:none; color: var(--ink); }
  .muneem-root .nav-brand-text { font-size: 22px; line-height: 1; letter-spacing: -0.015em; }

  .muneem-root main.pt { padding-top: 64px; }

  .muneem-root .hero { position: relative; }
  .muneem-root .hero-inner { padding-top: 64px; padding-bottom: 80px; }
  @media (min-width: 768px) { .muneem-root .hero-inner { padding-top: 96px; padding-bottom: 112px; } }

  .muneem-root .eyebrow-rail { display:flex; align-items:center; justify-content:space-between; margin-bottom: 40px; }
  @media (min-width: 768px) { .muneem-root .eyebrow-rail { margin-bottom: 56px; } }
  .muneem-root .eyebrow-rail .left { display:flex; align-items:center; gap: 12px; }
  .muneem-root .eyebrow-rail .right { display:none; align-items:center; gap: 24px; }
  @media (min-width: 768px) { .muneem-root .eyebrow-rail .right { display:flex; } }

  .muneem-root .grid12 { display:grid; gap: 24px; }
  @media (min-width: 768px) { .muneem-root .grid12 { grid-template-columns: repeat(12, minmax(0,1fr)); gap: 40px; } }
  .muneem-root .col-6 { grid-column: span 12 / span 12; }
  .muneem-root .col-7 { grid-column: span 12 / span 12; }
  .muneem-root .col-5 { grid-column: span 12 / span 12; }
  .muneem-root .col-8 { grid-column: span 12 / span 12; }
  .muneem-root .col-4 { grid-column: span 12 / span 12; }
  .muneem-root .col-3 { grid-column: span 12 / span 12; }
  .muneem-root .col-2 { grid-column: span 12 / span 12; }
  @media (min-width: 768px) {
    .muneem-root .col-6 { grid-column: span 6 / span 6; }
    .muneem-root .col-7 { grid-column: span 7 / span 7; }
    .muneem-root .col-5 { grid-column: span 5 / span 5; }
    .muneem-root .col-8 { grid-column: span 8 / span 8; }
    .muneem-root .col-4 { grid-column: span 4 / span 4; }
    .muneem-root .col-3 { grid-column: span 3 / span 3; }
    .muneem-root .col-2 { grid-column: span 2 / span 2; }
    .muneem-root .col-5-start8 { grid-column: 8 / span 5; }
  }

  .muneem-root .sub-grid { display:grid; gap: 24px; margin-top: 40px; }
  @media (min-width: 768px) { .muneem-root .sub-grid { margin-top: 56px; gap: 40px; } }

  .muneem-root .h1 { font-weight: 400; }
  .muneem-root .h1 .italic { font-style: italic; }

  .muneem-root .entry-grid { display:grid; gap: 20px; }
  @media (min-width: 768px) { .muneem-root .entry-grid { grid-template-columns: repeat(2, minmax(0,1fr)); gap: 24px; } }

  .muneem-root .entry-card { padding: 28px; border-radius: 4px; text-decoration: none; color: inherit; }
  @media (min-width: 768px) { .muneem-root .entry-card { padding: 36px; } }
  .muneem-root .entry-card .top { display:flex; align-items:flex-start; justify-content:space-between; }
  .muneem-root .entry-card h3 { font-size: 34px; line-height: 1.05; margin-top: 16px; font-weight: 400; }
  @media (min-width: 768px) { .muneem-root .entry-card h3 { font-size: 40px; } }
  .muneem-root .role-list { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--rule); display:grid; grid-template-columns: 1fr; gap: 12px; font-size: 12.5px; list-style:none; padding-left: 0; }
  @media (min-width: 640px) { .muneem-root .role-list { grid-template-columns: repeat(3, minmax(0,1fr)); } }
  .muneem-root .role-list li { display:flex; align-items:center; gap: 8px; }
  .muneem-root .role-list li .bullet { width: 4px; height: 4px; border-radius: 999px; background: currentColor; opacity: .6; display:inline-block; }

  .muneem-root section.bordered { border-top: 1px solid var(--rule); }
  .muneem-root section.padded { padding-top: 80px; padding-bottom: 80px; }
  @media (min-width: 768px) { .muneem-root section.padded { padding-top: 112px; padding-bottom: 112px; } }

  .muneem-root .three-col { display:grid; gap: 40px; margin-top: 56px; }
  @media (min-width: 768px) { .muneem-root .three-col { grid-template-columns: repeat(3, minmax(0,1fr)); gap: 48px; } }

  .muneem-root .step-card .top { display:flex; align-items:flex-start; justify-content:space-between; border-top: 1px solid var(--ink); padding-top: 20px; }
  .muneem-root .step-card h3 { font-size: 26px; margin-top: 24px; line-height: 1.15; font-weight: 400; }
  .muneem-root .step-card p { margin-top: 16px; font-size: 14.5px; line-height: 1.65; color: var(--muted); }

  .muneem-root .cta-strip { margin-top: 64px; display:flex; flex-direction:column; gap: 24px; align-items:flex-start; justify-content:space-between; }
  @media (min-width: 768px) { .muneem-root .cta-strip { margin-top: 80px; flex-direction: row; align-items: center; } }

  .muneem-root .stats-grid { display:grid; gap: 32px; }
  @media (min-width: 640px) { .muneem-root .stats-grid { grid-template-columns: repeat(3, minmax(0,1fr)); } }
  .muneem-root .stat { border-top: 1px solid var(--ink); padding-top: 20px; }
  .muneem-root .stat .num-big { font-size: 44px; line-height: 1; color: var(--crimson); font-weight: 400; }

  .muneem-root .trust-strip { margin-top: 56px; padding-top: 32px; border-top: 1px solid var(--rule); display:flex; flex-direction:column; gap: 16px; align-items:flex-start; justify-content:space-between; }
  @media (min-width: 768px) { .muneem-root .trust-strip { flex-direction: row; align-items: center; } }
  .muneem-root .trust-strip .cities { display:flex; flex-wrap:wrap; column-gap: 32px; row-gap: 8px; }

  .muneem-root .ba-card { padding: 28px; height: 100%; display:flex; flex-direction:column; justify-content:space-between; }
  @media (min-width: 768px) { .muneem-root .ba-card { padding: 36px; } }

  .muneem-root .closing { padding-top: 80px; padding-bottom: 80px; text-align:center; border-top: 1px solid var(--rule); }
  @media (min-width: 768px) { .muneem-root .closing { padding-top: 112px; padding-bottom: 112px; } }

  .muneem-root footer.f { border-top: 1px solid var(--rule); }
  .muneem-root footer.f .inner { max-width: 1280px; margin: 0 auto; padding: 48px 24px; }
  @media (min-width: 768px) { .muneem-root footer.f .inner { padding: 56px 40px; } }
  .muneem-root footer.f .grid { display:grid; gap: 32px; }
  @media (min-width: 768px) { .muneem-root footer.f .grid { grid-template-columns: repeat(12, minmax(0,1fr)); } }
  .muneem-root footer.f ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; font-size: 13.5px; }
  .muneem-root footer.f .bottom { margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--rule); display:flex; flex-direction:column; gap: 16px; align-items:flex-start; justify-content:space-between; }
  @media (min-width: 768px) { .muneem-root footer.f .bottom { flex-direction: row; align-items: center; } }
`;

export default function MuneemJiPage() {
  useEffect(() => {
    const els = document.querySelectorAll(".muneem-root .reveal");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="muneem-root">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600;9..144,700&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: styles }} />

      {/* NAV */}
      <header className="nav-wrap nav-blur">
        <nav className="nav-inner">
          <a href="#" className="nav-brand">
            <span className="glyph" />
            <span className="font-display nav-brand-text">Muneem Ji</span>
          </a>
          <div className="nav-links">
            <a href="#for-cas" className="ulink">For CAs</a>
            <a href="#for-owners" className="ulink">For Business Owners</a>
            <a href="#find-ca" className="ulink">Find a CA</a>
            <a href="#" className="ulink text-muted">Sign in</a>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <a
              href="/join-waitlist"
              className="btn-primary"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 16px",
                borderRadius: 3,
                fontSize: 13.5,
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              Join waitlist <span aria-hidden>→</span>
            </a>
          </div>
        </nav>
      </header>

      <main className="pt">
        {/* HERO */}
        <section className="hero">
          <div className="container-x hero-inner">
            <div className="eyebrow-rail reveal">
              <div className="left">
                <span className="sq" />
                <span className="h-eyebrow">A practice operating system</span>
              </div>
              <div className="right trust-row">
                <span>Est. 2026</span>
                <span className="hairline" style={{ width: 40 }} />
                <span>India · Canada · Ireland</span>
              </div>
            </div>

            <h1 className="font-display h-display reveal h1">
              Where the<br />
              <span className="font-display-wonk italic text-crimson">paperwork</span> ends<br />
              and the books begin.
            </h1>

            <div className="grid12 sub-grid">
              <div className="col-6 reveal">
                <p
                  style={{
                    fontSize: 20,
                    lineHeight: 1.5,
                    color: "var(--ink-2)",
                    maxWidth: "34ch",
                  }}
                >
                  Muneem Ji is a practice OS for Chartered Accountants — a branded website,
                  a clean way to collect client documents, and a double-entry day book at the end of it.
                </p>
              </div>
              <div className="col-5 col-5-start8 reveal">
                <p style={{ fontSize: 14.5, lineHeight: 1.65, color: "var(--muted)" }}>
                  Zoho Books assumes your documents are already organised.
                  We are what gets them organised — the messy step{" "}
                  <em className="font-display italic" style={{ color: "var(--ink-2)" }}>
                    before
                  </em>{" "}
                  any ledger can be written.
                </p>
              </div>
            </div>

            {/* Split entry */}
            <div id="cta" style={{ marginTop: 80 }}>
              <div className="sec-divider" style={{ marginBottom: 32 }}>
                <span className="h-eyebrow">Choose your entry</span>
                <span className="line" />
                <span className="index-num">01 / 02</span>
              </div>
              <div className="entry-grid">
                <a href="#for-cas" className="entry-card crimson reveal">
                  <div className="top">
                    <div className="h-eyebrow role-meta">For practising CAs</div>
                    <span className="arrow" style={{ fontSize: 22, lineHeight: 1 }}>→</span>
                  </div>
                  <h3 className="font-display">I&rsquo;m a Chartered Accountant</h3>
                  <p style={{ marginTop: 12, fontSize: 14.5, lineHeight: 1.6, color: "var(--muted)" }} className="role-meta">
                    Get a website under your own brand, collect documents from every client, and export a clean day book.
                  </p>
                  <ul className="role-list">
                    <li><span className="bullet" /> Branded site</li>
                    <li><span className="bullet" /> Document intake</li>
                    <li><span className="bullet" /> Day book export</li>
                  </ul>
                </a>

                <a href="#for-owners" className="entry-card reveal">
                  <div className="top">
                    <div className="h-eyebrow role-meta">For business owners</div>
                    <span className="arrow" style={{ fontSize: 22, lineHeight: 1 }}>→</span>
                  </div>
                  <h3 className="font-display">I run a business</h3>
                  <p style={{ marginTop: 12, fontSize: 14.5, lineHeight: 1.6, color: "var(--muted)" }}>
                    Find a Chartered Accountant on Muneem Ji — or start organising your own documents while you look.
                  </p>
                  <ul className="role-list">
                    <li><span className="bullet" /> Find a CA</li>
                    <li><span className="bullet" /> Document vault</li>
                    <li><span className="bullet" /> Hand off cleanly</li>
                  </ul>
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* PROBLEM / VALUE */}
        <section className="bordered">
          <div className="container-x padded">
            <div className="sec-divider reveal" style={{ marginBottom: 48 }}>
              <span className="h-eyebrow">The problem we solve</span>
              <span className="line" />
              <span className="index-num">— ch. one</span>
            </div>

            <div className="grid12">
              <div className="col-7 reveal">
                <h2 className="font-display h-section" style={{ fontWeight: 400 }}>
                  Bookkeeping software begins where{" "}
                  <span className="font-display-wonk italic text-crimson">the real work ends</span>.
                </h2>
                <p style={{ marginTop: 24, fontSize: 17, lineHeight: 1.65, maxWidth: "58ch", color: "var(--ink-2)" }}>
                  Every CA already has a stack of WhatsApp messages, courier envelopes, and forwarded
                  emails. Bank statements arrive late. Invoices arrive in three formats. By the time
                  a ledger can be written, the month is already gone. Muneem Ji is built for the
                  forty hours that happen <em className="font-display italic">before</em> Tally opens.
                </p>
              </div>

              <div className="col-5 reveal">
                <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 24 }}>
                  {[
                    { n: "01", k: "collection", t: "Clients send what you ask for, in the format you asked for." },
                    { n: "02", k: "order", t: "Statements, invoices and receipts land in one shared, searchable place." },
                    { n: "03", k: "output", t: "Out comes a tidy double-entry day book — ready for whatever ledger you keep." },
                  ].map((item) => (
                    <li key={item.n} style={{ borderTop: "1px solid var(--rule)", paddingTop: 20 }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                        <span className="index-num">{item.n}</span>
                        <span className="h-eyebrow">{item.k}</span>
                      </div>
                      <p className="font-display" style={{ fontSize: 22, marginTop: 8, lineHeight: 1.35, fontWeight: 400 }}>
                        {item.t}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="for-cas" className="bordered noise" style={{ background: "var(--cream-2)", position: "relative" }}>
          <div className="container-x padded">
            <div className="sec-divider reveal" style={{ marginBottom: 48 }}>
              <span className="h-eyebrow">How it works · for CAs</span>
              <span className="line" />
              <span className="index-num">— ch. two</span>
            </div>

            <h2 className="font-display h-section reveal" style={{ fontWeight: 400, maxWidth: "22ch" }}>
              Three movements. One quiet practice.
            </h2>

            <div className="three-col">
              <div className="reveal step-card">
                <div className="top">
                  <span className="step-num">01</span>
                  <span className="h-eyebrow">Set up</span>
                </div>
                <h3 className="font-display">A website, in your name, by tomorrow morning.</h3>
                <p>
                  Tell us about your practice. We draft a clean, AI-generated site under your own brand —
                  ready to share with prospects and clients.
                </p>
                <div className="doc-chip" style={{ marginTop: 24 }}>
                  <span className="dot" />
                  yourname.muneem.ji
                </div>
              </div>

              <div className="reveal step-card">
                <div className="top">
                  <span className="step-num">02</span>
                  <span className="h-eyebrow">Collect</span>
                </div>
                <h3 className="font-display">Documents arrive where you need them.</h3>
                <p>
                  Every client gets a private space to upload bank statements, invoices and receipts.
                  Reminders go out. You stop chasing.
                </p>
                <div style={{ marginTop: 24, display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <span className="doc-chip">Bank statement · Mar</span>
                  <span className="doc-chip">GST invoices</span>
                  <span className="doc-chip">Petty cash</span>
                </div>
              </div>

              <div className="reveal step-card">
                <div className="top">
                  <span className="step-num">03</span>
                  <span className="h-eyebrow">Export</span>
                </div>
                <h3 className="font-display">A double-entry day book, on the first of the month.</h3>
                <p>
                  Out comes a clean day book — debit and credit, line by line — ready to import into
                  whichever ledger your firm keeps.
                </p>
                <div
                  className="ledger"
                  style={{
                    marginTop: 24,
                    padding: 16,
                    background: "var(--cream)",
                    border: "1px solid var(--rule)",
                    borderRadius: 3,
                  }}
                >
                  <div className="row head">
                    <span>Date</span><span>Particulars</span><span className="num">Dr</span><span className="num">Cr</span>
                  </div>
                  <div className="row">
                    <span>03 Apr</span><span>HDFC · Inward</span><span className="num">42,500</span><span className="num">—</span>
                  </div>
                  <div className="row">
                    <span>03 Apr</span><span>Sales · Invoice 218</span><span className="num">—</span><span className="num">42,500</span>
                  </div>
                  <div className="row" style={{ borderBottom: "none" }}>
                    <span>04 Apr</span><span>Office rent</span><span className="num">—</span><span className="num">28,000</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="cta-strip reveal">
              <p className="font-display" style={{ fontSize: 28, lineHeight: 1.2, maxWidth: "40ch", fontWeight: 400 }}>
                Built for practising CAs in India, Canada and Ireland.
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <a
                  href="#"
                  className="btn-primary"
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 20px", borderRadius: 3, fontSize: 14, fontWeight: 500, textDecoration: "none" }}
                >
                  Start your practice site <span aria-hidden>→</span>
                </a>
                <a
                  href="#"
                  className="btn-ghost"
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 20px", borderRadius: 3, fontSize: 14, fontWeight: 500, textDecoration: "none" }}
                >
                  Book a 15-min walk-through
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* TRUST */}
        <section className="bordered">
          <div className="container-x" style={{ paddingTop: 80, paddingBottom: 80 }}>
            <div className="grid12" style={{ alignItems: "flex-start" }}>
              <div className="col-4 reveal">
                <div className="h-eyebrow">Why CAs choose us</div>
                <h3 className="font-display" style={{ marginTop: 12, fontSize: 34, lineHeight: 1.1, fontWeight: 400 }}>
                  Refined by the firms that use it daily.
                </h3>
              </div>
              <div className="col-8 reveal">
                <div className="stats-grid">
                  <div className="stat">
                    <div className="font-display num-big">40h</div>
                    <p style={{ marginTop: 12, fontSize: 13.5, lineHeight: 1.55, color: "var(--muted)" }}>
                      average time saved per practice, per month — collecting documents instead of chasing them.
                    </p>
                  </div>
                  <div className="stat">
                    <div className="font-display num-big">3 in 1</div>
                    <p style={{ marginTop: 12, fontSize: 13.5, lineHeight: 1.55, color: "var(--muted)" }}>
                      a website, a client portal, and a day book — under one practice, one login.
                    </p>
                  </div>
                  <div className="stat">
                    <div className="font-display num-big">0&nbsp;learn-curve</div>
                    <p style={{ marginTop: 12, fontSize: 13.5, lineHeight: 1.55, color: "var(--muted)" }}>
                      no migration, no Tally retraining. Sits beside your existing books.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="trust-strip reveal">
              <div className="trust-row">In quiet use by independent practices in</div>
              <div className="cities trust-row">
                <span>Mumbai</span><span>Bengaluru</span><span>Delhi NCR</span>
                <span>Toronto</span><span>Dublin</span><span>Ahmedabad</span>
              </div>
            </div>
          </div>
        </section>

        {/* FOR BUSINESS OWNERS */}
        <section id="for-owners" className="bordered">
          <div className="container-x padded">
            <div className="sec-divider reveal" style={{ marginBottom: 48 }}>
              <span className="h-eyebrow">For business owners</span>
              <span className="line" />
              <span className="index-num">— ch. three</span>
            </div>

            <div className="grid12" style={{ alignItems: "stretch" }}>
              <div className="col-7 reveal">
                <h2 className="font-display h-section" style={{ maxWidth: "20ch", fontWeight: 400 }}>
                  No CA yet?{" "}
                  <span className="font-display-wonk italic text-crimson">Get your documents in order</span> first.
                </h2>
                <p style={{ marginTop: 24, fontSize: 17, lineHeight: 1.65, maxWidth: "58ch", color: "var(--ink-2)" }}>
                  A private vault for your bank statements, invoices and receipts —
                  so when you do find the right Chartered Accountant, you hand them
                  a tidy stack on day one, not a shoebox.
                </p>

                <div id="find-ca" style={{ marginTop: 32, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
                  <a
                    href="#"
                    className="btn-primary"
                    style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 20px", borderRadius: 3, fontSize: 14, fontWeight: 500, textDecoration: "none" }}
                  >
                    Find a CA on Muneem Ji <span aria-hidden>→</span>
                  </a>
                  <a
                    href="#"
                    className="pill"
                    style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 20px", borderRadius: 3, fontSize: 14, fontWeight: 500, textDecoration: "none", color: "var(--ink)" }}
                  >
                    Start a vault on your own
                  </a>
                </div>

                <p style={{ marginTop: 24, fontSize: 12.5, color: "var(--muted)", maxWidth: "52ch" }}>
                  Already working with someone? Invite them — Muneem Ji works the same whether
                  your accountant is on the platform or not.
                </p>
              </div>

              <aside className="col-5 reveal">
                <div className="ba-card">
                  <div>
                    <div className="h-eyebrow" style={{ color: "#C9BFAE" }}>Independent plan</div>
                    <div style={{ marginTop: 24, display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span className="font-display" style={{ fontSize: 64, lineHeight: 1, fontWeight: 400 }}>₹199</span>
                      <span style={{ fontSize: 13.5, color: "#C9BFAE" }}>/ month</span>
                    </div>
                    <p style={{ marginTop: 16, fontSize: 14, lineHeight: 1.6, color: "#D9D0C0" }}>
                      For business owners who want to organise their documents before — or instead of —
                      hiring a CA.
                    </p>

                    <ul style={{ listStyle: "none", padding: 0, margin: "28px 0 0", display: "flex", flexDirection: "column", gap: 12, fontSize: 13.5, color: "#E9E1D2" }}>
                      {[
                        "Private document vault",
                        "Bank-statement & invoice intake",
                        "One-click hand-off to any CA",
                      ].map((t) => (
                        <li key={t} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                          <span style={{ marginTop: 7, width: 6, height: 6, background: "var(--crimson-soft)", borderRadius: 999, flexShrink: 0 }} />
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid rgba(255,255,255,0.12)" }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                      <div>
                        <div className="h-eyebrow" style={{ color: "#C9BFAE" }}>When you link a CA</div>
                        <div className="font-display" style={{ fontSize: 36, lineHeight: 1, marginTop: 8, fontWeight: 400, color: "#FBF7F0" }}>
                          It drops to <span className="font-display-wonk italic" style={{ color: "#E89A9A" }}>zero.</span>
                        </div>
                      </div>
                    </div>
                    <p style={{ marginTop: 12, fontSize: 12.5, color: "#B9AE9C" }}>
                      Connect any CA already on Muneem Ji and your subscription is on the house —
                      they take it from there.
                    </p>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </section>

        {/* CLOSING */}
        <section>
          <div className="container-x closing">
            <div className="reveal">
              <p className="h-eyebrow" style={{ marginBottom: 24 }}>A small note from us</p>
              <p className="font-display" style={{ fontSize: 40, lineHeight: 1.15, maxWidth: "26ch", margin: "0 auto", fontWeight: 400 }}>
                &ldquo;Muneem Ji&rdquo; means{" "}
                <span className="font-display-wonk italic text-crimson">the accountant</span> —
                the trusted one, the one who knows where everything is.
              </p>
              <p style={{ marginTop: 24, fontSize: 13.5, color: "var(--muted)", maxWidth: "44ch", margin: "24px auto 0" }}>
                We named the product after the people we built it for.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="f">
        <div className="inner">
          <div className="grid">
            <div className="col-5">
              <a href="#" className="nav-brand">
                <span className="glyph" />
                <span className="font-display nav-brand-text">Muneem Ji</span>
              </a>
              <p style={{ marginTop: 16, fontSize: 13.5, color: "var(--muted)", maxWidth: "36ch" }}>
                A practice operating system for Chartered Accountants — and the businesses they keep tidy.
              </p>
            </div>

            <div className="col-3">
              <div className="h-eyebrow" style={{ marginBottom: 16 }}>For CAs</div>
              <ul>
                <li><a href="#" className="flink ulink">Practice website</a></li>
                <li><a href="#" className="flink ulink">Document intake</a></li>
                <li><a href="#" className="flink ulink">Day-book export</a></li>
                <li><a href="#" className="flink ulink">Pricing</a></li>
              </ul>
            </div>

            <div className="col-2">
              <div className="h-eyebrow" style={{ marginBottom: 16 }}>For owners</div>
              <ul>
                <li><a href="#" className="flink ulink">Find a CA</a></li>
                <li><a href="#" className="flink ulink">Document vault</a></li>
                <li><a href="#" className="flink ulink">How hand-off works</a></li>
              </ul>
            </div>

            <div className="col-2">
              <div className="h-eyebrow" style={{ marginBottom: 16 }}>Company</div>
              <ul>
                <li><a href="#" className="flink ulink">About</a></li>
                <li><a href="#" className="flink ulink">Contact</a></li>
                <li><a href="#" className="flink ulink">Privacy</a></li>
              </ul>
            </div>
          </div>

          <div className="bottom">
            <div className="trust-row" style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span>India</span><span className="hairline" style={{ width: 24 }} />
              <span>Canada</span><span className="hairline" style={{ width: 24 }} />
              <span>Ireland</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              © 2026 Muneem Ji · Made for the people who keep the books.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
