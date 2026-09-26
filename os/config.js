(() => {
  'use strict';
  const SUPABASE_URL = "https://pxipclkptxpqukefwexh.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_g6XQVQvYVSWpIskA7r_1cQ_CaHkVnmc";
  const STORAGE_KEY = "underweb-auth-v1";
  const LEGACY_KEY = "sb-pxipclkptxpqukefwexh-auth-token";
  try {
    if (!localStorage.getItem(STORAGE_KEY)) {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) localStorage.setItem(STORAGE_KEY, legacy);
    }
  } catch (e) { console.warn("[UnderWeb OS] auth storage migration unavailable", e); }
  window.UNDERWEB_OS_CONFIG = Object.freeze({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_PUBLISHABLE_KEY,
    storageKey: STORAGE_KEY
  });
})();