-- Hub card likes (2026-10-20)
--
-- In the hub's Creator Room every screen has a ♥. A like is written to VRChat's log by the world and passed on by
-- anyone in the instance running UWX (edge function hub-likes checks the world's code). One like per VRChat display
-- name per card. Counts go back into the hub with the card images (hub-cards -> manifest), and creators see theirs
-- on their profile (hub_my_likes).
-- Only the edge functions (service role) read or write the raw table; members only ever see their own totals.

create table if not exists public.hub_card_likes (
    card_id    text not null check (char_length(card_id) between 1 and 64),   -- hub_creator_cards.user_id or creator_showcase.id
    voter      text not null check (char_length(voter) between 1 and 64),     -- VRChat display name
    created_at timestamptz not null default now(),
    primary key (card_id, voter)
);
create index if not exists hub_card_likes_card_time on public.hub_card_likes (card_id, created_at);
alter table public.hub_card_likes enable row level security;   -- no policies: service role only

comment on table public.hub_card_likes is 'Likes from the UnderWeb hub world Creator Room (one per VRChat name per card).';

-- record a like, only for something that is actually in the hub right now
create or replace function public.hub_like_report(p_card text, p_voter text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
    if p_card is null or p_voter is null or char_length(p_voter) not between 1 and 64 then
        return false;
    end if;
    if not exists (select 1 from public.hub_creator_cards c where c.user_id::text = p_card and c.status = 'approved' and c.enabled)
       and not exists (select 1 from public.creator_showcase s where s.id::text = p_card and s.show_in_hub and s.moderation_status = 'approved') then
        return false;
    end if;
    insert into public.hub_card_likes (card_id, voter) values (p_card, p_voter) on conflict do nothing;
    return true;
end;
$$;

-- all-time counts per card, for the hub-cards feed
create or replace function public.hub_like_counts()
returns table (card_id text, likes integer)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
    select l.card_id, count(*)::integer from public.hub_card_likes l group by l.card_id;
$$;

-- the signed-in member's own totals (their hub card + their art-wall pieces)
create or replace function public.hub_my_likes()
returns table (total integer, this_week integer)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
    select count(*)::integer,
           (count(*) filter (where l.created_at > now() - interval '7 days'))::integer
    from public.hub_card_likes l
    where auth.uid() is not null
      and (l.card_id = auth.uid()::text
           or l.card_id in (select s.id::text from public.creator_showcase s where s.user_id = auth.uid()));
$$;

revoke all on function public.hub_like_report(text, text) from public, anon, authenticated;
revoke all on function public.hub_like_counts() from public, anon, authenticated;
revoke all on function public.hub_my_likes() from public, anon;
grant execute on function public.hub_like_report(text, text) to service_role;
grant execute on function public.hub_like_counts() to service_role;
grant execute on function public.hub_my_likes() to authenticated;
