import { el } from './dom'
import { openModal, closeModal } from './modal'
import { getCharacter } from '../data/characters'
import type { Character, CharacterType, Script } from '../types'

const TYPE_ORDER: CharacterType[] = ['townsfolk', 'outsider', 'minion', 'demon']
const TYPE_LABELS: Record<CharacterType, string> = {
  townsfolk: 'Townsfolk',
  outsider: 'Outsiders',
  minion: 'Minions',
  demon: 'Demon',
}

export interface CharacterPickerOptions {
  title?: string
  allowNone?: boolean
  filterIds?: string[]
  onSelect: (characterId: string | null) => void
}

// Single-click grid picker (no dropdowns) for the common "pick one character"
// case — character assignment, adding a `character` night-card element,
// Town Square predictions. For "toggle many characters on/off" (Setup), see
// grimoire-panel.ts's own dedicated setup modal instead — the interaction is
// different enough (multi-select + running counts) not to share this component.
export function openCharacterPicker(script: Script, options: CharacterPickerOptions): void {
  const ids = options.filterIds ?? script.characterIds

  const groups = TYPE_ORDER.map((type) => {
    const characters = ids.map((id) => getCharacter(id)).filter((c): c is Character => c?.type === type)
    if (characters.length === 0) return null

    return el('div', { className: 'character-picker-group' }, [
      el('h3', { textContent: TYPE_LABELS[type] }),
      el(
        'div',
        { className: 'character-picker-grid' },
        characters.map((character) => {
          const item = el('button', { className: `character-picker-item ${character.alignment}` }, [
            character.tokenUrl
              ? el('img', { src: character.tokenUrl, alt: character.name })
              : el('div', { className: 'character-picker-token placeholder' }),
            el('span', { textContent: character.name }),
          ])
          item.addEventListener('click', () => {
            closeModal()
            options.onSelect(character.id)
          })
          return item
        }),
      ),
    ])
  }).filter((group): group is HTMLDivElement => group !== null)

  const content = el('div', { className: 'character-picker-card' }, [
    el('div', { className: 'character-picker-header' }, [
      el('h2', { textContent: options.title ?? 'Choose a character' }),
      el('button', { className: 'character-popup-close', textContent: '✕', onclick: () => closeModal() }),
    ]),
    ...(options.allowNone
      ? [
          el('button', {
            className: 'secondary character-picker-none',
            textContent: '— None —',
            onclick: () => {
              closeModal()
              options.onSelect(null)
            },
          }),
        ]
      : []),
    ...groups,
  ])

  openModal(content, 'character-picker-overlay')
}
