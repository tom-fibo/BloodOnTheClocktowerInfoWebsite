Agent: Include upcoming tasks as needed. Mark as not started, in progress, implemented, or tested & functional.

## Night communication MVP (room + roster + private ST/Player messaging)

- Status: **implemented**, not yet fully tested & functional (basic page load confirmed manually; full multi-device roster/secret-message flow still needs to be run through, see MAINTENANCE.md verification checklist).
- Scope: Storyteller hosts a room via a shareable code; Players join with a display name; everyone sees a live, ordered player roster; Storyteller can secretly message any one Player; a Player can secretly message only the Storyteller. Peer-to-peer via Trystero (WebRTC), no backend.
- Not yet done / explicitly deferred: offline/no-internet fallback, reconnect-with-same-identity across a page reload, GitHub remote + Pages deployment (manual step, not yet performed), any actual game content (characters, night order, votes) — this MVP is comms plumbing only.
