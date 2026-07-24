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

### The seven Trystero actions (`src/trystero/config.ts`, `src/trystero/room.ts`)

- `hello` (Player → Storyteller, targeted): a Player announces/re-announces
  `{name, reconnectToken}` to a peer as soon as `room.onPeerJoin` fires for that peer.
- `roster` (Storyteller → everyone, broadcast): `{storytellerId, scriptId, players:
  PlayerInfo[]}`. `PlayerInfo` is **public seat data only** — `{seat, name, peerId,
  alive, voteToken}` — deliberately excludes character assignment; see the privacy
  note below.
- `secretMessage` (Storyteller → one Player, targeted only in this direction now):
  `{text, ts}` — the Storyteller's quick-message send box in a seat's popup
  (`handle.sendToPlayer`). Used to share the same action name for both directions;
  Players now send their own unprompted content via the richer `playerCard` action
  instead (see "Messages and night cards are unified" below), so there is no
  `secretMessage.onMessage` handler on the Storyteller's side anymore.
- `characterAssign` (Storyteller → one Player, targeted): `{characterId, ts}` — the
  *only* way a Player learns their own character. Never broadcast.
- `nightCard` (Storyteller → one Player, targeted): `{elements: NightCardElement[],
  ts}` — a composed night card (see "Night cards" below).
- `playerCard` (Player → Storyteller, targeted): same payload shape as `nightCard`
  (literally reuses the `NightCardPayload` type — no separate type needed since the
  shape carries no directional semantics itself) — a Player's own composed card (a
  "Got it," a chosen player, custom text, or several queued together). The reverse
  direction of `nightCard`; lands in that seat's message log via `onPlayerCard`.
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
type. Don't try to derive it from `NightCardElement` again.) The same module also
exports `describeNightCardElement(element)`, a short one-line preview used by every
composer's pending-list-before-sending and by the Storyteller's per-seat message log
— it used to be duplicated between `seat-modal.ts` and `night-actions-panel.ts`;
don't reintroduce a second copy.

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

### Every payload interface needs the index signature (still true, 6 payload types for 7 actions)

Trystero's `makeAction<T>()` requires an explicit `[key: string]: JsonValue` index
signature on named interfaces passed as `T` (a plain object literal wouldn't need
this, but a declared interface does) — this applies to `HelloPayload`,
`RosterPayload`, `SecretMessagePayload`, `CharacterAssignPayload`, `NightCardPayload`,
and `NightActionResponsePayload` in `types.ts`. Six *types* for seven *actions*
because `playerCard` reuses `NightCardPayload` verbatim rather than needing its own —
the shape (`{elements, ts}`) carries no inherent direction.

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
target peerId — both `sendPlayerCard` and `respondToNightCard` in
`src/trystero/room.ts` hardcode `{target: storytellerId}`. Caveat: a technically
sophisticated Player could still
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
  `reconnectTokenToSeat` map, `seatNotes` (private per-seat reminders), audit log, and
  general notes, serialized to `localStorage` on every mutation and restored on
  `createHostRoom()` init. All restored `peerId`s are immediately reset to `null` —
  they belonged to the previous Trystero session (`selfId` is fresh every reload) and
  are stale until each seat's occupant reconnects and its `hello` is matched via
  `reconnectTokenToSeat`. Cleared on an explicit "Leave Room" click (`clearHostState`),
  so intentionally ending a game doesn't leave stale state behind for next time the
  same room code is reused — but an accidental reload/crash does NOT clear it, which
  is the whole point.

