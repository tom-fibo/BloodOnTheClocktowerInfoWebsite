// A stable per-room, per-browser identity token, independent of Trystero's
// `selfId` (which regenerates every page reload). Sent in the `hello` payload so
// the Storyteller can recognize "this is the same seat as before" across a
// reload, instead of appending a new roster row. Not cryptographically secure —
// this only needs to survive a reload on the same device, not resist a
// determined attacker, so plain Math.random entropy is sufficient and (unlike
// crypto.randomUUID) also works over plain HTTP on a LAN dev server.
function generateToken(): string {
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join('')
}

function storageKey(roomCode: string): string {
  return `botc:player-token:${roomCode}`
}

export function getOrCreatePlayerToken(roomCode: string): string {
  const key = storageKey(roomCode)
  try {
    const existing = localStorage.getItem(key)
    if (existing) return existing
    const token = generateToken()
    localStorage.setItem(key, token)
    return token
  } catch {
    // localStorage unavailable (private browsing, disabled storage, etc.) —
    // fall back to a per-load token; reconnect just won't reclaim the seat.
    return generateToken()
  }
}
