import { el } from '../../ui/dom'
import type { HostRoomHandle } from '../../trystero/room'
import { renderRosterPanel } from '../../ui/roster-panel'
import { appendMessage, type LogMessage } from '../../ui/message-log'

export function renderMessagesPanel(container: HTMLElement, handle: HostRoomHandle, log: LogMessage[]): void {
  let selectedPeerId: string | null = null

  const rosterContainer = el('div', { className: 'roster-panel' })
  const selectedLabel = el('p', { className: 'selected-label', textContent: 'Select a player to message' })
  const logContainer = el('div', { className: 'message-log' })
  const composeInput = el('textarea', { className: 'compose-input', placeholder: 'Secret message…', rows: 2 })
  const sendButton = el('button', { className: 'primary', textContent: 'Send Secretly' })

  function refreshRoster(): void {
    const seats = handle.getSeats()
    renderRosterPanel(rosterContainer, seats, {
      selectable: true,
      selectedPeerId,
      onSelect(peerId) {
        selectedPeerId = peerId
        const seat = seats.find((p) => p.peerId === peerId)
        selectedLabel.textContent = seat ? `Messaging: ${seat.name}` : 'Select a player to message'
        refreshRoster()
      },
    })
  }

  function replayLog(): void {
    logContainer.replaceChildren()
    for (const entry of log) appendMessage(logContainer, entry)
  }

  handle.onRosterChange((seats) => {
    if (selectedPeerId && !seats.some((p) => p.peerId === selectedPeerId)) {
      selectedPeerId = null
      selectedLabel.textContent = 'Select a player to message'
    }
    refreshRoster()
  })

  // The shared log array is appended to by the top-level subscription in
  // index.ts (so messages aren't lost while this tab isn't active) — re-render
  // fully here to pick up anything that arrived while unmounted.
  handle.onPlayerMessage(replayLog)

  function send(): void {
    const text = composeInput.value.trim()
    if (!text || !selectedPeerId) return
    const seat = handle.getSeats().find((p) => p.peerId === selectedPeerId)
    handle.sendToPlayer(selectedPeerId, text)
    const entry: LogMessage = { label: `You → ${seat?.name ?? 'player'}`, text, ts: Date.now(), self: true }
    log.push(entry)
    appendMessage(logContainer, entry)
    composeInput.value = ''
  }

  sendButton.addEventListener('click', send)
  composeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  })

  container.replaceChildren(
    el('div', { className: 'room-body' }, [
      el('div', { className: 'roster-column' }, [el('h2', { textContent: 'Players' }), rosterContainer]),
      el('div', { className: 'messaging-column' }, [selectedLabel, logContainer, composeInput, sendButton]),
    ]),
  )

  refreshRoster()
  replayLog()
}
