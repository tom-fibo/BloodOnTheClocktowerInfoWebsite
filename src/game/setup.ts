export interface Distribution {
  townsfolk: number
  outsider: number
  minion: number
  demon: number
}

// Official Trouble Brewing distribution table, 5-15 players (townsfolk/outsider/minion/demon).
const DISTRIBUTION_TABLE: Record<number, Distribution> = {
  5: { townsfolk: 3, outsider: 0, minion: 1, demon: 1 },
  6: { townsfolk: 3, outsider: 1, minion: 1, demon: 1 },
  7: { townsfolk: 5, outsider: 0, minion: 1, demon: 1 },
  8: { townsfolk: 5, outsider: 1, minion: 1, demon: 1 },
  9: { townsfolk: 5, outsider: 2, minion: 1, demon: 1 },
  10: { townsfolk: 7, outsider: 0, minion: 2, demon: 1 },
  11: { townsfolk: 7, outsider: 1, minion: 2, demon: 1 },
  12: { townsfolk: 7, outsider: 2, minion: 2, demon: 1 },
  13: { townsfolk: 9, outsider: 0, minion: 3, demon: 1 },
  14: { townsfolk: 9, outsider: 1, minion: 3, demon: 1 },
  15: { townsfolk: 9, outsider: 2, minion: 3, demon: 1 },
}

// Officially BOTC supports 5-15 players; outside that range we clamp to the
// nearest supported count so the assistant still produces something usable.
export function suggestDistribution(playerCount: number): Distribution {
  const clamped = Math.min(15, Math.max(5, playerCount))
  return DISTRIBUTION_TABLE[clamped]
}

export const DISTRIBUTION_PLAYER_COUNTS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const

// The whole 5-15 table, for display (e.g. the Script view's player-count chart) —
// distinct from suggestDistribution(), which is for a single specific count.
export function getDistributionTable(): (Distribution & { players: number })[] {
  return DISTRIBUTION_PLAYER_COUNTS.map((players) => ({ players, ...DISTRIBUTION_TABLE[players] }))
}

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}