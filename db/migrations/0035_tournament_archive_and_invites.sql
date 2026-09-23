-- 0035_tournament_archive_and_invites.sql
-- Two independent additions to Rally Bracket (tournament.html):
--
-- 1. Cup archive/delete. tournaments_delete and tournaments_update RLS (0028_tournaments.sql)
--    already let any admin delete or update ANY tournament row -- deleting a Cup needed nothing
--    new (a plain client-side delete, cascades to tournament_teams via its FK). Archiving just
--    needed somewhere to record it without actually removing the row, hence archived_at: null
--    means active/visible in the Cup switcher, non-null means archived (hidden by default, still
--    reachable by anyone who already has its ?t=<id> link).
--
-- 2. A real partner-invite flow. Team registration always had a "partner email" field, but
--    nothing behind it -- runVerification('partnerEmail') was the same fake always-resolves-true
--    timer as every other check. Player 1 can't invite Player 2 with a raw insert into
--    notifications (notifications_insert is admin-only, since normally only admins broadcast
--    them), so this adds two narrow SECURITY DEFINER RPCs instead of widening that policy:
--      invite_team_partner: only the team's own registered_by can call it (checked inside the
--        function, not by RLS -- SECURITY DEFINER bypasses RLS entirely), looks up the partner's
--        account by email, and if found, writes a normal notification row + a payload.players[1]
--        status flag the client can read back after teamRowToTeam().
--      accept_team_invite: only someone whose OWN email matches the team's players[1].email can
--        call it, and only flips that slot to accepted + records their user id -- this is what
--        submitRegistration()'s new "already a partner elsewhere" check reads client-side to stop
--        one person being player 2 on a team AND registering their own.
--    Both functions read/write tournament_teams.payload directly (jsonb), never touching the
--    schema -- same reason player data has always lived in payload rather than real columns
--    (0028_tournaments.sql: brackets/groups only ever reference team ids, never player rows).

begin;

alter table public.tournaments add column if not exists archived_at timestamptz null;

create or replace function public.invite_team_partner(p_team_id uuid, p_partner_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team public.tournament_teams;
  v_partner_id uuid;
  v_tournament_name text;
  v_category_name text;
  v_players jsonb;
begin
  if auth.uid() is null then
    raise exception 'Harus login.';
  end if;
  if p_partner_email is null or length(trim(p_partner_email)) = 0 then
    raise exception 'Email partner wajib diisi.';
  end if;

  select * into v_team from public.tournament_teams where id = p_team_id;
  if v_team.id is null then
    raise exception 'Tim tidak ditemukan.';
  end if;
  if v_team.registered_by is distinct from auth.uid() then
    raise exception 'Cuma pendaftar tim ini yang bisa mengundang partner.';
  end if;

  select id into v_partner_id from public.profiles where lower(email) = lower(trim(p_partner_email)) limit 1;

  v_players := coalesce(v_team.payload->'players', '[]'::jsonb);
  if jsonb_array_length(v_players) < 2 then
    raise exception 'Data pemain tim tidak lengkap.';
  end if;

  v_players := jsonb_set(
    v_players, '{1}',
    (v_players->1) || jsonb_build_object(
      'inviteStatus', case when v_partner_id is null then 'no_account' else 'pending' end,
      'invitedUserId', to_jsonb(v_partner_id)
    )
  );
  update public.tournament_teams set payload = jsonb_set(payload, '{players}', v_players) where id = p_team_id;

  if v_partner_id is not null then
    select t.name, coalesce((c->>'name'), '') into v_tournament_name, v_category_name
    from public.tournaments t
    left join lateral jsonb_array_elements(t.data->'categories') c on (c->>'id') = v_team.category_id
    where t.id = v_team.tournament_id;

    insert into public.notifications (user_id, title, message, kind, link_url, payload, created_by)
    values (
      v_partner_id,
      '🤝 Undangan Tim',
      'Kamu diundang jadi partner di tim "'||v_team.name||'" ('||coalesce(v_category_name,'')||' · '||coalesce(v_tournament_name,'')||'). Buka buat konfirmasi.',
      'team_invite',
      'tournament.html?t='||v_team.tournament_id,
      jsonb_build_object('tournament_id', v_team.tournament_id, 'category_id', v_team.category_id, 'team_id', v_team.id),
      auth.uid()
    );
    return 'sent';
  end if;
  return 'no_account';
end;
$$;

grant execute on function public.invite_team_partner(uuid, text) to authenticated;

create or replace function public.accept_team_invite(p_team_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team public.tournament_teams;
  v_my_email text;
  v_players jsonb;
begin
  if auth.uid() is null then
    raise exception 'Harus login.';
  end if;

  select email into v_my_email from auth.users where id = auth.uid();
  select * into v_team from public.tournament_teams where id = p_team_id;
  if v_team.id is null then
    return false;
  end if;

  v_players := coalesce(v_team.payload->'players', '[]'::jsonb);
  if jsonb_array_length(v_players) < 2 or lower(v_players->1->>'email') is distinct from lower(v_my_email) then
    return false;
  end if;

  v_players := jsonb_set(
    v_players, '{1}',
    (v_players->1) || jsonb_build_object('inviteStatus', 'accepted', 'userId', to_jsonb(auth.uid()))
  );
  update public.tournament_teams set payload = jsonb_set(payload, '{players}', v_players) where id = p_team_id;
  return true;
end;
$$;

grant execute on function public.accept_team_invite(uuid) to authenticated;

insert into public._migrations (filename) values ('0035_tournament_archive_and_invites.sql')
  on conflict (filename) do nothing;

commit;
