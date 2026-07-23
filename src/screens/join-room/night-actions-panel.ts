import { el } from '../../ui/dom'
import type { PlayerRoomHandle } from '../../trystero/room'
import { getCharacter } from '../../data/characters'
import { attachCharacterTrigger, openCharacterPopup } from '../../ui/character-popup'
import { nightCardElement } from '../../game/night-card'
import type { NightCardElement, PlayerInfo } from '../../types'

// Messages and night cards are the same feed from the Player's point of view —
// a plain text message (either direction) is just a card with one `text`
// element, so both render through the same `renderElement` path below.
export interface FeedEntry {
  ts: number
  self: boolean
  elements: NightCardElement[]
}

export interface NightActionsState {
  myCharacterId: string | null
  feed: FeedEntry[]
  latestRoster: PlayerInfo[]
}

function characterChip(className: string, character: ReturnType<typeof getCharacter>, label: string): HTMLElement {
  const item = el('button', { className }, [
    character?.tokenUrl
      ? el('img', { className: 'character-chip-token', src: character.tokenUrl, alt: character.name })
      : el('div', { className: 'character-chip-token placeholder' }),
    el('span', { textContent: label }),
  ])
  if (character) attachCharacterTrigger(item, character.id)
  return item
}

function renderElement(element: NightCardElement, roster: PlayerInfo[]): HTMLElement {
  switch (element.kind) {
    case 'text':
      return el('p', { className: 'night-card-element', textContent: element.text ?? '' })
    case 'number':
      return el('p', { className: 'night-card-element number-element', textContent: String(element.value ?? 0) })
    case 'player':
      return el('p', { className: 'night-card-element', textContent: `Player: ${element.name ?? 'Unknown'}` })
    case 'character': {
      const character = getCharacter(element.characterId ?? '')
      return characterChip('night-card-element character-chip', character, character?.name ?? element.characterId ?? '?')
    }
    case 'characterChange': {
      const character = getCharacter(element.characterId ?? '')
      return characterChip('night-card-element character-chip change', character, `You are now: ${character?.name ?? element.characterId}`)
    }
    case 'choosePlayer':
      return renderChoosePlayer(element, roster)
    case 'chooseCharacter':
      return renderChooseCharacter(element)
  }
}

function renderChoosePlayer(element: NightCardElement, roster: PlayerInfo[]): HTMLElement {
  const select = el(
    'select',
    {},
    roster.filter((p) => p.peerId !== null).map((p) => el('option', { value: String(p.seat), textContent: p.name })),
  )
  return el('div', { className: 'night-card-element choose-prompt' }, [
    el('p', { textContent: element.prompt ?? 'Choose a player' }),
    select,
  ])
}

function renderChooseCharacter(element: NightCardElement): HTMLElement {
  const select = el(
    'select',
    {},
    (element.characterIds ?? []).map((id) => el('option', { value: id, textContent: getCharacter(id)?.name ?? id })),
  )
  return el('div', { className: 'night-card-element choose-prompt' }, [
    el('p', { textContent: element.prompt ?? 'Choose a character' }),
    select,
  ])
}

export function renderNightActionsPanel(container: HTMLElement, handle: PlayerRoomHandle, state: NightActionsState): void {
  const characterSection = el('div', { className: 'my-character-section' })
  const feedList = el('div', { className: 'received-cards-list' })
  const customInput = el('input', { className: 'composer-input', placeholder: 'Custom text…' })

  function refreshCharacter(): void {
    const character = state.myCharacterId ? getCharacter(state.myCharacterId) : undefined
    if (!character) {
      characterSection.replaceChildren(el('p', { className: 'roster-empty', textContent: 'No character assigned yet.' }))
      return
    }
    characterSection.replaceChildren(
      el('div', { className: `my-character-card ${character.alignment}` }, [
        character.tokenUrl
          ? el('img', { className: 'my-character-token', src: character.tokenUrl, alt: character.name })
          : el('div', { className: 'my-character-token placeholder' }),
        el('div', {}, [
          el('h2', { textContent: character.name }),
          el('p', { textContent: character.ability }),
          el('button', {
            className: 'secondary',
            textContent: 'More info',
            onclick: () => openCharacterPopup(character.id),
          }),
        ]),
      ]),
    )
  }

  function refreshFeed(): void {
    const ordered = [...state.feed].reverse()
    feedList.replaceChildren(
      ...(ordered.length
        ? ordered.map((entry) =>
            el('div', { className: `night-card${entry.self ? ' self' : ''}` }, [
              el('p', {
                className: 'night-card-time',
                textContent: `${entry.self ? 'You · ' : ''}${new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
              }),
              ...entry.elements.map((element) => renderElement(element, state.latestRoster)),
              ...(!entry.self && entry.elements.some((e) => e.kind === 'choosePlayer' || e.kind === 'chooseCharacter')
                ? [
                    el('button', {
                      className: 'primary',
                      textContent: 'Send response',
                      onclick: (event: MouseEvent) => {
                        const wrapper = (event.currentTarget as HTMLElement).parentElement
                        const select = wrapper?.querySelector('select')
                        if (!select) return
                        const chooseCharacter = entry.elements.find((e) => e.kind === 'chooseCharacter')
                        if (chooseCharacter) {
                          handle.respondToNightCard(entry.ts, { chosenCharacterId: select.value })
                        } else {
                          handle.respondToNightCard(entry.ts, { chosenPeerId: select.value })
                        }
                      },
                    }),
                  ]
                : []),
            ]),
          )
        : [el('p', { className: 'roster-empty', textContent: 'Nothing yet.' })]),
    )
  }

  function send(elements: NightCardElement[]): void {
    const text = elements.length === 1 && elements[0].kind === 'text' ? elements[0].text ?? '' : ''
    if (text) handle.sendToStoryteller(text)
    state.feed.push({ ts: Date.now(), self: true, elements })
    refreshFeed()
  }

  const composer = el('div', { className: 'night-actions-composer' }, [
    el('div', { className: 'element-quick-grid' }, [
      el('button', {
        className: 'element-quick-button',
        textContent: 'Got it',
        onclick: () => send([nightCardElement('text', { text: 'Got it' })]),
      }),
    ]),
    el('div', { className: 'composer-row' }, [
      customInput,
      el('button', {
        className: 'primary',
        textContent: 'Send',
        onclick: () => {
          const text = customInput.value.trim()
          if (!text) return
          send([nightCardElement('text', { text })])
          customInput.value = ''
        },
      }),
    ]),
  ])
  customInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const text = customInput.value.trim()
      if (!text) return
      send([nightCardElement('text', { text })])
      customInput.value = ''
    }
  })

  container.replaceChildren(
    el('div', { className: 'night-actions-panel' }, [
      el('h2', { textContent: 'Your character' }),
      characterSection,
      el('h2', { textContent: 'Night cards' }),
      composer,
      feedList,
    ]),
  )

  refreshCharacter()
  refreshFeed()

  handle.onCharacterAssign(() => refreshCharacter())
  handle.onNightCard(() => refreshFeed())
  handle.onRosterChange(() => refreshFeed())
}
