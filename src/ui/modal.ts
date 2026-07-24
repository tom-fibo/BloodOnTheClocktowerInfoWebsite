import { el } from './dom'

let currentOverlay: HTMLElement | null = null

export interface ModalHandle {
  close(): void
}

// Single shared overlay slot — only one modal is ever open at a time in this
// app, so opening a new one implicitly closes whatever was already open.
// `onBackdropDismiss` fires only when the user clicks the backdrop itself —
// deliberately not on every `closeModal()` call, since callers routinely close
// the current modal programmatically just to open a *different* one on top
// (e.g. the character picker opening over the seat modal), and that shouldn't
// be treated as the same thing as the user dismissing it.
export function openModal(content: HTMLElement, className = '', onBackdropDismiss?: () => void): ModalHandle {
  closeModal()
  const overlay = el('div', {
    className: `modal-overlay ${className}`.trim(),
    onclick: (event: MouseEvent) => {
      if (event.target === overlay) {
        closeModal()
        onBackdropDismiss?.()
      }
    },
  })
  overlay.append(content)
  document.body.append(overlay)
  currentOverlay = overlay
  return { close: closeModal }
}

// Swaps the currently-open overlay's content without tearing down and
// recreating the overlay element itself — critical for anything that
// re-renders on every small interaction (a composer button click, a Setup
// checkbox toggle). Returns false (does nothing) if no modal is currently
// open, so callers can fall back to `openModal` in that case.
//
// The overlay itself isn't recreated, but `content` (the card) IS a fresh
// element each call, and the card — not the overlay — is the actual scroll
// container (`.seat-modal-card`/`.character-picker-card` have their own
// `overflow-y: auto`) — so a fresh card still starts at scrollTop 0 unless we
// explicitly carry the old one's position over, which is what this does.
export function updateModalContent(content: HTMLElement): boolean {
  if (!currentOverlay) return false
  const previousCardScrollTop = currentOverlay.firstElementChild?.scrollTop ?? 0
  const previousOverlayScrollTop = currentOverlay.scrollTop
  currentOverlay.replaceChildren(content)
  content.scrollTop = previousCardScrollTop
  currentOverlay.scrollTop = previousOverlayScrollTop
  return true
}

export function closeModal(): void {
  currentOverlay?.remove()
  currentOverlay = null
}

// Lets an automatic reload (connection watchdog, disconnect-banner timer)
// check before firing — reloading out from under an open modal (a seat
// composer, a character picker) would silently discard whatever the user was
// doing in it.
export function isModalOpen(): boolean {
  return currentOverlay !== null
}
