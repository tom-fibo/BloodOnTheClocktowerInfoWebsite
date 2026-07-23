import { el } from '../../ui/dom'
import type { PlayerRoomHandle } from '../../trystero/room'
import { getScript } from '../../data/scripts'
import { suggestDistribution } from '../../game/setup'
import { openCharacterPicker } from '../../ui/character-picker'
import { openModal, closeModal } from '../../ui/modal'
import { getCharacter } from '../../data/characters'
import { layoutInCircle } from '../../ui/circular-layout'
import type { PlayerInfo } from '../../types'

export interface TownSquareState {
  latestRoster: PlayerInfo[]
  scriptId: string
}

// Predictions and notes are a Player's own private scratchpad about other
// players — purely local, never sent anywhere, so they reset on reload same as
// any other unsaved browser state. Keyed by seat number.
const predictions = new Map<number, string>()
const notes = new Map<number, string>()

export function renderTownSquarePanel(container: HTMLElement, handle: PlayerRoomHandle, state: TownSquareState): void {
  const summary = el('p', { className: 'town-square-summary' })
  const circle = el('div', { className: 'seat-circle town-square-circle' })

  function refreshSummary(): void {
    const dist = suggestDistribution(state.latestRoster.length)
    summary.textContent = `Default for ${state.latestRoster.length} players: ${dist.townsfolk} Townsfolk, ${dist.outsider} Outsider, ${dist.minion} Minion, ${dist.demon} Demon.`
  }

  function openSeatModal(seat: PlayerInfo): void {
    const predictionButton = el('button', {
      className: 'secondary prediction-button',
      textContent: predictions.has(seat.seat) ? getCharacter(predictions.get(seat.seat)!)?.name ?? 'Prediction' : 'Set prediction',
      onclick: () => {
        const script = getScript(state.scriptId)
        if (!script) return
        openCharacterPicker(script, {
          title: `Prediction for ${seat.name}`,
          allowNone: true,
          onSelect: (characterId) => {
            if (characterId) predictions.set(seat.seat, characterId)
            else predictions.delete(seat.seat)
            openSeatModal(seat)
          },
        })
      },
    })

    const noteInput = el('textarea', {
      className: 'town-square-note-input',
      rows: 3,
      placeholder: 'Notes about this player…',
      value: notes.get(seat.seat) ?? '',
    })
    noteInput.addEventListener('input', () => notes.set(seat.seat, noteInput.value))

    const content = el('div', { className: 'seat-modal-card' }, [
      el('button', { className: 'character-popup-close', textContent: '✕', onclick: () => closeModal() }),
      el('h2', { textContent: seat.name }),
      el('p', {
        className: 'text-muted',
        textContent: [!seat.alive ? 'Dead' : 'Alive', seat.voteToken ? 'has vote token' : null].filter(Boolean).join(' · '),
      }),
      el('div', { className: 'seat-detail-row' }, [el('label', { textContent: 'Prediction:' }), predictionButton]),
      el('label', { textContent: 'Notes:' }),
      noteInput,
    ])

    openModal(content, 'seat-modal-overlay')
  }

  function refreshCircle(): void {
    const seats = [...state.latestRoster].sort((a, b) => a.seat - b.seat)
    const tokens = seats.map((seat) =>
      el(
        'button',
        {
          className: `seat-token${!seat.alive ? ' dead' : ''}${seat.peerId === null ? ' disconnected' : ''}`,
          onclick: () => openSeatModal(seat),
        },
        [
          el('div', { className: 'seat-token-image placeholder', textContent: seat.name.slice(0, 1).toUpperCase() }),
          el('span', { className: 'seat-token-name', textContent: seat.name }),
          ...(predictions.has(seat.seat)
            ? [el('span', { className: 'seat-token-character', textContent: getCharacter(predictions.get(seat.seat)!)?.name ?? '' })]
            : []),
          ...(!seat.alive ? [el('span', { className: 'shroud-icon', textContent: '🪦' })] : []),
        ],
      ),
    )
    circle.replaceChildren(...tokens)
    layoutInCircle(circle)
  }

  container.replaceChildren(
    el('div', { className: 'town-square-panel' }, [el('h2', { textContent: 'Town Square' }), summary, circle]),
  )

  refreshSummary()
  refreshCircle()

  // Live-update while this panel stays mounted, not just at mount time — a
  // Player looking at Town Square when the roster changes (someone else joins,
  // a character gets assigned, etc.) should see it update in place.
  handle.onRosterChange((players, _storytellerId, scriptId) => {
    state.latestRoster = players
    state.scriptId = scriptId
    refreshSummary()
    refreshCircle()
  })
}
