export const OWNER_AUTH_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;1,9..144,300;1,9..144,400&family=DM+Sans:wght@300;400;500&display=swap');

  .mj-root {
    --cream: #F5F0E8;
    --cream-mid: #EDE7D9;
    --ink: #1A1614;
    --crimson: #7A1818;
    --crimson-deep: #5C1010;
    --muted: #6B6560;
    --border: rgba(26,22,20,0.12);
    --error: #B91C1C;
    font-family: 'DM Sans', system-ui, sans-serif;
    background: var(--cream);
    min-height: 100vh;
    color: var(--ink);
  }
  .mj-root * { box-sizing: border-box; }
  .mj-root .font-display { font-family: 'Fraunces', Georgia, serif; }
  .mj-root a { color: var(--crimson); text-decoration: none; }
  .mj-root a:hover { text-decoration: underline; }

  .mj-root .page-wrap {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
  }

  .mj-root .card {
    width: 100%;
    max-width: 440px;
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 48px 40px;
    box-shadow: 0 2px 16px rgba(26,22,20,0.06);
  }

  .mj-root .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 36px;
    text-decoration: none !important;
    color: var(--ink) !important;
  }
  .mj-root .brand-glyph {
    width: 28px; height: 28px;
    background: var(--crimson);
    border-radius: 3px;
    display: inline-block;
  }
  .mj-root .brand-name {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 20px;
    font-weight: 400;
    color: var(--ink);
  }

  .mj-root h1 {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 26px;
    font-weight: 400;
    color: var(--ink);
    margin: 0 0 6px;
    line-height: 1.2;
  }
  .mj-root .subtitle {
    font-size: 14px;
    color: var(--muted);
    margin: 0 0 32px;
  }

  .mj-root .field { margin-bottom: 20px; }
  .mj-root label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--ink);
    margin-bottom: 6px;
    letter-spacing: 0.01em;
  }
  .mj-root input {
    width: 100%;
    padding: 10px 12px;
    font-size: 14px;
    font-family: inherit;
    color: var(--ink);
    background: var(--cream);
    border: 1px solid var(--border);
    border-radius: 3px;
    outline: none;
    transition: border-color 0.15s;
  }
  .mj-root input:focus { border-color: var(--crimson); background: #fff; }
  .mj-root input.err { border-color: var(--error); }
  .mj-root .field-error { font-size: 12px; color: var(--error); margin-top: 4px; }

  .mj-root .global-error {
    background: #FEF2F2;
    border: 1px solid #FECACA;
    border-radius: 3px;
    padding: 10px 14px;
    font-size: 13px;
    color: var(--error);
    margin-bottom: 20px;
  }

  .mj-root .btn-primary {
    width: 100%;
    padding: 12px;
    background: var(--crimson);
    color: #fff;
    font-family: inherit;
    font-size: 14px;
    font-weight: 500;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    transition: background 0.15s, transform 0.1s;
    margin-top: 8px;
  }
  .mj-root .btn-primary:hover:not(:disabled) { background: var(--crimson-deep); transform: translateY(-1px); }
  .mj-root .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

  .mj-root .footer-links {
    margin-top: 28px;
    text-align: center;
    font-size: 13px;
    color: var(--muted);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .mj-root .divider { border: none; border-top: 1px solid var(--border); margin: 24px 0; }
`;
