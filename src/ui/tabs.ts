import { el } from './dom'

export interface TabDef {
  id: string
  label: string
  render: (container: HTMLElement) => void
}

export interface TabsHandle {
  switchTo(id: string): void
  setBadge(id: string, show: boolean): void
}

// Shared bottom tab-bar shell used by both the Storyteller's and Player's
// multi-panel screens (mobile-first: tabs sit at the bottom of the viewport,
// see .tab-bar in style.css).
export function renderTabs(container: HTMLElement, tabs: TabDef[], initialTabId?: string): TabsHandle {
  let activeId = initialTabId ?? tabs[0]?.id
  const contentArea = el('div', { className: 'tab-content' })
  const buttons = new Map<string, HTMLButtonElement>()
  const badges = new Map<string, boolean>()

  function rebuildButton(tab: TabDef): void {
    const button = buttons.get(tab.id)
    if (!button) return
    button.replaceChildren(tab.label, ...(badges.get(tab.id) ? [el('span', { className: 'tab-badge' })] : []))
  }

  function renderActive(): void {
    const tab = tabs.find((t) => t.id === activeId)
    if (!tab) return
    for (const [id, button] of buttons) {
      button.classList.toggle('active', id === activeId)
    }
    tab.render(contentArea)
  }

  const tabBar = el(
    'nav',
    { className: 'tab-bar' },
    tabs.map((tab) => {
      const button = el('button', {
        className: 'tab-button',
        textContent: tab.label,
        onclick: () => {
          activeId = tab.id
          if (badges.get(tab.id)) {
            badges.set(tab.id, false)
            rebuildButton(tab)
          }
          renderActive()
        },
      })
      buttons.set(tab.id, button)
      return button
    }),
  )

  // Content first, tab bar second — mobile-first players switch panels via
  // tabs docked at the bottom of the screen, not a top nav.
  container.replaceChildren(contentArea, tabBar)
  renderActive()

  return {
    switchTo(id) {
      if (!tabs.some((t) => t.id === id)) return
      activeId = id
      renderActive()
    },
    setBadge(id, show) {
      const tab = tabs.find((t) => t.id === id)
      if (!tab) return
      badges.set(id, show && id !== activeId)
      rebuildButton(tab)
    },
  }
}
