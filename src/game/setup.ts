import type { Character, Script } from '../types'
import { CHARACTERS_BY_ID } from '../data/characters'

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

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function charactersOfType(script: Script, type: Character['type']): Character[] {
  return script.characterIds.map((id) => CHARACTERS_BY_ID[id]).filter((c): c is Character => c?.type === type)
}

// Randomly assigns characters for a game: picks Minions and the Demon first, then
// applies the Baron's +2 Outsider / -2 Townsfolk modifier if the Baron was picked,
// before finally picking Townsfolk and Outsiders. Returns character ids in a
// randomized order — the caller decides which seat gets which slot.
export function assignCharacters(script: Script, playerCount: number): string[] {
  const base = suggestDistribution(playerCount)

  const demons = shuffle(charactersOfType(script, 'demon')).slice(0, base.demon)
  const minions = shuffle(charactersOfType(script, 'minion')).slice(0, base.minion)

  const hasBaron = minions.some((c) => c.id === 'baron')
  const townsfolkCount = hasBaron ? Math.max(0, base.townsfolk - 2) : base.townsfolk
  const outsiderCount = hasBaron ? base.outsider + 2 : base.outsider

  const townsfolk = shuffle(charactersOfType(script, 'townsfolk')).slice(0, townsfolkCount)
  const outsiders = shuffle(charactersOfType(script, 'outsider')).slice(0, outsiderCount)

  return shuffle([...townsfolk, ...outsiders, ...minions, ...demons].map((c) => c.id))
}
