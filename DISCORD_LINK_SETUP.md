# Static `index.html` transfer instructions

This bundle is tailored to the uploaded UnderWeb website. The selected
canonical file is the root `index.html`, which is a static HTML page using the
Supabase browser SDK and the `underweb-auth-v1` local-storage key.

Nothing in the uploaded ZIP is modified by this bundle.

## Files to transfer

Copy these files into the UnderWeb website repository:

```text
static-index/account/discord/link/index.html
static-index/supabase/functions/redeem-discord-link/index.ts
```

Also apply the existing transfer-package migration:

```text
../supabase/redeem-discord-link-token.sql
```

## Hosting the page

The bot link is configured for:

```text
https://www.underweb.cloud/account/discord/link
```

Configure the static host so that this URL serves:

```text
account/discord/link/index.html
```

If the host cannot serve directory index routes, use its rewrite rule to map
`/account/discord/link` to that file. Do not change the bot URL to a local or
development path.

For Vercel, keep `vercel.json` at the project root beside the existing root
`index.html`. The included rewrite maps `/account/discord/link` to the nested
page without changing the existing root page.

The page creates the same Supabase browser client configuration already present
in `index.html`:

- Same Supabase project URL
- Same publishable key
- Same `underweb-auth-v1` local-storage key
- Same persisted Supabase session

It does not accept a browser-supplied user ID, email, profile ID, or Discord
ID. An email is accepted only by Supabase's existing passwordless OTP
authentication flow when the visitor is signed out. The link is redeemed only
after Supabase confirms the authenticated session.

## Deploying the Edge Function

The static page calls this Supabase Edge Function:

```text
redeem-discord-link
```

From the website repository, using the Supabase CLI:

```bash
supabase functions deploy redeem-discord-link
```

Configure the function environment variable:

```text
UNDERWEB_SITE_ORIGIN=https://www.underweb.cloud
```

Supabase supplies `SUPABASE_URL` and `SUPABASE_ANON_KEY` to Edge Functions.
The function uses the user's bearer token and the anon/publishable key. It does
not require or use the service-role key.

The SQL function must be applied before deploying or testing the Edge Function:

```text
public.redeem_discord_link_token(text)
```

## Supabase Auth redirect URL

In Supabase Dashboard, under Authentication → URL Configuration, add:

```text
https://www.underweb.cloud/account/discord/link
```

If Vercel canonicalizes the route with a trailing slash, also add:

```text
https://www.underweb.cloud/account/discord/link/
```

## Security flow

1. `/link` sends the raw token to the page URL.
2. The page moves the token into same-origin local storage for the short login
   handoff and removes it from the address bar.
3. The page checks the existing Supabase session.
4. If signed out, the page uses the existing passwordless Supabase OTP flow.
5. The page calls the Edge Function with `{ "token": "..." }`.
6. The Edge Function validates the bearer token with Supabase Auth.
7. The Edge Function hashes the raw token with SHA-256.
8. The Edge Function calls the atomic database function with only the hash.
9. The database function derives the profile from `auth.uid()`, locks the token
   row, rejects expired/used/conflicting links, updates the profile, and marks
   the token used in one transaction.

## Test checklist

1. Deploy the SQL function.
2. Deploy the Edge Function.
3. Publish the page at `/account/discord/link` on `www.underweb.cloud`.
4. Set the bot's `UNDERWEB_DISCORD_LINK_URL` to the published URL.
5. Run `/link` in Discord.
6. Open the private link while signed out.
7. Complete the existing Supabase passwordless sign-in.
8. Confirm the Discord connection.
9. Verify `/profile` in Discord.
10. Open the same link again and confirm it is rejected.

## Important static-site limitation

This bundle adds only the Discord-link page. It does not modify the existing
root `index.html`. The page must be published as its own static route or
rewrite. The existing root page can continue using its current authentication
and Inner Web behavior unchanged.