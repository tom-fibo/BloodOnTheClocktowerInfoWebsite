import { el } from '../../ui/dom'
import { getState, setState } from '../../state/store'
import { createHostRoom } from '../../trystero/room'
import { renderTabs } from '../../ui/tabs'
import { renderQrCode } from '../../ui/qr-code'
import type { LogMessage } from '../../ui/message-log'
import { renderGrimoirePanel } from './grimoire-panel'
import { renderSeatsPanel } from './seats-panel'
import { renderScriptPanel } from './script-panel'
import { renderMessagesPanel } from './messages-panel'

export function renderHostRoom(container: HTMLElement): void {
  const { roomCode } = getState()
  const handle = createHostRoom(roomCode)

  // Shared across tab activations so switching tabs never loses history —
  // see the comment on the listener Sets in trystero/room.ts for why a plain
  // single-callback model isn't enough here.
  const messageLog: LogMessage[] = []
  handle.onPlayerMessage((msg) => {
    messageLog.push({ label: msg.name, text: msg.text, ts: msg.ts })
  })

  const joinUrl = `${location.origin}${location.pathname}?join=${roomCode}`
  const qrToggle = el('button', { className: 'secondary qr-toggle-button', textContent: 'Show join QR code' })
  const qrContainer = el('div', { className: 'qr-container hidden' }, [renderQrCode(joinUrl)])
  qrToggle.addEventListener('click', () => {
    qrContainer.classList.toggle('hidden')
    qrToggle.textContent = qrContainer.classList.contains('hidden') ? 'Show join QR code' : 'Hide join QR code'
  })

  container.replaceChildren(
    el('div', { className: 'screen host-room-screen' }, [
      el('div', { className: 'room-header' }, [
        el('div', {}, [
          el('h1', { textContent: 'Storyteller' }),
          el('p', { className: 'room-code-display', textContent: `Room code: ${roomCode}` }),
        ]),
        el('div', { className: 'room-header-actions' }, [
          qrToggle,
          el('button', {
            className: 'leave-button',
            textContent: 'Leave Room',
            onclick: () => {
              handle.leave()
              setState({ screen: 'landing' })
            },
          }),
        ]),
      ]),
      qrContainer,
      el('div', { className: 'tabs-shell' }),
    ]),
  )

  const tabsShell = container.querySelector<HTMLDivElement>('.tabs-shell')!
  renderTabs(tabsShell, [
    { id: 'grimoire', label: 'Grimoire', render: (c) => renderGrimoirePanel(c, handle) },
    { id: 'seats', label: 'Seats', render: (c) => renderSeatsPanel(c, handle) },
    { id: 'script', label: 'Script', render: (c) => renderScriptPanel(c, handle) },
    { id: 'messages', label: 'Messages', render: (c) => renderMessagesPanel(c, handle, messageLog) },
  ])
}
