Agent: Include information about how the code works, what libraries, conventions, etc, are used, for future reference.
Reading the MAINTENANCE file should be sufficient background information to correctly modify other files.

## Dependency philosophy

Keep dependencies minimal. Only take on a library when it's necessary or covers a
significant portion of the project — `trystero` qualifies (it *is* the multiplayer
layer, and reimplementing WebRTC signaling ourselves would be far riskier). A UI
framework does not qualify at this project's current size; don't add one speculatively.
Runtime dependencies today: `trystero` only. Dev dependencies: `vite`, `typescript`.

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
browser tab — this is the app's non-mutable per-connection id, kept separate from the
player's mutable display name. **It regenerates on a full page reload** — a reload
rejoins as a "new" peer with a fresh roster entry. This is a known, accepted MVP
limitation, not a bug.

### The three Trystero actions (`src/trystero/config.ts`, `src/trystero/room.ts`)

- `hello` (Player → Storyteller, targeted): a Player announces/re-announces
  `{name}` to a peer as soon as `room.onPeerJoin` fires for that peer.
- `roster` (Storyteller → everyone, broadcast): `{storytellerId, players: PlayerInfo[]}`.
- `secretMessage` (both directions, always targeted): `{text, ts}`. Safe to share one
  action name for both directions because Trystero never loops a peer's own sends back
  to itself — the Storyteller's handler structurally only ever sees Player-originated
  messages, and a Player's handler only ever sees Storyteller-originated ones.

**Roster authority — read this before touching `room.ts`:** the Storyteller's client is
the single source of truth for player order (a mesh has no other way to guarantee every
peer agrees on join order). The Storyteller maintains an ordered array keyed by
`peerId`, updated on `hello` (insert or rename in place) and pruned on `onPeerLeave`,
then rebroadcasts the *entire* roster (plus its own `selfId` as `storytellerId`) on
every change. Players just render whatever roster they're sent — they never compute
their own ordering.

**The one timing rule that matters:** `hello` must never be sent as a blind broadcast
immediately after `joinRoom()` returns — at that instant no peer connections exist yet,
so the message would be silently lost. `room.onPeerJoin` firing for a peerId is what
proves that connection is actually ready to send on. This is why `joinPlayerRoom`
sends `hello` from inside `onPeerJoin` (targeted at whichever peer just connected),
not as a one-shot broadcast at join time. A joining Player can't yet tell which of its
new connections is the Storyteller (the mesh connects to every existing peer, not just
the ST), so it sends `hello` to each one — harmless, since only the Storyteller's code
ever registers a `hello.onMessage` handler.

**Enforcing "Players can't message Players":** this is structural, not just a hidden
UI control. `src/screens/join-room.ts` has no code path that accepts a Player-supplied
target peerId — `sendToStoryteller` in `src/trystero/room.ts` hardcodes
`{target: storytellerId}`. Caveat: a technically sophisticated Player could still
hand-invoke Trystero from their own devtools console to message another Player
directly — there is no server in this architecture to prevent that. Accepted
limitation for an in-person social game; not something to chase.

## File layout

```
src/
  main.ts                 # screen switcher; subscribes to the store, swaps #app content
  style.css                # mobile-first, light/dark aware
  types.ts                 # PlayerInfo, HelloPayload, RosterPayload, SecretMessagePayload
                            # (each payload needs an explicit `[key: string]: JsonValue`
                            #  index signature — Trystero's makeAction<T>() constraint
                            #  requires it on named interfaces, see inline comment)
  trystero/
    config.ts               # APP_ID (namespaces rooms on the shared public relays), ACTIONS
    room.ts                  # createHostRoom() / joinPlayerRoom() — all P2P + privacy
                              # logic lives only here; screens never call joinRoom/makeAction directly
  state/store.ts             # tiny pub-sub for COARSE state only: screen/roomCode/selfName.
                              # Deliberately does not carry roster/message data — see below.
  ui/
    dom.ts                   # el() helper (typed document.createElement + prop assign)
    roster-panel.ts           # renderRosterPanel() — shared; host rows clickable-to-select,
                               # player rows read-only (selectable: false)
    message-log.ts             # appendMessage() — shared, auto-scrolling log entry
  screens/
    landing.ts, host-setup.ts, host-room.ts, join-setup.ts, join-room.ts
  utils/room-code.ts           # generateRoomCode() (unambiguous alphabet), normalizeRoomCode()
```

**Why the room screens don't route through the global store:** `host-room.ts` and
`join-room.ts` wire the Trystero handle's callbacks directly to their own local DOM
subtrees (roster panel, message log, compose box) instead of pushing every
roster/message update through `state/store.ts`. Roster and message events arrive
asynchronously and often — if they triggered a full-screen re-render, they'd wipe out
text a user is mid-typing the moment someone else joins, leaves, or messages. The store
is reserved for rare, user-initiated screen transitions only.

## Known accepted limitations

- Page reload regenerates `selfId` → the same human reappears as a new roster row.
  Not solved; documented.
- The room code doubles as both the Trystero `roomId` and the `password` (for signaling
  encryption). Both create and join paths normalize it (trim + uppercase) since a
  mismatch silently produces two disjoint rooms with no visible error. Default codes
  are 5+ characters from a ~32-symbol unambiguous alphabet — Nostr relays are a public,
  global namespace, so collisions with unrelated real-world groups are only avoided by
  the code being long enough to be effectively unguessable, not by any registration.
- No server-side enforcement against a Player manually invoking Trystero actions from
  devtools to reach another Player directly (see above).

## Running locally / testing

- `npm run dev -- --host` exposes the dev server on the LAN for testing from a phone.
- `npm run build && npm run preview` tests the real production bundle.
- Because signaling goes over real public Nostr relays, even two tabs on one machine
  exercise genuine (if fast) network handshakes — but for a real validation, test
  across actual separate devices, including at least one on cellular data rather than
  the same Wi-Fi, to confirm it isn't accidentally relying on same-subnet behavior.
- Verification checklist (see the plan history for the full scenario list): sequential
  and simultaneous joins produce a correctly-ordered roster on every screen; renames
  update in place; a Player leaving prunes everyone's roster; a Storyteller→Player
  secret message is invisible to other Players and vice versa; closing the
  Storyteller's tab shows Players a disconnect banner; refreshing a Player's tab
  produces a new roster row (expected, not a bug).
