import { el } from '../../ui/dom'
import { closeModal } from '../../ui/modal'
import type { HostRoomHandle } from '../../trystero/room'
import { getCharacter } from '../../data/characters'
import { getScript } from '../../data/scripts'
import { openCharacterPicker } from '../../ui/character-picker'
import { openCharacterPopup } from '../../ui/character-popup'
import { nightCardElement } from '../../game/night-card'
import { shuffle } from '../../game/setup'
import type { NightCardElement, PlayerInfo } from '../../types'

export interface SeatModalCallbacks {
  // Seat data itself changed (rename/alive/vote/character/assign-peer) —
  // refresh the token grid and reopen the modal fresh, but only if it's still
  // meant to be open (the caller checks its own "is a modal active" state, so
  // this is a no-op after a dismiss/remove/send).
  onUpdate: () => void
  // Only the in-progress card composer changed — reopen the modal, no need to
  // touch the token grid.
  onComposerChange: () => void
  // "Player" was clicked in the composer — close this modal and let the
  // Storyteller tap any seat on the Grimoire to add it as a card element.
  onPickPlayer: () => void
  // The modal is being dismissed for good (✕, remove seat, or card sent) —
  // distinct from onUpdate because the caller must NOT reopen it afterward.
  onDismiss: () => void
}

// Messages and night cards are the same concept from the Storyteller's side
// too — this is a simple two-way text log scoped to one seat, replacing the
// old standalone "Messages" tab. Sent night cards themselves are tracked
// separately in the private audit log (grimoire-panel.ts), not duplicated here.
export interface SeatMessage {
  ts: number
  self: boolean
  text: string
}

function seatsWithCharacters(handle: HostRoomHandle): { seat: PlayerInfo; characterId: string }[] {
  return handle
    .getSeats()
    .map((seat) => ({ seat, characterId: handle.getCharacterAssignment(seat.seat) }))
    .filter((s): s is { seat: PlayerInfo; characterId: string } => Boolean(s.characterId))
}

function presetButton(label: string, onclick: () => void): HTMLButtonElement {
  return el('button', { className: 'preset-card-button', textContent: label, onclick })
}

function elementButton(label: string, onclick: () => void): HTMLButtonElement {
  return el('button', { className: 'element-quick-button', textContent: label, onclick })
}

function describeElement(element: NightCardElement): string {
  switch (element.kind) {
    case 'text':
      return element.text ?? ''
    case 'number':
      return `Number: ${element.value}`
    case 'player':
      return `Player: ${element.name}`
    case 'character':
      return `Character: ${getCharacter(element.characterId ?? '')?.name ?? element.characterId}`
    case 'characterChange':
      return `You are: ${getCharacter(element.characterId ?? '')?.name ?? element.characterId}`
    case 'choosePlayer':
      return `[Choose a player] ${element.prompt}`
    case 'chooseCharacter':
      return `[Choose a character] ${element.prompt}`
  }
}

