import { el } from '../../ui/dom'
import { getState, setState } from '../../state/store'
import { createHostRoom } from '../../trystero/room'
import type { HostRoomHandle } from '../../trystero/room'
import { renderTabs } from '../../ui/tabs'
import { renderQrCode } from '../../ui/qr-code'
import { saveLastSession, clearLastSession } from '../../utils/session'
import { watchForStaleConnection } from '../../utils/connection-watchdog'
import { isModalOpen } from '../../ui/modal'
import { renderGrimoirePanel } from './grimoire-panel'
import { renderScriptPanel } from './script-panel'

export function renderHostRoom(container: HTMLElement): void {
  const { roomCode } = getState()

  // createHostRoom() now awaits a TURN-credential fetch (bounded to ~5s, see
  // turn-config.ts) before it can call joinRoom() — this placeholder covers that
  // gap. saveLastSession() still runs immediately: even a reload mid-connect
  // should retry joining this room, not lose the destination.
  container.replaceChildren(
    el('div', { className: 'screen host-room-screen' }, [
      el('div', { className: 'room-header' }, [
        el('div', { className: 'room-header-title' }, [el('h1', { textContent: 'Storyteller' })]),
        el('button', {
          className: 'leave-button',
          textContent: 'Cancel',
          onclick: () => {
            clearLastSession()
            setState({ screen: 'landing' })
          },
        }),
      ]),
      el('p', { textContent: 'Connecting…' }),
    ]),
  )
  saveLastSession({ screen: 'host-room', roomCode, selfName: '' })

  createHostRoom(roomCode)
    .then((handle) => {
      // The user may have navigated away (e.g. clicked Cancel above) while the
      // TURN fetch was in flight — this container no longer belongs to us, so
      // tear the now-unwanted room down instead of clobbering whatever screen
      // is actually showing.
      if (getState().screen !== 'host-room' || getState().roomCode !== roomCode) {
        handle.leave()
        return
      }
      buildHostRoomUi(container, handle, roomCode)
    })
    .catch((err) => {
      console.error('[trystero] Failed to create host room', err)
      if (getState().screen !== 'host-room' || getState().roomCode !== roomCode) return
      container.replaceChildren(
        el('div', { className: 'screen host-room-screen' }, [
          el('p', { textContent: 'Failed to connect. Please try again.' }),
          el('button', {
            className: 'secondary',
            textContent: 'Back',
            onclick: () => setState({ screen: 'landing' }),
          }),
        ]),
      )
    })
}

function buildHostRoomUi(container: HTMLElement, handle: HostRoomHandle, roomCode: string): void {
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

  watchForStaleConnection(() => {
    if (isModalOpen()) return
    location.reload()
  })
}
