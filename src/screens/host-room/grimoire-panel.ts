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
  // Two-tap "choose which seats to swap" flow, mirroring the composer's
  // "Player" picking mode below but entirely separate from it (mutually
  // exclusive — see the token onclick handler in refreshTokenGrid) since
  // swapping isn't part of the night-card composer at all.
  let swappingSeats = false
  let swapFirstSeat: number | null = null

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

  const swapBannerText = el('span', {})
  const swapBanner = el('div', { className: 'picking-banner hidden' }, [
    swapBannerText,
    el('button', {
      className: 'secondary',
      textContent: 'Cancel',
      onclick: () => {
        swappingSeats = false
        swapFirstSeat = null
        swapBanner.classList.add('hidden')
        refreshTokenGrid()
      },
    }),
  ])
  const circleContainer = el('div', { className: 'seat-circle' })
  // Centers the circle and gives resizeCircleToFit() a stable box to measure
  // — its rendered size already reflects "whatever's left" after the header/
  // banners/notes above and below it, solved by flexbox, so JS doesn't have
  // to separately account for each sibling's height by hand.
  const circleArea = el('div', { className: 'grimoire-circle-area' }, [circleContainer])
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
            seat.alive && handle.getDiesTonight(seat.seat) ? 'dying' : '',
            activeSeat === seat.seat ? 'selected' : '',
            swapFirstSeat === seat.seat ? 'selected' : '',
            seat.peerId === null ? 'disconnected' : '',
            pickingPlayer || swappingSeats ? 'pickable' : '',
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
            if (swappingSeats) {
              if (swapFirstSeat === null) {
                swapFirstSeat = seat.seat
                swapBannerText.textContent = `Tap the seat to swap with ${seat.name}…`
                refreshTokenGrid()
                return
              }
              if (swapFirstSeat === seat.seat) {
                // Tapped the same seat again — deselect it rather than
                // treating that as "swap it with itself" or closing the flow.
                swapFirstSeat = null
                swapBannerText.textContent = 'Tap the first seat to swap…'
                refreshTokenGrid()
                return
              }
              handle.swapSeats(swapFirstSeat, seat.seat)
              swappingSeats = false
              swapFirstSeat = null
              swapBanner.classList.add('hidden')
              refreshTokenGrid()
              return
            }
            openSeatFor(seat.seat, true)
          },
        },
        [
          renderTokenImage(character?.tokenUrl, character ? character.name : seat.name, !seat.voteToken),
          el('span', { className: 'seat-token-name', textContent: seat.name }),
          ...(character ? [el('span', { className: 'seat-token-character', textContent: character.name })] : []),
          ...(unread.has(seat.seat) ? [el('span', { className: 'unread-dot', title: 'Unread message' })] : []),
        ],
      )
    })
    circleContainer.replaceChildren(...tokens)
    layoutInCircle(circleContainer)
    revealDeathsButton.disabled = !seats().some((seat) => handle.getDiesTonight(seat.seat))
  }

  // Sizes the circle to exactly whatever space circleArea's flex layout has
  // actually left it (a fixed square, min of the two dimensions, capped at
  // 760px) — rather than a flat vh-based guess, which either wasted space or
  // (as reported) overshot and clipped the bottom row of seats under the tab
  // bar. Measuring the real box, post-layout, is the only way to get this
  // exactly right regardless of window size/shape or how much room the
  // header/banners/notes ended up taking.
  function resizeCircleToFit(): void {
    const rect = circleArea.getBoundingClientRect()
    const size = Math.max(0, Math.min(rect.width, rect.height, 760))
    if (size === 0) return
    circleContainer.style.width = `${size}px`
    circleContainer.style.height = `${size}px`
  }

  // ResizeObserver (not just a window 'resize' listener) so this also
  // re-fires when circleArea's available space changes for a reason other
  // than the window itself resizing — e.g. the header row wrapping to two
  // lines on a narrower-but-not-resized layout, or the picking/swap banner
  // toggling visible and eating into the vertical space above the circle.
  new ResizeObserver(() => resizeCircleToFit()).observe(circleArea)

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

  // Pressed once the Storyteller has announced the night's deaths at the
  // table — clears every "dies tonight" flag and marks those seats actually
  // dead (a public change, unlike the flag itself). Disabled when nothing is
  // currently flagged (kept in sync inside refreshTokenGrid).
  const revealDeathsButton = el('button', {
    className: 'secondary',
    textContent: 'Reveal deaths',
    onclick: () => {
      handle.revealAllDeaths()
      refreshTokenGrid()
    },
  })

  // Two players swapping physical seats mid-game — moves everything about a
  // seat (name/character/notes/messages/vote token/dies-tonight flag) via the
  // existing handle.swapSeats(), which already keeps all of that in sync.
  const swapSeatsButton = el('button', {
    className: 'secondary',
    textContent: 'Swap Seats',
    onclick: () => {
      // Mutually exclusive with the composer's "Player" picking mode — cancel
      // that first if it was somehow left active (its own popup is normally
      // what would have to be closed to reach this button in the first place).
      pickingPlayer = false
      pickingBanner.classList.add('hidden')
      swappingSeats = true
      swapFirstSeat = null
      swapBannerText.textContent = 'Tap the first seat to swap…'
      swapBanner.classList.remove('hidden')
      refreshTokenGrid()
    },
  })

  container.replaceChildren(
    el('div', { className: 'grimoire-layout' }, [
      el('div', { className: 'grimoire-main' }, [
        el('div', { className: 'grimoire-tokens-header' }, [
          el('h2', { textContent: 'Grimoire' }),
          el('div', { className: 'button-row' }, [
            el('button', { className: 'secondary', textContent: 'Lobby', onclick: () => openLobbyModal(handle) }),
            el('button', { className: 'secondary', textContent: '+ Add seat', onclick: () => { handle.addSeat(); refreshTokenGrid() } }),
            el('button', { className: 'secondary', textContent: 'Setup', onclick: () => openSetupModal(handle, () => { refreshTokenGrid(); refreshNightOrder() }) }),
            swapSeatsButton,
            revealDeathsButton,
          ]),
        ]),
        pickingBanner,
        swapBanner,
        circleArea,
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
