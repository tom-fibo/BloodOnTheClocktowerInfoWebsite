import { el } from './dom'

// Always wraps the image in a container div, never a bare <img> — a death
// shroud overlay (.seat-token.dead/.dying .seat-token-image::after, see
// style.css) needs a real element to render on, and generated content
// (::before/::after) doesn't apply to replaced elements like <img> in any
// browser. `noVoteToken` adds a small purple circle overlay (::before),
// concentric with the token, for a seat that currently has no vote token —
// independent of alive/dead/dying, since a dead seat commonly has already
// spent its one ghost vote.
export function renderTokenImage(tokenUrl: string | undefined, name: string, noVoteToken = false): HTMLElement {
  return el('div', { className: `seat-token-image${noVoteToken ? ' no-vote' : ''}` }, [
    tokenUrl ? el('img', { src: tokenUrl, alt: name }) : el('span', { textContent: name.slice(0, 1).toUpperCase() }),
  ])
}
