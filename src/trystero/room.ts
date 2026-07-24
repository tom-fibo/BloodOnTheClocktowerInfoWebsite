import { joinRoom, selfId } from 'trystero'
import { APP_ID, ACTIONS } from './config'
import { DEFAULT_SCRIPT_ID } from '../data/scripts'
import { getOrCreatePlayerToken } from '../utils/reconnect-token'
import { loadHostState, saveHostState, clearHostState } from '../utils/host-persistence'
import type {
  HelloPayload,
  RosterPayload,
  CharacterAssignPayload,
  NightCardPayload,
  NightCardElement,
  PlayerInfo,
  SeatMessage,
} from '../types'

export interface UnseatedPeer {
  peerId: string
  name: string
}

export interface HostRoomHandle {
  selfId: string
  leave(): void
  onRosterChange(cb: (seats: PlayerInfo[]) => void): void

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

  // Sending a card also appends it to that seat's message log below — there is
  // no separate global "sent cards" record anymore. Works even if the seat is
  // currently disconnected: the card is queued and delivered once that seat's
  // occupant reconnects (see the `hello.onMessage` reclaim path).
  sendNightCard(seat: number, elements: NightCardElement[]): void
  // A seat with no device currently connected — sendNightCard still works, but
  // the seat-modal warns the Storyteller and styles the Send button
  // accordingly, since the card won't arrive until that player's device wakes up.
  isSeatConnected(seat: number): boolean

  getNote(): string
  setNote(note: string): void

  // Private per-seat reminder (e.g. "protected by Monk") — Storyteller-only
  // recall aid, never sent to the player. Distinct from the general `note`.
  getSeatNote(seat: number): string
  setSeatNote(seat: number, note: string): void

  // Per-seat log of exchanged cards (sent night cards + unprompted Player
  // cards) — "attached to the seat," persisted, and restored across both a
  // Player reconnect and a Storyteller reload.
  getSeatMessages(seat: number): SeatMessage[]
  // A Player composing their own unprompted card (a "Got it," a chosen
  // player, custom text, or a queue of several) arrived — fires only for
  // *incoming* cards, so panels know to live-refresh; the log itself is
  // always read via getSeatMessages().
  onPlayerCard(cb: (card: { peerId: string; seat: number; elements: NightCardElement[]; ts: number }) => void): void

  // Seats with an incoming card the Storyteller hasn't opened yet — drives
  // the Grimoire's unread-dot indicator.
  getUnreadSeats(): number[]
  markSeatRead(seat: number): void
  onUnreadChange(cb: (unreadSeats: number[]) => void): void
}

export interface PlayerRoomHandle {
  selfId: string
  leave(): void
  updateName(name: string): void
  sendPlayerCard(elements: NightCardElement[]): void
  onRosterChange(cb: (players: PlayerInfo[], storytellerId: string, scriptId: string) => void): void
  onStorytellerLeave(cb: () => void): void
  onCharacterAssign(cb: (characterId: string | null) => void): void
  onNightCard(cb: (card: { elements: NightCardElement[]; ts: number }) => void): void
}

