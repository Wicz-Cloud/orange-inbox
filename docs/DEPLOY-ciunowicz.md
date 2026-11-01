# orange-inbox on ciunowicz.com — deployment notes

Fork of InventiveHQ/orange-inbox (`upstream` remote). Family webmail at
**https://mail.ciunowicz.com**, mail domain **ciunowicz.com**, Cloudflare
Workers Free plan, login through Cloudflare Access with Authentik (OIDC).
No IMAP, no third-party mail provider.

## Architecture

| Piece | Name | Notes |
| --- | --- | --- |
| Web Worker | `orange-inbox-web` | Next.js via OpenNext. Custom domain `mail.ciunowicz.com` only; `workers.dev` and preview URLs are off. |
| Email Worker | `orange-inbox-email` | Receives Email Routing mail, runs a 1-minute cron. |
| D1 | `orange-inbox` (`62d0caa5-…`) | Shared by both Workers. |
| R2 | `orange-inbox-raw`, `orange-inbox-attachments` | Raw `.eml` and attachments. |
| KV | `DRAFTS` (`fbfae747…`) | Compose drafts. |
| Secrets | `INTERNAL_SECRET` (both), `VAPID_PRIVATE_KEY` (web), `ALERT_WEBHOOK_URL` (both) | Never in the repo. |

Why `workers.dev` is off: the app trusts the `Cf-Access-Authenticated-User-Email`
header and does not verify the Access JWT. Anything reachable without Access in
front can spoof any identity. **Never expose the web Worker except through the
Access-protected hostname.**

Outbound mail uses the default `send_email` binding. On the Free plan it only
delivers to verified Email Routing destination addresses, which is the parental
whitelist. No other provider is configured.

## Fresh-account deploy order

`scripts/setup.sh` deploys the email Worker before the web Worker, but the email
Worker has a service binding to the web Worker, so the first run fails with
`Service binding 'WEB' references Worker 'orange-inbox-web' which was not found`.
Deploy web first (`cd web && npm run deploy`), then run `./scripts/setup.sh`.

Redeploys of web with the custom-domain route need a token that can edit Workers
Routes on the zone (see the token permissions below).

## Manual dashboard checklist

Tick each box; Phase 3 starts only after all are done.

### a. Authentik provider and application (https://sentinel.wicz.cloud)

- [ ] Applications → Providers → Create → **OAuth2/OpenID Provider**
  - Client type: **Confidential**
  - Redirect URIs (strict): `https://<TEAM>.cloudflareaccess.com/cdn-cgi/access/callback`
  - Scopes: `openid`, `email`, `profile`
  - Subject mode: **Based on the User's Email**
  - Signing key: any RSA key (RS256)
  - Note the client ID, client secret and the provider slug.
- [ ] Applications → Create → name `orange-inbox`, bind the provider above.
- [ ] Every family member's Authentik user has the right `@ciunowicz.com` email
      set (the Access allowlist matches on it).

### b. Zero Trust → Settings → Authentication → Login methods → Add → OpenID Connect

- [ ] Name `Authentik`
- [ ] App ID = Authentik client ID; Client secret = Authentik client secret
- [ ] Auth URL `https://sentinel.wicz.cloud/application/o/authorize/`
- [ ] Token URL `https://sentinel.wicz.cloud/application/o/token/`
- [ ] Certificate URL `https://sentinel.wicz.cloud/application/o/<slug>/jwks/`
- [ ] Enable **PKCE**; scopes `openid email profile`
- [ ] Do **not** enable One-time PIN anywhere (a kid's PIN would land in the
      inbox they are trying to open).

### c. Access application `orange-inbox`

- [ ] Self-hosted, destination `mail.ciunowicz.com/*`
- [ ] Identity providers: **Authentik only**; turn off "Accept all available identity providers"
- [ ] Policy: Allow, include **Emails** = your address plus each kid's `@ciunowicz.com` address

### d. Access application `orange-inbox-public` (Bypass)

- [ ] Destinations on `mail.ciunowicz.com`: `/p/*`, `/_next/*`, `/sw.js`, `/manifest.webmanifest`, `/*.png`
- [ ] Policy: Action **Bypass**, include **Everyone**

### e. Email Routing on ciunowicz.com

- [ ] Email Routing is already enabled (MX, SPF and DKIM exist). Leave them as is.
- [ ] Routing rules → Catch-all → Action **Send to a Worker** → `orange-inbox-email` → enable.
- [ ] Add a DMARC TXT record at `_dmarc.ciunowicz.com` (suggested start:
      `v=DMARC1; p=none; rua=mailto:<your address>`), none exists today.

### f. Email Routing → Destination addresses (the outbound whitelist)

- [ ] Add and verify each approved outside contact (grandparents, etc.). A
      kid can only send to addresses on this list.

### Worker secrets still to set

- [ ] `ALERT_WEBHOOK_URL` (Discord webhook) on both Workers, see README "Operational alerts".

## API token permissions used so far

Account: Workers Scripts Edit, D1 Edit, Workers R2 Storage Edit, Workers KV
Storage Edit, Account Settings Read. User: User Details Read.
Needed for redeploying web with the custom-domain route: Zone → Workers Routes
Edit (and Zone → DNS Edit if the domain must be re-created) on ciunowicz.com.

## Pending (filled in by later phases)

Family mailboxes, kid-safe inbound, CI and updates, how to add a kid, how to
approve a contact, backup and rollback.
