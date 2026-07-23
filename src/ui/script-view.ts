import { el } from './dom'
import { getScript } from '../data/scripts'
import { CHARACTERS_BY_ID } from '../data/characters'
import { attachCharacterTrigger } from './character-popup'
import type { Character, CharacterType } from '../types'

const TYPE_ORDER: CharacterType[] = ['townsfolk', 'outsider', 'minion', 'demon']
const TYPE_LABELS: Record<CharacterType, string> = {
  townsfolk: 'Townsfolk',
  outsider: 'Outsiders',
  minion: 'Minions',
  demon: 'Demon',
}

// Shared between the Storyteller's and Player's Script panels — both just show
// the character list with popups; only the Storyteller's wrapper adds a
// script-selector control around this.
export function renderScriptView(container: HTMLElement, scriptId: string): void {
  const script = getScript(scriptId)
  if (!script) {
    container.replaceChildren(el('p', { className: 'roster-empty', textContent: 'Unknown script.' }))
    return
  }

  const groups = TYPE_ORDER.map((type) => {
    const characters = script.characterIds
      .map((id) => CHARACTERS_BY_ID[id])
      .filter((c): c is Character => c?.type === type)

    const list = el(
      'ul',
      { className: 'script-character-list' },
      characters.map((character) => {
        const item = el('li', { className: 'script-character-item' }, [
          character.tokenUrl
            ? el('img', { className: 'script-character-token', src: character.tokenUrl, alt: character.name })
            : el('div', { className: 'script-character-token placeholder' }),
          el('span', { textContent: character.name }),
        ])
        attachCharacterTrigger(item, character.id)
        return item
      }),
    )

    return el('div', { className: 'script-group' }, [el('h3', { textContent: TYPE_LABELS[type] }), list])
  })

  container.replaceChildren(el('div', { className: 'script-view' }, [el('h2', { textContent: script.name }), ...groups]))
}