export function createHostRoom(roomCode: string): HostRoomHandle {
  const room = joinRoom({ appId: APP_ID, password: roomCode }, roomCode)

  const hello = room.makeAction<HelloPayload>(ACTIONS.HELLO)
  const roster = room.makeAction<RosterPayload>(ACTIONS.ROSTER)
  const characterAssign = room.makeAction<CharacterAssignPayload>(ACTIONS.CHARACTER_ASSIGN)
  const nightCard = room.makeAction<NightCardPayload>(ACTIONS.NIGHT_CARD)
  const playerCard = room.makeAction<NightCardPayload>(ACTIONS.PLAYER_CARD)

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
  let note = restored?.note ?? ''
  const seatNotes: Record<number, string> = restored?.seatNotes ?? {}
  const seatMessages: Record<number, SeatMessage[]> = restored?.seatMessages ?? {}
  const unreadSeats = new Set<number>(restored?.unreadSeats ?? [])
  const pendingCards: Record<number, NightCardPayload[]> = restored?.pendingCards ?? {}

  // Connected-but-not-yet-placed devices. Not persisted: after a Storyteller
  // reload, every peerId here would be stale anyway (fresh Trystero session),
  // so it's simplest to let it rebuild fresh from the `hello`s that follow.
  const unseatedPeers = new Map<string, { name: string; reconnectToken: string }>()

  // Sets, not single nullable callbacks: every tab panel re-subscribes each time
  // it's activated (host-room/index.ts recreates panels on tab switch), so a
  // single-slot callback would silently drop events for whichever panel isn't
  // currently on screen — e.g. a player card arriving while the Storyteller
  // is looking at the Script tab, not the Grimoire.
  const rosterListeners = new Set<(seats: PlayerInfo[]) => void>()
  const unseatedListeners = new Set<(peers: UnseatedPeer[]) => void>()
  const playerCardListeners = new Set<Parameters<HostRoomHandle['onPlayerCard']>[0]>()
  const unreadListeners = new Set<(unreadSeats: number[]) => void>()

  function getUnseatedList(): UnseatedPeer[] {
    return [...unseatedPeers.entries()].map(([peerId, { name }]) => ({ peerId, name }))
  }

  function notifyUnseatedChange(): void {
    const list = getUnseatedList()
    unseatedListeners.forEach((cb) => cb(list))
  }

  function notifyUnreadChange(): void {
    const list = [...unreadSeats]
    unreadListeners.forEach((cb) => cb(list))
  }

  function persist(): void {
    saveHostState(roomCode, {
      seats,
      scriptId,
      characterAssignments,
      reconnectTokenToSeat,
      note,
      seatNotes,
      seatMessages,
      unreadSeats: [...unreadSeats],
      pendingCards,
    })
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
      const characterId = characterAssignments[seatEntry.seat] ?? null
      characterAssign.send({ characterId, ts: Date.now() }, { target: peerId })

      // Deliver anything the Storyteller sent while this seat's device was
      // asleep/disconnected — queued in order, oldest first.
      const queued = pendingCards[seatEntry.seat]
      if (queued?.length) {
        for (const card of queued) nightCard.send(card, { target: peerId })
        delete pendingCards[seatEntry.seat]
      }
      persist()
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

  playerCard.onMessage = (data, { peerId }) => {
    const seatEntry = seats.find((p) => p.peerId === peerId)
    if (!seatEntry) return
    const log = seatMessages[seatEntry.seat] ?? []
    log.push({ ts: data.ts, self: false, elements: data.elements })
    seatMessages[seatEntry.seat] = log
    unreadSeats.add(seatEntry.seat)
    persist()
    notifyUnreadChange()
    playerCardListeners.forEach((cb) => cb({ peerId, seat: seatEntry.seat, elements: data.elements, ts: data.ts }))
  }

  return {
    selfId,
    leave() {
      room.leave()
      clearHostState(roomCode)
    },
    onRosterChange(cb) {
      rosterListeners.add(cb)
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
      delete seatNotes[seat]
      delete seatMessages[seat]
      delete pendingCards[seat]
      unreadSeats.delete(seat)
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

      const aNote = seatNotes[seatA]
      const bNote = seatNotes[seatB]
      if (bNote !== undefined) seatNotes[seatA] = bNote
      else delete seatNotes[seatA]
      if (aNote !== undefined) seatNotes[seatB] = aNote
      else delete seatNotes[seatB]

      const aMessages = seatMessages[seatA]
      const bMessages = seatMessages[seatB]
      if (bMessages !== undefined) seatMessages[seatA] = bMessages
      else delete seatMessages[seatA]
      if (aMessages !== undefined) seatMessages[seatB] = aMessages
      else delete seatMessages[seatB]

      const aPending = pendingCards[seatA]
      const bPending = pendingCards[seatB]
      if (bPending !== undefined) pendingCards[seatA] = bPending
      else delete pendingCards[seatA]
      if (aPending !== undefined) pendingCards[seatB] = aPending
      else delete pendingCards[seatB]

      const aUnread = unreadSeats.has(seatA)
      const bUnread = unreadSeats.has(seatB)
      unreadSeats.delete(seatA)
      unreadSeats.delete(seatB)
      if (bUnread) unreadSeats.add(seatA)
      if (aUnread) unreadSeats.add(seatB)

      for (const token of Object.keys(reconnectTokenToSeat)) {
        if (reconnectTokenToSeat[token] === seatA) reconnectTokenToSeat[token] = seatB
        else if (reconnectTokenToSeat[token] === seatB) reconnectTokenToSeat[token] = seatA
      }

      broadcastRoster()
      persist()
      notifyUnreadChange()
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
      if (!seatEntry) return
      const ts = Date.now()
      const payload: NightCardPayload = { elements, ts }
      if (seatEntry.peerId) {
        nightCard.send(payload, { target: seatEntry.peerId })
      } else {
        // Seat's device isn't connected right now — queue it for delivery once
        // `hello.onMessage` sees that seat reconnect, rather than dropping it.
        const queue = pendingCards[seat] ?? []
        queue.push(payload)
        pendingCards[seat] = queue
      }
      const log = seatMessages[seat] ?? []
      log.push({ ts, self: true, elements })
      seatMessages[seat] = log
      persist()
    },
    isSeatConnected(seat) {
      const seatEntry = seats.find((p) => p.seat === seat)
      return seatEntry !== undefined && seatEntry.peerId !== null
    },

    getNote() {
      return note
    },
    setNote(newNote) {
      note = newNote
      persist()
    },

    getSeatNote(seat) {
      return seatNotes[seat] ?? ''
    },
    setSeatNote(seat, seatNote) {
      if (seatNote) seatNotes[seat] = seatNote
      else delete seatNotes[seat]
      persist()
    },

    getSeatMessages(seat) {
      return [...(seatMessages[seat] ?? [])]
    },
    onPlayerCard(cb) {
      playerCardListeners.add(cb)
    },

    getUnreadSeats() {
      return [...unreadSeats]
    },
    markSeatRead(seat) {
      if (!unreadSeats.delete(seat)) return
      persist()
      notifyUnreadChange()
    },
    onUnreadChange(cb) {
      unreadListeners.add(cb)
    },
  }
}

export function joinPlayerRoom(roomCode: string, initialName: string): PlayerRoomHandle {
  const room = joinRoom({ appId: APP_ID, password: roomCode }, roomCode)
  const reconnectToken = getOrCreatePlayerToken(roomCode)

  const hello = room.makeAction<HelloPayload>(ACTIONS.HELLO)
  const roster = room.makeAction<RosterPayload>(ACTIONS.ROSTER)
  const characterAssign = room.makeAction<CharacterAssignPayload>(ACTIONS.CHARACTER_ASSIGN)
  const nightCard = room.makeAction<NightCardPayload>(ACTIONS.NIGHT_CARD)
  const playerCard = room.makeAction<NightCardPayload>(ACTIONS.PLAYER_CARD)

  let name = initialName
  let storytellerId: string | null = null
  // Sets rather than single callbacks for the same reason as the host side —
  // each tab panel re-subscribes on activation, so a single slot would drop
  // events meant for a panel that isn't currently on screen.
  const rosterListeners = new Set<(players: PlayerInfo[], storytellerId: string, scriptId: string) => void>()
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
    sendPlayerCard(elements) {
      if (!storytellerId) return
      playerCard.send({ elements, ts: Date.now() }, { target: storytellerId })
    },
    onRosterChange(cb) {
      rosterListeners.add(cb)
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
