import { joinRoom, selfId } from 'trystero'
import { APP_ID, ACTIONS } from './config'
import type { HelloPayload, RosterPayload, SecretMessagePayload, PlayerInfo } from '../types'

export interface HostRoomHandle {
  selfId: string
  leave(): void
  sendToPlayer(peerId: string, text: string): void
  onRosterChange(cb: (roster: PlayerInfo[]) => void): void
  onPlayerMessage(cb: (msg: { peerId: string; name: string; text: string; ts: number }) => void): void
}

export interface PlayerRoomHandle {
  selfId: string
  leave(): void
  updateName(name: string): void
  sendToStoryteller(text: string): void
  onRosterChange(cb: (players: PlayerInfo[], storytellerId: string) => void): void
  onStorytellerMessage(cb: (msg: { text: string; ts: number }) => void): void
  onStorytellerLeave(cb: () => void): void
}

export function createHostRoom(roomCode: string): HostRoomHandle {
  const room = joinRoom({ appId: APP_ID, password: roomCode }, roomCode)

  const hello = room.makeAction<HelloPayload>(ACTIONS.HELLO)
  const roster = room.makeAction<RosterPayload>(ACTIONS.ROSTER)
  const secretMessage = room.makeAction<SecretMessagePayload>(ACTIONS.SECRET_MESSAGE)

  const players: PlayerInfo[] = []
  let rosterListener: ((roster: PlayerInfo[]) => void) | null = null
  let messageListener: ((msg: { peerId: string; name: string; text: string; ts: number }) => void) | null = null

  function broadcastRoster(): void {
    const payload: RosterPayload = { storytellerId: selfId, players: [...players] }
    roster.send(payload)
    rosterListener?.(payload.players)
  }

  // A player's connection is only proven open once we've received something over it,
  // so the roster is rebuilt reactively from `hello` rather than from onPeerJoin.
  hello.onMessage = (data, { peerId }) => {
    const existing = players.find((p) => p.peerId === peerId)
    if (existing) {
      existing.name = data.name
    } else {
      players.push({ peerId, name: data.name })
    }
    broadcastRoster()
  }

  room.onPeerLeave = (peerId) => {
    const index = players.findIndex((p) => p.peerId === peerId)
    if (index !== -1) {
      players.splice(index, 1)
      broadcastRoster()
    }
  }

  secretMessage.onMessage = (data, { peerId }) => {
    const player = players.find((p) => p.peerId === peerId)
    messageListener?.({ peerId, name: player?.name ?? 'Unknown player', text: data.text, ts: data.ts })
  }

  return {
    selfId,
    leave() {
      room.leave()
    },
    sendToPlayer(peerId, text) {
      secretMessage.send({ text, ts: Date.now() }, { target: peerId })
    },
    onRosterChange(cb) {
      rosterListener = cb
    },
    onPlayerMessage(cb) {
      messageListener = cb
    },
  }
}

export function joinPlayerRoom(roomCode: string, initialName: string): PlayerRoomHandle {
  const room = joinRoom({ appId: APP_ID, password: roomCode }, roomCode)

  const hello = room.makeAction<HelloPayload>(ACTIONS.HELLO)
  const roster = room.makeAction<RosterPayload>(ACTIONS.ROSTER)
  const secretMessage = room.makeAction<SecretMessagePayload>(ACTIONS.SECRET_MESSAGE)

  let name = initialName
  let storytellerId: string | null = null
  let rosterListener: ((players: PlayerInfo[], storytellerId: string) => void) | null = null
  let messageListener: ((msg: { text: string; ts: number }) => void) | null = null
  let storytellerLeaveListener: (() => void) | null = null

  // A joining player can't yet tell which peer is the Storyteller (the mesh connects
  // to every existing peer, not just the ST), so `hello` is sent to each one as its
  // connection comes up. Harmless: nobody but the ST has a `hello.onMessage` handler.
  room.onPeerJoin = (peerId) => {
    hello.send({ name }, { target: peerId })
  }

  room.onPeerLeave = (peerId) => {
    if (peerId === storytellerId) {
      storytellerLeaveListener?.()
    }
  }

  roster.onMessage = (data) => {
    storytellerId = data.storytellerId
    rosterListener?.(data.players, data.storytellerId)
  }

  secretMessage.onMessage = (data) => {
    messageListener?.({ text: data.text, ts: data.ts })
  }

  return {
    selfId,
    leave() {
      room.leave()
    },
    updateName(newName) {
      name = newName
      if (storytellerId) {
        hello.send({ name }, { target: storytellerId })
      }
    },
    sendToStoryteller(text) {
      if (!storytellerId) return
      secretMessage.send({ text, ts: Date.now() }, { target: storytellerId })
    },
    onRosterChange(cb) {
      rosterListener = cb
    },
    onStorytellerMessage(cb) {
      messageListener = cb
    },
    onStorytellerLeave(cb) {
      storytellerLeaveListener = cb
    },
  }
}
