Agent: Include information about how the code works, what libraries, conventions, etc, are used, for future reference.
Reading the MAINTENANCE file should be sufficient background information to correctly modify other files.
Cross-reference: TODO.md tracks the feature roadmap and per-task status. When a TODO.md task's status changes (especially to implemented), update the relevant section(s) here to describe the new architecture, data model, or conventions it introduced.

## Dependency philosophy

Keep dependencies minimal. Only take on a library when it's necessary or covers a
significant portion of the project — `trystero` qualifies (it *is* the multiplayer
layer, and reimplementing WebRTC signaling ourselves would be far riskier). `qrcode-generator`
qualifies too, on the same logic at smaller scale: correctly implementing QR encoding
(Reed-Solomon error correction, mask pattern selection) ourselves would be easy to get
subtly wrong with no easy way to verify except scanning it, and the package itself has
zero transitive dependencies. A UI framework does not qualify at this project's current
size; don't add one speculatively.
Runtime dependencies today: `trystero`, `qrcode-generator`. Dev dependencies: `vite`,
`typescript`, `@types/qrcode-generator`.

## Tech stack

- **Vite + TypeScript**, vanilla DOM rendering (no React/Preact/etc). `npm run dev`
  for local dev, `npm run build && npm run preview` to test the actual production
  bundle (GitHub Pages only ever serves the built bundle, not the dev server).
- TypeScript specifically (not plain JS) because the app's entire privacy guarantee
  rests on always passing the correct WebRTC peer-id `target` — typed payloads make
  "forgot the target, accidentally broadcast a secret" a compile error.