function buildComposer(
  handle: HostRoomHandle,
  seat: PlayerInfo,
  composerElements: NightCardElement[],
  callbacks: SeatModalCallbacks,
): HTMLElement {
  const script = getScript(handle.getScriptId())

  const elementList = el(
    'ul',
    { className: 'composer-element-list' },
    composerElements.map((element, index) =>
      el('li', {}, [
        el('span', { textContent: describeElement(element) }),
        el('button', {
          className: 'remove-element-button',
          textContent: '✕',
          onclick: () => {
            composerElements.splice(index, 1)
            callbacks.onComposerChange()
          },
        }),
      ]),
    ),
  )

  const customInput = el('input', { className: 'composer-input', placeholder: 'Custom text…' })

  const quickButtons = el('div', { className: 'element-quick-grid' }, [
    elementButton('Got it', () => {
      composerElements.push(nightCardElement('text', { text: 'Got it' }))
      callbacks.onComposerChange()
    }),
    elementButton('Yes', () => {
      composerElements.push(nightCardElement('text', { text: 'Yes' }))
      callbacks.onComposerChange()
    }),
    elementButton('No', () => {
      composerElements.push(nightCardElement('text', { text: 'No' }))
      callbacks.onComposerChange()
    }),
    elementButton('Good', () => {
      composerElements.push(nightCardElement('text', { text: 'Good' }))
      callbacks.onComposerChange()
    }),
    elementButton('Evil', () => {
      composerElements.push(nightCardElement('text', { text: 'Evil' }))
      callbacks.onComposerChange()
    }),
    ...['Zero', 'One', 'Two', 'Three', 'Four', 'Five'].map((label, value) =>
      elementButton(label, () => {
        composerElements.push(nightCardElement('number', { value }))
        callbacks.onComposerChange()
      }),
    ),
    elementButton('Player', () => callbacks.onPickPlayer()),
    elementButton('Character', () => {
      if (!script) return
      openCharacterPicker(script, {
        title: 'Add a character to the card',
        onSelect: (characterId) => {
          if (!characterId) return
          composerElements.push(nightCardElement('character', { characterId }))
          callbacks.onComposerChange()
        },
      })
    }),
  ])

  const presetButtons = el('div', { className: 'preset-card-grid' }, [
    presetButton('Use your Ability?', () => {
      composerElements.push(nightCardElement('text', { text: 'Use your ability?' }))
      callbacks.onComposerChange()
    }),
    presetButton('Make a Choice', () => {
      composerElements.push(nightCardElement('choosePlayer', { prompt: 'Make your choice' }))
      callbacks.onComposerChange()
    }),
    presetButton('These characters are not in play', () => {
      if (!script) return
      const inPlay = new Set(seatsWithCharacters(handle).map((s) => s.characterId))
      const bluffs = shuffle(script.characterIds.filter((id) => !inPlay.has(id))).slice(0, 3)
      composerElements.push(nightCardElement('text', { text: 'These characters are not in play:' }))
      for (const id of bluffs) composerElements.push(nightCardElement('character', { characterId: id }))
      callbacks.onComposerChange()
    }),
    presetButton('This is the Demon', () => {
      const demon = seatsWithCharacters(handle).find((s) => getCharacter(s.characterId)?.type === 'demon')
      composerElements.push(nightCardElement('text', { text: 'This is the Demon:' }))
      if (demon) {
        composerElements.push(nightCardElement('player', { name: demon.seat.name, peerId: demon.seat.peerId }))
        composerElements.push(nightCardElement('character', { characterId: demon.characterId }))
      }
      callbacks.onComposerChange()
    }),
    presetButton('These are your Minions', () => {
      const minions = seatsWithCharacters(handle).filter((s) => getCharacter(s.characterId)?.type === 'minion')
      composerElements.push(nightCardElement('text', { text: 'These are your Minions:' }))
      for (const minion of minions) {
        composerElements.push(nightCardElement('player', { name: minion.seat.name, peerId: minion.seat.peerId }))
        composerElements.push(nightCardElement('character', { characterId: minion.characterId }))
      }
      callbacks.onComposerChange()
    }),
    presetButton('You are', () => {
      const currentCharacterId = handle.getCharacterAssignment(seat.seat) ?? null
      composerElements.push(nightCardElement('text', { text: 'You are:' }))
      if (currentCharacterId) {
        composerElements.push(nightCardElement('characterChange', { characterId: currentCharacterId }))
      }
      callbacks.onComposerChange()
    }),
    presetButton('This player is', () => {
      composerElements.push(nightCardElement('text', { text: 'This player is:' }))
      callbacks.onComposerChange()
    }),
    presetButton('This character selected you', () => {
      composerElements.push(nightCardElement('text', { text: 'This character selected you:' }))
      callbacks.onComposerChange()
    }),
  ])

  return el('div', { className: 'night-card-composer' }, [
    el('h3', { textContent: 'Night card' }),
    presetButtons,
    quickButtons,
    el('div', { className: 'composer-row' }, [
      customInput,
      el('button', {
        textContent: 'Add',
        onclick: () => {
          if (!customInput.value.trim()) return
          composerElements.push(nightCardElement('text', { text: customInput.value.trim() }))
          customInput.value = ''
          callbacks.onComposerChange()
        },
      }),
    ]),
    elementList,
    el('button', {
      className: 'primary send-card-button',
      textContent: `Send card (${composerElements.length})`,
      disabled: composerElements.length === 0,
      onclick: () => {
        if (composerElements.length === 0) return
        const characterChange = composerElements.find((e) => e.kind === 'characterChange')
        if (characterChange?.characterId) {
          handle.assignCharacter(seat.seat, characterChange.characterId)
        }
        handle.sendNightCard(seat.seat, composerElements)
        composerElements.length = 0
        closeModal()
        callbacks.onDismiss()
        callbacks.onUpdate()
      },
    }),
  ])
}

