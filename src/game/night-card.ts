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
  prompt?: string
  characterIds?: string[]
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
    prompt: fields.prompt ?? null,
    characterIds: fields.characterIds ?? null,
  }
}
