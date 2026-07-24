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

### The five Trystero actions (`src/trystero/config.ts`, `src/trystero/room.ts`)

There used to be a sixth, `nightActionResponse` — a Player's structured answer to a
`choosePlayer`/`chooseCharacter` prompt embedded in a card. It was removed along with
those two `NightCardElementKind`s entirely: the Storyteller sends "Make a Choice" (now
just plain text) and the Player replies with their own night card through the unified
message log (see "Messages and night cards are unified" below) — a separate
choose-and-respond element added a whole extra action, payload type, and per-card
response-UI wiring without adding any capability the unified feed didn't already cover.
If you're tempted to reintroduce a structured "pick one of these and send it back"
element, don't — route it through the existing composer-then-`sendPlayerCard` flow
instead.

There also used to be a seventh (by that older count), `secretMessage` — a plain-text action shared by both
directions. It's gone entirely now, not just unused on one side: once the
Storyteller's "quick message" send box was removed (custom text in the night-card
composer already covers free text) and Players moved to `playerCard` for their own
unprompted sends, nothing called `secretMessage.send` from *either* side anymore, so
the action, its Trystero registration, `HostRoomHandle.sendToPlayer`,
`PlayerRoomHandle.onStorytellerMessage`, and `SecretMessagePayload` in `types.ts` were
all deleted together. If you're tempted to add a "just send some text" escape hatch
back in, don't — route it through `sendNightCard`/`sendPlayerCard` as a single `text`
element instead, so it stays part of the same per-seat log (see "Messages and night
cards are unified" below).

- `hello` (Player → Storyteller, targeted): a Player announces/re-announces
  `{name, reconnectToken}` to a peer as soon as `room.onPeerJoin` fires for that peer.
- `roster` (Storyteller → everyone, broadcast): `{storytellerId, scriptId, players:
  PlayerInfo[]}`. `PlayerInfo` is **public seat data only** — `{seat, name, peerId,
  alive, voteToken}` — deliberately excludes character assignment; see the privacy
  note below.
- `characterAssign` (Storyteller → one Player, targeted): `{characterId, ts}` — the
  *only* way a Player learns their own character. Never broadcast.
- `nightCard` (Storyteller → one Player, targeted): `{elements: NightCardElement[],
  ts}` — a composed night card (see "Night cards" below). Works even if the target
  seat is currently disconnected — see "Sending to a disconnected seat" below.
- `playerCard` (Player → Storyteller, targeted): same payload shape as `nightCard`
  (literally reuses the `NightCardPayload` type — no separate type needed since the
  shape carries no directional semantics itself) — a Player's own composed card (a
  "Got it," a chosen player, custom text, or several queued together). The reverse
  direction of `nightCard`; lands in that seat's message log via `onPlayerCard`.

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

The "dies tonight" flag (`diesTonight: Set<number>`, alongside `characterAssignments` in
`room.ts`'s closure, persisted as `HostState.diesTonightSeats`) follows the exact same
pattern and for the exact same reason: it must never be derivable from anything sent
over the wire, or a technically-inclined Player could learn a death is coming before
it's announced by inspecting the roster payload in devtools. Unlike `characterId`
there's no targeted "reveal to just this seat" action for it either — it's pure
Storyteller-side bookkeeping until `revealAllDeaths()` flips the affected seats' public
`alive` field and broadcasts that like any other roster change. If you're ever tempted
to fold `diesTonight` into `PlayerInfo` "just to simplify the types," don't — that would
put it in the broadcast roster and defeat the entire point of the feature.

### Night cards: one composable payload, not one type per ability

`NightCardElement` (`types.ts`) is a flat tagged interface, not a discriminated union —
every field is present but `null` unless relevant to that element's `kind` (`text`,
`number`, `player`, `character`). There used to also be a `characterChange` kind,
specifically for the "You are" preset's reveal — it was removed because the
Storyteller asked for that preset to add the exact same plain `text`/`character`
elements the Good/Evil/Character quick buttons produce (so they're indistinguishable
and freely editable in the composer list), which made `characterChange` a kind with no
remaining producer. Its side effect (automatically calling `handle.assignCharacter`)
went with it — an actual character reassignment now only ever happens through the
"Change" button in a seat's Character row, never implicitly via a sent card. There also
used to be `choosePlayer`/`chooseCharacter` kinds (plus `prompt`/`characterIds` fields
to support them) — removed along with the `nightActionResponse` action they drove (see
"The five Trystero actions" above); "You are" now additionally prepends a plain "You
are" text element ahead of the Good/Evil/Character ones, so the recipient knows the
following info describes themself rather than someone else.
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
per TODO.md's "prepare all information and then send it in one card." There is no
separate audit log anymore — the card is appended directly to that seat's own
`seatMessages` entry (see "Messages and night cards are unified" below), which is
itself the only record of what was sent.

