// Edge function: court. Deploy with "Verify JWT" OFF (same as underweb-discord). The handler checks every caller itself:
// public reads need nothing, website members need a Supabase session, judges need the staff role, and the Discord bot needs its credential.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createCourtHandler, type AuthPort } from './handler.ts';
import { createSupabaseStore } from './store.ts';
import { JUDGE_MIN_RANK } from './logic.ts';

function required(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing configuration: ${name}`);
  return v;
}

const supabaseUrl = required('SUPABASE_URL');
const anonKey = required('SUPABASE_ANON_KEY');
const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
const siteOrigin = required('UW_SITE_ORIGIN');
const guildId = required('DISCORD_GUILD_ID');
const claimPepper = required('COURT_CLAIM_PEPPER');
if (!siteOrigin.startsWith('https://') || claimPepper.length < 32) throw new Error('Invalid court configuration');

const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const auth: AuthPort = {
  async userFromToken(token) {
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const u = await r.json();
    return typeof u?.id === 'string' ? { id: u.id } : null;
  },
  async isJudge(token) {
    // Runs as the caller, so the existing role system decides (the same call the staff tools make).
    const as = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
    const { data, error } = await as.rpc('uw_max_role_rank');
    return !error && Number(data ?? 0) >= JUDGE_MIN_RANK;
  },
};

const handler = createCourtHandler({ siteOrigin, guildId, claimPepper }, createSupabaseStore(service), auth);
Deno.serve((req: Request) => handler.handle(req));
