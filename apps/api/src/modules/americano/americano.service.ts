import { type DbHandle } from "../../shared/db/pool.js";
import { NotFoundError, ForbiddenError, ValidationError } from "../../shared/errors/AppError.js";
import { americanoRepository } from "./americano.repository.js";
import { type CreateAmericanoInput, type RecordScoreInput } from "./americano.schema.js";

export interface AmericanoServiceDeps {
  db: DbHandle;
}

export interface LeaderboardEntry {
  id: string;
  display_name: string;
  wins: number;
  draws: number;
  losses: number;
  score: number; // League points (Wins * 3 + Draws * 1)
  pointsScored: number;
  pointsConceded: number;
  pointsDifference: number;
}

export interface AmericanoTeam {
  id: string;
  display_name: string;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  score: number | null;
}

export interface AmericanoMatch {
  status: string;
  score_a: number | null;
  score_b: number | null;
  team_a_id: string;
  team_b_id: string;
}


export class AmericanoService {
  constructor(private readonly deps: AmericanoServiceDeps) {}

  async createTournament(hostId: string, input: CreateAmericanoInput): Promise<string> {
    if (input.players.length < 4 || input.players.length > 12) {
      throw new ValidationError("Americano tournament requires between 4 and 12 participants.");
    }

    return await this.deps.db.db.transaction().execute(async (trx) => {
      // 1. Create the tournament
      const tournamentId = await americanoRepository.insertTournament(trx, {
        name: input.name,
        format: input.format,
        host_id: hostId,
        court_count: input.courts.length,
        scoring_system: input.scoring_system,
      });

      // 2. Create the teams (in both Solo & Team formats, the registered entities are saved as teams)
      const teamInsertData = input.players.map((name) => ({
        tournament_id: tournamentId,
        display_name: name,
      }));
      await americanoRepository.insertTeams(trx, teamInsertData);

      // Fetch teams back to get their generated IDs
      const insertedTeams = await americanoRepository.getTeams(trx, tournamentId);
      const teamIds = insertedTeams.map((t) => t.id);

      // 3. Generate Round Robin matches
      const schedule = this.generateRoundRobinSchedule(teamIds);

      // Create match rows
      const matchInsertData = schedule.map((item) => {
        // Distribute courts cyclically among matches of the same round
        const roundMatches = schedule.filter((s) => s.round === item.round);
        const matchIndexInRound = roundMatches.indexOf(item);
        const courtName = input.courts[matchIndexInRound % input.courts.length] ?? "Court 1";

        return {
          tournament_id: tournamentId,
          court_name: courtName,
          round_number: item.round,
          team_a_id: item.home,
          team_b_id: item.away,
        };
      });

      await americanoRepository.insertMatches(trx, matchInsertData);

      // Start the tournament automatically
      await americanoRepository.updateTournamentStatus(trx, tournamentId, "playing");

      return tournamentId;
    });
  }

  async getTournamentsByHost(hostId: string) {
    return await americanoRepository.getTournamentsByHost(this.deps.db.db, hostId);
  }

  async getTournamentDetails(id: string) {
    const db = this.deps.db.db;

    const tournament = await americanoRepository.getTournament(db, id);
    if (!tournament) throw new NotFoundError("Americano tournament not found");

    const teams = await americanoRepository.getTeams(db, id);
    const matches = await americanoRepository.getMatches(db, id);
    const reward = await americanoRepository.getReward(db, id);

    // Compute dynamic leaderboard standings
    const leaderboard = this.calculateLeaderboard(teams, matches);

    return {
      tournament,
      teams,
      matches,
      leaderboard,
      reward: reward ?? null,
    };
  }

