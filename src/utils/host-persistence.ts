import type { PlayerInfo } from '../types'

export interface AuditLogEntry {
  ts: number
  seat: number
  name: string
  summary: string
}

// Everything the Storyteller's browser needs to restore a room after its own
// tab reloads or crashes (same-device recovery only — this is plain
// localStorage, so it cannot help a Storyteller who switches devices).
export interface HostState {
  seats: PlayerInfo[]
  scriptId: string
  characterAssignments: Record<number, string>
  reconnectTokenToSeat: Record<string, number>
  auditLog: AuditLogEntry[]
  note: string
  // Private per-seat reminders (e.g. "protected by Monk") — never sent to the
  // player, just the Storyteller's own recall aid, shown in that seat's popup.
  seatNotes: Record<number, string>
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