A third, separate mechanism, `src/utils/session.ts`, is what makes a reload land back
on the right *screen* at all rather than the landing page — `saveLastSession({screen,
roomCode, selfName})` is called on entering `host-room`/`join-room`, `main.ts` reads
it back via `loadLastSession()` on boot (unless a `?join=` URL param is present, which
always wins — see below) and re-navigates there, and `clearLastSession()` runs on an
explicit "Leave Room" click, mirroring `clearHostState`'s reasoning. This is purely a
*navigation* aid — the actual rejoin correctness still comes entirely from the
reconnect-token/host-state mechanisms above; `session.ts` just gets the app to attempt
it instead of stopping at landing. `saveLastName`/`loadLastName` in the same module is
an unrelated, simpler bit of persistence (just the last-typed display name, to
pre-fill `join-setup`'s name field next time).

`src/utils/connection-watchdog.ts`'s `watchForStaleConnection(onStale)` addresses a
different, harder problem: a device that's been backgrounded (tab hidden / phone
locked) for a while can end up with a silently-dead WebRTC/signaling connection — the
Storyteller thinks they're connected, but Players in the room can't see them, and new
joiners can't either. There's no reliable way to distinguish "genuinely dead" from
"just slow" through Trystero's public API, so rather than attempting a risky in-place
reconnect (untested, and `selfId` reappearing under a new `joinRoom()` call while
peers still hold the old one is unclear behavior), this detects the likely trigger —
hidden for more than 15 seconds — via the Page Visibility API and does a full
`location.reload()`, which is guaranteed to recover correctly because it's the exact
scenario the reconnect-token/host-state mechanisms already handle. Both
`host-room/index.ts` and `join-room/index.ts` wire this to `() =>
location.reload()`. The 15-second threshold is an untested guess — revisit it once
there's a real report to calibrate against.

## Shared modal system + the seat popup's callback design

`ui/modal.ts` is a single shared overlay slot (`openModal(content, className,
onBackdropDismiss?)` / `updateModalContent(content)` / `closeModal()`) used by the
character popup, the character grid picker, the Grimoire's seat popup, the Setup
modal, the Lobby modal, and the Town Square seat/player-picker popups — only one is
ever open at a time, and opening a new one silently closes whatever was already open
(e.g. the character picker opening on top of the seat popup). `onBackdropDismiss`
fires **only** when the user clicks the backdrop itself, deliberately not on every
`closeModal()` call — most `closeModal()` calls in this codebase are a modal closing
itself just to open a *different* one, and that must not be confused with the user
dismissing the whole interaction.

