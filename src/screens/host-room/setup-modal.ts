import { el } from '../../ui/dom'
import { openModal, updateModalContent, closeModal } from '../../ui/modal'
import type { HostRoomHandle } from '../../trystero/room'
import { getScript } from '../../data/scripts'
import { getCharacter } from '../../data/characters'
import { suggestDistribution, shuffle } from '../../game/setup'
import type { Character, CharacterType } from '../../types'

const TYPE_ORDER: CharacterType[] = ['townsfolk', 'outsider', 'minion', 'demon']
const TYPE_LABELS: Record<CharacterType, string> = {
  townsfolk: 'Townsfolk',
  outsider: 'Outsiders',
  minion: 'Minions',
  demon: 'Demon',
}

// Real Storyteller workflow: the Storyteller picks exactly which characters are
// in play (respecting the suggested distribution for the player count) — the
// app only randomizes *which seat* ends up with which of the chosen characters,
// never which characters are chosen.
export function openSetupModal(handle: HostRoomHandle, onAssigned: () => void): void {
  const script = getScript(handle.getScriptId())
  if (!script) return

  const seats = handle.getSeats()
  const dist = suggestDistribution(seats.length)

  const selected = new Set(
    seats.map((seat) => handle.getCharacterAssignment(seat.seat)).filter((id): id is string => Boolean(id)),
  )

  function countOf(type: CharacterType): number {
    return [...selected].filter((id) => getCharacter(id)?.type === type).length
  }

  function rebuild(): void {
    const total = selected.size
    // One flat grid (no per-type headers — with 22+ characters those alone
    // pushed the grid past one screen); a single summary line replaces the
    // old per-category running counts.
    const summary = TYPE_ORDER.map((type) => `${TYPE_LABELS[type]} ${countOf(type)}/${dist[type]}`).join(' · ')

    const characters = script!.characterIds.map((id) => getCharacter(id)).filter((c): c is Character => Boolean(c))
    const grid = el(
      'div',
      { className: 'character-picker-grid' },
      characters.map((character) => {
        const isSelected = selected.has(character.id)
        const item = el(
          'button',
          { className: `character-picker-item ${character.alignment}${isSelected ? ' selected' : ''}` },
          [
            character.tokenUrl
              ? el('img', { src: character.tokenUrl, alt: character.name })
              : el('div', { className: 'character-picker-token placeholder' }),
            el('span', { textContent: character.name }),
          ],
        )
        item.addEventListener('click', () => {
          if (isSelected) selected.delete(character.id)
          else selected.add(character.id)
          rebuild()
        })
        return item
      }),
    )

    const randomizeButton = el('button', {
      className: 'primary',
      textContent: `Randomize seat assignment (${total} / ${seats.length} selected)`,
      disabled: total !== seats.length || seats.length === 0,
      onclick: () => {
        const characterIds = shuffle([...selected])
        seats.forEach((seat, i) => handle.assignCharacter(seat.seat, characterIds[i] ?? null))
        closeModal()
        onAssigned()
      },
    })

    const content = el('div', { className: 'character-picker-card setup-modal-card' }, [
      el('div', { className: 'character-picker-header' }, [
        el('h2', { textContent: 'Setup' }),
        el('button', { className: 'character-popup-close', textContent: '✕', onclick: () => closeModal() }),
      ]),
      el('p', { className: 'text-muted setup-summary', textContent: summary }),
      randomizeButton,
      grid,
    ])

    // Update in place so toggling a character doesn't reset scroll to the top
    // (see ui/modal.ts's updateModalContent doc comment).
    if (!updateModalContent(content)) {
      openModal(content, 'character-picker-overlay')
    }
  }

  rebuild()
}
