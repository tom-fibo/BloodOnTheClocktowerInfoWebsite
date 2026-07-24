import { el } from '../../ui/dom'
import { getState, setState } from '../../state/store'
import { joinPlayerRoom } from '../../trystero/room'
import { renderTabs, type TabsHandle } from '../../ui/tabs'
import { DEFAULT_SCRIPT_ID } from '../../data/scripts'
import { saveLastSession, clearLastSession, saveLastName } from '../../utils/session'
import { watchForStaleConnection } from '../../utils/connection-watchdog'
import { isModalOpen } from '../../ui/modal'
import { loadPlayerFeed, savePlayerFeed } from '../../utils/player-local-state'
import type { NightCardElement, PlayerInfo } from '../../types'
import { renderNightActionsPanel } from './night-actions-panel'
import { renderTownSquarePanel } from './town-square-panel'
import { renderScriptPanel } from './script-panel'

// A disconnect banner that never recovers on its own defeats the point of
// auto-reconnect — 8s gives the Storyteller's own reload a moment to land
// before this side forces a fresh WebRTC handshake too.
const AUTO_RELOAD_DELAY_MS = 8000

export function renderJoinRoom(container: HTMLElement): void {
  const { roomCode, selfName } = getState()
  const handle = joinPlayerRoom(roomCode, selfName)
  saveLastSession({ screen: 'join-room', roomCode, selfName })

  // Shared, mutable, and kept alive for the whole room session (unlike the
  // per-tab panels, which are torn down and recreated on every tab switch) —
  // see trystero/room.ts's listener-Set comment for why a plain single-slot
  // callback can't be trusted to carry state between panel mounts.
  const nightActionsState = {
    roomCode,
    myCharacterId: null as string | null,
    feed: loadPlayerFeed(roomCode),
    latestRoster: [] as PlayerInfo[],
    pendingElements: [] as NightCardElement[],
  }
  const townSquareState = { latestRoster: [] as PlayerInfo[], scriptId: DEFAULT_SCRIPT_ID }

  const nameInput = el('input', { className: 'name-input-inline', value: selfName, maxLength: 20 })
  const reconnectButton = el('button', {
    className: 'secondary',
    textContent: 'Refresh connection',
    onclick: () => location.reload(),
  })
  const banner = el('div', { className: 'disconnect-banner hidden' }, [
    el('span', { textContent: 'Storyteller disconnected — waiting to reconnect…' }),
    reconnectButton,
  ])
  let autoReloadTimer: ReturnType<typeof setTimeout> | null = null

  function clearAutoReload(): void {
    if (autoReloadTimer !== null) {
      clearTimeout(autoReloadTimer)
      autoReloadTimer = null
    }
  }

  container.replaceChildren(
    el('div', { className: 'screen join-room-screen' }, [
      el('div', { className: 'room-header' }, [
        el('div', { className: 'room-header-title' }, [el('h1', { textContent: 'Player' }), nameInput]),
        el('button', {
          className: 'leave-button',
          textContent: 'Leave Room',
          onclick: () => {
            handle.leave()
            clearLastSession()
            setState({ screen: 'landing' })
          },
        }),
      ]),
      banner,
      el('div', { className: 'tabs-shell' }),
    ]),
  )

  // These must be registered BEFORE renderTabs() mounts the initial panel
  // below. onX callbacks fire in registration order (Set insertion order —
  // see trystero/room.ts's listener-Set comment), and the Night Actions panel
  // registers its OWN onCharacterAssign/onNightCard/onRosterChange to trigger
  // a re-render. If these state-updating callbacks were registered second (as
  // they used to be, right after renderTabs), an event arriving while that
  // panel was already mounted would render BEFORE nightActionsState/
  // townSquareState were updated — the panel would draw the stale value (e.g.
  // "No character assigned yet") and nothing would re-render it afterward,
  // until the user switched tabs away and back and the panel re-mounted fresh
  // against the by-then-correct state. Registering these first guarantees the
  // shared state is always current by the time any panel's own listener runs.
  let tabsHandle: TabsHandle | undefined

  handle.onRosterChange((players, _storytellerId, scriptId) => {
    nightActionsState.latestRoster = players
    townSquareState.latestRoster = players
    townSquareState.scriptId = scriptId
    banner.classList.add('hidden')
    clearAutoReload()
  })

  handle.onStorytellerLeave(() => {
    banner.classList.remove('hidden')
    // Give the Storyteller's own reload a window to land, but don't leave the
    // player stuck on this banner forever if it doesn't — see the "players
    // don't auto-refresh connection" report this was added for.
    clearAutoReload()
    autoReloadTimer = setTimeout(() => {
      if (isModalOpen() || nightActionsState.pendingElements.length > 0) return
      location.reload()
    }, AUTO_RELOAD_DELAY_MS)
  })

  handle.onCharacterAssign((characterId) => {
    nightActionsState.myCharacterId = characterId
  })

  handle.onNightCard((card) => {
    nightActionsState.feed.push({ ts: card.ts, self: false, elements: card.elements })
    savePlayerFeed(roomCode, nightActionsState.feed)
    tabsHandle?.setBadge('night-actions', true)
  })

  const tabsShell = container.querySelector<HTMLDivElement>('.tabs-shell')!
  tabsHandle = renderTabs(tabsShell, [
    { id: 'night-actions', label: 'Night Actions', render: (c) => renderNightActionsPanel(c, handle, nightActionsState) },
    { id: 'town-square', label: 'Town Square', render: (c) => renderTownSquarePanel(c, handle, townSquareState) },
    { id: 'script', label: 'Script', render: (c) => renderScriptPanel(c, handle, townSquareState.scriptId) },
  ])

  nameInput.addEventListener('change', () => {
    const name = nameInput.value.trim()
    if (name) {
      handle.updateName(name)
      saveLastName(name)
      saveLastSession({ screen: 'join-room', roomCode, selfName: name })
    }
  })

  watchForStaleConnection(() => {
    if (isModalOpen() || nightActionsState.pendingElements.length > 0) return
    location.reload()
  })
}
