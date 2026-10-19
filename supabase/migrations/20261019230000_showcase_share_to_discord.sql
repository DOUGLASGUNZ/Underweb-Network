-- Showcase → Discord (2026-10-19)
-- A poster can ask for their photo to also be shared to the UnderWeb Discord.
-- Nothing is posted until staff approve it: the approve-showcase-media function
-- posts approved items with share_to_discord = true and stamps discord_posted_at.

alter table public.creator_showcase
    add column if not exists share_to_discord boolean not null default false,
    add column if not exists discord_posted_at timestamptz;

comment on column public.creator_showcase.share_to_discord is
    'Poster opted in to sharing this item to the UnderWeb Discord once approved.';
comment on column public.creator_showcase.discord_posted_at is
    'When the approved item was posted to Discord (set by the server only).';

-- Members can't mark something as already posted (or clear the stamp);
-- only the server (service role) or media reviewers set it.
create or replace function public.uw_guard_showcase_discord()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
    if auth.uid() is not null and not public.uw_can_review_media() then
        if tg_op = 'INSERT' then
            new.discord_posted_at := null;
        elsif new.discord_posted_at is distinct from old.discord_posted_at then
            raise exception 'discord_posted_at is set by the server.';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists uw_guard_showcase_discord on public.creator_showcase;
create trigger uw_guard_showcase_discord
    before insert or update on public.creator_showcase
    for each row execute function public.uw_guard_showcase_discord();
