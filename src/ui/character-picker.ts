import { el } from './dom'
import { openModal, updateModalContent, closeModal } from './modal'
import { getCharacter } from '../data/characters'
import type { Character, Script } from '../types'

function characterItem(character: Character): HTMLButtonElement {
  return el('button', { className: `character-picker-item ${character.alignment}` }, [
    character.tokenUrl
      ? el('img', { src: character.tokenUrl, alt: character.name })
      : el('div', { className: 'character-picker-token placeholder' }),
    el('span', { textContent: character.name }),
  ])
}

function charactersFor(ids: string[]): Character[] {
  return ids.map((id) => getCharacter(id)).filter((c): c is Character => Boolean(c))
}

export interface CharacterPickerOptions {
  title?: string
  allowNone?: boolean
  filterIds?: string[]
  onSelect: (characterId: string | null) => void
}

// Single-click grid picker (no dropdowns) for the common "pick one character"
// case — character assignment, adding a `character` night-card element, Town
// Square predictions. One flat grid, no Townsfolk/Outsider/Minion/Demon
// headers — with 22+ characters the headers alone were pushing the grid past
// one screen.
export function openCharacterPicker(script: Script, options: CharacterPickerOptions): void {
  const ids = options.filterIds ?? script.characterIds
  const grid = el(
    'div',
    { className: 'character-picker-grid' },
    charactersFor(ids).map((character) => {
      const item = characterItem(character)
      item.addEventListener('click', () => {
        closeModal()
        options.onSelect(character.id)
      })
      return item
    }),
  )

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
    grid,
  ])

  openModal(content, 'character-picker-overlay')
}

export interface MultiCharacterPickerOptions {
  title?: string
  count: number
  // Shown grayed-out and unclickable — e.g. characters already in play, when
  // picking bluffs that must come from what's NOT in play.
  disabledIds?: string[]
  onConfirm: (characterIds: string[]) => void
}

// "Pick exactly N characters" — used for e.g. manually choosing a Demon's 3
// bluffs, so the Storyteller controls which ones (avoiding an unfit random
// pick like the Drunk or an evil character) rather than the app choosing.
export function openMultiCharacterPicker(script: Script, options: MultiCharacterPickerOptions): void {
  const selected = new Set<string>()
  const disabled = new Set(options.disabledIds ?? [])

  function rebuild(): void {
    const grid = el(
      'div',
      { className: 'character-picker-grid' },
      charactersFor(script.characterIds).map((character) => {
        const isDisabled = disabled.has(character.id)
        const isSelected = selected.has(character.id)
        const item = characterItem(character)
        item.classList.toggle('selected', isSelected)
        item.classList.toggle('disabled', isDisabled)
        if (isDisabled) {
          item.disabled = true
        } else {
          item.addEventListener('click', () => {
            if (isSelected) selected.delete(character.id)
            else if (selected.size < options.count) selected.add(character.id)
            rebuild()
          })
        }
        return item
      }),
    )

    const confirmButton = el('button', {
      className: 'primary',
      textContent: `Confirm (${selected.size} / ${options.count})`,
      disabled: selected.size !== options.count,
      onclick: () => {
        closeModal()
        options.onConfirm([...selected])
      },
    })

    const content = el('div', { className: 'character-picker-card' }, [
      el('div', { className: 'character-picker-header' }, [
        el('h2', { textContent: options.title ?? `Choose ${options.count} characters` }),
        el('button', { className: 'character-popup-close', textContent: '✕', onclick: () => closeModal() }),
      ]),
      confirmButton,
      grid,
    ])

    if (!updateModalContent(content)) openModal(content, 'character-picker-overlay')
  }

  rebuild()
}
