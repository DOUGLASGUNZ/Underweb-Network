// UnderWeb Discord M1 — single-file Supabase Edge Function.
// Function name: underweb-discord. Paste this entire file into its index.ts.
// Configure Edge Function Secrets before deployment. Disable the platform
// Verify JWT switch for THIS function; this handler validates website sessions
// with Supabase Auth and separately authenticates scoped worker credentials.
// No private keys are embedded. Database activation flags remain unchanged.
// Assembled from the tested M1 modules without changing their implementation.
// + worker/verify/* routes: the Verify button flow in #verify (uw_bot_verify in the database).

export class AppError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export const snowflake = (v: unknown): v is string => typeof v === 'string' && /^[0-9]{17,20}$/.test(v);
export const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export async function sha256(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), x => x.toString(16).padStart(2, '0')).join('');
}
export function secret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
}
export interface Principal { userId: string; sessionId: string; email: string; fresh: boolean }
// Only call AFTER Supabase Auth has accepted this exact token and returned this user.
export function principalFromVerifiedToken(token: string, user: {id: string; email?: string; is_anonymous?: boolean}, issuer: string, now = Date.now()): Principal {
  let c: Record<string, any>;
  try {
    const p = token.split('.')[1];
    c = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
  } catch { throw new AppError('AUTH_REQUIRED', 401); }
  if (c.sub !== user.id || c.iss !== issuer || c.role !== 'authenticated' ||
      ![c.aud].flat().includes('authenticated') || !uuid(c.session_id) ||
      !Number.isFinite(c.exp) || c.exp * 1000 <= now || user.is_anonymous || c.is_anonymous) {
    throw new AppError('AUTH_REQUIRED', 401);
  }
  const allowed = new Set(['otp', 'magiclink', 'password', 'totp']);
  const fresh = Array.isArray(c.amr) && c.amr.some((a: any) =>
    allowed.has(a.method) && Number.isFinite(a.timestamp) &&
    a.timestamp * 1000 >= now - 15 * 60_000 && a.timestamp * 1000 <= now + 30_000);
  return {userId: user.id, sessionId: c.session_id, email: user.email ?? '', fresh};
}
export async function boundedJson(request: Request, max = 32768): Promise<Record<string, any>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new AppError('JSON_REQUIRED', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('INVALID_REQUEST');
  let length = 0; const chunks: Uint8Array[] = [];
  for (;;) {
    const {done, value} = await reader.read(); if (done) break;
    length += value.length;
    if (length > max) { await reader.cancel(); throw new AppError('REQUEST_TOO_LARGE', 413); }
    chunks.push(value);
  }
  const all = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  try {
    const value = JSON.parse(new TextDecoder().decode(all));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new AppError('INVALID_REQUEST'); }
}


export interface Settings {
  supabaseUrl: string; anonKey: string; serviceRoleKey: string;
  siteOrigin: string; discordClientId: string; discordClientSecret: string;
  discordRedirectUri: string; guildId: string;
}
export interface Dependencies {
  fetch?: typeof fetch;
  rpc?: (action: string, payload: Record<string, unknown>) => Promise<any>;
  verifyRpc?: (action: string, payload: Record<string, unknown>) => Promise<any>;
  log?: (event: Record<string, unknown>) => void;
}
const knownCodes = new Set(['AUTH_REQUIRED','NOT_CONFIGURED','ACCOUNT_RESTRICTED','LINK_RATE_LIMIT',
  'ALREADY_LINKED','PRIVILEGED_RELINK_REQUIRES_REVIEW','INVALID_OR_USED_STATE','REQUEST_EXPIRED',
  'IDENTITY_CHANGED','DISCORD_ALREADY_LINKED','CLEANUP_PENDING','LINK_CHANGED','WORKER_UNAUTHORIZED','INVALID_REQUEST']);
