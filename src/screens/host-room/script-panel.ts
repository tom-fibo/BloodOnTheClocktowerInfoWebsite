import { el } from '../../ui/dom'
import type { HostRoomHandle } from '../../trystero/room'
import { SCRIPTS } from '../../data/scripts'
import { renderScriptView } from '../../ui/script-view'

export function renderScriptPanel(container: HTMLElement, handle: HostRoomHandle): void {
  const viewArea = el('div', { className: 'script-view-area' })
  const select = el(
    'select',
    { className: 'script-select' },
    SCRIPTS.map((s) => el('option', { value: s.id, textContent: s.name, selected: s.id === handle.getScriptId() })),
  )

  select.addEventListener('change', () => {
    handle.setScriptId(select.value)
    renderScriptView(viewArea, select.value)
  })

  container.replaceChildren(
    el('div', { className: 'script-panel' }, [
      el('label', { textContent: 'Script:' }),
      select,
      viewArea,
    ]),
  )

  renderScriptView(viewArea, handle.getScriptId())
}
