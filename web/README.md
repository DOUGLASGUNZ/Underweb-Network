# UnderWeb website v2

The rebuilt underweb.cloud: Vue 3 + Vite, deployed on Vercel, same Supabase project and data as the current site.

## Run locally

```bash
cd web
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs dist/
```

## Deploy (alongside the current site first)

1. In Vercel, add a **new project** from this repo with **Root Directory = `web`** (framework: Vite). Keep the existing project serving the current site.
2. Give it a temporary domain, e.g. `beta.underweb.cloud`.
3. In Supabase → Authentication → URL Configuration, add to **Redirect URLs**:
   - `https://beta.underweb.cloud/auth/callback`
   - `https://beta.underweb.cloud/connections` (Discord linking)
4. Supabase → Authentication → Email Templates → **Magic Link**: include `{{ .Token }}` so emails contain the 6-digit code as well as the link. Codes are the reliable path on phones (the link can open in a different browser).
5. When the new site covers everything, point `underweb.cloud` at the new project. Sessions carry over (same storage key).

Optional environment variables: `VITE_LEGACY_SITE` (where "current site" links go), `VITE_DISCORD_INVITE`.

## What's here (phase 1 — foundation)

- Passwordless sign-in: email code **or** link; sessions persist; sign-out only affects this device.
- Onboarding: username + display name.
- Profiles: public profile pages (roles, verified accounts, links, badges, showcase, milestones) and an editor (picture, bio, time zone, links; creator fields for creators).
- Connected accounts: VRChat verification (claim → code in bio → staff review) and Discord link/unlink.
- Discover: creator directory with search, specialty filter, "open to collabs"; member search.
- Events: upcoming and past, in the viewer's time zone (plus Eastern for coordination).
- Bans/suspensions route to a restricted page; timeouts show a banner. Server-side enforcement is in the database (see `supabase/migrations`).

Not moved yet (still on the current site, linked as "current site"): staff tools, role applications, event proposals and control, projects, partners, gallery, tickets, cosmetics, Inner Web/Vault.

## Security model

The browser only has the publishable key. Route guards decide what to *show*; RLS policies and RPC checks decide what's *allowed*.
