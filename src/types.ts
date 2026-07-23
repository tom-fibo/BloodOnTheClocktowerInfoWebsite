import type { JsonValue } from 'trystero'

export interface PlayerInfo {
  peerId: string
  name: string
  [key: string]: JsonValue
}

// Trystero's makeAction<T>() requires T to structurally satisfy its JSON-payload
// constraint, which needs an explicit index signature on named interfaces (a plain
// object literal wouldn't need this, but a declared interface does).
export interface HelloPayload {
  name: string
  [key: string]: JsonValue
}

export interface RosterPayload {
  storytellerId: string
  players: PlayerInfo[]
  [key: string]: JsonValue
}

export interface SecretMessagePayload {
  text: string
  ts: number
  [key: string]: JsonValue
}
