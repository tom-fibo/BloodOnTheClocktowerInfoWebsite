import type { Character } from '../types'
import { CHARACTERS_BY_ID } from '../data/characters'

export interface NightOrderStep {
  key: string
  label: string
  detail?: string
  character?: Character
}

// Synthetic steps that aren't tied to a single character card — only relevant on
// the first night, only when the corresponding team has a member in the lineup.
function syntheticFirstNightSteps(characterIds: string[]): NightOrderStep[] {
  const hasMinion = characterIds.some((id) => CHARACTERS_BY_ID[id]?.type === 'minion')
  const hasDemon = characterIds.some((id) => CHARACTERS_BY_ID[id]?.type === 'demon')
  const steps: NightOrderStep[] = []
  if (hasMinion) {
    steps.push({
      key: 'minion-info',
      label: 'Minion info',
      detail: 'Wake all Minions together: show them each other and show them the Demon.',
    })
  }
  if (hasDemon) {
    steps.push({
      key: 'demon-info',
      label: 'Demon info',
      detail: 'Wake the Demon: show them the Minions, and show 3 "bluff" character tokens not in play.',
    })
  }
  return steps
}

// Given the characters actually in play for this game (a subset of the script),
// produce the ordered list of who to wake tonight.
export function deriveNightOrder(characterIdsInPlay: string[], isFirstNight: boolean): NightOrderStep[] {
  const characterSteps = characterIdsInPlay
    .map((id) => CHARACTERS_BY_ID[id])
    .filter((c): c is Character => Boolean(c))
    .filter((c) => (isFirstNight ? c.firstNightOrder !== undefined : c.otherNightsOrder !== undefined))
    .sort((a, b) => (isFirstNight ? a.firstNightOrder! - b.firstNightOrder! : a.otherNightsOrder! - b.otherNightsOrder!))
    .map((c) => ({
      key: c.id,
      label: c.name,
      detail: isFirstNight ? c.firstNight : c.otherNights,
      character: c,
    }))

  return isFirstNight ? [...syntheticFirstNightSteps(characterIdsInPlay), ...characterSteps] : characterSteps
}
