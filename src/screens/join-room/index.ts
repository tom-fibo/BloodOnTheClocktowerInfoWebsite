import { el } from '../../ui/dom'
import { getState, setState } from '../../state/store'
import { joinPlayerRoom } from '../../trystero/room'
import { renderRosterPanel } from '../../ui/roster-panel'
import { renderTabs } from '../../ui/tabs'
import { DEFAULT_SCRIPT_ID } from '../../data/scripts'
import type { LogMessage } from '../../ui/message-log'
import type { PlayerInfo } from '../../types'
import { renderNightActionsPanel, type ReceivedCard } from './night-actions-panel'
import { renderTownSquarePanel } from './town-square-panel'
import { renderScriptPanel } from './script-panel'
import { renderMessagesPanel } from './messages-panel'

export function renderJoinRoom(container: HTMLElement): void {
  const { roomCode, selfName } = getState()
  const handle = joinPlayerRoom(roomCode, selfName)

  // Shared, mutable, and kept alive for the whole room session (unlike the
  // per-tab panels, which are torn down and recreated on every tab switch) —
  // see trystero/room.ts's listener-Set comment for why a plain single-slot
  // callback can't be trusted to carry state between panel mounts.
  const messageLog: LogMessage[] = []
  const receivedCards: ReceivedCard[] = []
  const nightActionsState = { myCharacterId: null as string | null, receivedCards, latestRoster: [] as PlayerInfo[] }
  const townSquareState = { latestRoster: [] as PlayerInfo[], scriptId: DEFAULT_SCRIPT_ID }

  const rosterContainer = el('div', { className: 'roster-panel' })
  const nameInput = el('input', { className: 'name-input', value: selfName, maxLength: 20 })
  const banner = el('p', {
    className: 'disconnect-banner hidden',
    textContent: 'Storyteller disconnected — waiting to reconnect…',
  })

  container.replaceChildren(
    el('div', { className: 'screen join-room-screen' }, [
      el('div', { className: 'room-header' }, [
        el('div', {}, [el('h1', { textContent: 'Player' }), el('label', { textContent: 'Display name:' }), nameInput]),
        el('button', {
          className: 'leave-button',
          textContent: 'Leave Room',
          onclick: () => {
            handle.leave()
            setState({ screen: 'landing' })
          },
        }),
      ]),
      banner,
      el('div', { className: 'roster-panel-container' }, [el('h2', { textContent: 'Players in this room' }), rosterContainer]),
      el('div', { className: 'tabs-shell' }),
    ]),
  )

  const tabsShell = container.querySelector<HTMLDivElement>('.tabs-shell')!
  const tabsHandle = renderTabs(tabsShell, [
    { id: 'night-actions', label: 'Night Actions', render: (c) => renderNightActionsPanel(c, handle, nightActionsState) },
    { id: 'town-square', label: 'Town Square', render: (c) => renderTownSquarePanel(c, townSquareState) },
    { id: 'script', label: 'Script', render: (c) => renderScriptPanel(c, townSquareState.scriptId) },
    { id: 'messages', label: 'Messages', render: (c) => renderMessagesPanel(c, handle, messageLog) },
  ])

  handle.onRosterChange((players, _storytellerId, scriptId) => {
    nightActionsState.latestRoster = players
    townSquareState.latestRoster = players
    townSquareState.scriptId = scriptId
    renderRosterPanel(rosterContainer, players, { selectable: false, showStatus: true })
    banner.classList.add('hidden')
  })

  handle.onStorytellerLeave(() => banner.classList.remove('hidden'))

  handle.onStorytellerMessage((msg) => {
    messageLog.push({ label: 'Storyteller', text: msg.text, ts: msg.ts })
  })

  handle.onCharacterAssign((characterId) => {
    nightActionsState.myCharacterId = characterId
  })

  handle.onNightCard((card) => {
    receivedCards.push(card)
    tabsHandle.setBadge('night-actions', true)
  })

  nameInput.addEventListener('change', () => {
    const name = nameInput.value.trim()
    if (name) handle.updateName(name)
  })
}