**`updateModalContent` vs. `openModal` — this one shipped broken too:** anything that
re-renders in response to its own interactions (a composer button click, a Setup
checkbox toggle, a prediction change) must call `updateModalContent(freshContent)`
first and only fall back to `openModal(...)` if that returns `false` (no modal
currently open). Calling `openModal` unconditionally on every such refresh — which is
what shipped first — destroys and recreates the overlay `<div>` every time, and since
the overlay itself (not its content) is what carries `scrollTop`, that silently reset
scroll to the top on every single click. `updateModalContent` swaps the content of the
*same* overlay element in place, so its scroll position survives. Every "just
refresh what's already open" call site in `grimoire-panel.ts`, `seat-modal.ts`,
`setup-modal.ts`, `town-square-panel.ts`, and `lobby-modal.ts` follows this pattern —
don't add a new one that skips straight to `openModal`.

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
    session.ts                      # saveLastSession()/loadLastSession()/clearLastSession() +
                                     # saveLastName()/loadLastName() — see "Seats, reconnect" above
    connection-watchdog.ts           # watchForStaleConnection() — see "Seats, reconnect" above
  ui/
    dom.ts                          # el() helper (typed document.createElement + prop assign)
    tabs.ts                         # renderTabs() — shared bottom tab-bar shell; supports a
                                     # per-tab unread badge (setBadge)
    modal.ts                         # openModal()/updateModalContent()/closeModal() — shared
                                      # single-overlay-slot dialog primitive, see "Shared modal
                                      # system" above
    token-image.ts                   # renderTokenImage() — always wraps an <img> (or placeholder
                                      # initial) in a container div; needed because a death-shroud
                                      # ::after overlay doesn't render on a bare <img> in any browser
    circular-layout.ts                # layoutInCircle() — positions a container's children
                                       # evenly around a circle (Grimoire + Town Square seating);
                                       # container must be square (aspect-ratio: 1)
    qr-code.ts                        # renderQrCode(url) via qrcode-generator
    character-popup.ts                 # openCharacterPopup(), attachCharacterTrigger() — full
                                        # modal + desktop hover tooltip, used everywhere a
                                        # character appears
    character-picker.ts                 # openCharacterPicker() — single-click character grid
                                         # popup (character assign, night-card element, Town
                                         # Square prediction). NOT shared with Setup's own grid
                                         # — see "Shared modal system" above for why
    script-view.ts                      # renderScriptView() — shared character-list-by-type
                                         # renderer (ability text inline, CSS-column layout, plus
                                         # the 5-15+ player distribution table) used by both
                                         # roles' Script panels
  screens/
    landing.ts, host-setup.ts, join-setup.ts     # unchanged single-screen flows (join-setup.ts
                                                  # now also pre-fills the name field from
                                                  # utils/session.ts's loadLastName())
    host-room/
      index.ts                          # creates the HostRoomHandle, compact room header (QR
                                          # toggle, leave), the persistent per-seat message map
                                          # (see "Messages and night cards are unified" below),
                                          # session-persistence + connection-watchdog wiring, and
                                          # the tab shell (Grimoire/Script — no separate Seats or
                                          # Messages tab; both folded into the Grimoire's seat popup)
      grimoire-panel.ts                   # seat circle (layoutInCircle), a "Lobby" button
                                           # (lobby-modal.ts), night-order sidebar (two-column on
                                           # wide screens), audit log, general notes below the
                                           # fold; owns activeSeat/composerElements/pickingPlayer
                                           # state and opens seat-modal.ts's content into ui/modal.ts
      seat-modal.ts                        # buildSeatModalContent() — per-seat popup, now a
                                            # two-column layout (game state left, messages + night
                                            # card composer right) on wide screens: rename/remove/
                                            # alive/vote/character-assign, vacant-seat "assign a
                                            # connected player" list, a private per-seat reminder
                                            # note, a per-seat message log + quick-send box, and the
                                            # night card composer (quick element buttons + autofill
                                            # preset cards + "Player"-picking flow)
      setup-modal.ts                        # openSetupModal() — manual character-pool picker
                                             # (toggle which characters are in play, checked
                                             # against the suggested distribution) + "randomize
                                             # seat assignment" for the chosen pool only
      lobby-modal.ts                         # openLobbyModal() — Storyteller-only overview of
                                              # every connected device, seated or not; the ST-side
                                              # equivalent of the roster list Players no longer see
      script-panel.ts                       # script <select> (currently one option) + renderScriptView
    join-room/
      index.ts                          # creates the PlayerRoomHandle, compact room header
                                          # (display name inline), shared cross-tab state (the
                                          # unified feed, own character, latest roster),
                                          # session-persistence + connection-watchdog wiring, and
                                          # the tab shell (Night Actions/Town Square/Script — no
                                          # top-level roster list, no separate Messages tab)
      night-actions-panel.ts               # own character + ability, the unified feed (see
                                            # "Messages and night cards are unified" below), a
                                            # queueable composer ("Got it" / "Player" via
                                            # openPlayerPicker / custom text, all addable before one
                                            # Send, mirroring the Storyteller's own composer), and
                                            # reply controls for choose-prompts
      town-square-panel.ts                  # seat circle (layoutInCircle); tapping a seat opens a
                                             # popup (ui/modal.ts) with status, a prediction picker
                                             # (via character-picker.ts), and notes — mirrors the
                                             # Grimoire's "click a seat" pattern. Also exports
                                             # openPlayerPicker() (a read-only variant of the same
                                             # circle, used by night-actions-panel.ts's "Player"
                                             # composer button). Subscribes to onRosterChange
                                             # itself (live-updates while mounted, not just at
                                             # mount time)
      script-panel.ts                        # read-only renderScriptView wrapper; also
                                              # subscribes to onRosterChange in case the
                                              # Storyteller changes the script mid-game
