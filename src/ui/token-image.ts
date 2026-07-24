import { el } from './dom'

// Always wraps the image in a container div, never a bare <img> — a death
// shroud overlay (.seat-token.dead .seat-token-image::after, see style.css)
// needs a real element to render on, and generated content (::before/::after)
// doesn't apply to replaced elements like <img> in any browser.
export function renderTokenImage(tokenUrl: string | undefined, name: string): HTMLElement {
  return el('div', { className: 'seat-token-image' }, [
    tokenUrl ? el('img', { src: tokenUrl, alt: name }) : el('span', { textContent: name.slice(0, 1).toUpperCase() }),
  ])
}
