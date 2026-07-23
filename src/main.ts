import './style.css'
import { subscribe, getState, setState } from './state/store'
import { renderLanding } from './screens/landing'
import { renderHostSetup } from './screens/host-setup'
import { renderHostRoom } from './screens/host-room'
import { renderJoinSetup } from './screens/join-setup'
import { renderJoinRoom } from './screens/join-room'
import { normalizeRoomCode } from './utils/room-code'

const app = document.querySelector<HTMLDivElement>('#app')!

// A Storyteller's QR code encodes a join link like `?join=ABCDE` — land
// straight on the join-setup screen with the code pre-filled instead of
// making the player type it in by hand.
const joinParam = new URLSearchParams(location.search).get('join')
if (joinParam) {
  setState({ screen: 'join-setup', roomCode: normalizeRoomCode(joinParam) })
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
