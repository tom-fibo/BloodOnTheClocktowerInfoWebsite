import type { JsonValue } from 'trystero'

export type CharacterType = 'townsfolk' | 'outsider' | 'minion' | 'demon'
export type Alignment = 'good' | 'evil'

// Static game content — never sent over the network itself, only referenced by
// `characterId` string in payloads. Loaded from src/data/characters.ts.
export interface Character {
  id: string
  name: string
  type: CharacterType
  alignment: Alignment
  ability: string
  clarification?: string
  flavor?: string
  firstNight?: string
  otherNights?: string
  firstNightOrder?: number
  otherNightsOrder?: number
  wikiUrl?: string
  tokenUrl?: string
}

export interface Script {
  id: string
  name: string
  characterIds: string[]
}

// A seat is the primary unit of the roster — it exists independently of whether a
// device is currently connected to it (peerId null = no device attached right now,
// e.g. not yet joined, or reconnecting). This is deliberately public/broadcast data;
// `characterId` is NOT here — see CharacterAssignPayload below for why.
export interface PlayerInfo {
  seat: number
  name: string
  peerId: string | null
  alive: boolean
  voteToken: boolean
  [key: string]: JsonValue
}

// Trystero's makeAction<T>() requires an explicit index signature on named interfaces
// used as its type parameter (a plain object literal wouldn't need this, but a
// declared interface does) — every payload interface below needs one.
export interface HelloPayload {
  name: string
  reconnectToken: string
  [key: string]: JsonValue
}

export interface RosterPayload {
  storytellerId: string
  scriptId: string
  players: PlayerInfo[]
  [key: string]: JsonValue
}

// Sent ST -> one Player only, never broadcast — a Player's character is private
// even though the rest of their seat info (name/alive/voteToken) is public roster
// data. `characterId: null` means "no character currently assigned."
export interface CharacterAssignPayload {
  characterId: string | null
  ts: number
  [key: string]: JsonValue
}

// One composable piece of a night card. Modeled as a flat tagged interface (rather
// than a discriminated union) so it satisfies Trystero's JsonValue constraint
// without needing an index signature repeated on every union member — only the
// fields relevant to `kind` are populated (the rest `null`, not `undefined` —
// `undefined` isn't a valid JsonValue); build these via game/night-card.ts's
// `nightCardElement()` helper rather than writing the object literal by hand.
export type NightCardElementKind = 'text' | 'number' | 'player' | 'character'

export interface NightCardElement {
  kind: NightCardElementKind
  text: string | null
  value: number | null
  peerId: string | null
  name: string | null
  characterId: string | null
  [key: string]: JsonValue
}

// Sent ST -> one Player, targeted. A single card can bundle several elements
// (e.g. "you learn: <number>, about <player>") so the ST can prepare everything
// and send it as one message.
export interface NightCardPayload {
  elements: NightCardElement[]
  ts: number
  [key: string]: JsonValue
}

// A single per-seat log entry, from the Storyteller's point of view — covers
// both a sent night card (self: true) and an unprompted card a Player sent
// (self: false, via the playerCard action). Not itself a network payload (no
// index signature needed) — only ever stored locally and rendered.
export interface SeatMessage {
  ts: number
  self: boolean
  elements: NightCardElement[]
}
