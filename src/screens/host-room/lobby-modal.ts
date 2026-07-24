import { el } from '../../ui/dom'
import { openModal, updateModalContent, closeModal } from '../../ui/modal'
import type { HostRoomHandle } from '../../trystero/room'

// A quick overview of every connected device — seated or still waiting to be
// placed — since the Player side no longer shows a roster list (Town Square
// already serves that purpose for them; this is the Storyteller's equivalent).
export function openLobbyModal(handle: HostRoomHandle): void {
  function build(): HTMLElement {
    const seats = [...handle.getSeats()].sort((a, b) => a.seat - b.seat)
    const unseated = handle.getUnseatedPeers()

    return el('div', { className: 'character-picker-card lobby-modal-card' }, [
      el('div', { className: 'character-picker-header' }, [
        el('h2', { textContent: 'Lobby' }),
        el('button', { className: 'character-popup-close', textContent: '✕', onclick: () => closeModal() }),
      ]),
      el('h3', { textContent: 'Seated' }),
      el(
        'ul',
        { className: 'lobby-list' },
        seats.length
          ? seats.map((seat) =>
              el('li', { className: seat.peerId === null ? 'disconnected' : '' }, [
                el('span', { textContent: seat.name }),
                el('span', { className: 'text-muted', textContent: seat.peerId === null ? 'disconnected' : 'connected' }),
              ]),
            )
          : [el('li', { className: 'roster-empty', textContent: 'No seats yet.' })],
      ),
      el('h3', { textContent: 'Connected, not yet seated' }),
      el(
        'ul',
        { className: 'lobby-list' },
        unseated.length
          ? unseated.map((peer) => el('li', {}, [el('span', { textContent: peer.name })]))
          : [el('li', { className: 'roster-empty', textContent: 'Nobody waiting.' })],
      ),
    ])
  }

  const content = build()
  openModal(content, 'lobby-modal-overlay')

  // Live-refresh in place (preserves scroll) while this modal stays open.
  handle.onRosterChange(() => updateModalContent(build()))
  handle.onUnseatedChange(() => updateModalContent(build()))
}