### Sending to a disconnected seat (`pendingCards`)

`sendNightCard(seat, elements)` no longer requires the target seat to have a device
currently connected. If `seatEntry.peerId` is `null`, the card is pushed onto
`pendingCards: Record<seat, NightCardPayload[]>` (persisted alongside the rest of
`HostState`) instead of being sent immediately; it's still appended to `seatMessages`
right away either way, since from the Storyteller's point of view the card was sent the
moment they clicked the button, regardless of delivery timing. Delivery happens the
next time that seat's `hello` reclaims it: the reclaim branch of `hello.onMessage` now
also drains and clears that seat's `pendingCards` queue (oldest first) before
persisting. `removeSeat`/`swapSeats` keep `pendingCards` in sync the same way they do
`seatMessages`/`seatNotes`. `HostRoomHandle.isSeatConnected(seat)` is what
`seat-modal.ts` uses to decide whether to show the Send button as a normal "Send card"
or an orange/warning-colored "Queue card" with an inline warning line — this is a pure
read, it doesn't affect whether sending is allowed (it always is).

**This shipped with a real bug, worth understanding if you touch `sendNightCard`
again:** it originally stored the caller's `elements` array *by reference* in the sent
payload, the `seatMessages` log entry, and the `pendingCards` queue entry. But
`seat-modal.ts`'s Send button clears its own composer array **in place**
(`composerElements.length = 0`) immediately after calling `sendNightCard` — and since
arrays are reference types, that mutation reached into all three places the array had
just been stashed. For an immediately-delivered card this was invisible (the WebRTC
send had already serialized the data before the array was cleared), but a *queued*
card for a disconnected seat — and the Storyteller's own message-log entry for
literally any sent card, once the seat popup was reopened later — ended up rendering
as an empty card ("0 info"). The fix: `sendNightCard` now makes one `[...elements]`
copy up front and stores/sends that copy everywhere, decoupling it from whatever the
caller does to its own array afterward. If you add another call site that hands
`room.ts` a live, mutable array (rather than a fresh literal), assume the same trap
applies and copy defensively.

### Every payload interface needs the index signature (still true, 4 payload types for 5 actions)

Trystero's `makeAction<T>()` requires an explicit `[key: string]: JsonValue` index
signature on named interfaces passed as `T` (a plain object literal wouldn't need
this, but a declared interface does) — this applies to `HelloPayload`,
`RosterPayload`, `CharacterAssignPayload`, and `NightCardPayload` in `types.ts`. Four
*types* for five *actions* because `playerCard` reuses `NightCardPayload` verbatim
rather than needing its own — the shape (`{elements, ts}`) carries no inherent
direction. `SeatMessage` (also in `types.ts`, next to these) looks similar but is
*not* a network payload — it's never sent over Trystero itself, only stored/rendered
locally, so it doesn't need the index signature.

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
target peerId — `sendPlayerCard` in `src/trystero/room.ts` hardcodes `{target:
storytellerId}`. Caveat: a technically sophisticated Player could still
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
  `reconnectTokenToSeat` map, `seatNotes` (private per-seat reminders), `seatMessages`
  (the per-seat sent/received card log — see "Messages and night cards are unified"
  below), `unreadSeats`, `pendingCards`, `diesTonightSeats` (see "Privacy: why
  character assignment is never in the roster" above), and general notes, serialized to
  `localStorage` on every mutation and restored on `createHostRoom()` init. All restored
  `peerId`s are
  immediately reset to `null` — they belonged to the previous Trystero session
  (`selfId` is fresh every reload) and are stale until each seat's occupant reconnects
  and its `hello` is matched via `reconnectTokenToSeat`. Cleared on an explicit "Leave
  Room" click (`clearHostState`), so intentionally ending a game doesn't leave stale
  state behind for next time the same room code is reused — but an accidental
  reload/crash does NOT clear it, which is the whole point.

A third, same-browser-only mechanism, `src/utils/player-local-state.ts`, persists
purely client-side Player scratch state that's never sent anywhere: their own view of
the unified feed (`loadPlayerFeed`/`savePlayerFeed`, keyed by room code) and their Town
Square predictions/notes (`loadTownSquareLocal`/`saveTownSquareLocal`). Both used to be
in-memory only and were lost on the Player's own reload — the Storyteller's own copy of
the message exchange already survived (see "Messages and night cards are unified"
below), but the Player's local view of it didn't, which is what this closes. Loaded
once at module-init time in `town-square-panel.ts`/`join-room/index.ts` and
re-persisted on every mutation; there's no cross-device sync here any more than there
is for `host-persistence.ts` — it's scoped to `localStorage`, so switching devices
starts the Player's local view fresh (their seat/character/roster info itself still
comes back correctly via the reconnect token, only their own scratch notes are lost).