  async recordMatchScore(
    hostId: string,
    matchId: string,
    input: RecordScoreInput
  ): Promise<void> {
    await this.deps.db.db.transaction().execute(async (trx) => {
      // 1. Fetch match and check exist
      const match = await americanoRepository.getMatch(trx, matchId);
      if (!match) throw new NotFoundError("Match not found");

      const tournament = await americanoRepository.getTournament(trx, match.tournament_id);
      if (!tournament) throw new NotFoundError("Tournament not found");

      if (tournament.host_id !== hostId) {
        throw new ForbiddenError("Only the tournament host can record match scores.");
      }

      // 2. Update the match score
      await americanoRepository.updateMatchScore(trx, matchId, input.score_a, input.score_b);

      // 3. Recalculate stats for all teams in the tournament
      const allMatches = await americanoRepository.getMatches(trx, tournament.id);
      const allTeams = await americanoRepository.getTeams(trx, tournament.id);

      const teamStatsMap = new Map<string, { wins: number; draws: number; losses: number; score: number }>();
      for (const t of allTeams) {
        teamStatsMap.set(t.id, { wins: 0, draws: 0, losses: 0, score: 0 });
      }

      for (const m of allMatches) {
        if (m.status !== "completed" || m.score_a === null || m.score_b === null) continue;

        const statsA = teamStatsMap.get(m.team_a_id) ?? { wins: 0, draws: 0, losses: 0, score: 0 };
        const statsB = teamStatsMap.get(m.team_b_id) ?? { wins: 0, draws: 0, losses: 0, score: 0 };

        if (m.score_a > m.score_b) {
          statsA.wins += 1;
          statsA.score += 3;
          statsB.losses += 1;
        } else if (m.score_b > m.score_a) {
          statsB.wins += 1;
          statsB.score += 3;
          statsA.losses += 1;
        } else {
          statsA.draws += 1;
          statsA.score += 1;
          statsB.draws += 1;
          statsB.score += 1;
        }

        teamStatsMap.set(m.team_a_id, statsA);
        teamStatsMap.set(m.team_b_id, statsB);
      }

      // Save updated team statistics
      for (const [teamId, stats] of teamStatsMap.entries()) {
        await americanoRepository.updateTeamStats(trx, teamId, stats);
      }

      // 4. Check if all matches are completed
      const pendingMatches = allMatches.filter((m) => m.id !== matchId && m.status === "pending");
      if (pendingMatches.length === 0) {
        // Complete the tournament
        await americanoRepository.updateTournamentStatus(trx, tournament.id, "completed");

        // Fetch refreshed teams and matches to calculate definitive standings
        const finalTeams = await americanoRepository.getTeams(trx, tournament.id);
        const finalMatches = await americanoRepository.getMatches(trx, tournament.id);
        const leaderboard = this.calculateLeaderboard(finalTeams, finalMatches);

        const winner = leaderboard[0];
        if (winner) {
          // Generate sponsor coupon code
          const couponChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
          let code = "TOPPADEL-";
          for (let i = 0; i < 6; i++) {
            code += couponChars.charAt(Math.floor(Math.random() * couponChars.length));
          }

          await americanoRepository.insertReward(trx, {
            tournament_id: tournament.id,
            winner_team_id: winner.id,
            sponsor_coupon_code: code,
            prize_name: "Free 1 Hour Court Slot at Top Padel Baku",
          });
        }
      }
    });
  }

  // Helper: Berger/Circle round robin algorithm
  private generateRoundRobinSchedule(teamIds: string[]): { round: number; home: string; away: string }[] {
    const list = [...teamIds];
    const isOdd = list.length % 2 !== 0;
    if (isOdd) {
      list.push("BYE"); // dummy team for bye round
    }

    const numTeams = list.length;
    const numRounds = numTeams - 1;
    const half = numTeams / 2;
    const schedule: { round: number; home: string; away: string }[] = [];

    for (let round = 1; round <= numRounds; round++) {
      for (let i = 0; i < half; i++) {
        const home = list[i];
        const away = list[numTeams - 1 - i];
        if (home !== undefined && away !== undefined && home !== "BYE" && away !== "BYE") {
          schedule.push({ round, home, away });
        }
      }
      // Rotate list: keep first element fixed, rotate others
      const popped = list.pop();
      if (popped !== undefined) {
        list.splice(1, 0, popped);
      }
    }

    return schedule;
  }

  // Calculate tie-breaker sorting dynamically
  calculateLeaderboard(teams: AmericanoTeam[], matches: AmericanoMatch[]): LeaderboardEntry[] {
    const board = teams.map((t) => ({
      id: t.id,
      display_name: t.display_name,
      wins: Number(t.wins),
      draws: Number(t.draws),
      losses: Number(t.losses),
      score: Number(t.score),
      pointsScored: 0,
      pointsConceded: 0,
      pointsDifference: 0,
    }));

    const map = new Map<string, typeof board[0]>();
    for (const b of board) {
      map.set(b.id, b);
    }

    for (const m of matches) {
      if (m.status !== "completed" || m.score_a === null || m.score_b === null) continue;

      const teamA = map.get(m.team_a_id);
      const teamB = map.get(m.team_b_id);

      if (teamA) {
        teamA.pointsScored += m.score_a;
        teamA.pointsConceded += m.score_b;
      }
      if (teamB) {
        teamB.pointsScored += m.score_b;
        teamB.pointsConceded += m.score_a;
      }
    }

    for (const b of board) {
      b.pointsDifference = b.pointsScored - b.pointsConceded;
    }

    // Sort by: 1. Total score/points, 2. Points difference, 3. Points scored
    board.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.pointsDifference !== a.pointsDifference) return b.pointsDifference - a.pointsDifference;
      return b.pointsScored - a.pointsScored;
    });

    return board;
  }
}
