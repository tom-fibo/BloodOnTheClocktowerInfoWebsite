import { getCharacter } from '../data/characters'
import type { NightCardElement, NightCardElementKind } from '../types'

// Kept separate from NightCardElement itself (rather than `Partial<Omit<NightCardElement, 'kind'>>`)
// because NightCardElement's `[key: string]: JsonValue` index signature collapses
// Omit/Pick's per-property types down to the broad JsonValue union — this plain
// interface keeps the field types precise.
interface NightCardElementFields {
  text?: string
  value?: number
  peerId?: string | null
  name?: string
  characterId?: string
}

// NightCardElement's fields are all required-but-nullable (Trystero's JsonValue
// constraint rejects `undefined`), which is tedious to spell out by hand at every
// call site — this fills in `null` for whatever the given `kind` doesn't use.
export function nightCardElement(kind: NightCardElementKind, fields: NightCardElementFields = {}): NightCardElement {
  return {
    kind,
    text: fields.text ?? null,
    value: fields.value ?? null,
    peerId: fields.peerId ?? null,
    name: fields.name ?? null,
    characterId: fields.characterId ?? null,
  }
}

// Short one-line preview of an element, for a composer's pending-list-before-
// sending (either side) and the Storyteller's audit/message logs. Shared here
// rather than duplicated per screen.
export function describeNightCardElement(element: NightCardElement): string {
  switch (element.kind) {
    case 'text':
      return element.text ?? ''
    case 'number':
      return `Number: ${element.value}`
    case 'player':
      return `Player: ${element.name}`
    case 'character':
      return `Character: ${getCharacter(element.characterId ?? '')?.name ?? element.characterId}`
  }
}
