export interface LastSession {
  screen: 'host-room' | 'join-room'
  roomCode: string
  selfName: string
}

const SESSION_KEY = 'botc:last-session'
const NAME_KEY = 'botc:last-name'

// So an accidental (or intentional) reload rejoins the same room instead of
// dumping the user back at the landing screen — the reconnect-token/seat-reclaim
// (Player) and host-state persistence (Storyteller) mechanisms already handle
// the actual rejoin correctly once we're back on the right screen; this is
// just what gets the app to navigate there again after a reload.
export function saveLastSession(session: LastSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // Storage unavailable — auto-rejoin silently degrades to "always land on landing."
  }
}

export function loadLastSession(): LastSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as LastSession) : null
  } catch {
    return null
  }
}

// Cleared on an explicit "Leave Room" click, mirroring host-persistence's
// clearHostState — an intentional exit shouldn't auto-rejoin next time.
export function clearLastSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
}

export function saveLastName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    // ignore
  }
}

export function loadLastName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}
