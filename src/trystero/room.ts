import { joinRoom, selfId } from 'trystero'
import { APP_ID, ACTIONS } from './config'
import { DEFAULT_SCRIPT_ID } from '../data/scripts'
import { getCharacter } from '../data/characters'
import { getOrCreatePlayerToken } from '../utils/reconnect-token'
import { loadHostState, saveHostState, clearHostState, type AuditLogEntry } from '../utils/host-persistence'
import type {
  HelloPayload,
  RosterPayload,
  SecretMessagePayload,
  CharacterAssignPayload,
  NightCardPayload,
  NightCardElement,
  NightActionResponsePayload,
  PlayerInfo,
} from '../types'

export interface UnseatedPeer {
  peerId: string
  name: string
}

export interface HostRoomHandle {
  selfId: string
  leave(): void
  sendToPlayer(peerId: string, text: string): void
  onRosterChange(cb: (seats: PlayerInfo[]) => void): void
  onPlayerMessage(cb: (msg: { peerId: string; name: string; text: string; ts: number }) => void): void

  getSeats(): PlayerInfo[]
  addSeat(): void
  removeSeat(seat: number): void
  renameSeat(seat: number, name: string): void
  swapSeats(seatA: number, seatB: number): void
  setAlive(seat: number, alive: boolean): void
  setVoteToken(seat: number, voteToken: boolean): void

  // Connected devices wait here, unassigned, until the Storyteller places them
  // in a specific (vacant) seat — matching the real workflow of assigning each
  // arriving device to whichever physical chair that person is sitting in.
  getUnseatedPeers(): UnseatedPeer[]
  onUnseatedChange(cb: (peers: UnseatedPeer[]) => void): void
  assignPeerToSeat(peerId: string, seat: number): void

  getScriptId(): string
  setScriptId(scriptId: string): void

  assignCharacter(seat: number, characterId: string | null): void
  getCharacterAssignment(seat: number): string | undefined

  sendNightCard(seat: number, elements: NightCardElement[]): void
  onNightActionResponse(
    cb: (response: {
      peerId: string
      seat: number
      forTs: number
      chosenPeerId: string | null
      chosenCharacterId: string | null
      ts: number
    }) => void,
  ): void

  getAuditLog(): AuditLogEntry[]
  onAuditLogChange(cb: (log: AuditLogEntry[]) => void): void

  getNote(): string
  setNote(note: string): void
}

export interface PlayerRoomHandle {
  selfId: string
  leave(): void
  updateName(name: string): void
  sendToStoryteller(text: string): void
  respondToNightCard(forTs: number, response: { chosenPeerId?: string; chosenCharacterId?: string }): void
  onRosterChange(cb: (players: PlayerInfo[], storytellerId: string, scriptId: string) => void): void
  onStorytellerMessage(cb: (msg: { text: string; ts: number }) => void): void
  onStorytellerLeave(cb: () => void): void
  onCharacterAssign(cb: (characterId: string | null) => void): void
  onNightCard(cb: (card: { elements: NightCardElement[]; ts: number }) => void): void
}

function summarizeElements(elements: NightCardElement[]): string {
  return elements
    .map((element) => {
      switch (element.kind) {
        case 'text':
          return element.text ?? ''
        case 'number':
          return `number: ${element.value}`
        case 'player':
          return `player: ${element.name ?? element.peerId}`
        case 'character':
          return `character: ${getCharacter(element.characterId ?? '')?.name ?? element.characterId}`
        case 'characterChange':
          return `now the: ${getCharacter(element.characterId ?? '')?.name ?? element.characterId}`
        case 'choosePlayer':
          return `[choose a player] ${element.prompt ?? ''}`
        case 'chooseCharacter':
          return `[choose a character] ${element.prompt ?? ''}`
        default:
          return ''
      }
    })
    .filter(Boolean)
    .join(' · ')
}

