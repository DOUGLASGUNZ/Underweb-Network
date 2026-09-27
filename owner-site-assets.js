(()=>{"use strict";
const SUPABASE_URL="https://pxipclkptxpqukefwexh.supabase.co";
const SUPABASE_KEY="sb_publishable_g6XQVQvYVSWpIskA7r_1cQ_CaHkVnmc";
const OWNER_ID="582affa4-c6d4-4bcb-bdf3-a26bf40dcad7";
const UNDERWEB_AUTH_STORAGE_KEY="underweb-auth-v1";
const UNDERWEB_LEGACY_AUTH_STORAGE_KEY="sb-pxipclkptxpqukefwexh-auth-token";
try{
 if(!window.localStorage.getItem(UNDERWEB_AUTH_STORAGE_KEY)){
  const legacy=window.localStorage.getItem(UNDERWEB_LEGACY_AUTH_STORAGE_KEY);
  if(legacy) window.localStorage.setItem(UNDERWEB_AUTH_STORAGE_KEY,legacy);
 }
}catch(e){console.warn("Auth storage migration unavailable",e)}
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:UNDERWEB_AUTH_STORAGE_KEY}});
const $=id=>document.getElementById(id), auth=$("auth"), file=$("file"), path=$("path"), upload=$("upload"), status=$("status"), preview=$("preview");
let user=null;
const say=(m,ok=false)=>{status.className=ok?"good":"bad";status.textContent=m};
async function boot(){
 const {data:{session},error:sessionError}=await sb.auth.getSession();
 if(sessionError){auth.innerHTML='<span class="bad">Session error: '+sessionError.message+'</span>';return}
 user=session?.user||null;
 if(!user){auth.innerHTML='<span class="bad">Not signed in. Sign into UnderWeb first, then reopen this page.</span>';return}
 if(user.id!==OWNER_ID){auth.innerHTML='<span class="bad">Owner access only.</span>';return}
 auth.innerHTML='<span class="good">OWNER SESSION VERIFIED</span>'; upload.disabled=!file.files.length;
}
file.addEventListener("change",()=>{
 const f=file.files[0]; upload.disabled=!f||user?.id!==OWNER_ID;
 if(f){preview.src=URL.createObjectURL(f);preview.style.display="block";
 const ext=(f.name.split(".").pop()||"webp").toLowerCase(); if(path.value==="site-assets/os/underweb-hero.webp") path.value="site-assets/os/underweb-hero."+ext;}
});
upload.addEventListener("click",async()=>{
 const f=file.files[0]; if(!f||!user)return;
 if(!["image/png","image/jpeg","image/webp"].includes(f.type))return say("PNG, JPG or WebP only.");
 if(f.size>8*1024*1024)return say("Asset exceeds the 8 MB network-media limit.");
 const clean=path.value.trim().replace(/^\/+|\.\.+/g,"").replace(/[^a-zA-Z0-9._\/-]/g,"-");
 if(!clean||!clean.startsWith("site-assets/"))return say("Path must begin with site-assets/.");
 const objectPath=user.id+"/"+clean;
 upload.disabled=true;say("Uploading…");
 const {error}=await sb.storage.from("network-media").upload(objectPath,f,{upsert:true,contentType:f.type,cacheControl:"3600"});
 if(error){upload.disabled=false;return say(error.message)}
 const {data}=sb.storage.from("network-media").getPublicUrl(objectPath);
 say("UPLOAD COMPLETE\n\n"+data.publicUrl,true); upload.disabled=false;
 try{await navigator.clipboard.writeText(data.publicUrl)}catch{}
});
boot();
})();