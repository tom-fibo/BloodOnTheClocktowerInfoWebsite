import type { Script } from '../types'
import { CHARACTERS } from './characters'

export const TROUBLE_BREWING: Script = {
  id: 'trouble-brewing',
  name: 'Trouble Brewing',
  characterIds: CHARACTERS.map((c) => c.id),
}

// Custom script import and additional scripts (Bad Moon Rising, Sects & Violets)
// are deferred — see TODO.md. For now this is the only script.
export const SCRIPTS: Script[] = [TROUBLE_BREWING]

export function getScript(id: string): Script | undefined {
  return SCRIPTS.find((s) => s.id === id)
}

export const DEFAULT_SCRIPT_ID = TROUBLE_BREWING.id