export function createHostRoom(roomCode: string): HostRoomHandle {
  const room = joinRoom({ appId: APP_ID, password: roomCode }, roomCode)

  const hello = room.makeAction<HelloPayload>(ACTIONS.HELLO)
  const roster = room.makeAction<RosterPayload>(ACTIONS.ROSTER)
  const secretMessage = room.makeAction<SecretMessagePayload>(ACTIONS.SECRET_MESSAGE)
  const characterAssign = room.makeAction<CharacterAssignPayload>(ACTIONS.CHARACTER_ASSIGN)
  const nightCard = room.makeAction<NightCardPayload>(ACTIONS.NIGHT_CARD)
  const nightActionResponse = room.makeAction<NightActionResponsePayload>(ACTIONS.NIGHT_ACTION_RESPONSE)

  // Restore from this browser's own last session for this room code, if any —
  // this is what lets the Storyteller recover from an accidental reload/crash.
  // Cross-device recovery is out of scope: localStorage never leaves this browser.
  const restored = loadHostState(roomCode)
  const seats: PlayerInfo[] = restored?.seats ?? []
  // Every restored peerId belonged to the previous Trystero session (selfId is
  // fresh every reload) and is therefore stale — treat every seat as
  // disconnected until its occupant's `hello` reconnects it.
  for (const seat of seats) seat.peerId = null
  let scriptId = restored?.scriptId ?? DEFAULT_SCRIPT_ID
  const characterAssignments: Record<number, string> = restored?.characterAssignments ?? {}
  const reconnectTokenToSeat: Record<string, number> = restored?.reconnectTokenToSeat ?? {}
  const auditLog: AuditLogEntry[] = restored?.auditLog ?? []
  let note = restored?.note ?? ''

  // Connected-but-not-yet-placed devices. Not persisted: after a Storyteller
  // reload, every peerId here would be stale anyway (fresh Trystero session),
  // so it's simplest to let it rebuild fresh from the `hello`s that follow.
  const unseatedPeers = new Map<string, { name: string; reconnectToken: string }>()

  // Sets, not single nullable callbacks: every tab panel re-subscribes each time
  // it's activated (host-room/index.ts recreates panels on tab switch), so a
  // single-slot callback would silently drop events for whichever panel isn't
  // currently on screen — e.g. a secret message arriving while the Storyteller
  // is looking at the Grimoire tab, not the Messages tab.
  const rosterListeners = new Set<(seats: PlayerInfo[]) => void>()
  const messageListeners = new Set<(msg: { peerId: string; name: string; text: string; ts: number }) => void>()
  const nightActionResponseListeners = new Set<Parameters<HostRoomHandle['onNightActionResponse']>[0]>()
  const auditLogListeners = new Set<(log: AuditLogEntry[]) => void>()
  const unseatedListeners = new Set<(peers: UnseatedPeer[]) => void>()

  function getUnseatedList(): UnseatedPeer[] {
    return [...unseatedPeers.entries()].map(([peerId, { name }]) => ({ peerId, name }))
  }

  function notifyUnseatedChange(): void {
    const list = getUnseatedList()
    unseatedListeners.forEach((cb) => cb(list))
  }

  function persist(): void {
    saveHostState(roomCode, { seats, scriptId, characterAssignments, reconnectTokenToSeat, auditLog, note })
  }

  function broadcastRoster(): void {
    const payload: RosterPayload = { storytellerId: selfId, scriptId, players: [...seats] }
    roster.send(payload)
    rosterListeners.forEach((cb) => cb(payload.players))
  }

  function nextSeatNumber(): number {
    return seats.length > 0 ? Math.max(...seats.map((p) => p.seat)) + 1 : 0
  }

  // A player's connection is only proven open once we've received something over it,
  // so the roster is rebuilt reactively from `hello` rather than from onPeerJoin.
  //
  // New connections do NOT get an auto-created seat — they wait in the unseated
  // pool until the Storyteller places them in a specific (vacant) seat, matching
  // how a real Storyteller assigns each arriving device to the chair its owner
  // is actually sitting in. A matching reconnectToken skips the pool entirely
  // and goes straight back to the seat it already occupied.
  hello.onMessage = (data, { peerId }) => {
    const reclaimedSeat = reconnectTokenToSeat[data.reconnectToken]
    const seatEntry =
      reclaimedSeat !== undefined ? seats.find((p) => p.seat === reclaimedSeat) : seats.find((p) => p.peerId === peerId)

    if (seatEntry) {
      seatEntry.peerId = peerId
      seatEntry.name = data.name
      unseatedPeers.delete(peerId)
      broadcastRoster()
      persist()
      const characterId = characterAssignments[seatEntry.seat] ?? null
      characterAssign.send({ characterId, ts: Date.now() }, { target: peerId })
      return
    }

    const existingUnseated = unseatedPeers.get(peerId)
    unseatedPeers.set(peerId, { name: data.name, reconnectToken: data.reconnectToken })
    notifyUnseatedChange()
    if (!existingUnseated) {
      // Not a seat change, so no broadcastRoster() — but this peer still needs
      // to learn storytellerId (from the roster payload) before it can target
      // any of its own sends back to us.
      roster.send({ storytellerId: selfId, scriptId, players: [...seats] }, { target: peerId })
    }
  }

  // Disconnects don't remove the seat — it stays active so a reconnect (or the
  // Storyteller manually) can pick it back up with all its info intact.
  room.onPeerLeave = (peerId) => {
    const seatEntry = seats.find((p) => p.peerId === peerId)
    if (seatEntry) {
      seatEntry.peerId = null
      broadcastRoster()
      persist()
    }
    if (unseatedPeers.delete(peerId)) {
      notifyUnseatedChange()
    }
  }

  secretMessage.onMessage = (data, { peerId }) => {
    const seatEntry = seats.find((p) => p.peerId === peerId)
    const msg = { peerId, name: seatEntry?.name ?? 'Unknown player', text: data.text, ts: data.ts }
    messageListeners.forEach((cb) => cb(msg))
  }

  nightActionResponse.onMessage = (data, { peerId }) => {
    const seatEntry = seats.find((p) => p.peerId === peerId)
    if (!seatEntry) return
    const response = {
      peerId,
      seat: seatEntry.seat,
      forTs: data.forTs,
      chosenPeerId: data.chosenPeerId,
      chosenCharacterId: data.chosenCharacterId,
      ts: data.ts,
    }
    nightActionResponseListeners.forEach((cb) => cb(response))
  }

  return {
    selfId,
    leave() {
      room.leave()
      clearHostState(roomCode)
    },
    sendToPlayer(peerId, text) {
      secretMessage.send({ text, ts: Date.now() }, { target: peerId })
    },
    onRosterChange(cb) {
      rosterListeners.add(cb)
    },
    onPlayerMessage(cb) {
      messageListeners.add(cb)
    },

    getSeats() {
      return [...seats]
    },
    addSeat() {
      seats.push({ seat: nextSeatNumber(), name: `Seat ${seats.length + 1}`, peerId: null, alive: true, voteToken: true })
      broadcastRoster()
      persist()
    },
    removeSeat(seat) {
      const index = seats.findIndex((p) => p.seat === seat)
      if (index === -1) return
      seats.splice(index, 1)
      delete characterAssignments[seat]
      broadcastRoster()
      persist()
    },
    renameSeat(seat, name) {
      const seatEntry = seats.find((p) => p.seat === seat)
      if (!seatEntry) return
      seatEntry.name = name
      broadcastRoster()
      persist()
    },
    swapSeats(seatA, seatB) {
      const a = seats.find((p) => p.seat === seatA)
      const b = seats.find((p) => p.seat === seatB)
      if (!a || !b) return

      const aData = { name: a.name, peerId: a.peerId, alive: a.alive, voteToken: a.voteToken }
      const bData = { name: b.name, peerId: b.peerId, alive: b.alive, voteToken: b.voteToken }
      Object.assign(a, bData)
      Object.assign(b, aData)

      const aChar = characterAssignments[seatA]
      const bChar = characterAssignments[seatB]
      if (bChar !== undefined) characterAssignments[seatA] = bChar
      else delete characterAssignments[seatA]
      if (aChar !== undefined) characterAssignments[seatB] = aChar
      else delete characterAssignments[seatB]

      for (const token of Object.keys(reconnectTokenToSeat)) {
        if (reconnectTokenToSeat[token] === seatA) reconnectTokenToSeat[token] = seatB
        else if (reconnectTokenToSeat[token] === seatB) reconnectTokenToSeat[token] = seatA
      }

      broadcastRoster()
      persist()
    },
    setAlive(seat, alive) {
      const seatEntry = seats.find((p) => p.seat === seat)
      if (!seatEntry) return
      seatEntry.alive = alive
      broadcastRoster()
      persist()
    },
    setVoteToken(seat, voteToken) {
      const seatEntry = seats.find((p) => p.seat === seat)
      if (!seatEntry) return
      seatEntry.voteToken = voteToken
      broadcastRoster()
      persist()
    },

    getUnseatedPeers() {
      return getUnseatedList()
    },
    onUnseatedChange(cb) {
      unseatedListeners.add(cb)
    },
    assignPeerToSeat(peerId, seat) {
      const pending = unseatedPeers.get(peerId)
      const seatEntry = seats.find((p) => p.seat === seat)
      if (!pending || !seatEntry || seatEntry.peerId !== null) return

      seatEntry.peerId = peerId
      seatEntry.name = pending.name
      reconnectTokenToSeat[pending.reconnectToken] = seat
      unseatedPeers.delete(peerId)

      broadcastRoster()
      persist()
      notifyUnseatedChange()
      const characterId = characterAssignments[seat] ?? null
      characterAssign.send({ characterId, ts: Date.now() }, { target: peerId })
    },

    getScriptId() {
      return scriptId
    },
    setScriptId(id) {
      scriptId = id
      broadcastRoster()
      persist()
    },

    assignCharacter(seat, characterId) {
      if (characterId) characterAssignments[seat] = characterId
      else delete characterAssignments[seat]
      persist()
      const seatEntry = seats.find((p) => p.seat === seat)
      if (seatEntry?.peerId) {
        characterAssign.send({ characterId, ts: Date.now() }, { target: seatEntry.peerId })
      }
    },
    getCharacterAssignment(seat) {
      return characterAssignments[seat]
    },

    sendNightCard(seat, elements) {
      const seatEntry = seats.find((p) => p.seat === seat)
      if (!seatEntry?.peerId) return
      const ts = Date.now()
      nightCard.send({ elements, ts }, { target: seatEntry.peerId })
      auditLog.push({ ts, seat, name: seatEntry.name, summary: summarizeElements(elements) })
      persist()
      auditLogListeners.forEach((cb) => cb([...auditLog]))
    },
    onNightActionResponse(cb) {
      nightActionResponseListeners.add(cb)
    },

    getAuditLog() {
      return [...auditLog]
    },
    onAuditLogChange(cb) {
      auditLogListeners.add(cb)
    },

    getNote() {
      return note
    },
    setNote(newNote) {
      note = newNote
      persist()
    },
  }
}

