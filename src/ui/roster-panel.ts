import type { PlayerInfo } from '../types'
import { el } from './dom'

export interface RosterPanelOptions {
  selectable?: boolean
  selectedPeerId?: string | null
  onSelect?: (peerId: string) => void
  showStatus?: boolean
}

export function renderRosterPanel(container: HTMLElement, players: PlayerInfo[], options: RosterPanelOptions = {}): void {
  const sorted = [...players].sort((a, b) => a.seat - b.seat)

  const items =
    sorted.length === 0
      ? [el('li', { className: 'roster-empty', textContent: 'No players yet' })]
      : sorted.map((player) => {
          const selected = options.selectedPeerId !== undefined && options.selectedPeerId === player.peerId
          const canSelect = options.selectable && player.peerId !== null
          const item = el('li', {
            className: [
              'roster-item',
              canSelect ? 'selectable' : '',
              selected ? 'selected' : '',
              player.peerId === null ? 'disconnected' : '',
              options.showStatus && !player.alive ? 'dead' : '',
            ]
              .filter(Boolean)
              .join(' '),
          })

          const nameParts: (Node | string)[] = [
            el('span', { className: 'roster-item-name', textContent: player.name }),
          ]
          if (options.showStatus && !player.alive) {
            nameParts.push(el('span', { className: 'shroud-icon', title: 'Dead', textContent: '🪦' }))
          }
          if (options.showStatus && player.voteToken) {
            nameParts.push(el('span', { className: 'vote-token-icon', title: 'Has vote token', textContent: '🗳️' }))
          }
          if (player.peerId === null) {
            nameParts.push(el('span', { className: 'disconnected-label', textContent: '(disconnected)' }))
          }
          item.append(...nameParts)

          if (canSelect) {
            item.addEventListener('click', () => options.onSelect?.(player.peerId as string))
          }
          return item
        })

  container.replaceChildren(el('ul', { className: 'roster-list' }, items))
}
