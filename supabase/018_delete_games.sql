-- Deleting games you don't want. League admins could already delete any game; this lets team admins delete
-- a game their team is in that was started by mistake: a regular-season game with no plays recorded yet.
-- (Scheduled and playoff games, and games with plays, still need a league admin.)
-- Run this once in Supabase: SQL Editor → New query → paste → Run.

create or replace function public.delete_game(p_game_id text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  g public.games;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  select * into g from public.games where id = p_game_id for update;
  if not found then return; end if;   -- already deleted
  if public.is_league_admin(g.league_id)
     or (g.practice_team is not null and public.is_team_admin(g.practice_team)) then
    delete from public.games where id = p_game_id;
    return;
  end if;
  if not (public.is_team_admin(g.home_id) or public.is_team_admin(g.away_id)) then
    raise exception 'Only admins of a team in this game can delete it.';
  end if;
  if g.stage <> 'regular' or g.status = 'scheduled' then
    raise exception 'Only league admins can delete scheduled or playoff games.';
  end if;
  if exists (select 1 from public.events where game_id = p_game_id) then
    raise exception 'This game has plays recorded. Undo them first, or ask a league admin to delete it.';
  end if;
  delete from public.games where id = p_game_id;   -- plays go with it
end;
$$;
revoke execute on function public.delete_game(text) from public, anon;
grant execute on function public.delete_game(text) to authenticated;
