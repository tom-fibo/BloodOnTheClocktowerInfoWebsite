import { el } from '../../ui/dom'
import { getState } from '../../state/store'
import type { PlayerRoomHandle } from '../../trystero/room'
import { getScript } from '../../data/scripts'
import { suggestDistribution } from '../../game/setup'
import { openCharacterPicker } from '../../ui/character-picker'
import { openModal, updateModalContent, closeModal } from '../../ui/modal'
import { getCharacter } from '../../data/characters'
import { layoutInCircle } from '../../ui/circular-layout'
import { renderTokenImage } from '../../ui/token-image'
import { loadTownSquareLocal, saveTownSquareLocal } from '../../utils/player-local-state'
import type { PlayerInfo } from '../../types'

export interface TownSquareState {
  latestRoster: PlayerInfo[]
  scriptId: string
}

// Predictions and notes are a Player's own private scratchpad about other
// players — never sent anywhere, but persisted to this browser's localStorage
// (keyed by room code) so they survive the Player's own reload. Loaded once
// at module init: by the time town-square-panel.ts is actually used, the room
// code is already set in the store (main.ts/join-setup.ts set it before
// renderJoinRoom runs).
const roomCodeForLocalState = getState().roomCode
const storedTownSquare = loadTownSquareLocal(roomCodeForLocalState)
const predictions = new Map<number, string>(Object.entries(storedTownSquare.predictions).map(([k, v]) => [Number(k), v]))
const notes = new Map<number, string>(Object.entries(storedTownSquare.notes).map(([k, v]) => [Number(k), v]))

function persistTownSquareLocal(): void {
  saveTownSquareLocal(roomCodeForLocalState, {
    predictions: Object.fromEntries(predictions),
    notes: Object.fromEntries(notes),
  })
}

// Shows the Player's own prediction (icon + name), same visual pattern as the
// Grimoire showing a seat's actual assigned character — "they should see all
// players as their prediction," not just a name in the popup.
function seatTokenChildren(seat: PlayerInfo): (Node | string)[] {
  const predictedId = predictions.get(seat.seat)
  const predicted = predictedId ? getCharacter(predictedId) : undefined
  return [
    renderTokenImage(predicted?.tokenUrl, predicted ? predicted.name : seat.name),
    el('span', { className: 'seat-token-name', textContent: seat.name }),
    ...(predicted ? [el('span', { className: 'seat-token-character', textContent: predicted.name })] : []),
  ]
}

// Used by night-actions-panel.ts's composer: "Pressing the Player button shows
// the Town Square view... so they can select one with context" — reuses the
// same circle rendering (including predictions) rather than a plain list.
// Only needs the roster, not the full TownSquareState, since predictions are
// looked up from the module-level map above (no scriptId involved).
export function openPlayerPicker(state: { latestRoster: PlayerInfo[] }, onSelect: (seat: PlayerInfo) => void): void {
  const seats = [...state.latestRoster].sort((a, b) => a.seat - b.seat)
  const circle = el('div', { className: 'seat-circle town-square-circle' })
  circle.replaceChildren(
    ...seats.map((seat) =>
      el(
        'button',
        {
          className: `seat-token${!seat.alive ? ' dead' : ''}`,
          onclick: () => {
            closeModal()
            onSelect(seat)
          },
        },
        seatTokenChildren(seat),
      ),
    ),
  )

  const content = el('div', { className: 'character-picker-card player-picker-card' }, [
    el('div', { className: 'character-picker-header' }, [
      el('h2', { textContent: 'Choose a player' }),
      el('button', { className: 'character-popup-close', textContent: '✕', onclick: () => closeModal() }),
    ]),
    circle,
  ])
  openModal(content, 'player-picker-overlay')
  layoutInCircle(circle)
}

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
            persistTownSquareLocal()
            // Refresh both the popup (new prediction shown there) and the
            // main circle behind it — previously only the popup refreshed,
            // so the circle's token stayed stale until the Player switched
            // tabs away and back.
            openSeatModal(seat)
            refreshCircle()
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
    noteInput.addEventListener('input', () => {
      notes.set(seat.seat, noteInput.value)
      persistTownSquareLocal()
    })

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

    if (!updateModalContent(content)) {
      openModal(content, 'seat-modal-overlay')
    }
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
        seatTokenChildren(seat),
      ),
    )
    circle.replaceChildren(...tokens)
    layoutInCircle(circle)
  }

  // Summary at the bottom, not between the header and the circle — the circle
  // is the primary content and shouldn't be pushed down by it.
  container.replaceChildren(
    el('div', { className: 'town-square-panel' }, [el('h2', { textContent: 'Town Square' }), circle, summary]),
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
