(() => {
'use strict';
const state={client:null,user:null,profile:null,roles:[],identity:null};
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=(s,v)=>{const e=$(s);if(e)e.textContent=v};
const card=(host,title,body,meta='')=>{const e=$(host);if(e)e.innerHTML='<div class="data-card"><b>'+esc(title)+'</b><p>'+esc(body||'')+'</p>'+(meta?'<small>'+esc(meta)+'</small>':'')+'</div>'};
function activity(rows){const e=$('[data-os-activity]');if(!e)return;if(!rows?.length){e.innerHTML='<div class="empty"><b>NO PUBLIC ACTIVITY YET</b><span>The live feed is connected.</span></div>';return}e.innerHTML='<div class="feed">'+rows.map(r=>'<article class="feed-item"><div><b>'+esc(r.title)+'</b>'+(r.body?'<p>'+esc(r.body)+'</p>':'')+'</div><time>'+esc(r.created_at?new Date(r.created_at).toLocaleString():'')+'</time></article>').join('')+'</div>'}
async function count(table,filters=[]){let q=state.client.from(table).select('*',{count:'exact',head:true});filters.forEach(([k,op,v])=>q=q[op](k,v));const {count,error}=await q;if(error)throw error;return count??0}
async function boot(){
 const cfg=window.UNDERWEB_OS_CONFIG||{};
 if(!cfg.supabaseUrl||!cfg.supabaseAnonKey||!window.supabase?.createClient){text('[data-os-feed-state]','NOT CONFIGURED');return}
 state.client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:cfg.storageKey||'underweb-auth-v1'}});
 try{
  const {data:{session}}=await state.client.auth.getSession();state.user=session?.user||null;
  if(state.user){
   const [{data:p},{data:r},{data:identity,error:identityError}]=await Promise.all([
    state.client.from('profiles').select('id,display_name,username,avatar_url,public_profile').eq('id',state.user.id).maybeSingle(),
    state.client.from('user_roles').select('role_slug,status').eq('user_id',state.user.id).eq('status','active')
   ]);
   state.profile=p||null;state.roles=r||[];state.identity=!identityError&&identity?.length?identity[0]:null;
   text('[data-os-name]',state.identity?.display_name||state.profile?.display_name||state.profile?.username||'NETWORK USER');\n   if(state.identity){const box=$('[data-os-identity]');if(box)box.hidden=false;text('[data-os-id]',state.identity.underweb_id||'—');const roles=state.identity.roles||[];text('[data-os-role]',roles.length?roles.map(x=>String(x).toUpperCase()).join(' // '):'MEMBER');text('[data-os-discord]',state.identity.discord_linked?'DISCORD ✓':'DISCORD —');text('[data-os-vrchat]',state.identity.vrchat_username?'VRCHAT ✓ '+state.identity.vrchat_username:'VRCHAT —')}
   if(state.roles.some(x=>['owner','director','admin'].includes(String(x.role_slug).toLowerCase()))){const c=$('[data-os-control]');if(c)c.hidden=false}
  } else text('[data-os-name]','GUEST');
  const now=new Date().toISOString();
  const [feed,members,partners,event,project]=await Promise.all([
   state.client.from('network_activity').select('id,kind,title,body,object_type,object_id,created_at').eq('public',true).order('created_at',{ascending:false}).limit(8),
   count('profiles'),
   count('network_partners',[['status','eq','active']]),
   state.client.from('network_events').select('id,title,starts_at,location,description,cover_url,status').in('status',['approved','published','active']).gte('starts_at',now).is('cancelled_at',null).order('starts_at',{ascending:true}).limit(1).maybeSingle(),
   state.client.from('network_projects').select('id,title,project_type,description,status,deadline,project_date,cover_url').eq('visibility','public').in('status',['open','active','published']).order('created_at',{ascending:false}).limit(1).maybeSingle()
  ]);
  if(feed.error)throw feed.error;activity(feed.data);text('[data-os-feed-state]','LIVE DATA');
  text('[data-os-members]',members);text('[data-os-partners]',partners);
  if(event.error)card('[data-os-event]','EVENT DATA UNAVAILABLE',event.error.message);else if(event.data)card('[data-os-event]',event.data.title,event.data.location,new Date(event.data.starts_at).toLocaleString());else card('[data-os-event]','NO UPCOMING EVENTS','Nothing approved is currently scheduled.');
  if(project.error)card('[data-os-project]','PROJECT DATA UNAVAILABLE',project.error.message);else if(project.data)card('[data-os-project]',project.data.title,project.data.description,project.data.project_type);else card('[data-os-project]','NO ACTIVE PROJECTS','No public Network projects are active.');
 }catch(err){console.error('[UnderWeb OS]',err);text('[data-os-feed-state]','DATA ERROR')}
}
window.UnderWebOS={boot,state};boot();
})();