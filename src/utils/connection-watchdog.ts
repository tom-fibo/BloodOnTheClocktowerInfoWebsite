// Mitigates a reported real-world symptom: after a device sits backgrounded
// (tab hidden / phone locked) for a while, its WebRTC/signaling connection can
// go quietly stale — the Storyteller thinks they're still in the room, but
// Players in it can't see them, and new joiners don't either. There's no
// reliable way from here to distinguish "genuinely dead" from "just slow" via
// Trystero's public API, so rather than trying to hot-patch the existing
// connection (risky and unverified), this detects the likely trigger — a long
// stretch hidden — and does a full page reload, which is guaranteed to
// recover correctly because it reuses the already-built, already-tested
// reconnect path (reconnect-token seat reclaim for Players, host-state
// restore for the Storyteller) rather than inventing a new one.
const STALE_THRESHOLD_MS = 15000

export function watchForStaleConnection(onStale: () => void): void {
  let hiddenSince: number | null = null

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenSince = Date.now()
      return
    }
    if (hiddenSince === null) return
    const hiddenMs = Date.now() - hiddenSince
    hiddenSince = null
    if (hiddenMs > STALE_THRESHOLD_MS) onStale()
  })
}
