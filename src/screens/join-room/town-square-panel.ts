import { el } from '../../ui/dom'
import { getScript } from '../../data/scripts'
import { suggestDistribution } from '../../game/setup'
import { characterOptionsFor } from '../../ui/character-select'
import { attachCharacterTrigger } from '../../ui/character-popup'
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
  const list = el('div', { className: 'town-square-list' })

  function refreshSummary(): void {
    const dist = suggestDistribution(state.latestRoster.length)
    summary.textContent = `Default for ${state.latestRoster.length} players: ${dist.townsfolk} Townsfolk, ${dist.outsider} Outsider, ${dist.minion} Minion, ${dist.demon} Demon.`
  }

  function refreshList(): void {
    const script = getScript(state.scriptId)
    const seats = [...state.latestRoster].sort((a, b) => a.seat - b.seat)

    list.replaceChildren(
      ...(seats.length
        ? seats.map((seat) => {
            const predictionSelect = script ? characterOptionsFor(script, predictions.get(seat.seat)) : el('select', {})
            predictionSelect.addEventListener('change', () => predictions.set(seat.seat, predictionSelect.value))
            if (predictions.get(seat.seat)) attachCharacterTrigger(predictionSelect, predictions.get(seat.seat)!)

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
              el('label', { className: 'town-square-prediction-label', textContent: 'Prediction:' }),
              predictionSelect,
              noteInput,
            ])
          })
        : [el('p', { className: 'roster-empty', textContent: 'No players yet.' })]),
    )
  }

  container.replaceChildren(
    el('div', { className: 'town-square-panel' }, [el('h2', { textContent: 'Town Square' }), summary, list]),
  )

  refreshSummary()
  refreshList()
}
