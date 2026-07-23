import { el } from './dom'
import { getScript } from '../data/scripts'
import { CHARACTERS_BY_ID } from '../data/characters'
import { attachCharacterTrigger } from './character-popup'
import { getDistributionTable } from '../game/setup'
import type { Character, CharacterType } from '../types'

const TYPE_ORDER: CharacterType[] = ['townsfolk', 'outsider', 'minion', 'demon']
const TYPE_LABELS: Record<CharacterType, string> = {
  townsfolk: 'Townsfolk',
  outsider: 'Outsiders',
  minion: 'Minions',
  demon: 'Demon',
}

function buildDistributionTable(): HTMLElement {
  const rows = getDistributionTable()
  const countLabel = (players: number, index: number) => (index === rows.length - 1 ? `${players}+` : String(players))

  function row(label: string, values: (r: (typeof rows)[number]) => number): HTMLElement {
    return el('tr', {}, [el('th', { textContent: label }), ...rows.map((r) => el('td', { textContent: String(values(r)) }))])
  }

  return el('table', { className: 'distribution-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { textContent: 'Players' }),
        ...rows.map((r, i) => el('th', { textContent: countLabel(r.players, i) })),
      ]),
    ]),
    el('tbody', {}, [
      row('Townsfolk', (r) => r.townsfolk),
      row('Outsiders', (r) => r.outsider),
      row('Minions', (r) => r.minion),
      row('Demons', (r) => r.demon),
    ]),
  ])
}

// Shared between the Storyteller's and Player's Script panels — both just show
// the character list with popups; only the Storyteller's wrapper adds a
// script-selector control around this. The character list flows through CSS
// columns (.script-columns) rather than a fixed grid so it packs into
// whatever width is available and fits without scrolling, similar in spirit
// to the official script PDF's compact one-line-per-character layout.
export function renderScriptView(container: HTMLElement, scriptId: string): void {
  const script = getScript(scriptId)
  if (!script) {
    container.replaceChildren(el('p', { className: 'roster-empty', textContent: 'Unknown script.' }))
    return
  }

  const groups = TYPE_ORDER.map((type) => {
    const characters = script.characterIds
      .map((id) => CHARACTERS_BY_ID[id])
      .filter((c): c is Character => c?.type === type)

    const list = el(
      'ul',
      { className: 'script-character-list' },
      characters.map((character) => {
        const item = el('li', { className: 'script-character-item' }, [
          character.tokenUrl
            ? el('img', { className: 'script-character-token', src: character.tokenUrl, alt: character.name })
            : el('div', { className: 'script-character-token placeholder' }),
          el('div', { className: 'script-character-text' }, [
            el('span', { className: 'script-character-name', textContent: character.name }),
            el('span', { className: 'script-character-ability', textContent: character.ability }),
          ]),
        ])
        attachCharacterTrigger(item, character.id)
        return item
      }),
    )

    return el('div', { className: 'script-group' }, [el('h3', { textContent: TYPE_LABELS[type] }), list])
  })

  container.replaceChildren(
    el('div', { className: 'script-view' }, [
      el('h2', { textContent: script.name }),
      el('div', { className: 'script-columns' }, groups),
      buildDistributionTable(),
    ]),
  )
}
