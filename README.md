# docvault-site

Static landing for `docvault.tech` served by Cloudflare Pages. The pilot-request form (`/api/contact`) is handled by a Pages Function that mirrors the original `app/routes/contact.py` from `automatizari-cc/docvault` (paused at tag `v0-paused`, 2026-05-10), with one architectural change: email send is over the Resend HTTP API instead of SMTP via aiosmtplib. Cloudflare Turnstile is preserved end-to-end.

## Structure

```
.
├── index.html               # the single-page landing
├── functions/
│   └── api/
│       └── contact.ts       # Pages Function bound to /api/contact
├── .github/
│   ├── workflows/security.yml   # gitleaks + html5validator + tsc --noEmit
│   └── dependabot.yml           # weekly github-actions + npm bumps
├── package.json             # dev deps only (@cloudflare/workers-types, typescript)
├── tsconfig.json            # strict mode, workers-types
└── .gitignore
```

## Required Pages environment variables (production)

Set these in Cloudflare Pages → Settings → Environment Variables (production scope). Both are encrypted secrets.

- `TURNSTILE_SECRET` — Cloudflare Turnstile secret key paired with site key `0x4AAAAAAC84uax_-LjHgMcf` (embedded in `index.html`). Same value used by the legacy FastAPI handler; reuse, no rotation needed.
- `RESEND_API_KEY` — Resend API key. Issue from Resend dashboard after verifying the `docvault.tech` sending domain (DNS records added at the Cloudflare zone).

## Email envelope

- **From:** `DocVault Site <keeper@docvault.tech>`
- **To:** `keeper@docvault.tech`
- **Reply-To:** the submitter's email from the form
- **Subject:** `[Pilot request] {company} — {usecase}`

## Local development

```bash
npm install
npm run typecheck             # tsc --noEmit
```

Smoke test via Cloudflare's local dev (requires wrangler):

```bash
npx wrangler pages dev . --binding TURNSTILE_SECRET=test --binding RESEND_API_KEY=test
```

## Deploy

Connected to Cloudflare Pages via GitHub. Push to `main` → Pages auto-builds + deploys. Custom domain `docvault.tech` is bound in Pages → Custom domains.

## Security pipeline

- `gitleaks-action` — secret detection on every push/PR
- `html5validator-action` — HTML validity check
- `tsc --noEmit` — TypeScript strict-mode typecheck of the Pages Function
- Dependabot — weekly bumps for GitHub Actions + npm

## Form-flow integration test

After deploying, a real submission should:

1. Load the page → Turnstile widget renders (visible challenge or invisible).
2. Fill the form → submit → Turnstile token is included in the JSON POST to `/api/contact`.
3. Pages Function validates inputs, calls Turnstile siteverify, calls Resend.
4. `keeper@docvault.tech` receives the email; the page shows the success message.

Rate-limit posture: deferred to Cloudflare's edge Rate Limit rule (matches the existing `/auth/*` posture from `marius.summitsec.cloud`); no in-Function limiter.
