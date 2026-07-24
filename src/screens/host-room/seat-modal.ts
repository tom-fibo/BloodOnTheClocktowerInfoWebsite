import { el } from '../../ui/dom'
import { closeModal } from '../../ui/modal'
import type { HostRoomHandle } from '../../trystero/room'
import { getCharacter } from '../../data/characters'
import { getScript } from '../../data/scripts'
import { openCharacterPicker, openMultiCharacterPicker } from '../../ui/character-picker'
import { openCharacterPopup } from '../../ui/character-popup'
import { nightCardElement, describeNightCardElement } from '../../game/night-card'
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
        el('span', { textContent: describeNightCardElement(element) }),
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
      composerElements.push(nightCardElement('text', { text: 'Make a Choice' }))
      callbacks.onComposerChange()
    }),
    presetButton('These characters are not in play', () => {
      if (!script) return
      const inPlay = seatsWithCharacters(handle).map((s) => s.characterId)
      openMultiCharacterPicker(script, {
        title: 'Choose 3 characters not in play',
        count: 3,
        disabledIds: inPlay,
        onConfirm: (characterIds) => {
          composerElements.push(nightCardElement('text', { text: 'These characters are not in play:' }))
          for (const id of characterIds) composerElements.push(nightCardElement('character', { characterId: id }))
          callbacks.onComposerChange()
        },
      })
    }),
    presetButton('This is the Demon', () => {
      const demon = seatsWithCharacters(handle).find((s) => getCharacter(s.characterId)?.type === 'demon')
      composerElements.push(nightCardElement('text', { text: 'This is the Demon:' }))
      if (demon) {
        composerElements.push(nightCardElement('player', { name: demon.seat.name, peerId: demon.seat.peerId }))
      }
      callbacks.onComposerChange()
    }),
    presetButton('These are your Minions', () => {
      const minions = seatsWithCharacters(handle).filter((s) => getCharacter(s.characterId)?.type === 'minion')
      composerElements.push(nightCardElement('text', { text: 'These are your Minions:' }))
      for (const minion of minions) {
        composerElements.push(nightCardElement('player', { name: minion.seat.name, peerId: minion.seat.peerId }))
      }
      callbacks.onComposerChange()
    }),
    presetButton('You are', () => {
      const currentCharacterId = handle.getCharacterAssignment(seat.seat) ?? null
      const character = currentCharacterId ? getCharacter(currentCharacterId) : undefined
      // The "You are" text tells the player the following elements describe
      // themself (as opposed to e.g. a Demon/Minion reveal about someone
      // else) — the Good/Evil + Character elements after it are otherwise
      // identical to the plain Good/Evil/Character quick buttons, and remain
      // freely editable/removable like any other composer element. This
      // preset doesn't reassign the seat's character itself; use the
      // "Change" button in the Character row for that.
      if (character) {
        composerElements.push(nightCardElement('text', { text: 'You are' }))
        composerElements.push(nightCardElement('text', { text: character.alignment === 'good' ? 'Good' : 'Evil' }))
        composerElements.push(nightCardElement('character', { characterId: character.id }))
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
    // A disconnected seat can still receive a card — it's queued and delivered
    // once that player's device reconnects (e.g. asleep at night) — but the
    // Storyteller should clearly see that it won't arrive immediately.
    ...(!handle.isSeatConnected(seat.seat)
      ? [
          el('p', {
            className: 'send-warning-text',
            textContent: "This seat isn't connected — the card will be delivered once they reconnect.",
          }),
        ]
      : []),
    el('button', {
      className: `primary send-card-button${!handle.isSeatConnected(seat.seat) ? ' send-card-button-pending' : ''}`,
      textContent: handle.isSeatConnected(seat.seat)
        ? `Send card (${composerElements.length})`
        : `Queue card (${composerElements.length})`,
      disabled: composerElements.length === 0,
      onclick: () => {
        if (composerElements.length === 0) return
        handle.sendNightCard(seat.seat, composerElements)
        composerElements.length = 0
        closeModal()
        callbacks.onDismiss()
        callbacks.onUpdate()
      },
    }),
  ])
}