A fourth mechanism, `src/utils/session.ts`, is what makes a reload land back
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
scenario the reconnect-token/host-state mechanisms already handle. The 15-second
threshold is an untested guess — revisit it once there's a real report to calibrate
against.

Neither `host-room/index.ts` nor `join-room/index.ts` wire this straight to `() =>
location.reload()` anymore — both now check `ui/modal.ts`'s `isModalOpen()` first and
skip the reload if a modal is currently open (a seat popup, a character picker), since
reloading out from under one would silently discard whatever the user was mid-way
through. `join-room/index.ts` additionally skips if
`nightActionsState.pendingElements.length > 0` — the Player's composer isn't inside a
modal, so `isModalOpen()` alone wouldn't catch "mid-way through queueing a night card."
This is a one-shot skip, not a retry: if the guard trips, the reload for that
particular stale-connection event just doesn't happen, and the user is expected to
either finish what they're doing and use the disconnect banner's manual "Refresh
connection" button, or wait for the next stale-connection detection.

`join-room/index.ts` also has its own separate, narrower auto-reload: previously a
Player stuck on `onStorytellerLeave`'s disconnect banner had no way to recover short of
manually reloading their tab, even after the Storyteller's own reload had already fixed
things on the wire — nothing re-checked the connection once the banner appeared. Now
`onStorytellerLeave` starts an 8-second `setTimeout` (cleared on the next
`onRosterChange`, i.e. as soon as the connection actually recovers) that reloads
automatically, gated by the same `isModalOpen()`/`pendingElements` guard as above. The
banner itself also gained a manual "Refresh connection" button (same `location.reload()`
as the Storyteller's Lobby modal button) for the impatient/guarded-out case.

`HostRoomHandle.resyncConnectedSeats()` is a different, ST-triggered nudge: it
re-broadcasts the roster and re-sends `characterAssign` to every currently-connected
seat, without touching any state. `lobby-modal.ts` calls it every time the modal opens.
This exists because a Player's view can in principle go stale for reasons the app
can't detect on its own (a dropped/late message, a tab that was suspended and resumed
without triggering the watchdog, etc.) — reopening the Lobby is a natural, low-cost
moment for the Storyteller to force everyone back in sync, cheaper than asking a Player
to reload. It deliberately reuses the existing `characterAssign`/`roster` actions and
their already-wired-up listeners (`onCharacterAssign` refreshes "Your Character" in
`night-actions-panel.ts`, `onRosterChange` refreshes Town Square's roster) rather than
introducing a new "resync" action — there's nothing this needs to do that resending
those two doesn't already cover.

### "Dies tonight": a hidden flag, kept structurally separate from `alive`

`diesTonight: Set<number>` (in `room.ts`'s closure, persisted as
`HostState.diesTonightSeats`) lets the Storyteller mark a seat to die tonight without
revealing anything to Players before the morning announcement — see "Privacy: why
character assignment is never in the roster" above for why this can't live on
`PlayerInfo`. `setDiesTonight(seat, flag)` only toggles the flag and persists; it does
NOT touch `seat.alive`. `revealAllDeaths()` is the one action that turns a hidden flag
into a public fact: for every seat in the set, it sets `alive = false`, then clears the
set and broadcasts the roster like any other public change. `seat-modal.ts` disables
the "Dies tonight" toggle for an already-dead seat (`disabled: !seat.alive`) since the
flag is only meaningful as a "not yet" state. `grimoire-panel.ts`'s "Reveal deaths"
button in the tokens header is disabled whenever nothing is currently flagged (checked
fresh inside `refreshTokenGrid()` on every render, not tracked as separate state).

On the Grimoire, a flagged-but-still-alive seat gets a `.dying` class instead of
`.dead` — CSS-wise this means the gray diagonal slash (`::after`) without the
grayscale/darken `filter` that `.dead` applies, so the token stays recognizable at a
glance while still visibly marked. `.dying` is only ever computed/applied in
`grimoire-panel.ts`; Town Square has no equivalent, because `diesTonight` was never
sent to it in the first place — there's no rendering-layer check to "hide" it from
Players, the data structurally can't reach them.

### Toggle buttons and the no-vote-token indicator

Alive/Vote token (and the new Dies tonight) used to be `<input type="checkbox">` +
`<label>` pairs in the seat popup; they're now `.toggle-button` elements whose `.active`
class is recomputed from current seat state every time the popup rebuilds (the same
"just re-render the whole thing" pattern the rest of this codebase already uses instead
of hand-patching individual DOM nodes) — smaller footprint, and consistent with the
rest of the composer's button-grid UI rather than mixing in native form controls.

A seat with no vote token (independent of alive/dead/dying — a dead seat commonly has
already spent its one ghost vote) gets a `no-vote` class on its `.seat-token-image`
(now accepted as a third parameter to `ui/token-image.ts`'s `renderTokenImage()`),
rendering a small purple circle (`--vote-missing`) concentric with the token via
`::before`. `::after` on the same element is already spoken for by the death/dying
overlays, which is exactly why the vote-missing indicator had to use the other
available pseudo-element slot — the two need to be able to coexist (a dead seat with no
vote token is the common case, not an edge case). Applied identically on both the
Grimoire (`grimoire-panel.ts`) and Town Square (`town-square-panel.ts`'s shared
`seatTokenChildren()`), unlike `.dying` which is Grimoire-only.

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

**`updateModalContent` vs. `openModal` — this shipped broken twice, in two different
ways:** anything that re-renders in response to its own interactions (a composer
button click, a Setup checkbox toggle, a prediction change) must call
`updateModalContent(freshContent)` first and only fall back to `openModal(...)` if
that returns `false` (no modal currently open).

1. First bug: calling `openModal` unconditionally on every such refresh destroyed and
   recreated the overlay `<div>` every time, resetting scroll to the top on every click.
2. Second bug, after "fixing" the first: `updateModalContent` stopped recreating the
   *overlay*, but `content` (the card passed in) is still a brand-new element every
   call — and the card, not the overlay, is the actual scroll container
   (`.seat-modal-card`/`.character-picker-card` have their own `max-height: 90vh;
   overflow-y: auto`). A fresh card starts at `scrollTop` 0 regardless of whether the
   overlay around it is reused, so scroll still reset. The real fix: `ui/modal.ts`
   explicitly reads `scrollTop` off both the outgoing overlay and its `firstElementChild`
   (the old card) before swapping, then applies both values to the overlay and the new
   card afterward.

Every "just refresh what's already open" call site in `grimoire-panel.ts`,
`seat-modal.ts`, `setup-modal.ts`, `town-square-panel.ts`, and `lobby-modal.ts` follows
this pattern — don't add a new one that skips straight to `openModal`, and don't
"simplify" `updateModalContent` by dropping the scrollTop transfer thinking the overlay
reuse alone is sufficient (that's exactly bug #2).

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

`ui/character-picker.ts` exports two variants, plus the Setup modal has its own
third, separate grid (`screens/host-room/setup-modal.ts`) — all three render a grid of
character tokens, but each has a genuinely different interaction, so they aren't
merged into one component with a mode flag:

- `openCharacterPicker` — single click selects and closes (character assign, a
  `character` night-card element, Town Square predictions).
- `openMultiCharacterPicker` — toggle exactly `count` characters (some passed in as
  `disabledIds`, grayed out and unclickable), with a Confirm button gated on the count
  matching exactly. Used by the Grimoire's "these characters are not in play" bluffs
  preset, where the Storyteller must pick exactly 3 from whatever isn't already in play.
- Setup's own grid — toggle *any number* on/off, checked against a distribution table
  the required count isn't fixed up front (it's `dist.townsfolk`/`dist.outsider`/etc.
  for whatever the current seat count suggests), and the "Randomize" button is
  separately gated on the total matching the seat count. This is different enough from
  "pick exactly N" that it isn't built on `openMultiCharacterPicker` either.

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
  types.ts                    # PlayerInfo, HelloPayload, RosterPayload, CharacterAssignPayload,
                               # NightCardPayload, NightCardElement, SeatMessage, Character,
                               # Script — every NETWORK payload interface needs the
                               # `[key: string]: JsonValue` index signature (SeatMessage doesn't
                               # — it's stored/rendered locally, never sent as-is)
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
    player-local-state.ts            # load/savePlayerFeed(), load/saveTownSquareLocal() — a
                                      # Player's own local scratch state (feed history, Town
                                      # Square predictions/notes), see "Seats, reconnect" above
  ui/
    dom.ts                          # el() helper (typed document.createElement + prop assign)
    tabs.ts                         # renderTabs() — shared bottom tab-bar shell; supports a
                                     # per-tab unread badge (setBadge)
    modal.ts                         # openModal()/updateModalContent()/closeModal() — shared
                                      # single-overlay-slot dialog primitive, see "Shared modal
                                      # system" above
    token-image.ts                   # renderTokenImage(tokenUrl, name, noVoteToken?) — always
                                      # wraps an <img> (or placeholder initial) in a container div;
                                      # needed because a death-shroud ::after overlay doesn't render
                                      # on a bare <img> in any browser. noVoteToken adds a ::before
                                      # purple-circle overlay, concentric with the token
    circular-layout.ts                # layoutInCircle() — positions a container's children
                                       # evenly around a circle (Grimoire + Town Square seating);
                                       # container must be square (aspect-ratio: 1)
    qr-code.ts                        # renderQrCode(url) via qrcode-generator
    character-popup.ts                 # openCharacterPopup(), attachCharacterTrigger() — full
                                        # modal + desktop hover tooltip, used everywhere a
                                        # character appears
    character-picker.ts                 # openCharacterPicker() (single-click, pick one) AND
                                         # openMultiCharacterPicker() (toggle exactly N, with
                                         # some disabled/grayed-out — used for choosing bluffs).
                                         # NOT shared with Setup's own grid — see "Shared modal
                                         # system" above for why all three stay separate
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
                                          # toggle, leave), session-persistence + connection-
                                          # watchdog wiring, and the tab shell (Grimoire/Script —
                                          # no separate Seats or Messages tab; both folded into the
                                          # Grimoire's seat popup). No longer owns any per-seat
                                          # message state itself — that all lives in room.ts now.
      grimoire-panel.ts                   # seat circle (layoutInCircle, with an unread-dot per
                                           # seat, a .dying gray-slash class for a "dies tonight"
                                           # seat, a no-vote purple-circle overlay), a "Lobby" button
                                           # (lobby-modal.ts), a "Reveal deaths" button
                                           # (handle.revealAllDeaths(), disabled when nothing is
                                           # flagged), night-order sidebar (two-column on wide
                                           # screens), general notes below the fold (no audit log
                                           # section anymore — sent cards live in each seat's own
                                           # popup); owns activeSeat/composerElements/pickingPlayer
                                           # state and opens seat-modal.ts's content into
                                           # ui/modal.ts; calls handle.markSeatRead() whenever a seat
                                           # is opened
      seat-modal.ts                        # buildSeatModalContent() — per-seat popup, a two-column
                                            # layout (game state left, messages + night card
                                            # composer right) on wide screens: rename/remove,
                                            # Alive/Vote token/Dies tonight as compact .toggle-button
                                            # elements (not checkboxes), character-assign,
                                            # vacant-seat "assign a connected player" list, a private
                                            # per-seat reminder note, a read-only per-seat message
                                            # log (reads handle.getSeatMessages() fresh and reverses
                                            # it — newest message first — no compose box of its own
                                            # anymore), and the night card composer (quick
                                            # element buttons, autofill preset cards, "Player"-
                                            # picking flow). The composer works even for a
                                            # disconnected seat — the Send button relabels to
                                            # "Queue card" and turns orange/warning-colored, with an
                                            # inline warning, when handle.isSeatConnected() is false
      setup-modal.ts                        # openSetupModal() — manual character-pool picker
                                             # (toggle which characters are in play; one summary
                                             # line of running counts, not per-category headers) +
                                             # "randomize seat assignment" for the chosen pool only
      lobby-modal.ts                         # openLobbyModal() — Storyteller-only overview of
                                              # every connected device, seated or not, plus a manual
                                              # "Refresh connection" button (same as the automatic
                                              # connection watchdog, triggered on demand). Also calls
                                              # handle.resyncConnectedSeats() every time it opens, to
                                              # nudge any Player whose view might have gone stale
      script-panel.ts                       # script <select> (currently one option) + renderScriptView
    join-room/
      index.ts                          # creates the PlayerRoomHandle, compact room header
                                          # (display name inline), shared cross-tab state (the
                                          # unified feed — restored from player-local-state.ts on
                                          # init — own character, latest roster, pendingElements),
                                          # session-persistence + connection-watchdog wiring (both
                                          # gated on isModalOpen()/pendingElements), the disconnect
                                          # banner (manual refresh button + 8s auto-reload timer),
                                          # and the tab shell (Night Actions/Town Square/Script — no
                                          # top-level roster list, no separate Messages tab)
      night-actions-panel.ts               # own character + ability, the unified feed (see
                                            # "Messages and night cards are unified" below), a
                                            # queueable composer ("Got it" / "Player" via
                                            # openPlayerPicker / custom text, all addable before one
                                            # Send, mirroring the Storyteller's own composer) —
                                            # pendingElements lives on shared NightActionsState, not
                                            # a local variable, so it survives tab switches and can
                                            # be checked by index.ts's auto-reload guards
      town-square-panel.ts                  # seat circle (layoutInCircle) showing each seat's
                                             # prediction as an icon + name, same visual pattern as
                                             # the Grimoire's actual-character tokens; tapping a
                                             # seat opens a popup (ui/modal.ts) with status, the
                                             # prediction picker (via character-picker.ts), and
                                             # notes — mirrors the Grimoire's "click a seat" pattern.
                                             # Setting a prediction now refreshes the main circle
                                             # immediately (previously only the popup refreshed).
                                             # The distribution summary sits below the circle, not
                                             # above it. predictions/notes are loaded from and
                                             # saved to player-local-state.ts. Also exports
                                             # openPlayerPicker() (a read-only variant of the same
                                             # circle, used by night-actions-panel.ts's "Player"
                                             # composer button). Subscribes to onRosterChange itself
                                             # (live-updates while mounted, not just at mount time)
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

## Messages and night cards are unified (no separate "Messages" tab, no separate audit log)

A plain text message and a structured night card are the same concept, displayed
through the same feed/log on both sides. There is no standalone "Messages" tab
anywhere (the original `screens/*/messages-panel.ts` and `ui/message-log.ts` are
deleted), no separate global "sent cards" audit log (that entire concept was removed —
see below), and the Storyteller's per-seat log has no compose box of its own anymore
either. `secretMessage`/`sendToStoryteller`/`onPlayerMessage` are gone entirely (see
"The six Trystero actions" above) — everything routes through `nightCard`/`playerCard`.

- **Player side** (`night-actions-panel.ts`): `NightActionsState.feed` reuses
  `SeatMessage` (`{ts, self, elements}`) rather than a separate near-identical
  `FeedEntry` type — one shape for "a per-seat log entry," used by both sides. A plain
  message is represented as a card with exactly one `text` element — built via the same
  `nightCardElement()` helper as everything else, so `renderElement()` renders both
  received night cards and plain messages through identical code. The composer is
  **queued**, matching the Storyteller's own composer: "Got it," "Player" (opens
  `town-square-panel.ts`'s `openPlayerPicker()` so the Player picks with the same
  context — status, their own predictions — visible, rather than a bare list), and
  custom text all push onto `NightActionsState.pendingElements` with a visible
  remove-able preview (`describeNightCardElement`), and a single "Send" flushes the
  whole queue via `handle.sendPlayerCard(...)`. `pendingElements` lives on the shared
  state object (not a local variable inside `renderNightActionsPanel`) for two reasons:
  it survives this panel being torn down and recreated on every tab switch (previously
  it didn't — switching away from Night Actions mid-composition silently lost whatever
  was queued), and `join-room/index.ts`'s automatic-reload guards can check
  `nightActionsState.pendingElements.length` before reloading out from under the
  Player. Both `feed` and Town Square's predictions/notes are now persisted to
  `localStorage` per Player device via `utils/player-local-state.ts` (see "Seats,
  reconnect, and persistence" above) — restored on init, re-saved on every mutation.
- **Storyteller side** (`room.ts`'s `seatMessages: Record<seat, SeatMessage[]>`, NOT a
  UI-layer map anymore): this is the single source of truth, persisted via
  `host-persistence.ts` alongside seats/characterAssignments/seatNotes. Two things feed
  it: `sendNightCard(seat, elements)` appends a `self: true` entry every time the
  Storyteller sends a card (this doubles as what used to be the separate audit log —
  there is no other record of a sent card now), and the internal `playerCard.onMessage`
  handler appends a `self: false` entry for an incoming Player card. `seat-modal.ts`'s
  `buildMessageLog()` reads it fresh via `handle.getSeatMessages(seat)` every time the
  popup (re)builds — it does NOT take the log as a parameter passed by reference
  anymore, and has no input box; it's a plain read-only rendering of
  `describeNightCardElement(...)` joined per entry, reversed (`[...messages].reverse()`)
  so the newest message renders at the top — `getSeatMessages()` itself still returns
  in storage order (oldest first), so don't assume the array is already reversed if you
  add another reader of it.
- **Unread indicator:** `unreadSeats: Set<number>` (persisted as an array) lives
  alongside `seatMessages` in `room.ts`. `playerCard.onMessage` adds the seat to it and
  fires `onUnreadChange`; `handle.markSeatRead(seat)` (called by `grimoire-panel.ts`'s
  `openSeatFor` every time a seat is opened, "reading" it) removes it. The Grimoire's
  `refreshTokenGrid()` renders a `.unread-dot` on any seat currently in the set, and
  subscribes to both `onUnreadChange` and `onPlayerCard` so the dot appears live even
  for a seat whose popup isn't open.
- Because `seatMessages`/`unreadSeats` live in `room.ts` and are keyed by seat number
  (not peerId), they're automatically "attached to the seat, not the connection" —
  restored correctly across both a Player reconnecting (their seat's log was never
  touched) and a Storyteller reload (loaded back from `localStorage` like everything
  else in `HostState`). No extra plumbing was needed for this once the log moved out of
  a screen-lifetime UI map and into `room.ts` proper.
- `grimoire-panel.ts` still registers its *own* `onPlayerCard` subscription (in
  addition to whatever `room.ts` does internally) — but only to decide whether to
  live-refresh an already-open seat popup and to refresh the token grid; it reads via
  `handle.getSeatMessages`/`getUnreadSeats`, it does not maintain its own copy.

## Known accepted limitations

- Reload used to always mean "the same human reappears as a new roster row" — that's
  now mitigated by the reconnect-token/seat-reclaim mechanism above, but only within
  the same browser. A Player switching to a different device/browser still can't
  reclaim their old seat; they'll appear as a new one, same as before.
- Storyteller-side reload/crash recovery is same-browser only (plain `localStorage`,
  nothing synced elsewhere) — a Storyteller switching devices mid-game loses all
  seat/character/message state, same as if this feature didn't exist.
- Town Square predictions/notes and a Player's own `feed` are still pure client-side
  scratch state — never sent anywhere — but as of `utils/player-local-state.ts` they
  now persist to `localStorage` per device, so they survive that Player's own reload.
  They do NOT sync across devices (switching phones still starts them fresh), the same
  limitation as the Storyteller's own `host-persistence.ts`.
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
  autofill — "This player is" and "This character selected you" only insert a text
  template, not real player/character data, because the app has no way to know which
  specific ability is being run. Revisit these against real play if the mapping feels
  off at the table. ("This is the Demon," "These are your Minions," "These characters
  are not in play," "You are," and "Make a Choice" have all since been resolved to
  match actual Storyteller feedback — see TODO.md.)
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
  not removed); a Storyteller→Player night card is invisible to other Players and
  vice versa; closing the Storyteller's tab shows Players a disconnect banner.
- Additional checklist for this pass's features (none of this has been run yet —
  everything below is "implemented," not "tested & functional" in TODO.md's terms):
  - Reload a Player's tab mid-game → they should reclaim their same seat (name,
    alive/vote-token state, and character all intact), not appear as a duplicate.
  - Reload/crash the Storyteller's tab mid-game → seats, character assignments,
    script, per-seat message logs, and notes should all still be there once Players
    reconnect.
  - Scan the Storyteller's QR code from a phone camera → lands on join-setup with
    the room code pre-filled.
  - Send a night card combining several element kinds in one message → Player sees
    all of them together, in order, as one card.
  - Send "Make a Choice" from a seat's composer, then have that Player reply with their
    own night card (via the unified feed's composer, not a special response control —
    that mechanism was removed) → the reply lands in that seat's message log on the
    Storyteller's side, attributed correctly.
  - Open a seat whose device is currently disconnected → the composer's Send button
    should read "Queue card," be styled orange/warning-colored, and show an inline
    warning; sending should still work, and the card should reach that seat's device
    the moment it reconnects (verify it also shows up in the seat's message log
    immediately, not just after delivery).
  - Setup modal: toggle characters including Baron → outsider count in the running
    tally should read +2 / townsfolk -2 versus the base distribution; "randomize seat
    assignment" should stay disabled until selected count equals seat count.
  - Switch the Storyteller away from the Grimoire tab (e.g. to Script), have a Player
    send a "Got it" or any queued card → the Grimoire tab should show an unread red dot
    on that seat's token once you switch back, even though the Grimoire wasn't mounted
    when it arrived (this is the scenario the listener-Set refactor exists to fix, now
    additionally backed by `seatMessages`/`unreadSeats` living in `room.ts` rather than
    a screen-lifetime UI map — regression-test both the arrival-while-elsewhere case
    and that opening the seat clears the dot).
  - A Player on Town Square (not Night Actions) when the Storyteller assigns/changes
    their character or the roster otherwise changes → Town Square should update in
    place without needing to switch tabs and back.
  - Send a plain "Got it" from Night Actions → it should show up in that seat's
    message log on the Storyteller's side (there is no separate Storyteller-side
    compose box anymore — only the composer's custom-text option and the received log).
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
  - Character picker and Setup grids should show NO "Townsfolk"/"Outsider"/"Minion"/
    "Demon" section headers, and the whole 22-character Trouble Brewing set should
    plausibly fit without scrolling on a normal desktop window.
  - "This is the Demon"/"These are your Minions" presets should add the player only,
    with no character chip — a Minion shouldn't see the Demon's exact character from
    this preset. "You are" should add a "You are" text label, then a plain "Good"/"Evil"
    text, then a Character element — the Good/Evil/Character elements should look and
    behave exactly like clicking those quick buttons manually (removable/editable the
    same way) — and must NOT reassign the seat's character; only the "Change" button
    does that.
  - "These characters are not in play" should open a picker with every in-play
    character visibly grayed out and unclickable, require picking exactly 3, and the
    Confirm button should stay disabled until exactly 3 are selected.
  - "Make a Choice" should add only plain text with no interactive prompt — there is no
    longer a "Choose a Player"/"Choose a Character" quick button (removed; see "The
    five Trystero actions" above).
  - Storyteller: open the Lobby modal, click "Refresh connection" → the page should
    reload and the Storyteller should land back in the same room afterward.
  - Player: with the Storyteller disconnected (close their tab), confirm the banner's
    "Refresh connection" button works, and separately that leaving it alone for ~8
    seconds triggers an automatic reload once the Storyteller reconnects (or stays
    disconnected — either way, verify it does NOT reload while a modal is open or a
    night card is queued in the composer).
  - Reload a Player's tab mid-game → besides reclaiming their seat, their own feed
    (received night cards + sent replies) and any Town Square predictions/notes they'd
    set should still be there, not reset to empty.
  - A dead Player's own predicted character in Town Square, and an actual assigned
    character in the Grimoire, should each show that character's token icon next to
    the name on the circle — not just plain text.
