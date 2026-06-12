import { type Executor } from "../../shared/db/withTransaction.js";

export interface TournamentInsert {
  name: string;
  format: "solo" | "team";
  host_id: string;
  court_count: number;
  scoring_system: string;
}

export interface TeamInsert {
  tournament_id: string;
  display_name: string;
}

export interface MatchInsert {
  tournament_id: string;
  court_name: string;
  round_number: number;
  team_a_id: string;
  team_b_id: string;
}

export interface RewardInsert {
  tournament_id: string;
  winner_team_id: string;
  sponsor_coupon_code: string;
  prize_name: string;
}

export const americanoRepository = {
  async insertTournament(db: Executor, params: TournamentInsert): Promise<string> {
    const row = await db
      .insertInto("americano_tournaments")
      .values({
        name: params.name,
        format: params.format,
        host_id: params.host_id,
        court_count: params.court_count,
        scoring_system: params.scoring_system,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  },

  async insertTeams(db: Executor, teams: TeamInsert[]): Promise<void> {
    if (teams.length === 0) return;
    await db
      .insertInto("americano_teams")
      .values(teams)
      .execute();
  },

  async insertMatches(db: Executor, matches: MatchInsert[]): Promise<void> {
    if (matches.length === 0) return;
    await db
      .insertInto("americano_matches")
      .values(matches)
      .execute();
  },

  async getTournament(db: Executor, id: string) {
    return await db
      .selectFrom("americano_tournaments")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  },

  async getTournamentsByHost(db: Executor, hostId: string) {
    return await db
      .selectFrom("americano_tournaments")
      .selectAll()
      .where("host_id", "=", hostId)
      .orderBy("created_at", "desc")
      .execute();
  },

  async getTeams(db: Executor, tournamentId: string) {
    return await db
      .selectFrom("americano_teams")
      .selectAll()
      .where("tournament_id", "=", tournamentId)
      .execute();
  },

  async getMatches(db: Executor, tournamentId: string) {
    return await db
      .selectFrom("americano_matches")
      .selectAll()
      .where("tournament_id", "=", tournamentId)
      .orderBy("round_number", "asc")
      .execute();
  },

  async getMatch(db: Executor, id: string) {
    return await db
      .selectFrom("americano_matches")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
  },

  async updateMatchScore(
    db: Executor,
    matchId: string,
    scoreA: number,
    scoreB: number
  ): Promise<void> {
    await db
      .updateTable("americano_matches")
      .set({
        score_a: scoreA,
        score_b: scoreB,
        status: "completed",
      })
      .where("id", "=", matchId)
      .execute();
  },

  async updateTournamentStatus(
    db: Executor,
    id: string,
    status: "open" | "playing" | "completed"
  ): Promise<void> {
    await db
      .updateTable("americano_tournaments")
      .set({ status })
      .where("id", "=", id)
      .execute();
  },

  async updateTeamStats(
    db: Executor,
    teamId: string,
    stats: { wins: number; draws: number; losses: number; score: number }
  ): Promise<void> {
    await db
      .updateTable("americano_teams")
      .set({
        wins: stats.wins,
        draws: stats.draws,
        losses: stats.losses,
        score: stats.score,
      })
      .where("id", "=", teamId)
      .execute();
  },

  async insertReward(db: Executor, params: RewardInsert): Promise<string> {
    const row = await db
      .insertInto("americano_rewards")
      .values({
        tournament_id: params.tournament_id,
        winner_team_id: params.winner_team_id,
        sponsor_coupon_code: params.sponsor_coupon_code,
        prize_name: params.prize_name,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  },

  async getReward(db: Executor, tournamentId: string) {
    return await db
      .selectFrom("americano_rewards")
      .selectAll()
      .where("tournament_id", "=", tournamentId)
      .executeTakeFirst();
  },
};
