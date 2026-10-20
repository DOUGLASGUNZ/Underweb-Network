-- Hub creator cards (2026-10-20)
--
-- Creators can put themselves in the UnderWeb hub world:
--   * avatar / asset makers and artists -> a Creator Market card (image, name, headline, QR to their shop)
--   * DJs -> a Resident DJ card (logo/photo, name, QR to their music)
-- and opt approved showcase photos/art into the hub's art wall.
--
-- Everything is opt-in and staff-approved. Editing a card puts it back to pending.
-- A GitHub Actions job renders approved cards and publishes them to GitHub Pages,
-- where the hub world loads them (VRChat only trusts *.github.io for images).

create table if not exists public.hub_creator_cards (
    user_id        uuid primary key references auth.users(id) on delete cascade,
    kind           text not null default 'market' check (kind in ('market', 'dj')),
    enabled        boolean not null default true,
    image_url      text not null,
    headline       text not null default '' check (char_length(headline) <= 60),
    link_url       text check (link_url is null or (link_url ~ '^https://[^\s/$.?#][^\s]*$' and char_length(link_url) <= 200)),
    link_label     text not null default '' check (char_length(link_label) <= 40),
    extra_link_url text check (extra_link_url is null or (extra_link_url ~ '^https://[^\s/$.?#][^\s]*$' and char_length(extra_link_url) <= 200)),
    status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    review_note    text check (review_note is null or char_length(review_note) <= 200),
    reviewed_by    uuid,
    reviewed_at    timestamptz,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

comment on table public.hub_creator_cards is
    'Opt-in creator cards shown in the UnderWeb hub world (Creator Market / Resident DJs). Staff-approved.';

alter table public.creator_showcase
    add column if not exists show_in_hub boolean not null default false;
comment on column public.creator_showcase.show_in_hub is
    'Owner opted this approved item into the hub world art wall (public).';

-- Guard: members can't approve themselves; any content edit goes back to pending;
-- the card image must be one of the member's own uploads on UnderWeb storage.
create or replace function public.uw_guard_hub_creator_card()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
    v_base constant text := 'https://pxipclkptxpqukefwexh.supabase.co/storage/v1/object/public/';
    v_reviewer boolean := auth.uid() is null or public.uw_can_review_media();
    v_changed boolean;
begin
    if new.image_url is null
       or not (new.image_url like v_base || 'creator-showcase/' || new.user_id::text || '/%'
            or new.image_url like v_base || 'profile-media/' || new.user_id::text || '/%') then
        raise exception 'The card image must be one of your own UnderWeb uploads (showcase or profile).';
    end if;

    new.headline := btrim(new.headline);
    new.link_label := btrim(new.link_label);
    new.updated_at := now();

    if tg_op = 'INSERT' then
        if not v_reviewer then
            new.status := 'pending';
            new.review_note := null;
            new.reviewed_by := null;
            new.reviewed_at := null;
        end if;
        return new;
    end if;

    if new.user_id is distinct from old.user_id then
        raise exception 'A hub card cannot change owner.';
    end if;

    if not v_reviewer then
        v_changed := new.kind is distinct from old.kind
            or new.image_url is distinct from old.image_url
            or new.headline is distinct from old.headline
            or new.link_url is distinct from old.link_url
            or new.link_label is distinct from old.link_label
            or new.extra_link_url is distinct from old.extra_link_url;
        if v_changed then
            new.status := 'pending';
            new.review_note := null;
            new.reviewed_by := null;
            new.reviewed_at := null;
        else
            -- turning the card on/off is fine; review fields stay as staff left them
            new.status := old.status;
            new.review_note := old.review_note;
            new.reviewed_by := old.reviewed_by;
            new.reviewed_at := old.reviewed_at;
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists uw_guard_hub_creator_card on public.hub_creator_cards;
create trigger uw_guard_hub_creator_card
    before insert or update on public.hub_creator_cards
    for each row execute function public.uw_guard_hub_creator_card();

alter table public.hub_creator_cards enable row level security;

drop policy if exists "hub cards owner or reviewer read" on public.hub_creator_cards;
create policy "hub cards owner or reviewer read"
    on public.hub_creator_cards for select to authenticated
    using (user_id = auth.uid() or public.uw_can_review_media());

drop policy if exists "hub cards owner insert" on public.hub_creator_cards;
create policy "hub cards owner insert"
    on public.hub_creator_cards for insert to authenticated
    with check (user_id = auth.uid() and public.uw_has_network_access());

drop policy if exists "hub cards owner update" on public.hub_creator_cards;
create policy "hub cards owner update"
    on public.hub_creator_cards for update to authenticated
    using (user_id = auth.uid() and public.uw_has_network_access())
    with check (user_id = auth.uid() and public.uw_has_network_access());

drop policy if exists "hub cards owner delete" on public.hub_creator_cards;
create policy "hub cards owner delete"
    on public.hub_creator_cards for delete to authenticated
    using (user_id = auth.uid());

revoke all on public.hub_creator_cards from anon;

-- Staff approve or reject a card.
create or replace function public.uw_review_hub_card(p_user_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
    if not public.uw_can_review_media() then
        raise exception 'Media review authority required';
    end if;
    update public.hub_creator_cards
       set status = case when p_approve then 'approved' else 'rejected' end,
           review_note = nullif(left(btrim(coalesce(p_note, '')), 200), ''),
           reviewed_by = auth.uid(),
           reviewed_at = now()
     where user_id = p_user_id;
    if not found then
        raise exception 'Hub card not found';
    end if;
end;
$$;

revoke execute on function public.uw_review_hub_card(uuid, boolean, text) from public, anon;
grant execute on function public.uw_review_hub_card(uuid, boolean, text) to authenticated;