```

**Why the room screens don't route through the global store:** `host-room/` and
`join-room/` wire the Trystero handle's callbacks directly to their own local DOM
subtrees (roster panel, seat popups, tab panels) instead of pushing every
roster/message/night-card update through `state/store.ts`. These events arrive
asynchronously and often — if they triggered a full-screen re-render, they'd wipe out
text a user is mid-typing the moment someone else joins, leaves, or messages. The store
is reserved for rare, user-initiated screen transitions only.

## Messages and night cards are unified (no separate "Messages" tab)

A plain text message and a structured night card are now the same concept, displayed
through the same feed/log on both sides — there is no standalone "Messages" tab
anywhere in the app anymore (the original `screens/*/messages-panel.ts` and
`ui/message-log.ts` are deleted, and so is the Player-outgoing half of the old
`secretMessage`-based path — see below).

- **Player side** (`night-actions-panel.ts`): `FeedEntry = {ts, self, elements:
  NightCardElement[]}`. A plain message (either direction) is represented as a card
  with exactly one `text` element — built via the same `nightCardElement()` helper as
  everything else, so `renderElement()` renders both received night cards and plain
  messages through identical code. The composer is **queued**, matching the
  Storyteller's own composer exactly: "Got it," "Player" (opens
  `town-square-panel.ts`'s `openPlayerPicker()` so the Player picks with the same
  context — status, their own predictions — visible, rather than a bare list), and
  custom text all push onto a local `pendingElements` array with a visible
  remove-able preview (`describeNightCardElement`), and a single "Send" flushes the
  whole queue via `handle.sendPlayerCard(pendingElements)` — a real structured card
  over the wire, not text squashed into one string. The Storyteller's per-card choose-
  prompt replies still go over the separate `respondToNightCard`/`nightActionResponse`
  action, tied to a specific card's `forTs` — that mechanism is unchanged.
- **Storyteller side** (`seat-modal.ts`'s `buildMessageLog()`): scoped per-seat rather
  than a single global list, since a seat's popup is already "everything about this
  player." `SeatMessage = {ts, self, elements: NightCardElement[]}` — the *same shape*
  as the Player's `FeedEntry`, rendered as a joined `describeNightCardElement(...)`
  summary per entry (a compact one-line log, not the Player's richer per-element
  rendering). Two things feed this log: the Storyteller's own quick-send box (still
  wire-compatible plain text via `handle.sendToPlayer`/`secretMessage`, wrapped as a
  single-`text`-element `SeatMessage` for display), and incoming `onPlayerCard` events
  (the Player's queued sends, arriving with their full element list intact). Sent
  night *cards* (via `sendNightCard`) remain tracked separately in the global, ST-only
  audit log (`grimoire-panel.ts`) — not duplicated into the per-seat log.
- **The old Player → Storyteller `secretMessage`/`sendToStoryteller` path is gone, not
  just unused.** Since `playerCard` fully supersedes it, `PlayerRoomHandle.
  sendToStoryteller` and `HostRoomHandle.onPlayerMessage` (plus the Storyteller's
  `secretMessage.onMessage` handler and its `messageListeners` Set) were deleted
  rather than left as dead code — `secretMessage` now only flows Storyteller → Player
  (`sendToPlayer`/`onStorytellerMessage`), and nothing in this codebase calls
  `secretMessage.send` from the Player side anymore. If you're looking for where
  Players used to send free-form text, that's `sendPlayerCard` now.
- The `messagesBySeat: Map<seat, SeatMessage[]>` map lives in `host-room/index.ts`
  (persistent for the room's lifetime), populated by a single top-level `onPlayerCard`
  subscription there — for the same reason the Player-side feed and the listener Sets
  exist at all: `grimoire-panel.ts` is torn down and recreated every time its tab is
  (re)activated, so if the map were populated there instead, a card arriving while the
  Storyteller was on the Script tab would be lost. `grimoire-panel.ts` registers its
  *own* `onPlayerCard` too, but only to decide whether to live-refresh an already-open
  seat popup — it must not also push into the map, or entries would double up.

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
- Ability/flavor/night-info/clarification text for the 22 Trouble Brewing characters in
  `data/characters.ts` has been hand-refined against the official script; if it's ever
  regenerated or touched wholesale again, don't silently overwrite this without
  checking with whoever last edited it.
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
- Mobile viewports are not specially reflowed to avoid all scrolling — the explicit
  design choice (per TODO.md) is that a Player can pinch-zoom instead, so small-screen
  layouts prioritize fitting real content (the seat circle, the composer's button
  grids) over shrinking everything to avoid ever needing zoom.
- `#app`'s fixed-height/`overflow: hidden` shell (see "Fit-to-screen layout" in
  TODO.md) assumes each screen manages its own internal scrolling correctly. If you
  add a new screen or panel with a lot of content and it doesn't have a `min-height: 0`
  chain down to whichever element should scroll, content can get silently clipped
  instead of scrolling — this is a real footgun of the fixed-shell approach, worth
  checking whenever a new panel is added.
- The connection watchdog's "hidden for 15+ seconds → reload" heuristic is a guess,
  not something verified against a real stale-connection repro — it may need a
  different threshold, or a different signal entirely, once there's real evidence of
  what actually triggers the reported symptom.
- The auto-rejoin-on-reload session (`utils/session.ts`) doesn't verify the room still
  exists before navigating back to it — if the Storyteller's room is truly gone (they
  clicked "Leave Room" is the one case this already handles, but e.g. clearing browser
  data wouldn't), a Player would just land on a room screen with an empty/stale roster
  rather than being told "this room doesn't exist." No worse than manually re-joining
  a dead code would have been, just not actively detected either.

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
  - Switch the Storyteller away from the Grimoire tab (e.g. to Script), have a Player
    send a message/"Got it" → switch back to the Grimoire and open that seat's popup
    → the message should be there (this is the scenario the listener-Set refactor
    above exists to fix — regression-test it specifically; `messagesBySeat` living in
    `host-room/index.ts` rather than `grimoire-panel.ts` is what makes this work).
  - A Player on Town Square (not Night Actions) when the Storyteller assigns/changes
    their character or the roster otherwise changes → Town Square should update in
    place without needing to switch tabs and back.
  - Send a plain "Got it" from Night Actions, and separately have the Storyteller send
    a quick message from a seat's popup → both should land in the same chronological
    feed/log on the respective side, not a separate list.
  - Resize the browser window (or check on an actual desktop monitor) → the Grimoire's
    seat circle should visibly grow on a wider/taller window, the tab bar should never
    scroll out of view even with many seats, and the Script view's character list
    should use multiple columns rather than one long scrolling column.
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
  - Add several elements in a seat's night-card composer (or Setup's character grid,
    or the Player's own composer), clicking around between additions → scroll
    position inside the modal must NOT jump back to the top on each click (this is
    the updateModalContent-vs-openModal bug — regression-test it specifically, since
    it's easy to reintroduce by routing a new "just refresh" call through `openModal`).
  - A dead seat's token should show a visibly shrouded/desaturated circle over the
    token image itself (not a gravestone emoji next to the name) — check both the
    Grimoire and Town Square circles.
  - Storyteller: click "Lobby" → seated and not-yet-seated connections both show, and
    the list updates live while the modal stays open (join a new device while it's open).
  - Storyteller: set a private per-seat reminder note in a seat's popup → it should
    persist across a Storyteller reload and never appear on the Player's own screen.
  - Player: from Night Actions, tap "Player" → Town Square's circle should open as a
    picker (not a bare list); picking a seat should add it to the pending queue, which
    should support adding several elements (including another "Player") before Send,
    matching the Storyteller composer's queue-then-send pattern.
  - Reload the Player's or Storyteller's tab (without clicking "Leave Room" first) →
    the app should land back in the same room, not on the landing screen; clicking
    "Leave Room" first and then reloading (or reopening the app fresh) should NOT
    auto-rejoin.
  - Background a tab (switch away / lock the screen) for 20+ seconds, then bring it
    back to the foreground → expect a full page reload to have happened automatically
    and the room to be rejoined correctly afterward.
  - Seat modal and character/Setup pickers should visibly use much more of a wide
    desktop window than before — the seat popup specifically should show game state
    and the night-card composer side by side on a wide screen, stacked on a narrow one.
