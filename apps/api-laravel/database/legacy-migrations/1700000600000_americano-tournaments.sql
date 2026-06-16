CREATE TABLE americano_tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  format VARCHAR(10) NOT NULL, -- 'solo' or 'team'
  host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  court_count INT NOT NULL,
  scoring_system VARCHAR(30) NOT NULL,
  status VARCHAR(15) NOT NULL DEFAULT 'open', -- 'open', 'playing', 'completed'
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE americano_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES americano_tournaments(id) ON DELETE CASCADE,
  display_name VARCHAR(100) NOT NULL,
  wins INT NOT NULL DEFAULT 0,
  draws INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  score INT NOT NULL DEFAULT 0
);

CREATE TABLE americano_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES americano_tournaments(id) ON DELETE CASCADE,
  court_name VARCHAR(50) NOT NULL,
  round_number INT NOT NULL,
  team_a_id UUID NOT NULL REFERENCES americano_teams(id) ON DELETE CASCADE,
  team_b_id UUID NOT NULL REFERENCES americano_teams(id) ON DELETE CASCADE,
  score_a INT,
  score_b INT,
  status VARCHAR(15) NOT NULL DEFAULT 'pending' -- 'pending', 'completed'
);

CREATE TABLE americano_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES americano_tournaments(id) ON DELETE CASCADE,
  winner_team_id UUID NOT NULL REFERENCES americano_teams(id) ON DELETE CASCADE,
  sponsor_coupon_code VARCHAR(30) NOT NULL,
  prize_name VARCHAR(100) NOT NULL
);