function buildMessageLog(handle: HostRoomHandle, seat: PlayerInfo): HTMLElement {
  const messages = [...handle.getSeatMessages(seat.seat)].reverse()
  const logList = el(
    'ul',
    { className: 'audit-log-list seat-message-log' },
    messages.length
      ? messages.map((msg) =>
          el('li', {}, [
            el('span', { className: 'audit-log-time', textContent: new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }),
            el('span', { className: 'audit-log-seat', textContent: msg.self ? 'You' : seat.name }),
            el('span', {
              className: 'audit-log-summary',
              textContent: msg.elements.map(describeNightCardElement).join(' · '),
            }),
          ]),
        )
      : [el('li', { className: 'roster-empty', textContent: 'No messages yet.' })],
  )

  return el('div', { className: 'seat-messages' }, [el('h3', { textContent: 'Messages' }), logList])
}

export function buildSeatModalContent(
  handle: HostRoomHandle,
  seat: PlayerInfo,
  composerElements: NightCardElement[],
  callbacks: SeatModalCallbacks,
): HTMLElement {
  const characterId = handle.getCharacterAssignment(seat.seat)
  const nameInput = el('input', { className: 'seat-name-input', value: seat.name })

  nameInput.addEventListener('change', () => {
    handle.renameSeat(seat.seat, nameInput.value.trim() || seat.name)
    callbacks.onUpdate()
  })

  const aliveToggle = el('button', {
    className: `toggle-button${seat.alive ? ' active' : ''}`,
    textContent: 'Alive',
    onclick: () => {
      handle.setAlive(seat.seat, !seat.alive)
      callbacks.onUpdate()
    },
  })
  const voteToggle = el('button', {
    className: `toggle-button${seat.voteToken ? ' active' : ''}`,
    textContent: 'Vote token',
    onclick: () => {
      handle.setVoteToken(seat.seat, !seat.voteToken)
      callbacks.onUpdate()
    },
  })
  // Storyteller-only: a private "will die tonight" mark, rendered on the
  // Grimoire as a gray slash rather than the full death shroud — see
  // "Reveal deaths" in grimoire-panel.ts for the public reveal step. Only
  // meaningful for a currently-alive seat.
  const diesTonightToggle = el('button', {
    className: `toggle-button${handle.getDiesTonight(seat.seat) ? ' active' : ''}`,
    textContent: 'Dies tonight',
    disabled: !seat.alive,
    onclick: () => {
      handle.setDiesTonight(seat.seat, !handle.getDiesTonight(seat.seat))
      callbacks.onUpdate()
    },
  })

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

  // Private, Storyteller-only reminder (e.g. "protected by Monk") — distinct
  // from the general notes textarea, and never sent to the player.
  const seatNoteInput = el('textarea', {
    className: 'seat-private-note-input',
    rows: 2,
    placeholder: 'Private reminder…',
    value: handle.getSeatNote(seat.seat),
  })
  seatNoteInput.addEventListener('input', () => handle.setSeatNote(seat.seat, seatNoteInput.value))

  const leftColumn = el('div', { className: 'seat-modal-left' }, [
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
    el('div', { className: 'seat-detail-row seat-toggle-row' }, [aliveToggle, voteToggle, diesTonightToggle]),
    characterRow,
    el('label', { textContent: 'Private reminder:' }),
    seatNoteInput,
    buildMessageLog(handle, seat),
  ])

  const rightColumn = el('div', { className: 'seat-modal-right' }, [buildComposer(handle, seat, composerElements, callbacks)])

  return el('div', { className: 'seat-modal-card' }, [
    el('button', {
      className: 'character-popup-close',
      textContent: '✕',
      onclick: () => {
        closeModal()
        callbacks.onDismiss()
      },
    }),
    el('div', { className: 'seat-modal-columns' }, [leftColumn, rightColumn]),
  ])
}
