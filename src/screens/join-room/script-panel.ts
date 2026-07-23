import { renderScriptView } from '../../ui/script-view'
import type { PlayerRoomHandle } from '../../trystero/room'

export function renderScriptPanel(container: HTMLElement, handle: PlayerRoomHandle, scriptId: string): void {
  let currentScriptId = scriptId
  renderScriptView(container, currentScriptId)

  // Scripts rarely change mid-game, but if the Storyteller does change it,
  // this tab should reflect that live rather than only on next mount.
  handle.onRosterChange((_players, _storytellerId, newScriptId) => {
    if (newScriptId === currentScriptId) return
    currentScriptId = newScriptId
    renderScriptView(container, currentScriptId)
  })
}