- `vite.config.ts` sets `base: './'` (relative) so the build works from any GitHub
  Pages subpath without further changes. GitHub remote creation / Pages enablement
  itself is a manual step not yet done (requires the user's own GitHub account).
- `tsconfig.json` has `esModuleInterop: true` (added alongside `qrcode-generator`,
  which is a CommonJS `export =` module — without it, `import qrcode from
  'qrcode-generator'` doesn't type-check). Doesn't affect Vite's actual bundling,
  which handles CJS/ESM interop at the esbuild/rollup level regardless of this flag;
  it only affects `tsc`'s type-checking pass.

## Architecture: serverless P2P via Trystero

This is a static site with **no backend we run**. Multiplayer works via
[Trystero](https://github.com/dmotz/trystero), a WebRTC library that uses free public
relay networks (default strategy here: Nostr relays) purely to bootstrap connections
("signaling"). Actual app messages travel directly device-to-device over WebRTC data
channels, end-to-end encrypted, never through any server we control. This requires the
game venue to have internet access (an explicit, accepted assumption — not designed to
work fully offline).

Trystero rooms are **full mesh**: every peer holds a direct connection to every other
peer. Privacy is enforced not by network topology but by Trystero's targeted send —
`action.send(data, {target: peerId})` reaches only that one peer's own data channel;
omitting `target` broadcasts to everyone currently connected. This is sufficient on its
own for "Storyteller → one Player secretly" and "Player → Storyteller secretly, never
Player → Player" — there is no custom relay-through-host logic.

`selfId` (imported from `trystero`) is a stable, non-mutable peer id for the life of a
browser tab — kept separate from the player's mutable display name and from the
player's persistent **reconnect token** (see below). It still regenerates on a full
page reload, but that no longer means "the same human reappears as a new roster
row" — see "Seats, reconnect, and persistence" below for how that's now handled.

### The six Trystero actions (`src/trystero/config.ts`, `src/trystero/room.ts`)

- `hello` (Player → Storyteller, targeted): a Player announces/re-announces
  `{name, reconnectToken}` to a peer as soon as `room.onPeerJoin` fires for that peer.
- `roster` (Storyteller → everyone, broadcast): `{storytellerId, scriptId, players:
  PlayerInfo[]}`. `PlayerInfo` is **public seat data only** — `{seat, name, peerId,
  alive, voteToken}` — deliberately excludes character assignment; see the privacy
  note below.
- `secretMessage` (both directions, always targeted): `{text, ts}`. Safe to share one
  action name for both directions because Trystero never loops a peer's own sends back
  to itself — the Storyteller's handler structurally only ever sees Player-originated
  messages, and a Player's handler only ever sees Storyteller-originated ones.
- `characterAssign` (Storyteller → one Player, targeted): `{characterId, ts}` — the
  *only* way a Player learns their own character. Never broadcast.
- `nightCard` (Storyteller → one Player, targeted): `{elements: NightCardElement[],
  ts}` — a composed night card (see "Night cards" below).
- `nightActionResponse` (Player → Storyteller, targeted): `{forTs, chosenPeerId,
  chosenCharacterId, ts}` — a Player's answer to a `choosePlayer`/`chooseCharacter`
  prompt embedded in a card. `chosenPeerId`/`chosenCharacterId` are typed `string |
  null`, not optional — Trystero's `JsonValue` constraint rejects `undefined` (see
  the `NightCardElement` comment in `types.ts`).

**Roster authority — read this before touching `room.ts`:** the Storyteller's client is
the single source of truth for seat order (a mesh has no other way to guarantee every
peer agrees on it). The Storyteller maintains an ordered `seats: PlayerInfo[]` array,
then rebroadcasts the *entire* roster (plus its own `selfId` as `storytellerId` and the
current `scriptId`) on every change. Players just render whatever roster they're sent —
they never compute their own ordering.

**Seats persist independently of connections.** A seat is the primary unit, not a
connection: `PlayerInfo.peerId` is nullable. Disconnecting (`onPeerLeave`) sets a seat's
`peerId` to `null` rather than removing it — the seat, its alive/vote-token state, and
its (private, ST-only) character assignment all survive. This is what makes seat
reclaim on reconnect possible (below) and is also just correct for seat management's
own stated behavior in TODO.md ("if a player disconnects, their seat remains active").

### Connection model: an unseated pool, not auto-seating

A brand-new connection (no matching `reconnectToken`, no existing seat) does **not**
get a seat created for it automatically. Instead `createHostRoom`'s closure keeps an
in-memory `unseatedPeers: Map<peerId, {name, reconnectToken}>` — "connected, waiting to
be placed." The Storyteller's Grimoire shows this pool inside a *vacant* seat's popup
("Assign a connected player"), and `handle.assignPeerToSeat(peerId, seat)` is the only
thing that moves someone out of it and into an actual seat (registering their
`reconnectToken` against that seat number at the same time, so their *next* reload
reclaims it directly rather than re-entering the pool). This matches the real
Storyteller workflow of assigning each arriving device to whichever physical chair its
owner is actually sitting in, rather than the app guessing.

`unseatedPeers` is **not persisted** — unlike `seats`, it's rebuilt fresh from `hello`
messages every time (a Storyteller reload doesn't need it to survive, since any
still-connected-but-unplaced device will just say `hello` again once the new session
comes up, via the same `onPeerJoin` mechanism described in "the one timing rule that
matters" below). `onPeerLeave` also removes a departing peer from this pool if it was
never assigned a seat, so it doesn't accumulate stale entries for people who connected
and left before the Storyteller got to them.

### Privacy: why character assignment is never in the roster

`PlayerInfo` (broadcast to everyone) intentionally has no `characterId` field. A
Player's own character is private information — if it rode along in the broadcast
`roster` payload, every Player would learn every other Player's character, which
defeats the entire game. The Storyteller keeps `characterAssignments: Record<seat,
characterId>` as **local-only** state (in `room.ts`'s closure, persisted only to the
Storyteller's own `localStorage`) and pushes a character to its owner exclusively via
the targeted `characterAssign` action. When code needs "what character is in seat N,"
it goes through `handle.getCharacterAssignment(seat)` (Storyteller-side only) — there
is no code path that lets this leak into a broadcast payload. Keep it that way.

### Night cards: one composable payload, not one type per ability

`NightCardElement` (`types.ts`) is a flat tagged interface, not a discriminated union —
every field is present but `null` unless relevant to that element's `kind` (`text`,
`number`, `player`, `character`, `characterChange`, `choosePlayer`, `chooseCharacter`).
This is because `NightCardElement` needs Trystero's `[key: string]: JsonValue` index
signature (see below), and TypeScript's `JsonValue` union rejects `undefined` — so
optional (`field?: T`) fields don't compile, only required-but-nullable (`field: T |
null`) ones do. Build these with `game/night-card.ts`'s `nightCardElement(kind,
fields)` helper rather than writing the object literal by hand — it fills in the
`null`s for you. (That helper's parameter type is deliberately a plain separate
interface, not `Partial<Omit<NightCardElement, 'kind'>>` — `Omit`/`Pick` over a type
that has an index signature collapses every named property's type down to the index
signature's value type, i.e. every field becomes `JsonValue` instead of its specific
type. Don't try to derive it from `NightCardElement` again.)

A card is `{elements: NightCardElement[], ts}` — the Storyteller composes several
elements (e.g. a `text` plus a `number`) and sends them as one `nightCard` message,
per TODO.md's "prepare all information and then send it in one card." The Storyteller
also appends a locally-summarized line to its private audit log (`getAuditLog()`)
whenever a card is sent — never networked, just a `localStorage`-backed scratch record
for "what did I tell this player" disputes.

**Known limitation:** a card can contain multiple `choosePlayer`/`chooseCharacter`
prompts, but the Player-side UI (`night-actions-panel.ts`) only wires up a single
"Send response" button per card, driven by whichever `<select>` its `querySelector`
finds first. Abilities needing two choices in one prompt (e.g. Fortune Teller's
"choose 2 players") aren't fully representable yet — split them into two cards, or
extend the response UI to loop over every prompt element and send multiple responses,
before relying on this for a genuinely two-target ability.

### Every payload interface needs the index signature (still true, now for 6 payloads)

Trystero's `makeAction<T>()` requires an explicit `[key: string]: JsonValue` index
signature on named interfaces passed as `T` (a plain object literal wouldn't need
this, but a declared interface does) — this now applies to `HelloPayload`,
`RosterPayload`, `SecretMessagePayload`, `CharacterAssignPayload`, `NightCardPayload`,
and `NightActionResponsePayload` in `types.ts`.

### Multiple subscribers per event, not one

`HostRoomHandle`/`PlayerRoomHandle`'s `onX(cb)` methods (`onRosterChange`,
`onPlayerMessage`, `onNightCard`, etc.) each add `cb` to a `Set`, not overwrite a
single nullable callback slot. This matters because of how the tabbed UI works (see
below): every panel re-subscribes each time its tab is activated, since
`renderTabs()` tears down and recreates the active panel's DOM/closures on every
switch. If `onX` overwrote a single slot, switching away from (say) the Messages tab
would silently stop delivering `onPlayerMessage` events to anyone — there'd be no
listener at all while a different tab is active, and an incoming secret message would
just be dropped. With a `Set`, the room-level top-level subscription (registered once,
for the life of the screen — see `host-room/index.ts` / `join-room/index.ts`) keeps
accumulating events into a shared, screen-lifetime array regardless of which tab is
active; each panel, on mount, replays that shared array for its initial render and
adds its own subscription for live updates while it stays active. There's no
explicit unsubscribe on tab-switch-away — a torn-down panel's stale listener just
turns into a harmless no-op update to a detached DOM node, which is an acceptable
inefficiency for a single Storyteller/Player device switching tabs a normal number of
times per game, not a correctness issue.

**The one timing rule that matters:** `hello` must never be sent as a blind broadcast
immediately after `joinRoom()` returns — at that instant no peer connections exist yet,
so the message would be silently lost. `room.onPeerJoin` firing for a peerId is what
proves that connection is actually ready to send on. This is why `joinPlayerRoom`
sends `hello` from inside `onPeerJoin` (targeted at whichever peer just connected),
not as a one-shot broadcast at join time. A joining Player can't yet tell which of its
new connections is the Storyteller (the mesh connects to every existing peer, not just
the ST), so it sends `hello` to each one — harmless, since only the Storyteller's code
ever registers a `hello.onMessage` handler. This same mechanism is what makes
Storyteller-reload recovery work: when the ST's tab reloads, every Player sees their
old ST-peer leave (disconnect banner) and the new ST-session join as a "new" peer,
which fires `onPeerJoin` again and re-sends `hello` — carrying each Player's persistent
`reconnectToken`, which the freshly-restored Storyteller state matches back to the
right seat.

**Enforcing "Players can't message Players":** this is structural, not just a hidden
UI control. `src/screens/join-room/` has no code path that accepts a Player-supplied
target peerId — `sendToStoryteller` in `src/trystero/room.ts` hardcodes
`{target: storytellerId}`. Caveat: a technically sophisticated Player could still
hand-invoke Trystero from their own devtools console to message another Player
directly — there is no server in this architecture to prevent that. Accepted
limitation for an in-person social game; not something to chase.

## Seats, reconnect, and persistence

Two independent `localStorage`-backed mechanisms (`src/utils/reconnect-token.ts` and
`src/utils/host-persistence.ts`), both **same-browser only** — neither helps someone
who switches devices.

- **Player token** (`getOrCreatePlayerToken(roomCode)`): a random per-room, per-browser
  string (not `crypto.randomUUID()` — that requires a secure context, i.e. HTTPS or
  `localhost`, and this app is explicitly tested over plain HTTP on a LAN dev server
  via `npm run dev -- --host`; a hand-rolled `Math.random()`-based token works
  everywhere and doesn't need to resist a determined attacker, only survive a reload).
  Sent in every `hello`. Lets the Storyteller recognize "this is the same seat as
  before" across a Player's reload.
- **Host state** (`saveHostState`/`loadHostState`/`clearHostState`, keyed by room
  code): the Storyteller's `seats`, `scriptId`, `characterAssignments`,
  `reconnectTokenToSeat` map, audit log, and notes, serialized to `localStorage` on
  every mutation and restored on `createHostRoom()` init. All restored `peerId`s are
  immediately reset to `null` — they belonged to the previous Trystero session
  (`selfId` is fresh every reload) and are stale until each seat's occupant
  reconnects and its `hello` is matched via `reconnectTokenToSeat`. Cleared on an
  explicit "Leave Room" click (`clearHostState`), so intentionally ending a game
  doesn't leave stale state behind for next time the same room code is reused —
  but an accidental reload/crash does NOT clear it, which is the whole point.

## Shared modal system + the seat popup's callback design

`ui/modal.ts` is a single shared overlay slot (`openModal(content, className,
onBackdropDismiss?)` / `closeModal()`) used by the character popup, the character
grid picker, the Grimoire's seat popup, and the Setup modal — only one is ever open at
a time, and opening a new one silently closes whatever was already open (e.g. the
character picker opening on top of the seat popup). `onBackdropDismiss` fires **only**
when the user clicks the backdrop itself, deliberately not on every `closeModal()`
call — most `closeModal()` calls in this codebase are a modal closing itself just to
open a *different* one, and that must not be confused with the user dismissing the
whole interaction.

This distinction matters concretely in `screens/host-room/grimoire-panel.ts` +
`seat-modal.ts`, which is the trickiest state-management corner of the app. The
Grimoire tracks `activeSeat: number | null` for "which seat's popup is currently
meant to be open." `seat-modal.ts`'s `SeatModalCallbacks` has three distinct
callbacks precisely because conflating them causes real bugs (this shipped broken
once — the fix is worth preserving):

- `onUpdate()` — seat data changed (rename, alive/vote, character via the "Change"
  button, assigning an unseated peer). Refreshes the token circle and **reopens the
  popup only if `activeSeat` is still non-null** — i.e. only if nothing has dismissed
  it in the meantime. Don't remove that guard; without it, an unrelated event (like
  `onUnseatedChange` firing because a new device connected) would reopen a popup the
  user had already closed.
- `onDismiss()` — the interaction is genuinely ending (✕ button, "Remove seat," "Send
  card," or the backdrop click wired via `onBackdropDismiss`). Sets `activeSeat =
  null`. Always paired with `closeModal()` at the call site, and for "Remove seat"/
  "Send card," called *before* `onUpdate()` so the guard above correctly no-ops.
- `onComposerChange()` — only the in-progress card's element list changed (an element
  added/removed via the composer's buttons). Just reopens the popup with the same
  `composerElements` array (passed by reference from `grimoire-panel.ts`, mutated in
  place by `seat-modal.ts` — no separate sync step needed).

The "Player" composer button is its own small state machine: clicking it closes the
popup (via the plain `closeModal()`, not `onDismiss` — `activeSeat` deliberately stays
set so the popup can reopen afterward), sets a local `pickingPlayer` flag, and shows a
banner ("Tap a seat to add it as a Player…"). While that flag is set, the token
circle's own click handler diverts to pushing a `player` element for whichever seat
was tapped instead of opening that seat's popup, then clears the flag and reopens
`activeSeat`'s popup. `Cancel` in the banner must also clear the flag and hide the
banner — this was the second bug this feature shipped with; if you touch this flow,
verify both the "successfully picked a seat" and "Cancel" paths reset picking state.

`ui/character-picker.ts` is deliberately a *separate* component from the Setup modal's
own character grid (`screens/host-room/setup-modal.ts`), even though both render a
grid of character tokens — the interaction is different enough (single-click-and-close
vs. toggle-many-and-keep-open, with running counts against the suggested
distribution) that sharing one component would need an awkward mode flag. Don't
merge them.

## File layout

```
src/
  main.ts                    # screen switcher; subscribes to the store, swaps #app content.
                              # Also reads a `?join=CODE` URL param (from a Storyteller's
                              # QR code) and routes straight to join-setup with it pre-filled.
  style.css                   # mobile-first; black/gold is the DEFAULT theme regardless of
                               # system preference (matches the physical game's night-phase
                               # aesthetic), with a light variant behind prefers-color-scheme:
                               # light for anyone whose system explicitly asks for it
  types.ts                    # PlayerInfo, HelloPayload, RosterPayload, SecretMessagePayload,
                               # CharacterAssignPayload, NightCardPayload, NightCardElement,
                               # NightActionResponsePayload, Character, Script — every payload
                               # interface needs the `[key: string]: JsonValue` index signature
  data/
    characters.ts              # CHARACTERS: all 22 Trouble Brewing characters (ability,
                                 # clarification, flavor, first/other night text + order,
                                 # wiki/token URLs computed from name/id)
    scripts.ts                  # SCRIPTS (currently just Trouble Brewing), DEFAULT_SCRIPT_ID
  game/
    night-order.ts               # deriveNightOrder(characterIdsInPlay, isFirstNight) — sorts
                                  # by firstNightOrder/otherNightsOrder, prepends synthetic
                                  # "Minion info"/"Demon info" steps on first night
    setup.ts                     # suggestDistribution() (official 5-15p table),
                                  # assignCharacters() (Baron-aware random setup), shuffle()
    night-card.ts                 # nightCardElement() builder — see "Night cards" above
  trystero/
    config.ts                     # APP_ID (namespaces rooms on the shared public relays), ACTIONS
    room.ts                       # createHostRoom() / joinPlayerRoom() — all P2P + privacy +
                                    # persistence logic lives only here; screens never call
                                    # joinRoom/makeAction/localStorage directly
  state/store.ts                  # tiny pub-sub for COARSE state only: screen/roomCode/selfName.
                                   # Deliberately does not carry roster/message/game data.
  utils/
    room-code.ts                   # generateRoomCode() (unambiguous alphabet), normalizeRoomCode()
    reconnect-token.ts              # getOrCreatePlayerToken() — see "Seats, reconnect" above
    host-persistence.ts             # save/load/clearHostState() — see "Seats, reconnect" above
  ui/
    dom.ts                          # el() helper (typed document.createElement + prop assign)
    tabs.ts                         # renderTabs() — shared bottom tab-bar shell; supports a
                                     # per-tab unread badge (setBadge)
    modal.ts                         # openModal()/closeModal() — shared single-overlay-slot
                                      # dialog primitive, see "Shared modal system" above
    roster-panel.ts                  # renderRosterPanel() — shared; host rows clickable-to-select
                                      # (only if peerId isn't null), player rows read-only;
                                      # optional showStatus renders shroud/vote-token icons
    circular-layout.ts                # layoutInCircle() — positions a container's children
                                       # evenly around a circle (Grimoire + Town Square seating);
                                       # container must be square (aspect-ratio: 1)
    message-log.ts                    # appendMessage() — shared, auto-scrolling log entry
    qr-code.ts                        # renderQrCode(url) via qrcode-generator
    character-popup.ts                 # openCharacterPopup(), attachCharacterTrigger() — full
                                        # modal + desktop hover tooltip, used everywhere a
                                        # character appears
    character-picker.ts                 # openCharacterPicker() — single-click character grid
                                         # popup (character assign, night-card element, Town
                                         # Square prediction). NOT shared with Setup's own grid
                                         # — see "Shared modal system" above for why
    script-view.ts                      # renderScriptView() — shared character-list-by-type
                                         # renderer (now shows ability text inline, multi-column
                                         # grid) used by both roles' Script panels
  screens/
    landing.ts, host-setup.ts, join-setup.ts     # unchanged single-screen flows
    host-room/
      index.ts                          # creates the HostRoomHandle, room header (QR toggle,
                                          # leave), the shared cross-tab message log, and the
                                          # tab shell (Grimoire/Script/Messages — no separate
                                          # Seats tab, folded into the Grimoire's seat popup)
      grimoire-panel.ts                   # seat circle (layoutInCircle), night-order sidebar
                                           # (two-column on wide screens), audit log, notes;
                                           # owns activeSeat/composerElements/pickingPlayer state
                                           # and opens seat-modal.ts's content into ui/modal.ts
      seat-modal.ts                        # buildSeatModalContent() — per-seat popup: rename/
                                            # remove/alive/vote/character-assign, vacant-seat
                                            # "assign a connected player" list, and the night
                                            # card composer (quick element buttons + autofill
                                            # preset cards + "Player"-picking flow)
      setup-modal.ts                        # openSetupModal() — manual character-pool picker
                                             # (toggle which characters are in play, checked
                                             # against the suggested distribution) + "randomize
                                             # seat assignment" for the chosen pool only
      script-panel.ts                       # script <select> (currently one option) + renderScriptView
      messages-panel.ts                      # the original ST<->Player text messaging UI
    join-room/
      index.ts                          # creates the PlayerRoomHandle, room header, shared
                                          # roster panel, shared cross-tab state (message log,
                                          # received cards, own character, latest roster), and
                                          # the tab shell (Night Actions/Town Square/Script/Messages)
      night-actions-panel.ts               # own character + ability, full received-card
                                            # history, reply controls for choose-prompts
      town-square-panel.ts                  # seat circle (layoutInCircle) + status, per-player
                                             # prediction (via character-picker.ts, not a
                                             # dropdown) / notes (local-only scratch state),
                                             # default team-count summary
      script-panel.ts                        # read-only renderScriptView wrapper
      messages-panel.ts                       # the original Player<->ST text messaging UI
```

**Why the room screens don't route through the global store:** `host-room/` and
`join-room/` wire the Trystero handle's callbacks directly to their own local DOM
subtrees (roster panel, message log, compose box, tab panels) instead of pushing every
roster/message/night-card update through `state/store.ts`. These events arrive
asynchronously and often — if they triggered a full-screen re-render, they'd wipe out
text a user is mid-typing the moment someone else joins, leaves, or messages. The store
is reserved for rare, user-initiated screen transitions only.

## Known accepted limitations

- Reload used to always mean "the same human reappears as a new roster row" — that's
  now mitigated by the reconnect-token/seat-reclaim mechanism above, but only within
  the same browser. A Player switching to a different device/browser still can't
  reclaim their old seat; they'll appear as a new one, same as before.
- Storyteller-side reload/crash recovery is same-browser only (plain `localStorage`,
  nothing synced elsewhere) — a Storyteller switching devices mid-game loses all
  seat/character/audit-log state, same as if this feature didn't exist.
- A night card with more than one `choosePlayer`/`chooseCharacter` prompt only gets one
  response wired up on the Player's side (see "Night cards" above).
- Town Square predictions and notes are pure in-memory scratch state on the Player's
  own device — not persisted across reload, not sent anywhere. Losing them on
  accidental reload is an accepted gap (see TODO.md's deferred list).
- Character token images hotlink `release.botc.app`'s own asset URLs (a pattern the
  project's own TODO.md suggested) — this is a third-party host we don't control and
  could change its URL scheme without notice; if tokens stop rendering, that's the
  first thing to check.
- Ability/flavor text for the 22 Trouble Brewing characters in `data/characters.ts`
  was written from memory of the official script, not transcribed from a source file —
  spot-check exact wording against a physical almanac/character sheet before trusting
  it verbatim at the table.
- The room code doubles as both the Trystero `roomId` and the `password` (for signaling
  encryption). Both create and join paths normalize it (trim + uppercase) since a
  mismatch silently produces two disjoint rooms with no visible error. Default codes
  are 5+ characters from a ~32-symbol unambiguous alphabet — Nostr relays are a public,
  global namespace, so collisions with unrelated real-world groups are only avoided by
  the code being long enough to be effectively unguessable, not by any registration.
- No server-side enforcement against a Player manually invoking Trystero actions from
  devtools to reach another Player directly (see above).
- Not every composer preset card in `seat-modal.ts` has an unambiguous default to
  autofill — "This player is," "This character selected you," "Use your Ability?,"
  and "Make a Choice" only insert a text/prompt template, not real player/character
  data, because the app has no way to know which specific ability is being run.
  Revisit these against real play if the mapping feels off at the table.
- A night card composer's "Player" button only supports picking one player at a time
  per click (tap it again to add another) — there's no multi-select tap mode.
- The Setup modal's "randomize seat assignment" button is disabled unless the number
  of selected characters exactly equals the number of seats — there's no partial/
  best-effort assignment for a mismatched count.

## Running locally / testing

- `npm run dev -- --host` exposes the dev server on the LAN for testing from a phone.
- `npm run build && npm run preview` tests the real production bundle.
- Because signaling goes over real public Nostr relays, even two tabs on one machine
  exercise genuine (if fast) network handshakes — but for a real validation, test
  across actual separate devices, including at least one on cellular data rather than
  the same Wi-Fi, to confirm it isn't accidentally relying on same-subnet behavior.
- Verification checklist (original comms MVP, still applies): sequential and
  simultaneous joins produce a correctly-ordered roster on every screen; renames
  update in place; a Player leaving keeps their seat (now shown as disconnected,
  not removed); a Storyteller→Player secret message is invisible to other Players
  and vice versa; closing the Storyteller's tab shows Players a disconnect banner.
- Additional checklist for this pass's features (none of this has been run yet —
  everything below is "implemented," not "tested & functional" in TODO.md's terms):
  - Reload a Player's tab mid-game → they should reclaim their same seat (name,
    alive/vote-token state, and character all intact), not appear as a duplicate.
  - Reload/crash the Storyteller's tab mid-game → seats, character assignments,
    script, audit log, and notes should all still be there once Players reconnect.
  - Scan the Storyteller's QR code from a phone camera → lands on join-setup with
    the room code pre-filled.
  - Send a night card combining several element kinds in one message → Player sees
    all of them together, in order, as one card.
  - Send a `choosePlayer`/`chooseCharacter` prompt → Player's response reaches the
    Storyteller and is attributed to the right seat.
  - Setup modal: toggle characters including Baron → outsider count in the running
    tally should read +2 / townsfolk -2 versus the base distribution; "randomize seat
    assignment" should stay disabled until selected count equals seat count.
  - Switch away from the Messages tab, have another device send a message, switch
    back → the message should be there (this is the scenario the listener-Set
    refactor above exists to fix — regression-test it specifically).
  - A brand-new device joining (no matching reconnect token) should appear in a
    vacant seat's "Assign a connected player" list, not automatically get its own
    seat; assigning it should move it out of that list and into the seat, and a
    *later* reload of that same device should reclaim the seat directly.
  - Composer "Player" button: click it, popup should close and a "tap a seat" banner
    appear; tapping a seat should add it as an element and reopen the popup with the
    Grimoire and Town Square circles rendering evenly regardless of seat count (try
    2, 5, and 12 seats).
  - Click outside a seat popup / character picker to dismiss it, then trigger an
    unrelated update (e.g. another device connecting) → the popup must NOT reopen by
    itself (this is the activeSeat/onDismiss bug described in "Shared modal system"
    above — regression-test it specifically).
