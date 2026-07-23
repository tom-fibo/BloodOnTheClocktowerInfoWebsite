import { el } from '../ui/dom'
import { setState } from '../state/store'

export function renderLanding(container: HTMLElement): void {
  container.replaceChildren(
    el('div', { className: 'screen landing-screen' }, [
      el('h1', { textContent: 'Blood on the Clocktower' }),
      el('p', { className: 'subtitle', textContent: 'Night communication companion' }),
      el('div', { className: 'button-row' }, [
        el('button', {
          className: 'primary',
          textContent: 'Host a Game',
          onclick: () => setState({ screen: 'host-setup' }),
        }),
        el('button', {
          className: 'secondary',
          textContent: 'Join a Game',
          onclick: () => setState({ screen: 'join-setup' }),
        }),
      ]),
    ]),
  )
}
