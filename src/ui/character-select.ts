import { el } from './dom'
import { getCharacter } from '../data/characters'
import type { Script } from '../types'

// Shared "pick a character from this script" <select> builder, used by the
// Grimoire's character-assign control and Town Square's prediction control.
export function characterOptionsFor(script: Script, selectedId?: string): HTMLSelectElement {
  return el('select', { className: 'character-select' }, [
    el('option', { value: '', textContent: '— none —' }),
    ...script.characterIds.map((id) => {
      const character = getCharacter(id)
      return el('option', {
        value: id,
        textContent: character ? `[${character.type}] ${character.name}` : id,
        selected: selectedId === id,
      })
    }),
  ])
}
