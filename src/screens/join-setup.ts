import { el } from '../ui/dom'
import { setState } from '../state/store'
import { normalizeRoomCode } from '../utils/room-code'

export function renderJoinSetup(container: HTMLElement): void {
  const nameInput = el('input', { className: 'name-input', placeholder: 'Your display name', maxLength: 20 })
  const codeInput = el('input', { className: 'room-code-input', placeholder: 'Room code' })

  function join(): void {
    const name = nameInput.value.trim()
    const code = normalizeRoomCode(codeInput.value)
    if (!name || !code) return
    setState({ screen: 'join-room', roomCode: code, selfName: name })
  }

  for (const input of [nameInput, codeInput]) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') join()
    })
  }

  container.replaceChildren(
    el('div', { className: 'screen join-setup-screen' }, [
      el('h1', { textContent: 'Join a Game' }),
      el('label', { textContent: 'Your name:' }),
      nameInput,
      el('label', { textContent: 'Room code:' }),
      codeInput,
      el('div', { className: 'button-row' }, [
        el('button', { className: 'primary', textContent: 'Join Room', onclick: join }),
        el('button', {
          className: 'secondary',
          textContent: 'Back',
          onclick: () => setState({ screen: 'landing' }),
        }),
      ]),
    ]),
  )
}
