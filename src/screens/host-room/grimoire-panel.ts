import { el } from '../../ui/dom'
import type { HostRoomHandle } from '../../trystero/room'
import { getCharacter } from '../../data/characters'
import { getScript } from '../../data/scripts'
import { attachCharacterTrigger, openCharacterPopup } from '../../ui/character-popup'
import { characterOptionsFor } from '../../ui/character-select'
import { deriveNightOrder } from '../../game/night-order'
import { assignCharacters, shuffle, suggestDistribution } from '../../game/setup'
import { nightCardElement } from '../../game/night-card'
import type { NightCardElement, PlayerInfo } from '../../types'

export function renderGrimoirePanel(container: HTMLElement, handle: HostRoomHandle): void {
  let selectedSeat: number | null = null
  let isFirstNight = true
  let composerElements: NightCardElement[] = []

  const pinnedBanner = el('p', { className: 'grimoire-pinned-note hidden' })
  const tokenGrid = el('div', { className: 'token-grid' })
  const detailPanel = el('div', { className: 'grimoire-detail' })
  const nightOrderList = el('ol', { className: 'night-order-list' })
  const auditLogList = el('ul', { className: 'audit-log-list' })
  const notesInput = el('textarea', { className: 'grimoire-notes-input', rows: 3, placeholder: 'Private notes (first line can be pinned above)…' })

  function currentScript() {
    return getScript(handle.getScriptId())
  }

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
            selectedSeat === seat.seat ? 'selected' : '',
            seat.peerId === null ? 'disconnected' : '',
          ]
            .filter(Boolean)
            .join(' '),
          onclick: () => {
            selectedSeat = seat.seat
            composerElements = []
            refreshTokenGrid()
            refreshDetail()
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
    const addButton = el('button', {
      className: 'add-seat-button',
      textContent: '+ Add seat',
      onclick: () => {
        handle.addSeat()
        refreshTokenGrid()
      },
    })
    tokenGrid.replaceChildren(...tokens, addButton)
  }

  function characterOptions(selectedId?: string): HTMLSelectElement {
    const script = currentScript()
    if (!script) return el('select', { className: 'character-select' })
    return characterOptionsFor(script, selectedId)
  }

  function renderComposerElementList(): HTMLElement {
    return el(
      'ul',
      { className: 'composer-element-list' },
      composerElements.map((element, index) =>
        el('li', {}, [
          el('span', { textContent: describeElement(element) }),
          el('button', {
            className: 'remove-element-button',
            textContent: '✕',
            onclick: () => {
              composerElements = composerElements.filter((_, i) => i !== index)
              refreshDetail()
            },
          }),
        ]),
      ),
    )
  }

  function describeElement(element: NightCardElement): string {
    switch (element.kind) {
      case 'text':
        return `Text: "${element.text}"`
      case 'number':
        return `Number: ${element.value}`
      case 'player':
        return `Player: ${element.name}`
      case 'character':
        return `Character: ${getCharacter(element.characterId ?? '')?.name ?? element.characterId}`
      case 'characterChange':
        return `Change to: ${getCharacter(element.characterId ?? '')?.name ?? element.characterId}`
      case 'choosePlayer':
        return `Prompt (choose a player): "${element.prompt}"`
      case 'chooseCharacter':
        return `Prompt (choose a character): "${element.prompt}"`
    }
  }

  function renderComposer(seat: PlayerInfo): HTMLElement {
    const textInput = el('input', { className: 'composer-input', placeholder: 'Custom text…' })
    const numberInput = el('input', { className: 'composer-input', type: 'number', placeholder: '0' })
    const playerSelect = el(
      'select',
      { className: 'composer-input' },
      seats().map((s) => el('option', { value: String(s.seat), textContent: s.name })),
    )
    const characterSelect = characterOptions()
    const changeCharacterSelect = characterOptions()
    const promptInput = el('input', { className: 'composer-input', placeholder: 'Prompt for the player…' })

    return el('div', { className: 'night-card-composer' }, [
      el('h3', { textContent: 'Compose night card' }),
      el('div', { className: 'composer-row' }, [
        textInput,
        el('button', {
          textContent: 'Add text',
          onclick: () => {
            if (!textInput.value.trim()) return
            composerElements.push(nightCardElement('text', { text: textInput.value.trim() }))
            textInput.value = ''
            refreshDetail()
          },
        }),
      ]),
      el('div', { className: 'composer-row' }, [
        numberInput,
        el('button', {
          textContent: 'Add number',
          onclick: () => {
            composerElements.push(nightCardElement('number', { value: Number(numberInput.value) || 0 }))
            refreshDetail()
          },
        }),
      ]),
      el('div', { className: 'composer-row' }, [
        playerSelect,
        el('button', {
          textContent: 'Add player',
          onclick: () => {
            const s = seats().find((x) => x.seat === Number(playerSelect.value))
            if (!s) return
            composerElements.push(nightCardElement('player', { name: s.name, peerId: s.peerId }))
            refreshDetail()
          },
        }),
      ]),
      el('div', { className: 'composer-row' }, [
        characterSelect,
        el('button', {
          textContent: 'Add character',
          onclick: () => {
            if (!characterSelect.value) return
            composerElements.push(nightCardElement('character', { characterId: characterSelect.value }))
            refreshDetail()
          },
        }),
      ]),
      el('div', { className: 'composer-row' }, [
        changeCharacterSelect,
        el('button', {
          textContent: 'Add character change',
          onclick: () => {
            if (!changeCharacterSelect.value) return
            composerElements.push(nightCardElement('characterChange', { characterId: changeCharacterSelect.value }))
            refreshDetail()
          },
        }),
      ]),
      el('div', { className: 'composer-row' }, [
        el('button', {
          textContent: '"Choose a Player" prompt',
          onclick: () => {
            composerElements.push(nightCardElement('choosePlayer', { prompt: promptInput.value.trim() || 'Choose a player' }))
            promptInput.value = ''
            refreshDetail()
          },
        }),
        el('button', {
          textContent: '"Choose a Character" prompt',
          onclick: () => {
            composerElements.push(
              nightCardElement('chooseCharacter', {
                prompt: promptInput.value.trim() || 'Choose a character',
                characterIds: currentScript()?.characterIds ?? [],
              }),
            )
            promptInput.value = ''
            refreshDetail()
          },
        }),
      ]),
      el('div', { className: 'composer-row' }, [promptInput]),
      renderComposerElementList(),
      el('button', {
        className: 'primary send-card-button',
        textContent: 'Send card',
        onclick: () => {
          if (composerElements.length === 0) return
          const characterChange = composerElements.find((e) => e.kind === 'characterChange')
          if (characterChange?.characterId) {
            handle.assignCharacter(seat.seat, characterChange.characterId)
          }
          handle.sendNightCard(seat.seat, composerElements)
          composerElements = []
          refreshTokenGrid()
          refreshDetail()
          refreshAuditLog()
        },
      }),
    ])
  }

  function refreshDetail(): void {
    const seat = seats().find((s) => s.seat === selectedSeat)
    if (!seat) {
      detailPanel.replaceChildren(el('p', { className: 'grimoire-empty-hint', textContent: 'Tap a seat above to manage it.' }))
      return
    }

    const characterId = handle.getCharacterAssignment(seat.seat)
    const nameInput = el('input', { className: 'seat-name-input', value: seat.name })
    const aliveCheckbox = el('input', { type: 'checkbox', checked: seat.alive })
    const voteCheckbox = el('input', { type: 'checkbox', checked: seat.voteToken })
    const charSelect = characterOptions(characterId)
    const charLabel = el('button', {
      className: 'character-preview-button',
      textContent: characterId ? getCharacter(characterId)?.name ?? characterId : 'No character',
      onclick: () => characterId && openCharacterPopup(characterId),
    })

    detailPanel.replaceChildren(
      el('div', { className: 'seat-detail-header' }, [
        nameInput,
        el('button', {
          className: 'danger',
          textContent: 'Remove seat',
          onclick: () => {
            handle.removeSeat(seat.seat)
            selectedSeat = null
            refreshTokenGrid()
            refreshDetail()
          },
        }),
      ]),
      el('div', { className: 'seat-detail-row' }, [
        el('label', {}, [aliveCheckbox, ' Alive']),
        el('label', {}, [voteCheckbox, ' Has vote token']),
      ]),
      el('div', { className: 'seat-detail-row' }, [
        el('label', { textContent: 'Character:' }),
        charSelect,
        charLabel,
      ]),
      renderComposer(seat),
    )

    nameInput.addEventListener('change', () => handle.renameSeat(seat.seat, nameInput.value.trim() || seat.name))
    aliveCheckbox.addEventListener('change', () => {
      handle.setAlive(seat.seat, aliveCheckbox.checked)
      refreshTokenGrid()
    })
    voteCheckbox.addEventListener('change', () => handle.setVoteToken(seat.seat, voteCheckbox.checked))
    charSelect.addEventListener('change', () => {
      handle.assignCharacter(seat.seat, charSelect.value || null)
      refreshTokenGrid()
      refreshDetail()
    })
  }

  function refreshNightOrder(): void {
    const steps = deriveNightOrder(characterIdsInPlay(), isFirstNight)
    nightOrderList.replaceChildren(
      ...steps.map((step) => {
        const item = el('li', {}, [
          el('strong', { textContent: step.label }),
          ...(step.detail ? [el('p', { textContent: step.detail })] : []),
        ])
        if (step.character) attachCharacterTrigger(item, step.character.id)
        return item
      }),
    )
    if (steps.length === 0) {
      nightOrderList.replaceChildren(el('li', { className: 'roster-empty', textContent: 'Assign characters to seats to see the night order.' }))
    }
  }

  function refreshAuditLog(): void {
    const log = [...handle.getAuditLog()].reverse()
    auditLogList.replaceChildren(
      ...(log.length
        ? log.map((entry) =>
            el('li', {}, [
              el('span', { className: 'audit-log-time', textContent: new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }),
              el('span', { className: 'audit-log-seat', textContent: entry.name }),
              el('span', { className: 'audit-log-summary', textContent: entry.summary }),
            ]),
          )
        : [el('li', { className: 'roster-empty', textContent: 'No cards sent yet.' })]),
    )
  }

  function sendMinionDemonInfo(): void {
    const script = currentScript()
    if (!script) return
    const withCharacter = seats()
      .map((seat) => ({ seat, characterId: handle.getCharacterAssignment(seat.seat) }))
      .filter((s): s is { seat: PlayerInfo; characterId: string } => Boolean(s.characterId))
    const minions = withCharacter.filter((s) => getCharacter(s.characterId)?.type === 'minion')
    const demons = withCharacter.filter((s) => getCharacter(s.characterId)?.type === 'demon')

    for (const minion of minions) {
      const elements: NightCardElement[] = [nightCardElement('text', { text: 'Your fellow Minions and the Demon:' })]
      for (const other of [...minions.filter((m) => m.seat.seat !== minion.seat.seat), ...demons]) {
        elements.push(nightCardElement('player', { name: other.seat.name, peerId: other.seat.peerId }))
        elements.push(nightCardElement('character', { characterId: other.characterId }))
      }
      handle.sendNightCard(minion.seat.seat, elements)
    }

    const inPlayIds = new Set(withCharacter.map((s) => s.characterId))
    const bluffs = shuffle(script.characterIds.filter((id) => !inPlayIds.has(id))).slice(0, 3)
    for (const demon of demons) {
      const elements: NightCardElement[] = [nightCardElement('text', { text: 'Your Minions:' })]
      for (const minion of minions) {
        elements.push(nightCardElement('player', { name: minion.seat.name, peerId: minion.seat.peerId }))
        elements.push(nightCardElement('character', { characterId: minion.characterId }))
      }
      elements.push(nightCardElement('text', { text: 'Your bluffs (not in play):' }))
      for (const bluffId of bluffs) elements.push(nightCardElement('character', { characterId: bluffId }))
      handle.sendNightCard(demon.seat.seat, elements)
    }
    refreshAuditLog()
  }

  const setupHint = el('p', { className: 'setup-hint' })
  function refreshSetupHint(): void {
    const dist = suggestDistribution(seats().length)
    setupHint.textContent = `Suggested for ${seats().length} players: ${dist.townsfolk} Townsfolk, ${dist.outsider} Outsider, ${dist.minion} Minion, ${dist.demon} Demon.`
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
    pinnedBanner,
    el('section', { className: 'grimoire-tokens' }, [el('h2', { textContent: 'Grimoire' }), tokenGrid]),
    el('section', { className: 'grimoire-detail-section' }, [detailPanel]),
    el('section', { className: 'grimoire-setup' }, [
      el('h2', { textContent: 'Setup assistant' }),
      setupHint,
      el('button', {
        textContent: 'Randomize characters for all seats',
        onclick: () => {
          const script = currentScript()
          if (!script) return
          const characterIds = assignCharacters(script, seats().length)
          seats().forEach((seat, index) => handle.assignCharacter(seat.seat, characterIds[index] ?? null))
          refreshTokenGrid()
          refreshDetail()
          refreshNightOrder()
        },
      }),
      el('button', { textContent: 'Send Minion/Demon info', onclick: sendMinionDemonInfo }),
    ]),
    el('section', { className: 'grimoire-night-order' }, [
      el('div', { className: 'night-order-header' }, [
        el('h2', { textContent: 'Night order' }),
        el('div', { className: 'button-row' }, [firstNightButton, otherNightsButton]),
      ]),
      nightOrderList,
    ]),
    el('section', { className: 'grimoire-audit-log' }, [el('h2', { textContent: 'Sent cards (Storyteller only)' }), auditLogList]),
    el('section', { className: 'grimoire-notes' }, [el('h2', { textContent: 'Notes' }), notesInput]),
  )

  notesInput.value = handle.getNote()
  notesInput.addEventListener('input', () => {
    handle.setNote(notesInput.value)
    refreshPinnedNote()
  })

  handle.onRosterChange(() => {
    refreshTokenGrid()
    refreshDetail()
    refreshNightOrder()
    refreshSetupHint()
  })
  handle.onAuditLogChange(refreshAuditLog)

  refreshPinnedNote()
  refreshTokenGrid()
  refreshDetail()
  refreshNightOrder()
  refreshAuditLog()
  refreshSetupHint()
}
