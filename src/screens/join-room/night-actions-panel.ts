import { el } from '../../ui/dom'
import type { PlayerRoomHandle } from '../../trystero/room'
import { getCharacter } from '../../data/characters'
import { attachCharacterTrigger, openCharacterPopup } from '../../ui/character-popup'
import type { NightCardElement, PlayerInfo } from '../../types'

export interface ReceivedCard {
  elements: NightCardElement[]
  ts: number
}

export interface NightActionsState {
  myCharacterId: string | null
  receivedCards: ReceivedCard[]
  latestRoster: PlayerInfo[]
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
      const item = el('button', { className: 'night-card-element character-chip', textContent: character?.name ?? element.characterId ?? '?' })
      if (character) attachCharacterTrigger(item, character.id)
      return item
    }
    case 'characterChange': {
      const character = getCharacter(element.characterId ?? '')
      const item = el('button', { className: 'night-card-element character-chip change', textContent: `You are now: ${character?.name ?? element.characterId}` })
      if (character) attachCharacterTrigger(item, character.id)
      return item
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
  const cardsList = el('div', { className: 'received-cards-list' })

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

  function refreshCards(): void {
    const ordered = [...state.receivedCards].reverse()
    cardsList.replaceChildren(
      ...(ordered.length
        ? ordered.map((card) =>
            el('div', { className: 'night-card' }, [
              el('p', {
                className: 'night-card-time',
                textContent: new Date(card.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              }),
              ...card.elements.map((element) => renderElement(element, state.latestRoster)),
              ...(card.elements.some((e) => e.kind === 'choosePlayer' || e.kind === 'chooseCharacter')
                ? [
                    el('button', {
                      className: 'primary',
                      textContent: 'Send response',
                      onclick: (event: MouseEvent) => {
                        const wrapper = (event.currentTarget as HTMLElement).parentElement
                        const select = wrapper?.querySelector('select')
                        if (!select) return
                        const chooseCharacter = card.elements.find((e) => e.kind === 'chooseCharacter')
                        if (chooseCharacter) {
                          handle.respondToNightCard(card.ts, { chosenCharacterId: select.value })
                        } else {
                          handle.respondToNightCard(card.ts, { chosenPeerId: select.value })
                        }
                      },
                    }),
                  ]
                : []),
            ]),
          )
        : [el('p', { className: 'roster-empty', textContent: 'No night cards yet.' })]),
    )
  }

  container.replaceChildren(
    el('div', { className: 'night-actions-panel' }, [
      el('h2', { textContent: 'Your character' }),
      characterSection,
      el('h2', { textContent: 'Night cards' }),
      cardsList,
    ]),
  )

  refreshCharacter()
  refreshCards()

  handle.onCharacterAssign(() => refreshCharacter())
  handle.onNightCard(() => refreshCards())
  handle.onRosterChange(() => refreshCards())
}
