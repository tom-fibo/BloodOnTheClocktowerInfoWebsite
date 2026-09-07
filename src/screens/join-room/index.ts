import { el } from '../../ui/dom'
import { getState, setState } from '../../state/store'
import { joinPlayerRoom } from '../../trystero/room'
import type { PlayerRoomHandle } from '../../trystero/room'
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
// The player's very first WebRTC handshake with the Storyteller sometimes just
// doesn't complete (a flaky mesh connection, not a "the Storyteller was here and
// left" event — room.onPeerLeave can't even fire for a peer that never finished
// connecting), leaving the player sat on what looks like a normal lobby with no
// indication the Storyteller can't actually see them yet. Longer than
// AUTO_RELOAD_DELAY_MS since establishing a brand new connection (ICE/TURN
// negotiation) is inherently slower than recovering one that already existed.
const INITIAL_CONNECT_TIMEOUT_MS = 15000

export function renderJoinRoom(container: HTMLElement): void {
  const { roomCode, selfName } = getState()

  // joinPlayerRoom() now awaits a TURN-credential fetch (bounded to ~5s, see
  // turn-config.ts) before it can call joinRoom() — this placeholder covers that
  // gap. saveLastSession() still runs immediately: even a reload mid-connect
  // should retry joining this room, not lose the destination.
  container.replaceChildren(
    el('div', { className: 'screen join-room-screen' }, [
      el('div', { className: 'room-header' }, [
        el('div', { className: 'room-header-title' }, [el('h1', { textContent: 'Player' })]),
        el('button', {
          className: 'leave-button',
          textContent: 'Cancel',
          onclick: () => {
            clearLastSession()
            setState({ screen: 'landing' })
          },
        }),
      ]),
      el('p', { textContent: 'Connecting…' }),
    ]),
  )
  saveLastSession({ screen: 'join-room', roomCode, selfName })

  joinPlayerRoom(roomCode, selfName)
    .then((handle) => {
      // The user may have navigated away (e.g. clicked Cancel above) while the
      // TURN fetch was in flight — this container no longer belongs to us, so
      // tear the now-unwanted room down instead of clobbering whatever screen
      // is actually showing.
      if (getState().screen !== 'join-room' || getState().roomCode !== roomCode) {
        handle.leave()
        return
      }
      buildJoinRoomUi(container, handle, roomCode, selfName)
    })
    .catch((err) => {
      console.error('[trystero] Failed to join room', err)
      if (getState().screen !== 'join-room' || getState().roomCode !== roomCode) return
      container.replaceChildren(
        el('div', { className: 'screen join-room-screen' }, [
          el('p', { textContent: 'Failed to connect. Please try again.' }),
          el('button', {
            className: 'secondary',
            textContent: 'Back',
            onclick: () => setState({ screen: 'landing' }),
          }),
        ]),
      )
    })
}

function buildJoinRoomUi(
  container: HTMLElement,
  handle: PlayerRoomHandle,
  roomCode: string,
  selfName: string,
): void {
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
  // Visible (not `hidden`) from the moment this screen mounts — this same
  // banner also covers "haven't connected to the Storyteller yet at all",
  // which is the state every join starts in until the first roster arrives.
  const bannerText = el('span', { textContent: 'Not yet connected to the Storyteller — waiting…' })
  const banner = el('div', { className: 'disconnect-banner' }, [bannerText, reconnectButton])
  let autoReloadTimer: ReturnType<typeof setTimeout> | null = null

  function clearAutoReload(): void {
    if (autoReloadTimer !== null) {
      clearTimeout(autoReloadTimer)
      autoReloadTimer = null
    }
  }

  function scheduleAutoReload(delayMs: number): void {
    clearAutoReload()
    autoReloadTimer = setTimeout(() => {
      if (isModalOpen() || nightActionsState.pendingElements.length > 0) return
      location.reload()
    }, delayMs)
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
    // Only reachable after at least one roster has arrived (see onPeerLeave's
    // storytellerId check in room.ts), so the banner's "waiting to connect"
    // text is always stale by this point — switch it to the reconnect message.
    bannerText.textContent = 'Storyteller disconnected — waiting to reconnect…'
    banner.classList.remove('hidden')
    // Give the Storyteller's own reload a window to land, but don't leave the
    // player stuck on this banner forever if it doesn't — see the "players
    // don't auto-refresh connection" report this was added for.
    scheduleAutoReload(AUTO_RELOAD_DELAY_MS)
  })

  handle.onCharacterAssign((characterId) => {
    nightActionsState.myCharacterId = characterId
  })

  handle.onNightCard((card) => {
    nightActionsState.feed.push({ ts: card.ts, self: false, elements: card.elements })
    savePlayerFeed(roomCode, nightActionsState.feed)
    tabsHandle?.setBadge('night-actions', true)
  })

  // Covers the "never actually connected" case the banner starts in — cleared
  // by onRosterChange above the moment a connection does come through.
  scheduleAutoReload(INITIAL_CONNECT_TIMEOUT_MS)

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
