-- Inner Web secure Vault download setup
-- Run after inner_web_migration.sql.

-- Store paths as: bucket-name/path/to/file.ext
-- Example test artifact:
-- update public.vault_items
-- set download_path='darko-vault/inner-web/test/underweb-vault-test.txt'
-- where id='dead_signal_eyes';

-- Keep private storage paths out of browser-readable RPCs.
-- The inner-web-download Edge Function reads download_path with the service role,
-- verifies auth + membership clearance + Signal window, then signs the object for 60 seconds.

-- Optional sanity check (SQL Editor/admin only):
select id,name,required_tier,downloadable,
       case when download_path is null then 'release_pending' else 'path_configured' end as delivery_state
from public.vault_items
where downloadable=true
order by created_at,id;
