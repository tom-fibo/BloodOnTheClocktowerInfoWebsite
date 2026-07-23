import { el } from '../../ui/dom'
import type { HostRoomHandle } from '../../trystero/room'
import { getCharacter } from '../../data/characters'
import { attachCharacterTrigger } from '../../ui/character-popup'
import { openModal, closeModal } from '../../ui/modal'
import { layoutInCircle } from '../../ui/circular-layout'
import { deriveNightOrder } from '../../game/night-order'
import { nightCardElement } from '../../game/night-card'
import { buildSeatModalContent, type SeatMessage } from './seat-modal'
import { openSetupModal } from './setup-modal'
import type { NightCardElement, PlayerInfo } from '../../types'

export function renderGrimoirePanel(
  container: HTMLElement,
  handle: HostRoomHandle,
  messagesBySeat: Map<number, SeatMessage[]>,
): void {
  let activeSeat: number | null = null
  let composerElements: NightCardElement[] = []
  let pickingPlayer = false
  let isFirstNight = true

  const pinnedBanner = el('p', { className: 'grimoire-pinned-note hidden' })
  const pickingBanner = el('div', { className: 'picking-banner hidden' }, [
    el('span', { textContent: 'Tap a seat to add it as a Player…' }),
    el('button', {
      className: 'secondary',
      textContent: 'Cancel',
      onclick: () => {
        pickingPlayer = false
        pickingBanner.classList.add('hidden')
        refreshTokenGrid()
        openSeatFor(activeSeat, false)
      },
    }),
  ])
  const circleContainer = el('div', { className: 'seat-circle' })
  const nightOrderList = el('ol', { className: 'night-order-list' })
  const auditLogList = el('ul', { className: 'audit-log-list' })
  const notesInput = el('textarea', {
    className: 'grimoire-notes-input',
    rows: 3,
    placeholder: 'Private notes (first line can be pinned above)…',
  })

  function seats(): PlayerInfo[] {
    return [...handle.getSeats()].sort((a, b) => a.seat - b.seat)
  }

  function characterIdsInPlay(): string[] {
    return seats()
      .map((seat) => handle.getCharacterAssignment(seat.seat))
      .filter((id): id is string => Boolean(id))
  }

  function refreshPinnedNote(): void {
    const note = handle.getNote()
    const firstLine = note.split('\n')[0]?.trim()
    pinnedBanner.textContent = firstLine ?? ''
    pinnedBanner.classList.toggle('hidden', !firstLine)
  }

  function openSeatFor(seatNumber: number | null, resetComposer: boolean): void {
    if (seatNumber === null) return
    activeSeat = seatNumber
    if (resetComposer) composerElements = []
    const seat = seats().find((s) => s.seat === seatNumber)
    if (!seat) {
      activeSeat = null
      return
    }
    const seatMessages = messagesBySeat.get(seatNumber) ?? []
    messagesBySeat.set(seatNumber, seatMessages)
    const content = buildSeatModalContent(handle, seat, composerElements, seatMessages, {
      onUpdate: () => {
        refreshTokenGrid()
        refreshAuditLog()
        // Not a no-op guard for its own sake — onDismiss (called first by
        // whichever action ends the interaction: remove seat, send card, ✕,
        // backdrop click) already nulled activeSeat in those cases, so this
        // correctly skips reopening a modal the user just closed.
        if (activeSeat !== null) openSeatFor(activeSeat, false)
      },
      onComposerChange: () => openSeatFor(activeSeat, false),
      onPickPlayer: () => {
        pickingPlayer = true
        closeModal()
        pickingBanner.classList.remove('hidden')
        refreshTokenGrid()
      },
      onDismiss: () => {
        activeSeat = null
      },
    })
    openModal(content, 'seat-modal-overlay', () => {
      activeSeat = null
    })
  }

  function refreshTokenGrid(): void {
    const tokens = seats().map((seat) => {
      const characterId = handle.getCharacterAssignment(seat.seat)
      const character = characterId ? getCharacter(characterId) : undefined
      return el(
        'button',
        {
          className: [
            'seat-token',
            !seat.alive ? 'dead' : '',
            activeSeat === seat.seat ? 'selected' : '',
            seat.peerId === null ? 'disconnected' : '',
            pickingPlayer ? 'pickable' : '',
          ]
            .filter(Boolean)
            .join(' '),
          onclick: () => {
            if (pickingPlayer) {
              composerElements.push(nightCardElement('player', { name: seat.name, peerId: seat.peerId }))
              pickingPlayer = false
              pickingBanner.classList.add('hidden')
              refreshTokenGrid()
              openSeatFor(activeSeat, false)
              return
            }
            openSeatFor(seat.seat, true)
          },
        },
        [
          character?.tokenUrl
            ? el('img', { className: 'seat-token-image', src: character.tokenUrl, alt: character.name })
            : el('div', { className: 'seat-token-image placeholder', textContent: seat.name.slice(0, 1).toUpperCase() }),
          el('span', { className: 'seat-token-name', textContent: seat.name }),
          ...(character ? [el('span', { className: 'seat-token-character', textContent: character.name })] : []),
          ...(!seat.alive ? [el('span', { className: 'shroud-icon', textContent: '🪦' })] : []),
        ],
      )
    })
    circleContainer.replaceChildren(...tokens)
    layoutInCircle(circleContainer)
  }

  function refreshNightOrder(): void {
    const steps = deriveNightOrder(characterIdsInPlay(), isFirstNight)
    nightOrderList.replaceChildren(
      ...(steps.length
        ? steps.map((step) => {
            const item = el('li', {}, [
              el('strong', { textContent: step.label }),
              ...(step.detail ? [el('p', { textContent: step.detail })] : []),
            ])
            if (step.character) attachCharacterTrigger(item, step.character.id)
            return item
          })
        : [el('li', { className: 'roster-empty', textContent: 'Assign characters to seats to see the night order.' })]),
    )
  }

  function refreshAuditLog(): void {
    const log = [...handle.getAuditLog()].reverse()
    auditLogList.replaceChildren(
      ...(log.length
        ? log.map((entry) =>
            el('li', {}, [
              el('span', {
                className: 'audit-log-time',
                textContent: new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              }),
              el('span', { className: 'audit-log-seat', textContent: entry.name }),
              el('span', { className: 'audit-log-summary', textContent: entry.summary }),
            ]),
          )
        : [el('li', { className: 'roster-empty', textContent: 'No cards sent yet.' })]),
    )
  }

  const firstNightButton = el('button', {
    className: 'primary',
    textContent: 'First night',
    onclick: () => {
      isFirstNight = true
      refreshNightOrder()
      refreshHeaderButtons()
    },
  })
  const otherNightsButton = el('button', {
    className: 'secondary',
    textContent: 'Other nights',
    onclick: () => {
      isFirstNight = false
      refreshNightOrder()
      refreshHeaderButtons()
    },
  })
  function refreshHeaderButtons(): void {
    firstNightButton.className = isFirstNight ? 'primary' : 'secondary'
    otherNightsButton.className = isFirstNight ? 'secondary' : 'primary'
  }

  container.replaceChildren(
    el('div', { className: 'grimoire-layout' }, [
      el('div', { className: 'grimoire-main' }, [
        pinnedBanner,
        pickingBanner,
        el('div', { className: 'grimoire-tokens-header' }, [
          el('h2', { textContent: 'Grimoire' }),
          el('div', { className: 'button-row' }, [
            el('button', { className: 'secondary', textContent: '+ Add seat', onclick: () => { handle.addSeat(); refreshTokenGrid() } }),
            el('button', { className: 'secondary', textContent: 'Setup', onclick: () => openSetupModal(handle, () => { refreshTokenGrid(); refreshNightOrder() }) }),
          ]),
        ]),
        circleContainer,
        el('div', { className: 'grimoire-notes' }, [el('h2', { textContent: 'Notes' }), notesInput]),
        el('div', { className: 'grimoire-audit-log' }, [el('h2', { textContent: 'Sent cards (Storyteller only)' }), auditLogList]),
      ]),
      el('div', { className: 'grimoire-sidebar' }, [
        el('div', { className: 'night-order-header' }, [
          el('h2', { textContent: 'Night order' }),
          el('div', { className: 'button-row' }, [firstNightButton, otherNightsButton]),
        ]),
        nightOrderList,
      ]),
    ]),
  )

  notesInput.value = handle.getNote()
  notesInput.addEventListener('input', () => {
    handle.setNote(notesInput.value)
    refreshPinnedNote()
  })

  handle.onRosterChange(() => {
    refreshTokenGrid()
    refreshNightOrder()
  })
  handle.onUnseatedChange(() => {
    // A vacant seat's modal shows the unseated pool — refresh it live if open.
    if (activeSeat !== null) openSeatFor(activeSeat, false)
  })
  handle.onAuditLogChange(refreshAuditLog)
  // The map itself is populated by a persistent subscription up in
  // host-room/index.ts (so messages aren't lost while a different tab is
  // active) — this one just refreshes the modal if it's open for that seat.
  handle.onPlayerMessage((msg) => {
    const seatEntry = seats().find((s) => s.peerId === msg.peerId)
    if (seatEntry && activeSeat === seatEntry.seat) openSeatFor(activeSeat, false)
  })

  refreshPinnedNote()
  refreshTokenGrid()
  refreshNightOrder()
  refreshAuditLog()
}
