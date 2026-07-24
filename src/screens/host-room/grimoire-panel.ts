import { el } from '../../ui/dom'
import type { HostRoomHandle } from '../../trystero/room'
import { getCharacter } from '../../data/characters'
import { attachCharacterTrigger } from '../../ui/character-popup'
import { openModal, updateModalContent, closeModal } from '../../ui/modal'
import { layoutInCircle, CIRCLE_RADIUS_PERCENT } from '../../ui/circular-layout'
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
  // Assigned once, further down, once its own children exist — declared here
  // (rather than at that point) so resizeCircleToFit(), defined earlier in
  // this function but only ever CALLED after the assignment below runs, can
  // close over it without a "used before its declaration" error. The `!` is
  // a definite-assignment assertion: TS can't statically prove the closure
  // only runs after the assignment below, but it does.
  let grimoireMain!: HTMLElement

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
  // Just centers circleContainer — sizing is entirely resizeCircleToFit()'s
  // job now (see below), not flexbox distribution, so this wrapper's own box
  // is simply whatever circleContainer's explicit size ends up being.
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
    // Seat count affects the minimum non-overlapping circle size (more seats
    // need more circumference) — recompute whenever it changes, not just
    // when circleArea's own box resizes.
    resizeCircleToFit()
  }

  // Matches .seat-token's CSS width — kept here rather than read from the DOM
  // since it's only needed for this one calculation and doesn't change.
  const TOKEN_WIDTH_PX = 92
  const MIN_TOKEN_GAP_PX = 12

  // The smallest square the circle can be without two adjacent tokens
  // visually overlapping, for the given seat count. Inverts
  // circular-layout.ts's own chord-length math (adjacent-token distance = 2 *
  // radius * sin(pi / n), radius = CIRCLE_RADIUS_PERCENT% of the container
  // size) to solve for the container size that keeps that chord at least
  // TOKEN_WIDTH_PX + MIN_TOKEN_GAP_PX.
  function minCircleSize(seatCount: number): number {
    if (seatCount < 2) return 0
    const neededChord = TOKEN_WIDTH_PX + MIN_TOKEN_GAP_PX
    const radiusFraction = CIRCLE_RADIUS_PERCENT / 100
    return neededChord / (2 * radiusFraction * Math.sin(Math.PI / seatCount))
  }

  // Sizes the circle to whatever space is actually available above the
  // notes section, prioritizing the circle over notes rather than splitting
  // the space evenly between them — a flat vh-based guess either wasted
  // space or (as reported) overshot and clipped seats under the tab bar, and
  // a naive "both get flex: 1" split let notes squeeze the circle down
  // arbitrarily small (both were willing to shrink to 0). Available height is
  // `grimoireMain`'s own bottom edge minus circleArea's top edge — NOT
  // circleArea's own height, which would be circular (its height is a
  // function of circleContainer's size, which is what we're about to set).
  // grimoireMain's own box is fixed by the outer row layout regardless of
  // how much its children's content actually needs, and circleArea's top
  // position only depends on the header/banners above it (unaffected by our
  // own writes) — so neither number depends on what this function just did
  // last time it ran, which is what keeps this convergent rather than
  // fighting with itself across repeated calls. Never goes below
  // minCircleSize(), even if that means overflowing past grimoireMain's own
  // box and requiring a scroll (see grimoireMain's comment in style.css) — a
  // seat token overlapping another is worse than a scrollbar.
  function resizeCircleToFit(): void {
    const mainRect = grimoireMain.getBoundingClientRect()
    const areaRect = circleArea.getBoundingClientRect()
    const availableHeight = mainRect.bottom - areaRect.top
    const size = Math.max(minCircleSize(seats().length), Math.min(areaRect.width, availableHeight))
    if (size <= 0) return
    circleContainer.style.width = `${size}px`
    circleContainer.style.height = `${size}px`
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

  const tokensHeader = el('div', { className: 'grimoire-tokens-header' }, [
    el('h2', { textContent: 'Grimoire' }),
    el('div', { className: 'button-row' }, [
      el('button', { className: 'secondary', textContent: 'Lobby', onclick: () => openLobbyModal(handle) }),
      el('button', { className: 'secondary', textContent: '+ Add seat', onclick: () => { handle.addSeat(); refreshTokenGrid() } }),
      el('button', { className: 'secondary', textContent: 'Setup', onclick: () => openSetupModal(handle, () => { refreshTokenGrid(); refreshNightOrder() }) }),
      swapSeatsButton,
      revealDeathsButton,
    ]),
  ])

  // A named reference (rather than building this inline below) because
  // resizeCircleToFit() needs to measure this element's own box — see its
  // comment for why that's the stable, JS-write-independent number the
  // calculation is anchored on.
  grimoireMain = el('div', { className: 'grimoire-main' }, [
    tokensHeader,
    pickingBanner,
    swapBanner,
    circleArea,
    // Renders at its natural height now, potentially below the visible
    // fold — grimoire-main itself scrolls to reach it when the circle above
    // has taken the room instead. Sent cards live per-seat now (each seat's
    // own popup), not in a separate global section here.
    el('div', { className: 'grimoire-below-fold' }, [
      el('div', { className: 'grimoire-notes' }, [el('h2', { textContent: 'Notes' }), notesInput]),
    ]),
  ])

  // ResizeObserver on grimoireMain (not circleArea, which we ourselves
  // resize — observing what you write to risks fighting yourself in a loop)
  // catches every reason its available space can change: the window
  // resizing, the header row wrapping to two lines, a picking/swap banner
  // toggling visible. Banner/seat-count changes also call resizeCircleToFit()
  // directly (see refreshTokenGrid() and the banner toggle sites) since
  // those don't necessarily change grimoireMain's own box size for the
  // observer to react to.
  new ResizeObserver(() => resizeCircleToFit()).observe(grimoireMain)

  container.replaceChildren(
    el('div', { className: 'grimoire-layout' }, [
      grimoireMain,
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
