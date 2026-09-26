(() => {
'use strict';
const cfg=window.UNDERWEB_OS_CONFIG||{};
const $=s=>document.querySelector(s);
const txt=(s,v)=>{const e=$(s);if(e)e.textContent=v};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function stateBox(title,body){const e=$('[data-control-health]');if(e)e.innerHTML='<div class="empty"><b>'+esc(title)+'</b><span>'+esc(body)+'</span></div>'}\nfunction workload(general,roles,projects,restrictions){const e=$('[data-control-workload]');if(!e)return;const total=general+roles+projects;e.innerHTML='<div class="workload"><article><strong>'+total+'</strong><span>TOTAL PENDING</span></article><article><strong>'+general+'</strong><span>GENERAL</span></article><article><strong>'+roles+'</strong><span>ROLES</span></article><article><strong>'+projects+'</strong><span>PROJECTS</span></article><article><strong>'+restrictions+'</strong><span>ACTIVE RESTRICTIONS</span></article></div>'}\nfunction moderation(rows){const e=$('[data-control-moderation]');if(!e)return;if(!rows?.length){e.innerHTML='<div class="empty"><b>NO RECENT ACTIONS</b><span>No moderation actions are visible.</span></div>';return}e.innerHTML='<div class="mod-feed">'+rows.map(r=>'<article><b>'+esc(String(r.action_type||"ACTION").toUpperCase())+'</b><span>'+esc(r.reason||"No reason recorded")+'</span><time>'+esc(r.created_at?new Date(r.created_at).toLocaleString():"")+'</time></article>').join('')+'</div>'}
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
  const [members,partners,events,generalApps,roleApps,projectApps,restrictions,modActions]=await Promise.all([
   count(client,'profiles'),
   count(client,'network_partners',q=>q.eq('status','active')),
   count(client,'network_events',q=>q.in('status',['approved','published','active']).gte('starts_at',now).is('cancelled_at',null))
  ]);
  txt('[data-control-members]',members);txt('[data-control-partners]',partners);txt('[data-control-events]',events);workload(generalApps,roleApps,projectApps,restrictions);if(modActions.error)throw modActions.error;moderation(modActions.data);
  stateBox('SUPABASE // CONNECTED','Authenticated as '+rank.toUpperCase()+'. Core Network reads are live. Discord Bot and UWX health remain unconnected until heartbeat sources exist.');
 }catch(err){console.error('[UnderWeb Control]',err);stateBox('CONTROL DATA ERROR',err?.message||'Unable to load verified Control data.')}
}
boot();
})();