export function joinPlayerRoom(roomCode: string, initialName: string): PlayerRoomHandle {
  const room = joinRoom({ appId: APP_ID, password: roomCode }, roomCode)
  const reconnectToken = getOrCreatePlayerToken(roomCode)

  const hello = room.makeAction<HelloPayload>(ACTIONS.HELLO)
  const roster = room.makeAction<RosterPayload>(ACTIONS.ROSTER)
  const secretMessage = room.makeAction<SecretMessagePayload>(ACTIONS.SECRET_MESSAGE)
  const characterAssign = room.makeAction<CharacterAssignPayload>(ACTIONS.CHARACTER_ASSIGN)
  const nightCard = room.makeAction<NightCardPayload>(ACTIONS.NIGHT_CARD)
  const nightActionResponse = room.makeAction<NightActionResponsePayload>(ACTIONS.NIGHT_ACTION_RESPONSE)

  let name = initialName
  let storytellerId: string | null = null
  // Sets rather than single callbacks for the same reason as the host side —
  // each tab panel re-subscribes on activation, so a single slot would drop
  // events meant for a panel that isn't currently on screen.
  const rosterListeners = new Set<(players: PlayerInfo[], storytellerId: string, scriptId: string) => void>()
  const messageListeners = new Set<(msg: { text: string; ts: number }) => void>()
  const storytellerLeaveListeners = new Set<() => void>()
  const characterListeners = new Set<(characterId: string | null) => void>()
  const nightCardListeners = new Set<(card: { elements: NightCardElement[]; ts: number }) => void>()

  // A joining player can't yet tell which peer is the Storyteller (the mesh connects
  // to every existing peer, not just the ST), so `hello` is sent to each one as its
  // connection comes up. Harmless: nobody but the ST has a `hello.onMessage` handler.
  // This also fires again whenever the Storyteller's tab reloads (their old peer
  // leaves, their new session joins as a "new" peer), which is what lets a
  // Storyteller-side reload recover without Players doing anything.
  room.onPeerJoin = (peerId) => {
    hello.send({ name, reconnectToken }, { target: peerId })
  }

  room.onPeerLeave = (peerId) => {
    if (peerId === storytellerId) {
      storytellerLeaveListeners.forEach((cb) => cb())
    }
  }

  roster.onMessage = (data) => {
    storytellerId = data.storytellerId
    rosterListeners.forEach((cb) => cb(data.players, data.storytellerId, data.scriptId))
  }

  secretMessage.onMessage = (data) => {
    messageListeners.forEach((cb) => cb({ text: data.text, ts: data.ts }))
  }

  characterAssign.onMessage = (data) => {
    characterListeners.forEach((cb) => cb(data.characterId))
  }

  nightCard.onMessage = (data) => {
    nightCardListeners.forEach((cb) => cb({ elements: data.elements, ts: data.ts }))
  }

  return {
    selfId,
    leave() {
      room.leave()
    },
    updateName(newName) {
      name = newName
      if (storytellerId) {
        hello.send({ name, reconnectToken }, { target: storytellerId })
      }
    },
    sendToStoryteller(text) {
      if (!storytellerId) return
      secretMessage.send({ text, ts: Date.now() }, { target: storytellerId })
    },
    respondToNightCard(forTs, response) {
      if (!storytellerId) return
      nightActionResponse.send(
        {
          forTs,
          chosenPeerId: response.chosenPeerId ?? null,
          chosenCharacterId: response.chosenCharacterId ?? null,
          ts: Date.now(),
        },
        { target: storytellerId },
      )
    },
    onRosterChange(cb) {
      rosterListeners.add(cb)
    },
    onStorytellerMessage(cb) {
      messageListeners.add(cb)
    },
    onStorytellerLeave(cb) {
      storytellerLeaveListeners.add(cb)
    },
    onCharacterAssign(cb) {
      characterListeners.add(cb)
    },
    onNightCard(cb) {
      nightCardListeners.add(cb)
    },
  }
}