function buildMessageLog(
  handle: HostRoomHandle,
  seat: PlayerInfo,
  messageLog: SeatMessage[],
  callbacks: SeatModalCallbacks,
): HTMLElement {
  const logList = el(
    'ul',
    { className: 'audit-log-list seat-message-log' },
    messageLog.length
      ? messageLog.map((msg) =>
          el('li', {}, [
            el('span', { className: 'audit-log-time', textContent: new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }),
            el('span', { className: 'audit-log-seat', textContent: msg.self ? 'You' : seat.name }),
            el('span', { className: 'audit-log-summary', textContent: msg.text }),
          ]),
        )
      : [el('li', { className: 'roster-empty', textContent: 'No messages yet.' })],
  )

  const input = el('input', { className: 'composer-input', placeholder: 'Quick message…' })
  function send(): void {
    const text = input.value.trim()
    if (!text || !seat.peerId) return
    handle.sendToPlayer(seat.peerId, text)
    messageLog.push({ ts: Date.now(), self: true, text })
    input.value = ''
    callbacks.onComposerChange()
  }
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') send()
  })

  return el('div', { className: 'seat-messages' }, [
    el('h3', { textContent: 'Messages' }),
    logList,
    el('div', { className: 'composer-row' }, [input, el('button', { textContent: 'Send', onclick: send })]),
  ])
}

export function buildSeatModalContent(
  handle: HostRoomHandle,
  seat: PlayerInfo,
  composerElements: NightCardElement[],
  messageLog: SeatMessage[],
  callbacks: SeatModalCallbacks,
): HTMLElement {
  const characterId = handle.getCharacterAssignment(seat.seat)
  const nameInput = el('input', { className: 'seat-name-input', value: seat.name })
  const aliveCheckbox = el('input', { type: 'checkbox', checked: seat.alive })
  const voteCheckbox = el('input', { type: 'checkbox', checked: seat.voteToken })

  nameInput.addEventListener('change', () => {
    handle.renameSeat(seat.seat, nameInput.value.trim() || seat.name)
    callbacks.onUpdate()
  })
  aliveCheckbox.addEventListener('change', () => {
    handle.setAlive(seat.seat, aliveCheckbox.checked)
    callbacks.onUpdate()
  })
  voteCheckbox.addEventListener('change', () => handle.setVoteToken(seat.seat, voteCheckbox.checked))

  const characterRow = el('div', { className: 'seat-detail-row' }, [
    el('label', { textContent: 'Character:' }),
    el('button', {
      className: 'character-preview-button',
      textContent: characterId ? getCharacter(characterId)?.name ?? characterId : 'None',
      onclick: () => characterId && openCharacterPopup(characterId),
    }),
    el('button', {
      className: 'secondary',
      textContent: 'Change',
      onclick: () => {
        const script = getScript(handle.getScriptId())
        if (!script) return
        openCharacterPicker(script, {
          title: `Set character for ${seat.name}`,
          allowNone: true,
          onSelect: (id) => {
            handle.assignCharacter(seat.seat, id)
            callbacks.onUpdate()
          },
        })
      },
    }),
  ])

  const vacantSection =
    seat.peerId === null
      ? el('div', { className: 'seat-vacant-section' }, [
          el('h3', { textContent: 'Assign a connected player' }),
          (() => {
            const unseated = handle.getUnseatedPeers()
            if (unseated.length === 0) {
              return el('p', { className: 'roster-empty', textContent: 'No connected players waiting.' })
            }
            return el(
              'div',
              { className: 'unseated-list' },
              unseated.map((peer) =>
                el('button', {
                  className: 'secondary unseated-button',
                  textContent: peer.name,
                  onclick: () => {
                    handle.assignPeerToSeat(peer.peerId, seat.seat)
                    callbacks.onUpdate()
                  },
                }),
              ),
            )
          })(),
        ])
      : el('div')

  return el('div', { className: 'seat-modal-card' }, [
    el('button', {
      className: 'character-popup-close',
      textContent: '✕',
      onclick: () => {
        closeModal()
        callbacks.onDismiss()
      },
    }),
    el('div', { className: 'seat-detail-header' }, [
      nameInput,
      el('button', {
        className: 'danger',
        textContent: 'Remove seat',
        onclick: () => {
          handle.removeSeat(seat.seat)
          closeModal()
          callbacks.onDismiss()
          callbacks.onUpdate()
        },
      }),
    ]),
    el('p', {
      className: 'text-muted',
      textContent: seat.peerId === null ? 'No device connected to this seat.' : 'Connected.',
    }),
    vacantSection,
    el('div', { className: 'seat-detail-row' }, [
      el('label', {}, [aliveCheckbox, ' Alive']),
      el('label', {}, [voteCheckbox, ' Has vote token']),
    ]),
    characterRow,
    seat.peerId !== null ? buildMessageLog(handle, seat, messageLog, callbacks) : el('div'),
    seat.peerId !== null ? buildComposer(handle, seat, composerElements, callbacks) : el('div'),
  ])
}
