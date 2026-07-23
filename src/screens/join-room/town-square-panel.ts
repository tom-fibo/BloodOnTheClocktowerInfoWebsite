import { el } from '../../ui/dom'
import { getScript } from '../../data/scripts'
import { suggestDistribution } from '../../game/setup'
import { openCharacterPicker } from '../../ui/character-picker'
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

export function renderTownSquarePanel(container: HTMLElement, state: TownSquareState): void {
  const summary = el('p', { className: 'town-square-summary' })
  const circle = el('div', { className: 'seat-circle town-square-circle' })
  const list = el('div', { className: 'town-square-list' })

  function refreshSummary(): void {
    const dist = suggestDistribution(state.latestRoster.length)
    summary.textContent = `Default for ${state.latestRoster.length} players: ${dist.townsfolk} Townsfolk, ${dist.outsider} Outsider, ${dist.minion} Minion, ${dist.demon} Demon.`
  }

  function refreshCircle(): void {
    const seats = [...state.latestRoster].sort((a, b) => a.seat - b.seat)
    const tokens = seats.map((seat) =>
      el('div', { className: `seat-token${!seat.alive ? ' dead' : ''}${seat.peerId === null ? ' disconnected' : ''}` }, [
        el('div', { className: 'seat-token-image placeholder', textContent: seat.name.slice(0, 1).toUpperCase() }),
        el('span', { className: 'seat-token-name', textContent: seat.name }),
        ...(!seat.alive ? [el('span', { className: 'shroud-icon', textContent: '🪦' })] : []),
      ]),
    )
    circle.replaceChildren(...tokens)
    layoutInCircle(circle)
  }

  function refreshList(): void {
    const script = getScript(state.scriptId)
    const seats = [...state.latestRoster].sort((a, b) => a.seat - b.seat)

    list.replaceChildren(
      ...(seats.length
        ? seats.map((seat) => {
            const predictionButton = el('button', {
              className: 'secondary prediction-button',
              textContent: predictions.has(seat.seat)
                ? getCharacter(predictions.get(seat.seat)!)?.name ?? 'Prediction'
                : 'Set prediction',
              onclick: () => {
                if (!script) return
                openCharacterPicker(script, {
                  title: `Prediction for ${seat.name}`,
                  allowNone: true,
                  onSelect: (characterId) => {
                    if (characterId) predictions.set(seat.seat, characterId)
                    else predictions.delete(seat.seat)
                    refreshList()
                  },
                })
              },
            })

            const noteInput = el('input', {
              className: 'town-square-note-input',
              placeholder: 'Notes…',
              value: notes.get(seat.seat) ?? '',
            })
            noteInput.addEventListener('input', () => notes.set(seat.seat, noteInput.value))

            return el('div', { className: `town-square-row${!seat.alive ? ' dead' : ''}` }, [
              el('span', { className: 'town-square-name', textContent: seat.name }),
              ...(!seat.alive ? [el('span', { className: 'shroud-icon', textContent: '🪦' })] : []),
              ...(seat.voteToken ? [el('span', { className: 'vote-token-icon', textContent: '🗳️' })] : []),
              predictionButton,
              noteInput,
            ])
          })
        : [el('p', { className: 'roster-empty', textContent: 'No players yet.' })]),
    )
  }

  container.replaceChildren(
    el('div', { className: 'town-square-panel' }, [
      el('h2', { textContent: 'Town Square' }),
      summary,
      circle,
      list,
    ]),
  )

  refreshSummary()
  refreshCircle()
  refreshList()
}
