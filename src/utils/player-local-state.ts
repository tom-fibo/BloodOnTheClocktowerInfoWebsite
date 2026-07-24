import type { SeatMessage } from '../types'

// Purely client-side scratch state a Player accumulates during a game — never
// sent anywhere (see the Storyteller's own, server-side-of-sorts persistence
// in host-persistence.ts for the ST's equivalent). Persisted to localStorage,
// keyed by room code, so a Player's own reload doesn't lose their view of past
// night cards or their Town Square predictions/notes.

export interface TownSquareLocalState {
  predictions: Record<number, string>
  notes: Record<number, string>
}

function feedKey(roomCode: string): string {
  return `botc:player-feed:${roomCode}`
}

function townSquareKey(roomCode: string): string {
  return `botc:town-square:${roomCode}`
}

export function loadPlayerFeed(roomCode: string): SeatMessage[] {
  try {
    const raw = localStorage.getItem(feedKey(roomCode))
    return raw ? (JSON.parse(raw) as SeatMessage[]) : []
  } catch {
    return []
  }
}

export function savePlayerFeed(roomCode: string, feed: SeatMessage[]): void {
  try {
    localStorage.setItem(feedKey(roomCode), JSON.stringify(feed))
  } catch {
    // Storage unavailable — this scratch state just won't survive a reload,
    // same as before this feature existed.
  }
}

export function loadTownSquareLocal(roomCode: string): TownSquareLocalState {
  try {
    const raw = localStorage.getItem(townSquareKey(roomCode))
    return raw ? (JSON.parse(raw) as TownSquareLocalState) : { predictions: {}, notes: {} }
  } catch {
    return { predictions: {}, notes: {} }
  }
}

export function saveTownSquareLocal(roomCode: string, state: TownSquareLocalState): void {
  try {
    localStorage.setItem(townSquareKey(roomCode), JSON.stringify(state))
  } catch {
    // ignore
  }
}
