-- Up Migration --
--
-- Seed the 10 starter badges. Idempotent via ON CONFLICT (slug) DO NOTHING so
-- re-running the migration locally won't error.
--
-- Criteria DSL recap:
--   games_played       — total games_played in player_sport_stats reaches `value`
--   elo_min            — elo_rating ≥ `value`
--   win_streak         — last `value` rated games are wins (latest first)
--   reliability_min    — reliability_score ≥ `value` AND games_played ≥ `min_games`
--   tournament_finalist— captain or roster of a tournament_entries row marked confirmed
--                        in a tournament with status='completed'
--   no_show_free_month — zero `no_show` participations in the trailing 30 days
--                        AND at least 1 game played in that window

INSERT INTO achievements (slug, name, description, icon_name, criteria) VALUES
  ('first_game',
   'First Game',
   'Played your first padel game on Linkfit.',
   'figure.tennis',
   '{"type":"games_played","value":1,"sport":"padel"}'),

  ('ten_games',
   'Ten in the Books',
   'Completed 10 games. The court remembers you.',
   'number.square',
   '{"type":"games_played","value":10,"sport":"padel"}'),

  ('hundred_games',
   'Century',
   '100 games played. Veteran energy.',
   'medal',
   '{"type":"games_played","value":100,"sport":"padel"}'),

  ('win_streak_5',
   'Hot Streak',
   'Five wins in a row — feel that flow.',
   'flame',
   '{"type":"win_streak","value":5,"sport":"padel"}'),

  ('elo_1500',
   'Sharp Edge',
   'Reached an ELO of 1500. Above the pack.',
   'bolt',
   '{"type":"elo_min","value":1500,"sport":"padel"}'),

  ('elo_2000',
   'Elite Tier',
   'Crossed 2000 ELO. Reserved for the top.',
   'crown',
   '{"type":"elo_min","value":2000,"sport":"padel"}'),

  ('tournament_finalist',
   'Tournament Finalist',
   'Played in the final of a completed tournament.',
   'trophy',
   '{"type":"tournament_finalist"}'),

  ('no_show_free_month',
   'Always Shows',
   'No-show free for a full month of active play.',
   'checkmark.seal',
   '{"type":"no_show_free_month"}'),

  ('reliable_player',
   'Reliable',
   'Above 90% reliability across 20+ games.',
   'shield.checkered',
   '{"type":"reliability_min","value":90,"min_games":20,"sport":"padel"}'),

  ('rating_giver',
   'Fair Judge',
   'Submitted ratings for 25 co-players.',
   'star.bubble',
   '{"type":"ratings_given","value":25}')
ON CONFLICT (slug) DO NOTHING;

-- Down Migration ----------------------------------------------------------
DELETE FROM achievements WHERE slug IN (
  'first_game','ten_games','hundred_games','win_streak_5',
  'elo_1500','elo_2000','tournament_finalist','no_show_free_month',
  'reliable_player','rating_giver'
);
