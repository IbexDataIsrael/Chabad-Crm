AI helper popup
Frontend only - not connected

First version of the AI helper chat popup for the minicrm website. This build is UI only. The backend is not wired yet, on purpose.

Ground rules
Don't push and don't commit. Work only in the minicrm project folder.
No deploy, no production data changes, no new paid services.
Follow the existing project conventions (read AGENTS.md if present) and reuse the existing React, auth, i18n and request patterns.
No unrelated refactors of existing screens.
What to build
1
A floating button on the site that opens a chat panel: message list, text input, send. Match the site's look. The panel must work in Hebrew (RTL) and English (LTR).
2
All panel content lives in new, isolated component files. A minimal mount change is allowed so the button appears - nothing more.
3
Every backend call goes through one small chat adapter module in its own file. The UI never calls fetch directly.
States the panel must show
The assistant brain answers with a JSON body shaped like:

{ status, reply?, passages?: [{ filename, heading, score }] }

status is "answer" or "insufficient_sources" today; a "clarify" value may come later. Design the panel states against this shape:

loading - waiting for the answer
answer - the reply text
sources - the passages used, each with filename, heading and score
insufficient - an honest "not enough information" state for status "insufficient_sources"
error - the request failed
The backend is not decided
Do not invent an endpoint
There is no server endpoint for this popup today. Do not guess a URL, a route name or an auth scheme. In production the adapter returns a clear "assistant not connected yet" state. In development only, use mocked fixtures so every state above can be seen and checked. The real endpoint and auth contract will be decided later, and wiring it must then be a one-file change inside the adapter.
Never fake it
Never show a fake answer, and never show a fake CRM success such as "contact created". If the action did not really happen, the UI says so.
Done when
1
The button mounts on the site and opens the panel.
2
Every state - loading, answer, sources, insufficient, error, and not-connected - is visible using the dev mocks.
3
Hebrew and English both render correctly.
4
A short report lists the files created or changed.
Scope: UI only. A working server-backed helper is a later step.