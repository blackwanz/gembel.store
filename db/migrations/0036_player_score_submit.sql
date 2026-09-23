-- 0036_player_score_submit.sql
-- Rally Bracket's "Bagan Live" tab lets a non-admin player self-report the result of their own
-- match (admin can still override it afterward from the regular Bagan tab -- see
-- tournament.html's matchCardHTML "submit-player-score" branch). The bracket itself lives in
-- tournaments.data (jsonb), and tournaments_update RLS (0028_tournaments.sql) is admin-only --
-- for good reason, a raw UPDATE policy can't tell "a player scoring THEIR OWN undecided match"
-- from "anyone rewriting the whole bracket". So this is a narrow SECURITY DEFINER RPC instead of
-- a policy change: it re-derives the match from (tournament, category, round, index), checks the
-- caller actually owns one of the two teams in it (registered_by, or an accepted partner via
-- players[1].userId -- same ownership rule tournament.html's isMyTeam() uses client-side) and
-- that it's genuinely undecided, then does the same "set winner + advance into next round" step
-- setMatchWinner() does client-side for an admin, just in SQL.
--
-- Deliberately simpler than the client engine in one respect: it does NOT recursively clear
-- already-decided downstream rounds if the slot it's writing into turns out to already hold a
-- DIFFERENT team. That situation would mean an admin manually force-placed a team several rounds
-- ahead (assignSlotTeam) while this earlier, still-undecided match could still change the
-- outcome feeding into it -- an unusual admin action, and correcting it recursively is exactly
-- what the admin's own Bagan tab (regenerate/reassign slots) is already for.

begin;

create or replace function public.submit_match_score(
  p_tournament_id uuid,
  p_category_id text,
  p_round int,
  p_match_idx int,
  p_score_a int,
  p_score_b int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data jsonb;
  v_cats jsonb;
  v_cat_idx int;
  v_cat jsonb;
  v_bracket jsonb;
  v_rounds jsonb;
  v_round jsonb;
  v_match jsonb;
  v_team_a_id text;
  v_team_b_id text;
  v_winner_id text;
  v_is_owner boolean;
  v_next_round int;
  v_next_idx int;
  v_next_match jsonb;
  v_next_slot text;
begin
  if auth.uid() is null then
    raise exception 'Harus login.';
  end if;
  if p_score_a is null or p_score_b is null or p_score_a = p_score_b then
    raise exception 'Skor tidak valid -- harus ada yang menang.';
  end if;

  select data into v_data from public.tournaments where id = p_tournament_id;
  if v_data is null then
    raise exception 'Turnamen tidak ditemukan.';
  end if;

  v_cats := coalesce(v_data->'categories', '[]'::jsonb);
  select (ord - 1) into v_cat_idx
    from jsonb_array_elements(v_cats) with ordinality as e(val, ord)
    where e.val->>'id' = p_category_id
    limit 1;
  if v_cat_idx is null then
    raise exception 'Kategori tidak ditemukan.';
  end if;

  v_cat := v_cats->v_cat_idx;
  v_bracket := v_cat->'bracket';
  if v_bracket is null then
    raise exception 'Bagan belum dibuat untuk kategori ini.';
  end if;
  v_rounds := v_bracket->'rounds';
  v_round := v_rounds->p_round;
  v_match := v_round->p_match_idx;
  if v_match is null then
    raise exception 'Pertandingan tidak ditemukan.';
  end if;
  if v_match->>'winnerId' is not null then
    raise exception 'Pertandingan ini sudah punya hasil.';
  end if;
  if coalesce((v_match->>'isBye')::boolean, false) then
    raise exception 'Ini bye, bukan pertandingan yang bisa disubmit.';
  end if;

  v_team_a_id := v_match->>'teamAId';
  v_team_b_id := v_match->>'teamBId';
  if v_team_a_id is null or v_team_b_id is null then
    raise exception 'Kedua slot tim belum terisi.';
  end if;

  select exists(
    select 1 from public.tournament_teams t
    where t.id::text in (v_team_a_id, v_team_b_id)
      and (
        t.registered_by = auth.uid()
        or (t.payload->'players'->1->>'userId') = auth.uid()::text
      )
  ) into v_is_owner;
  if not v_is_owner then
    raise exception 'Cuma pemain di pertandingan ini yang bisa submit skor.';
  end if;

  v_winner_id := case when p_score_a > p_score_b then v_team_a_id else v_team_b_id end;

  v_match := v_match || jsonb_build_object('scoreA', p_score_a, 'scoreB', p_score_b, 'winnerId', v_winner_id, 'walkover', false);
  v_round := jsonb_set(v_round, array[p_match_idx::text], v_match);
  v_rounds := jsonb_set(v_rounds, array[p_round::text], v_round);

  if p_round + 1 < jsonb_array_length(v_rounds) then
    v_next_round := p_round + 1;
    v_next_idx := p_match_idx / 2; -- integer division, matches Math.floor(mi/2) client-side
    v_next_match := v_rounds->v_next_round->v_next_idx;
    v_next_slot := case when p_match_idx % 2 = 0 then 'teamAId' else 'teamBId' end;
    v_next_match := jsonb_set(coalesce(v_next_match, '{}'::jsonb), array[v_next_slot], to_jsonb(v_winner_id));
    v_rounds := jsonb_set(v_rounds, array[v_next_round::text, v_next_idx::text], v_next_match);
  end if;

  v_bracket := jsonb_set(v_bracket, '{rounds}', v_rounds);
  v_cat := jsonb_set(v_cat, '{bracket}', v_bracket);
  v_cats := jsonb_set(v_cats, array[v_cat_idx::text], v_cat);
  v_data := jsonb_set(v_data, '{categories}', v_cats);

  update public.tournaments set data = v_data where id = p_tournament_id;
  return true;
end;
$$;

grant execute on function public.submit_match_score(uuid, text, int, int, int, int) to authenticated;

insert into public._migrations (filename) values ('0036_player_score_submit.sql')
  on conflict (filename) do nothing;

commit;
