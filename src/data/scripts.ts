import type { Script } from '../types'
import { CHARACTERS } from './characters'

export const TROUBLE_BREWING: Script = {
  id: 'trouble-brewing',
  name: 'Trouble Brewing',
  characterIds: CHARACTERS.filter((c) => (c.edition == 'tb')).map((c) => c.id),
}
export const BAD_MOON_RISING: Script = {
  id: 'bad-moon-rising',
  name: 'Bad Moon Rising',
  characterIds: CHARACTERS.filter((c) => (c.edition == 'bmr')).map((c) => c.id),
}
export const SECTS_AND_VIOLETS: Script = {
  id: 'sects-and-violets',
  name: 'Sects and Violets',
  characterIds: CHARACTERS.filter((c) => (c.edition == 'snv')).map((c) => c.id),
}

// Custom script import and additional scripts (Bad Moon Rising, Sects & Violets)
// are deferred — see TODO.md. For now this is the only script.
export const SCRIPTS: Script[] = [TROUBLE_BREWING, BAD_MOON_RISING, SECTS_AND_VIOLETS]

export function getScript(id: string): Script | undefined {
  return SCRIPTS.find((s) => s.id === id)
}

export const DEFAULT_SCRIPT_ID = TROUBLE_BREWING.id
