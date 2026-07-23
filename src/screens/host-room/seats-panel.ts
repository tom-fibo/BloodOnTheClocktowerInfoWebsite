import { el } from '../../ui/dom'
import type { HostRoomHandle } from '../../trystero/room'

export function renderSeatsPanel(container: HTMLElement, handle: HostRoomHandle): void {
  const list = el('ol', { className: 'seats-list' })

  function refresh(): void {
    const seats = [...handle.getSeats()].sort((a, b) => a.seat - b.seat)
    list.replaceChildren(
      ...seats.map((seat, index) => {
        const nameInput = el('input', { className: 'seat-name-input', value: seat.name })
        nameInput.addEventListener('change', () => handle.renameSeat(seat.seat, nameInput.value.trim() || seat.name))

        return el('li', { className: `seats-row${seat.peerId === null ? ' disconnected' : ''}` }, [
          nameInput,
          el('span', {
            className: 'seats-status',
            textContent: seat.peerId === null ? 'No device connected' : 'Connected',
          }),
          el('div', { className: 'seats-row-actions' }, [
            el('button', {
              textContent: '↑',
              disabled: index === 0,
              onclick: () => {
                handle.swapSeats(seat.seat, seats[index - 1].seat)
                refresh()
              },
            }),
            el('button', {
              textContent: '↓',
              disabled: index === seats.length - 1,
              onclick: () => {
                handle.swapSeats(seat.seat, seats[index + 1].seat)
                refresh()
              },
            }),
            el('button', {
              className: 'danger',
              textContent: 'Remove',
              onclick: () => {
                handle.removeSeat(seat.seat)
                refresh()
              },
            }),
          ]),
        ])
      }),
    )
  }

  container.replaceChildren(
    el('div', { className: 'seats-panel' }, [
      el('h2', { textContent: 'Seats' }),
      el('p', { className: 'text-muted', textContent: 'Set how many seats are in the game, rename them, and reorder who sits where. A seat stays active if its player disconnects.' }),
      list,
      el('button', { className: 'primary', textContent: '+ Add seat', onclick: () => { handle.addSeat(); refresh() } }),
    ]),
  )

  handle.onRosterChange(refresh)
  refresh()
}
