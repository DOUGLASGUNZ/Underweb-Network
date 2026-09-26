(() => {
'use strict';
const cfg=window.UNDERWEB_OS_CONFIG||{};
const $=s=>document.querySelector(s);
const txt=(s,v)=>{const e=$(s);if(e)e.textContent=v};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function stateBox(title,body){const e=$('[data-control-health]');if(e)e.innerHTML='<div class="empty"><b>'+esc(title)+'</b><span>'+esc(body)+'</span></div>'}
async function count(client,table,apply){let q=client.from(table).select('*',{count:'exact',head:true});if(apply)q=apply(q);const {count,error}=await q;if(error)throw error;return count??0}
async function boot(){
 if(!cfg.supabaseUrl||!cfg.supabaseAnonKey||!window.supabase?.createClient){stateBox('OS NOT CONFIGURED','Supabase bootstrap is unavailable.');return}
 const client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:cfg.storageKey||'underweb-auth-v1'}});
 try{
  const {data:{session}}=await client.auth.getSession();
  if(!session?.user){stateBox('ACCESS DENIED','Sign in to UnderWeb before opening Network Control.');document.body.classList.add('control-denied');return}
  const {data:roles,error:roleError}=await client.from('user_roles').select('role_slug,status').eq('user_id',session.user.id).eq('status','active');
  if(roleError)throw roleError;
  const allowed=(roles||[]).map(r=>String(r.role_slug).toLowerCase()).filter(r=>['owner','director','admin'].includes(r));
  if(!allowed.length){stateBox('ACCESS DENIED','Network Control requires an active Owner, Director, or Admin role.');document.body.classList.add('control-denied');return}
  const rank=['owner','director','admin'].find(r=>allowed.includes(r))||allowed[0];
  txt('[data-control-access]',rank.toUpperCase());
  const now=new Date().toISOString();
  const [members,partners,events]=await Promise.all([
   count(client,'profiles'),
   count(client,'network_partners',q=>q.eq('status','active')),
   count(client,'network_events',q=>q.in('status',['approved','published','active']).gte('starts_at',now).is('cancelled_at',null))
  ]);
  txt('[data-control-members]',members);txt('[data-control-partners]',partners);txt('[data-control-events]',events);
  stateBox('SUPABASE // CONNECTED','Authenticated as '+rank.toUpperCase()+'. Core Network reads are live. Discord Bot and UWX health remain unconnected until heartbeat sources exist.');
 }catch(err){console.error('[UnderWeb Control]',err);stateBox('CONTROL DATA ERROR',err?.message||'Unable to load verified Control data.')}
}
boot();
})();