import { el } from './dom'
import { getCharacter } from '../data/characters'

let overlay: HTMLElement | null = null

function closePopup(): void {
  overlay?.remove()
  overlay = null
}

export function openCharacterPopup(characterId: string): void {
  const character = getCharacter(characterId)
  if (!character) return
  closePopup()

  const typeLabel = `${character.alignment === 'good' ? 'Good' : 'Evil'} · ${character.type}`

  const nightLines: HTMLElement[] = []
  if (character.firstNight || character.otherNights) {
    nightLines.push(el('h3', { textContent: 'What they receive at night' }))
    if (character.firstNight) nightLines.push(el('p', { textContent: `First night: ${character.firstNight}` }))
    if (character.otherNights) nightLines.push(el('p', { textContent: `Other nights: ${character.otherNights}` }))
  }

  const card = el('div', { className: `character-popup-card ${character.alignment}` }, [
    el('button', { className: 'character-popup-close', textContent: '✕', onclick: closePopup }),
    character.tokenUrl
      ? el('img', { className: 'character-popup-token', src: character.tokenUrl, alt: character.name, loading: 'lazy' })
      : el('div', { className: 'character-popup-token placeholder' }),
    el('h2', { textContent: character.name }),
    el('p', { className: 'character-popup-type', textContent: typeLabel }),
    el('p', { className: 'character-popup-ability', textContent: character.ability }),
    ...(character.clarification
      ? [el('p', { className: 'character-popup-clarification', textContent: `Clarification: ${character.clarification}` })]
      : []),
    ...(character.flavor ? [el('p', { className: 'character-popup-flavor', textContent: character.flavor })] : []),
    ...nightLines,
    ...(character.wikiUrl
      ? [
          el('a', {
            className: 'character-popup-wiki',
            href: character.wikiUrl,
            target: '_blank',
            rel: 'noopener noreferrer',
            textContent: 'Wiki page ↗',
          }),
        ]
      : []),
  ])

  overlay = el('div', {
    className: 'character-popup-overlay',
    onclick: (event: MouseEvent) => {
      if (event.target === overlay) closePopup()
    },
  })
  overlay.append(card)
  document.body.append(overlay)
}

// Wires a tap/click (mobile long-press has no reliable cross-browser primitive,
// so a plain tap opens the same full popup) plus, for pointer/desktop users, a
// lightweight hover preview of name/ability/clarification without opening the
// full popup — matches the "hover shows a summary, click opens full info"
// pattern described in TODO.md.
export function attachCharacterTrigger(element: HTMLElement, characterId: string): void {
  const character = getCharacter(characterId)
  if (!character) return

  element.classList.add('character-trigger')
  element.addEventListener('click', () => openCharacterPopup(characterId))

  let tooltip: HTMLElement | null = null
  element.addEventListener('mouseenter', () => {
    tooltip = el('div', { className: 'character-tooltip' }, [
      el('strong', { textContent: character.name }),
      el('p', { textContent: character.ability }),
      ...(character.clarification ? [el('p', { className: 'character-tooltip-clarification', textContent: character.clarification })] : []),
    ])
    element.append(tooltip)
  })
  element.addEventListener('mouseleave', () => {
    tooltip?.remove()
    tooltip = null
  })
}
