import { el } from './dom'

export interface LogMessage {
  label: string
  text: string
  ts: number
  self?: boolean
}

export function appendMessage(container: HTMLElement, message: LogMessage): void {
  const time = new Date(message.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const entry = el('div', { className: `message${message.self ? ' self' : ''}` }, [
    el('div', { className: 'message-meta' }, [
      el('span', { className: 'message-label', textContent: message.label }),
      el('span', { className: 'message-time', textContent: time }),
    ]),
    el('p', { className: 'message-text', textContent: message.text }),
  ])
  container.append(entry)
  container.scrollTop = container.scrollHeight
}
