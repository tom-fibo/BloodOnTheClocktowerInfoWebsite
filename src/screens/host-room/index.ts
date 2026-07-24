import { el } from '../../ui/dom'
import { getState, setState } from '../../state/store'
import { createHostRoom } from '../../trystero/room'
import { renderTabs } from '../../ui/tabs'
import { renderQrCode } from '../../ui/qr-code'
import { saveLastSession, clearLastSession } from '../../utils/session'
import { watchForStaleConnection } from '../../utils/connection-watchdog'
import { renderGrimoirePanel } from './grimoire-panel'
import { renderScriptPanel } from './script-panel'

export function renderHostRoom(container: HTMLElement): void {
  const { roomCode } = getState()
  const handle = createHostRoom(roomCode)
  saveLastSession({ screen: 'host-room', roomCode, selfName: '' })

  const joinUrl = `${location.origin}${location.pathname}?join=${roomCode}`
  const qrToggle = el('button', { className: 'secondary qr-toggle-button', textContent: 'QR' })
  const qrContainer = el('div', { className: 'qr-container hidden' }, [renderQrCode(joinUrl)])
  qrToggle.addEventListener('click', () => {
    qrContainer.classList.toggle('hidden')
  })

  container.replaceChildren(
    el('div', { className: 'screen host-room-screen' }, [
      el('div', { className: 'room-header' }, [
        el('div', { className: 'room-header-title' }, [
          el('h1', { textContent: 'Storyteller' }),
          el('span', { className: 'room-code-display', textContent: `Room code: ${roomCode}` }),
        ]),
        el('div', { className: 'room-header-actions' }, [
          qrToggle,
          el('button', {
            className: 'leave-button',
            textContent: 'Leave Room',
            onclick: () => {
              handle.leave()
              clearLastSession()
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
    { id: 'script', label: 'Script', render: (c) => renderScriptPanel(c, handle) },
  ])

  watchForStaleConnection(() => location.reload())
}
