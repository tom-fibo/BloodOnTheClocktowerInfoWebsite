import { el } from '../ui/dom'
import { getState, setState } from '../state/store'
import { createHostRoom } from '../trystero/room'
import { renderRosterPanel } from '../ui/roster-panel'
import { appendMessage } from '../ui/message-log'
import type { PlayerInfo } from '../types'

export function renderHostRoom(container: HTMLElement): void {
  const { roomCode } = getState()

  let roster: PlayerInfo[] = []
  let selectedPeerId: string | null = null

  const rosterContainer = el('div', { className: 'roster-panel' })
  const selectedLabel = el('p', { className: 'selected-label', textContent: 'Select a player to message' })
  const logContainer = el('div', { className: 'message-log' })
  const composeInput = el('textarea', { className: 'compose-input', placeholder: 'Secret message…', rows: 2 })
  const sendButton = el('button', { className: 'primary', textContent: 'Send Secretly' })

  const handle = createHostRoom(roomCode)

  function refreshRoster(): void {
    renderRosterPanel(rosterContainer, roster, {
      selectable: true,
      selectedPeerId,
      onSelect(peerId) {
        selectedPeerId = peerId
        const player = roster.find((p) => p.peerId === peerId)
        selectedLabel.textContent = player ? `Messaging: ${player.name}` : 'Select a player to message'
        refreshRoster()
      },
    })
  }

  handle.onRosterChange((updated) => {
    roster = updated
    if (selectedPeerId && !roster.some((p) => p.peerId === selectedPeerId)) {
      selectedPeerId = null
      selectedLabel.textContent = 'Select a player to message'
    }
    refreshRoster()
  })

  handle.onPlayerMessage((msg) => {
    appendMessage(logContainer, { label: msg.name, text: msg.text, ts: msg.ts })
  })

  function send(): void {
    const text = composeInput.value.trim()
    if (!text || !selectedPeerId) return
    const player = roster.find((p) => p.peerId === selectedPeerId)
    handle.sendToPlayer(selectedPeerId, text)
    appendMessage(logContainer, { label: `You → ${player?.name ?? 'player'}`, text, ts: Date.now(), self: true })
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
    el('div', { className: 'screen host-room-screen' }, [
      el('div', { className: 'room-header' }, [
        el('div', {}, [el('h1', { textContent: 'Storyteller' }), el('p', { className: 'room-code-display', textContent: `Room code: ${roomCode}` })]),
        el('button', {
          className: 'leave-button',
          textContent: 'Leave Room',
          onclick: () => {
            handle.leave()
            setState({ screen: 'landing' })
          },
        }),
      ]),
      el('div', { className: 'room-body' }, [
        el('div', { className: 'roster-column' }, [el('h2', { textContent: 'Players' }), rosterContainer]),
        el('div', { className: 'messaging-column' }, [selectedLabel, logContainer, composeInput, sendButton]),
      ]),
    ]),
  )

  refreshRoster()
}
