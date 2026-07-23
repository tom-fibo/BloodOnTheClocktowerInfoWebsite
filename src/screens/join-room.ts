import { el } from '../ui/dom'
import { getState, setState } from '../state/store'
import { joinPlayerRoom } from '../trystero/room'
import { renderRosterPanel } from '../ui/roster-panel'
import { appendMessage } from '../ui/message-log'

export function renderJoinRoom(container: HTMLElement): void {
  const { roomCode, selfName } = getState()

  const rosterContainer = el('div', { className: 'roster-panel' })
  const logContainer = el('div', { className: 'message-log' })
  const composeInput = el('textarea', {
    className: 'compose-input',
    placeholder: 'Secret message to the Storyteller…',
    rows: 2,
  })
  const sendButton = el('button', { className: 'primary', textContent: 'Send Secretly' })
  const nameInput = el('input', { className: 'name-input', value: selfName, maxLength: 20 })
  const banner = el('p', {
    className: 'disconnect-banner hidden',
    textContent: 'Storyteller disconnected — waiting to reconnect…',
  })

  const handle = joinPlayerRoom(roomCode, selfName)

  handle.onRosterChange((players) => {
    renderRosterPanel(rosterContainer, players, { selectable: false })
    banner.classList.add('hidden')
  })

  handle.onStorytellerMessage((msg) => {
    appendMessage(logContainer, { label: 'Storyteller', text: msg.text, ts: msg.ts })
  })

  handle.onStorytellerLeave(() => {
    banner.classList.remove('hidden')
  })

  nameInput.addEventListener('change', () => {
    const name = nameInput.value.trim()
    if (name) handle.updateName(name)
  })

  function send(): void {
    const text = composeInput.value.trim()
    if (!text) return
    handle.sendToStoryteller(text)
    appendMessage(logContainer, { label: 'You', text, ts: Date.now(), self: true })
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
    el('div', { className: 'screen join-room-screen' }, [
      el('div', { className: 'room-header' }, [
        el('div', {}, [el('h1', { textContent: 'Player' }), el('label', { textContent: 'Display name:' }), nameInput]),
        el('button', {
          className: 'leave-button',
          textContent: 'Leave Room',
          onclick: () => {
            handle.leave()
            setState({ screen: 'landing' })
          },
        }),
      ]),
      banner,
      el('div', { className: 'room-body' }, [
        el('div', { className: 'roster-column' }, [el('h2', { textContent: 'Players in this room' }), rosterContainer]),
        el('div', { className: 'messaging-column' }, [logContainer, composeInput, sendButton]),
      ]),
    ]),
  )
}
