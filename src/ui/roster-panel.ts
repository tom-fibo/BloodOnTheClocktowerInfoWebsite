import type { PlayerInfo } from '../types'
import { el } from './dom'

export interface RosterPanelOptions {
  selectable?: boolean
  selectedPeerId?: string | null
  onSelect?: (peerId: string) => void
}

export function renderRosterPanel(container: HTMLElement, players: PlayerInfo[], options: RosterPanelOptions = {}): void {
  const items =
    players.length === 0
      ? [el('li', { className: 'roster-empty', textContent: 'No players yet' })]
      : players.map((player) => {
          const selected = options.selectedPeerId === player.peerId
          const item = el('li', {
            className: ['roster-item', options.selectable ? 'selectable' : '', selected ? 'selected' : '']
              .filter(Boolean)
              .join(' '),
            textContent: player.name,
          })
          if (options.selectable) {
            item.addEventListener('click', () => options.onSelect?.(player.peerId))
          }
          return item
        })

  container.replaceChildren(el('ul', { className: 'roster-list' }, items))
}
