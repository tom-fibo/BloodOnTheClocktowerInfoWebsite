import type { NightCardPayload, PlayerInfo, SeatMessage } from '../types'

// Everything the Storyteller's browser needs to restore a room after its own
// tab reloads or crashes (same-device recovery only — this is plain
// localStorage, so it cannot help a Storyteller who switches devices).
export interface HostState {
  seats: PlayerInfo[]
  scriptId: string
  characterAssignments: Record<number, string>
  reconnectTokenToSeat: Record<string, number>
  note: string
  // Private per-seat reminders (e.g. "protected by Monk") — never sent to the
  // player, just the Storyteller's own recall aid, shown in that seat's popup.
  seatNotes: Record<number, string>
  // Sent night cards + unprompted Player cards, scoped per seat — this is now
  // the ONLY record of either (there is no separate global "sent cards" log
  // anymore). "Attached to the seat," not the connection, so it survives a
  // Player's reconnect the same way seatNotes/characterAssignments do.
  seatMessages: Record<number, SeatMessage[]>
  // Seats with an incoming card the Storyteller hasn't opened yet — drives the
  // Grimoire's unread-dot indicator. Serialized as an array (plain JSON has no
  // Set); room.ts converts to/from a Set at runtime.
  unreadSeats: number[]
  // Night cards sent to a seat while its occupant was disconnected — the ST
  // can still prep and send a card for someone not currently looking at their
  // phone; it's queued here and delivered once that seat's `hello` reconnects.
  pendingCards: Record<number, NightCardPayload[]>
  // Seats flagged to die tonight but not yet revealed — Storyteller-only,
  // deliberately separate from PlayerInfo.alive (which is public). Serialized
  // as an array (plain JSON has no Set); room.ts converts to/from a Set.
  diesTonightSeats: number[]
}

function storageKey(roomCode: string): string {
  return `botc:host-state:${roomCode}`
}

export function saveHostState(roomCode: string, state: HostState): void {
  try {
    localStorage.setItem(storageKey(roomCode), JSON.stringify(state))
  } catch {
    // Storage unavailable — ST resilience silently degrades to "no persistence,"
    // same as before this feature existed.
  }
}

export function loadHostState(roomCode: string): HostState | null {
  try {
    const raw = localStorage.getItem(storageKey(roomCode))
    return raw ? (JSON.parse(raw) as HostState) : null
  } catch {
    return null
  }
}

export function clearHostState(roomCode: string): void {
  try {
    localStorage.removeItem(storageKey(roomCode))
  } catch {
    // ignore
  }
}