const VRC_USER = /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function createHandler(settings: Settings, deps: Dependencies = {}) {
  const requestFetch = deps.fetch ?? fetch;
  const log = deps.log ?? ((event) => console.log(JSON.stringify(event)));
  const base = settings.supabaseUrl.replace(/\/$/, '');
  if (new URL(settings.discordRedirectUri).origin !== settings.siteOrigin ||
      !settings.siteOrigin.startsWith('https://') || !snowflake(settings.guildId) || !snowflake(settings.discordClientId)) {
    throw new Error('Invalid integration configuration');
  }
  async function remote(url: string, init: RequestInit): Promise<Response> {
    try { return await requestFetch(url, {...init, signal: AbortSignal.timeout(15_000)}); }
    catch { throw new AppError('UPSTREAM_UNAVAILABLE', 503); }
  }
  const rpcAt = (fn: string) => async (action: string, payload: Record<string, unknown>) => {
    const response = await remote(`${base}/rest/v1/rpc/${fn}`, {
      method:'POST', headers:{'Content-Type':'application/json','apikey':settings.serviceRoleKey,
        'Authorization':`Bearer ${settings.serviceRoleKey}`},
      body:JSON.stringify({p_action:action,p_payload:payload})
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const code = knownCodes.has(data?.message) ? data.message : 'BACKEND_UNAVAILABLE';
      const status = code==='WORKER_UNAUTHORIZED'||code==='AUTH_REQUIRED' ? 401 : code==='LINK_RATE_LIMIT' ? 429 : code==='BACKEND_UNAVAILABLE' ? 503 : 409;
      throw new AppError(code,status);
    }
    return data;
  };
  const rpc = deps.rpc ?? rpcAt('uw_bot_dispatch');
  const verifyRpc = deps.verifyRpc ?? rpcAt('uw_bot_verify');
  async function authenticate(request: Request): Promise<Principal> {
    const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
    if (!token || token.length>16384) throw new AppError('AUTH_REQUIRED',401);
    const response = await remote(`${base}/auth/v1/user`, {
      headers:{'apikey':settings.anonKey,'Authorization':`Bearer ${token}`}
    });
    if (response.status>=500 || response.status===429) throw new AppError('AUTH_UNAVAILABLE',503);
    if (!response.ok) throw new AppError('AUTH_REQUIRED',401);
    const user = await response.json();
    return principalFromVerifiedToken(token,user,`${base}/auth/v1`);
  }
  async function discordIdentity(code: string): Promise<{id:string; name:string}> {
    const response = await remote('https://discord.com/api/oauth2/token', {
      method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:settings.discordClientId,client_secret:settings.discordClientSecret,
        grant_type:'authorization_code',code,redirect_uri:settings.discordRedirectUri})
    });
    if (!response.ok) throw new AppError(response.status===429?'DISCORD_RATE_LIMIT':'DISCORD_AUTH_FAILED',response.status===429?429:502);
    const token = await response.json();
    if (typeof token.access_token!=='string') throw new AppError('DISCORD_AUTH_FAILED',502);
    try {
      if (token.token_type?.toLowerCase()!=='bearer' || !String(token.scope??'').split(' ').includes('identify')) throw new AppError('DISCORD_AUTH_FAILED',502);
      const me = await remote('https://discord.com/api/v10/users/@me', {headers:{'Authorization':`Bearer ${token.access_token}`}});
      if (!me.ok) throw new AppError('DISCORD_AUTH_FAILED',502);
      const user = await me.json();
      if (!snowflake(user.id) || user.bot) throw new AppError('DISCORD_AUTH_FAILED',502);
      return {id:user.id,name:String(user.global_name||user.username||'Discord user').slice(0,100)};
    } finally {
      // Best effort revocation; tokens are never persisted or sent to the browser.
      try { await remote('https://discord.com/api/oauth2/token/revoke', {
        method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({client_id:settings.discordClientId,client_secret:settings.discordClientSecret,
          token:token.access_token,token_type_hint:'access_token'})
      }); } catch { log({event:'oauth.revoke_unavailable'}); }
    }
  }
  return async function handle(request: Request): Promise<Response> {
    const correlationId = crypto.randomUUID();
    const origin = request.headers.get('origin');
    const headers = new Headers({'Content-Type':'application/json','Cache-Control':'no-store',
      'Vary':'Origin','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Request-Id':correlationId});
    if (origin===settings.siteOrigin) {
      headers.set('Access-Control-Allow-Origin',origin);
      headers.set('Access-Control-Allow-Headers','authorization, content-type');
      headers.set('Access-Control-Allow-Methods','POST, OPTIONS');
    }
    let actor: Principal|undefined;
    let route = '';
    const reply = (data: unknown,status=200) => new Response(JSON.stringify(data),{status,headers});
    try {
      if (request.method==='OPTIONS') {
        if (origin!==settings.siteOrigin) throw new AppError('ORIGIN_DENIED',403);
        return new Response(null,{status:204,headers});
      }
      if (request.method!=='POST') throw new AppError('METHOD_NOT_ALLOWED',405);
      const url = new URL(request.url);
      const prefix = '/underweb-discord/';
      const idx = url.pathname.indexOf(prefix);
      route = idx<0 ? '' : url.pathname.slice(idx+prefix.length);
      if (!['state','link/start','link/complete','link/confirm','link/unlink','worker/tick','worker/refresh',
            'worker/verify/submit','worker/verify/posted','worker/verify/cancel','worker/verify/decide'].includes(route)) throw new AppError('NOT_FOUND',404);
      const body = await boundedJson(request);
      if (route.startsWith('worker/')) {
        if (origin) throw new AppError('ORIGIN_DENIED',403);
        const token = request.headers.get('authorization')?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
        if (!token) throw new AppError('WORKER_UNAUTHORIZED',401);
        const payload: Record<string,unknown> = {tokenHash:await sha256(token),guildId:settings.guildId};
        if (route.startsWith('worker/verify/')) {
          const step = route.slice('worker/verify/'.length);
          if (step==='submit') {
            if (!snowflake(body.discordUserId)||typeof body.vrcUserId!=='string'||!VRC_USER.test(body.vrcUserId)||
                (body.discordName!==undefined&&(typeof body.discordName!=='string'||body.discordName.length>100))) throw new AppError('INVALID_REQUEST');
            return reply(await verifyRpc('verify_submit',{...payload,discordUserId:body.discordUserId,vrcUserId:body.vrcUserId,discordName:body.discordName??''}));
          }
          if (!uuid(body.requestId)) throw new AppError('INVALID_REQUEST');
          if (step==='posted') {
            if (!snowflake(body.messageId)) throw new AppError('INVALID_REQUEST');
            return reply(await verifyRpc('verify_posted',{...payload,requestId:body.requestId,messageId:body.messageId}));
          }
          if (step==='cancel') return reply(await verifyRpc('verify_cancel',{...payload,requestId:body.requestId}));
          if (typeof body.approve!=='boolean'||!snowflake(body.staffDiscordId)) throw new AppError('INVALID_REQUEST');
          return reply(await verifyRpc('verify_decide',{...payload,requestId:body.requestId,approve:body.approve,staffDiscordId:body.staffDiscordId}));
        }
        if (route==='worker/refresh') {
          if (!snowflake(body.discordUserId)||!uuid(body.leaseId)||typeof body.revision!=='string'||!/^\d+$/.test(body.revision)) throw new AppError('INVALID_REQUEST');
          Object.assign(payload,{discordUserId:body.discordUserId,leaseId:body.leaseId,revision:body.revision});
          return reply(await rpc('worker_refresh',payload));
        }
        const observed = body.observed??[]; const acks = body.acks??[];
        if (!Array.isArray(observed)||observed.length>200||!observed.every(snowflake)||!Array.isArray(acks)||acks.length>20) throw new AppError('INVALID_REQUEST');
        for (const a of acks) {
          if (!a||!snowflake(a.discordUserId)||!uuid(a.leaseId)||typeof a.revision!=='string'||!/^\d+$/.test(a.revision)||
              !['applied','absent','blocked','retry','dry_run','superseded'].includes(a.outcome)) throw new AppError('INVALID_REQUEST');
          if (a.retryAfterSeconds!==undefined&&(!Number.isInteger(a.retryAfterSeconds)||a.retryAfterSeconds<1||a.retryAfterSeconds>86400)) throw new AppError('INVALID_REQUEST');
          if (a.errorCode!==undefined && (typeof a.errorCode!=='string'||!/^[A-Z0-9_]{1,64}$/.test(a.errorCode))) throw new AppError('INVALID_REQUEST');
        }
        return reply(await rpc('worker_tick',{...payload,observed,acks:acks.map(a=>({discordUserId:a.discordUserId,
          leaseId:a.leaseId,revision:a.revision,outcome:a.outcome,retryAfterSeconds:a.retryAfterSeconds,errorCode:a.errorCode}))}));
      }
      if (origin!==settings.siteOrigin) throw new AppError('ORIGIN_DENIED',403);
      actor = await authenticate(request);
      const principal = {userId:actor.userId,sessionId:actor.sessionId};
      if (route==='state') return reply(await rpc('state',principal));
      if (!actor.fresh) throw new AppError('REAUTH_REQUIRED',403);
      if (route==='link/start') {
        const state = secret();
        const started = await rpc('begin',{...principal,stateHash:await sha256(state)});
        const authUrl = new URL('https://discord.com/oauth2/authorize');
        authUrl.search = new URLSearchParams({response_type:'code',client_id:settings.discordClientId,
          scope:'identify',redirect_uri:settings.discordRedirectUri,state,prompt:'consent'}).toString();
        return reply({...started,state,url:authUrl.href});
      }
      if (route==='link/complete') {
        if (typeof body.state!=='string'||!/^[0-9a-f]{64}$/.test(body.state)||typeof body.code!=='string'||body.code.length<1||body.code.length>4096) throw new AppError('INVALID_REQUEST');
        const consumed = await rpc('consume',{...principal,stateHash:await sha256(body.state)});
        try {
          const identity = await discordIdentity(body.code);
          const pending = await rpc('stage',{...principal,requestId:consumed.requestId,discordUserId:identity.id,discordName:identity.name});
          return reply({pending});
        } catch (error) {
          await rpc('failed',{...principal,requestId:consumed.requestId}).catch(()=>{});
          throw error;
        }
      }
      if (route==='link/confirm') {
        if (!uuid(body.requestId)||!snowflake(body.discordUserId)) throw new AppError('INVALID_REQUEST');
        return reply(await rpc('confirm',{...principal,requestId:body.requestId,discordUserId:body.discordUserId}));
      }
      if (route==='link/unlink') {
        if (!uuid(body.linkId)) throw new AppError('INVALID_REQUEST');
        return reply(await rpc('unlink',{...principal,linkId:body.linkId}));
      }
      throw new AppError('NOT_FOUND',404);
    } catch (error) {
      const e = error instanceof AppError ? error : new AppError('INTERNAL_ERROR',500);
      log({event:'request.rejected',code:e.code,correlationId,route:route.slice(0,40)});
      if (actor) await rpc('rejection',{userId:actor.userId,code:e.code,route,correlationId}).catch(()=>{});
      if (e.status===429) headers.set('Retry-After','60');
      return reply({error:{code:e.code},requestId:correlationId},e.status);
    }
  };
}

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing configuration: ${name}`);
  return value;
}
Deno.serve(createHandler({
  supabaseUrl:required('SUPABASE_URL'), anonKey:required('SUPABASE_ANON_KEY'),
  serviceRoleKey:required('SUPABASE_SERVICE_ROLE_KEY'), siteOrigin:required('UW_SITE_ORIGIN'),
  discordClientId:required('DISCORD_CLIENT_ID'), discordClientSecret:required('DISCORD_CLIENT_SECRET'),
  discordRedirectUri:required('DISCORD_REDIRECT_URI'), guildId:required('DISCORD_GUILD_ID')
}));
