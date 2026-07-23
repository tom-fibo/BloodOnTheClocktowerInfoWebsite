import { el } from '../ui/dom'
import { setState } from '../state/store'
import { generateRoomCode, normalizeRoomCode } from '../utils/room-code'

export function renderHostSetup(container: HTMLElement): void {
  const codeInput = el('input', {
    className: 'room-code-input',
    value: generateRoomCode(),
    maxLength: 8,
  })

  function createRoom(): void {
    const code = normalizeRoomCode(codeInput.value)
    if (!code) return
    setState({ screen: 'host-room', roomCode: code })
  }

  codeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') createRoom()
  })

  container.replaceChildren(
    el('div', { className: 'screen host-setup-screen' }, [
      el('h1', { textContent: 'Host a Game' }),
      el('label', { textContent: 'Room code (share this with your players):' }),
      codeInput,
      el('div', { className: 'button-row' }, [
        el('button', { className: 'primary', textContent: 'Create Room', onclick: createRoom }),
        el('button', {
          className: 'secondary',
          textContent: 'Back',
          onclick: () => setState({ screen: 'landing' }),
        }),
      ]),
    ]),
  )
}
