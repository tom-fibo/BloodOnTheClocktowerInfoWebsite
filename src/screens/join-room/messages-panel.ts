import { el } from '../../ui/dom'
import type { PlayerRoomHandle } from '../../trystero/room'
import { appendMessage, type LogMessage } from '../../ui/message-log'

export function renderMessagesPanel(container: HTMLElement, handle: PlayerRoomHandle, log: LogMessage[]): void {
  const logContainer = el('div', { className: 'message-log' })
  const composeInput = el('textarea', {
    className: 'compose-input',
    placeholder: 'Secret message to the Storyteller…',
    rows: 2,
  })
  const sendButton = el('button', { className: 'primary', textContent: 'Send Secretly' })

  for (const entry of log) appendMessage(logContainer, entry)

  handle.onStorytellerMessage(() => {
    // The shared log array is appended to by the top-level subscription in
    // index.ts; re-render fully so we pick up whatever arrived, including
    // while this panel wasn't mounted.
    logContainer.replaceChildren()
    for (const entry of log) appendMessage(logContainer, entry)
  })

  function send(): void {
    const text = composeInput.value.trim()
    if (!text) return
    handle.sendToStoryteller(text)
    const entry: LogMessage = { label: 'You', text, ts: Date.now(), self: true }
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

  container.replaceChildren(el('div', { className: 'messaging-column' }, [logContainer, composeInput, sendButton]))
}
