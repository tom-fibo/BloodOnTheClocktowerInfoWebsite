import './style.css'
import { subscribe, getState } from './state/store'
import { renderLanding } from './screens/landing'
import { renderHostSetup } from './screens/host-setup'
import { renderHostRoom } from './screens/host-room'
import { renderJoinSetup } from './screens/join-setup'
import { renderJoinRoom } from './screens/join-room'

const app = document.querySelector<HTMLDivElement>('#app')!

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
