(() => {
'use strict';
const cfg=window.UNDERWEB_OS_CONFIG||{},$=s=>document.querySelector(s),txt=(s,v)=>{const e=$(s);if(e)e.textContent=v};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function stateBox(t,b){const e=$('[data-control-health]');if(e)e.innerHTML='<div class="empty"><b>'+esc(t)+'</b><span>'+esc(b)+'</span></div>'}
function workload(g,r,p,x){const e=$('[data-control-workload]');if(!e)return;e.innerHTML='<div class="workload"><article><strong>'+(g+r+p)+'</strong><span>TOTAL PENDING</span></article><article><strong>'+g+'</strong><span>GENERAL</span></article><article><strong>'+r+'</strong><span>ROLES</span></article><article><strong>'+p+'</strong><span>PROJECTS</span></article><article><strong>'+x+'</strong><span>ACTIVE RESTRICTIONS</span></article></div>'}
function moderation(rows){const e=$('[data-control-moderation]');if(!e)return;e.innerHTML=rows?.length?'<div class="mod-feed">'+rows.map(r=>'<article><b>'+esc(String(r.action_type||'ACTION').toUpperCase())+'</b><span>'+esc(r.reason||'No reason recorded')+'</span><time>'+esc(r.created_at?new Date(r.created_at).toLocaleString():'')+'</time></article>').join('')+'</div>':'<div class="empty"><b>NO RECENT ACTIONS</b><span>No moderation actions are visible.</span></div>'}
async function count(c,t,f){let q=c.from(t).select('*',{count:'exact',head:true});if(f)q=f(q);const {count,error}=await q;if(error)throw error;return count??0}
async function boot(){
 if(!cfg.supabaseUrl||!cfg.supabaseAnonKey||!window.supabase?.createClient){stateBox('OS NOT CONFIGURED','Supabase bootstrap is unavailable.');return}
 const c=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:localStorage,storageKey:cfg.storageKey||'underweb-auth-v1'}});
 try{
  const {data:{session}}=await c.auth.getSession();if(!session?.user){stateBox('ACCESS DENIED','Sign in to UnderWeb before opening Network Control.');return}
  const [{data:roles,error:roleError},{data:identity,error:idError}]=await Promise.all([c.from('user_roles').select('role_slug,status').eq('user_id',session.user.id).eq('status','active'),c.rpc('uw_my_identity')]);
  if(roleError)throw roleError;
  const allowed=(roles||[]).map(r=>String(r.role_slug).toLowerCase()).filter(r=>['owner','director','admin'].includes(r));if(!allowed.length){stateBox('ACCESS DENIED','Network Control requires an active Owner, Director, or Admin role.');return}
  const rank=['owner','director','admin'].find(r=>allowed.includes(r))||allowed[0],id=!idError&&identity?.length?identity[0]:null;txt('[data-control-access]',rank.toUpperCase()+(id?.underweb_id?' // '+id.underweb_id:''));
  const now=new Date().toISOString();
  const [members,partners,events,generalApps,roleApps,projectApps,restrictions,modActions]=await Promise.all([
   count(c,'profiles'),count(c,'network_partners',q=>q.eq('status','active')),count(c,'network_events',q=>q.in('status',['approved','published','active']).gte('starts_at',now).is('cancelled_at',null)),
   count(c,'applications',q=>q.eq('status','pending')),count(c,'role_applications',q=>q.eq('status','pending')),count(c,'network_project_applications',q=>q.eq('status','pending')),count(c,'user_restrictions',q=>q.eq('active',true)),
   c.from('moderation_actions').select('id,action_type,reason,created_at').order('created_at',{ascending:false}).limit(6)
  ]);
  txt('[data-control-members]',members);txt('[data-control-partners]',partners);txt('[data-control-events]',events);workload(generalApps,roleApps,projectApps,restrictions);if(modActions.error)throw modActions.error;moderation(modActions.data);
  stateBox('SUPABASE // CONNECTED',(id?.underweb_id?id.underweb_id+' // ':'')+rank.toUpperCase()+' authenticated. Core Network reads are live.');
 }catch(err){console.error('[UnderWeb Control]',err);stateBox('CONTROL DATA ERROR',err?.message||'Unable to load verified Control data.')}
}boot();
})();