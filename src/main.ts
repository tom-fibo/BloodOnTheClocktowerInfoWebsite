import './style.css'
import { subscribe, getState, setState } from './state/store'
import { renderLanding } from './screens/landing'
import { renderHostSetup } from './screens/host-setup'
import { renderHostRoom } from './screens/host-room'
import { renderJoinSetup } from './screens/join-setup'
import { renderJoinRoom } from './screens/join-room'
import { normalizeRoomCode } from './utils/room-code'
import { loadLastSession } from './utils/session'

const app = document.querySelector<HTMLDivElement>('#app')!

// A Storyteller's QR code encodes a join link like `?join=ABCDE` — land
// straight on the join-setup screen with the code pre-filled instead of
// making the player type it in by hand. Takes priority over auto-rejoining a
// previous session below — scanning a QR code is a clear signal to join THAT
// room, not resume an old one.
const joinParam = new URLSearchParams(location.search).get('join')
if (joinParam) {
  setState({ screen: 'join-setup', roomCode: normalizeRoomCode(joinParam) })
} else {
  // A reload (intentional or accidental) should try to rejoin whatever room
  // this browser was last in — the actual rejoin correctness (seat reclaim,
  // host-state restore) is handled by trystero/room.ts; this just gets the
  // app to navigate back to that screen instead of defaulting to landing.
  const lastSession = loadLastSession()
  if (lastSession) {
    setState({ screen: lastSession.screen, roomCode: lastSession.roomCode, selfName: lastSession.selfName })
  }
}

function render(): void {
  switch (getState().screen) {
    case 'landing':
      renderLanding(app)
      break
    case 'host-setup':
      renderHostSetup(app)
      break
    case 'host-room':
      renderHostRoom(app)
      break
    case 'join-setup':
      renderJoinSetup(app)
      break
    case 'join-room':
      renderJoinRoom(app)
      break
  }
}

subscribe(render)
render()
