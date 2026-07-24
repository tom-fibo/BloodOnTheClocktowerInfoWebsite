import { el } from '../../ui/dom'
import type { HostRoomHandle } from '../../trystero/room'
import { getCharacter } from '../../data/characters'
import { attachCharacterTrigger } from '../../ui/character-popup'
import { openModal, updateModalContent, closeModal } from '../../ui/modal'
import { layoutInCircle } from '../../ui/circular-layout'
import { deriveNightOrder } from '../../game/night-order'
import { nightCardElement } from '../../game/night-card'
import { renderTokenImage } from '../../ui/token-image'
import { buildSeatModalContent } from './seat-modal'
import { openSetupModal } from './setup-modal'
import { openLobbyModal } from './lobby-modal'
import type { NightCardElement, PlayerInfo } from '../../types'

export function renderGrimoirePanel(container: HTMLElement, handle: HostRoomHandle): void {
  let activeSeat: number | null = null
  let composerElements: NightCardElement[] = []
  let pickingPlayer = false
  let isFirstNight = true

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
  const notesInput = el('textarea', {
    className: 'grimoire-notes-input',
    rows: 3,
    placeholder: 'General private notes…',
  })

  function seats(): PlayerInfo[] {
    return [...handle.getSeats()].sort((a, b) => a.seat - b.seat)
  }

  function characterIdsInPlay(): string[] {
    return seats()
      .map((seat) => handle.getCharacterAssignment(seat.seat))
      .filter((id): id is string => Boolean(id))
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
    // Opening a seat is how the Storyteller "reads" whatever arrived for it.
    handle.markSeatRead(seatNumber)
    const content = buildSeatModalContent(handle, seat, composerElements, {
      onUpdate: () => {
        refreshTokenGrid()
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
    // A refresh (resetComposer false) updates the already-open modal's content
    // in place so its scroll position survives — recreating the overlay from
    // scratch on every composer click/checkbox toggle was resetting scroll to
    // the top each time. Falls back to a full open if nothing was open yet
    // (e.g. reopening after the "Player" picking flow closed it).
    if (resetComposer || !updateModalContent(content)) {
      openModal(content, 'seat-modal-overlay', () => {
        activeSeat = null
      })
    }
    refreshTokenGrid()
  }

  function refreshTokenGrid(): void {
    const unread = new Set(handle.getUnreadSeats())
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
          renderTokenImage(character?.tokenUrl, character ? character.name : seat.name),
          el('span', { className: 'seat-token-name', textContent: seat.name }),
          ...(character ? [el('span', { className: 'seat-token-character', textContent: character.name })] : []),
          ...(unread.has(seat.seat) ? [el('span', { className: 'unread-dot', title: 'Unread message' })] : []),
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
        el('div', { className: 'grimoire-tokens-header' }, [
          el('h2', { textContent: 'Grimoire' }),
          el('div', { className: 'button-row' }, [
            el('button', { className: 'secondary', textContent: 'Lobby', onclick: () => openLobbyModal(handle) }),
            el('button', { className: 'secondary', textContent: '+ Add seat', onclick: () => { handle.addSeat(); refreshTokenGrid() } }),
            el('button', { className: 'secondary', textContent: 'Setup', onclick: () => openSetupModal(handle, () => { refreshTokenGrid(); refreshNightOrder() }) }),
          ]),
        ]),
        pickingBanner,
        circleContainer,
        // Deliberately scrollable rather than fighting for space with the
        // circle above — the circle should always be fully visible; notes
        // scrolling is an accepted tradeoff. Sent cards live per-seat now
        // (each seat's own popup), not in a separate global section here.
        el('div', { className: 'grimoire-below-fold' }, [
          el('div', { className: 'grimoire-notes' }, [el('h2', { textContent: 'Notes' }), notesInput]),
        ]),
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
  notesInput.addEventListener('input', () => handle.setNote(notesInput.value))

  handle.onRosterChange(() => {
    refreshTokenGrid()
    refreshNightOrder()
  })
  handle.onUnseatedChange(() => {
    // A vacant seat's modal shows the unseated pool — refresh it live if open.
    if (activeSeat !== null) openSeatFor(activeSeat, false)
  })
  handle.onUnreadChange(() => refreshTokenGrid())
  handle.onPlayerCard((card) => {
    refreshTokenGrid()
    if (activeSeat === card.seat) openSeatFor(activeSeat, false)
  })

  refreshTokenGrid()
  refreshNightOrder()
}
