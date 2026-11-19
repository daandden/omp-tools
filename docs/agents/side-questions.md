# Side questions

A Side question is a full agent run in a mirror session built the way OMP's
`/tan` builds one (`tan-command-controller.ts`).

- **Availability.** `sideQuestionsAvailable` needs a main agent
  (`ctx.agent.kind === "main"`), a session file, and a live session in
  `AgentRegistry.global()` with a model. Without them `/btw` falls through to
  native and the Picker btw is off.
- **Fork.** `SessionManager.forkFrom` copies the main transcript into
  `$TMPDIR/omp-side-question-<random>/SideQuestion-<uuid>.jsonl`. It stays
  outside the sessions tree because omp-stats and the Agent Hub scan that
  tree and counted the fork's usage a second time. Dispose deletes it.
- **One constructor.** Build the mirror only with `createMirrorSession`. Its
  input type has no `systemPrompt`, tool list, or plain-string cache key, so
  the old wiring fails typecheck.
- **Tools.** `restrictToolNames` offers only read, grep, glob, find, and
  web_search (no MCP, LSP, IRC, or ambient extension tools) with OMP's
  default prompt for them. There is no call-time gate. Copying the main prompt
  and tools to reuse the main cache let a Picker btw call `ask`, `bash`, and
  `write` in 3 of 15 replays (0 of 15 now), so a thread's first request never
  reuses the main cache.
- **Cache key.** Every thread of one main session shares
  `sideQuestionCacheKey`, sent as `providerPromptCacheKey` and Codex
  `parentSessionId` over SSE (`preferWebsockets: false`). A later thread's
  first request read the earlier thread's prefix in 10 of 10 Codex runs,
  against 0 of 5 on a new websocket with the same key. Anthropic reused it
  either way.
- **Session wiring.** The mirror gets subagent settings, the parent's prepared
  extensions, and `main.costGate`, as in `/tan`. It is a child session
  (`parentTaskPrefix`, so it binds no process-wide state).
  `localProtocolOptions` snapshots the main session's artifacts dir and
  session id so `local://` (pasted images, large pastes) resolves; the fork
  copies no artifacts.
- **Registry.** `SideQuestionRegistry` is its own `AgentRegistry`, outside the
  Agent Hub so nothing can message or list the mirror. Its `get` and `list`
  fall back to `AgentRegistry.global()`, because `read agent://<id>` resolves
  a running agent with no output through the reader's registry.
- **Seed.** The mirror's messages come only from the fork file. OMP persists
  the eval state a history rewrite adds (`/tree`, compaction) since 18.18.2,
  so the file holds what the main agent sees. `open` reads the main leaf
  before the flush and moves the fork onto it with `branch()`, because
  `forkFrom` ends on the file's last entry and a `/tree` move is not written
  to the file. A leaf missing from the copy fails the open, so the mirror never
  answers from another branch. Accepted transformation: after the copied
  history, the mirror's own session adds notices about its own runtime (no
  eval runtime is retained for the mirror; eval prelude tools such as
  `ratchet` are unavailable). They are not in the main transcript.
- **Pending calls.** Only calls the main turn is still running get a
  still-open result in the fork (`ask`: the user is answering now; others:
  still running; both say not to call it again): those of the selected
  branch's last reply that are in `runToolCallIds` while the main session
  `isStreaming`, read before the flush. An "aborted" result made the model
  ask the user again. Other unpaired calls get no result, so the mirror's
  context drops them as the host drops interrupted calls
  (`buildSessionContext`). The fork skips `repairInterruptedTail`, which
  repairs the file's last branch instead of the selected one and returns an
  "outcome is unknown" error that does not say to wait.
- **Model.** `side-question-model.ts` reads `sideQuestionModel` per thread
  with `getPluginSettings`, and resolves the role and thinking level with
  `resolveModelOverride`. The fork records the selected role so shared-model
  roles keep their own fallback chains.
  - An unresolved selector calls `refreshDiscoverableProviders(..., "online")`
    for the providers its patterns name, then resolves again. Use that, not
    `refreshProvider`, whose static reload drops discovered models. A running
    OMP can lose discovery-only models such as Codex `gpt-6.1-terra` after a
    denied discovery with no usable cache.
  - The caller's signal, passed through `LazySideQuestionThread.get` and
    `open`, ends the wait without aborting the shared refresh.
  - Still unresolved, it warns with the missing model and uses the main model.
  - Before the first request, the tokenizer checks the mirror's history plus
    prompt and tool overhead. A known context window that is too small uses
    the main model. OMP owns overflow recovery after that.
- **Thread rules.** A thread rejects a question while one runs, and `ask`
  rejects an already-aborted signal before any request. After a cancelled
  question, the next prompt tells the mirror not to answer it.
- **Cache misses.** `SideQuestionCache` gives each thread a tracker that flags
  a request reading more than 2048 tokens below the expected cached prefix:
  the thread's previous request on that provider and model, or for a first
  request, the earlier thread's first request on that route while the
  selected entries since the last compaction still start with the ones it saw
  (`sharedPrefixPrompt`). It counts only when the request wrote cache
  (`cacheWrite > 0`, never on Codex) and shows `⊘ cache miss · N tokens` only
  while `display.cacheMissMarker` is on.
- **Usage.** `recordSideQuestionUsage` writes each mirror request to the main
  session's ledger as `model_usage` with purpose `side-question`.
  `forwardSideQuestionUsage` wraps the fork's `appendModelUsage` and copies
  every entry the mirror records off its transcript (cache warms, judge calls)
  as `side-question:<purpose>`. Session cost counts them after the fork file is
  gone, and none is a message.
- **Cache warming.** OMP's warming stays on: an idle panel on a 5-minute tier
  is warmed like the main session. 1-hour entries outlive the 30-minute idle
  window, so they are not.
- **Streaming.** `answerInto` keeps message starts, text, tool calls, and
  native retry and fallback events (`side-question-recovery.ts`) as ordered
  parts with a live retry countdown, so a later message never replaces earlier
  text. It turns failures into turn state instead of rejecting. `ask` returns
  the last assistant message's text.
- **Recovery.** Transport retries happen before TurnRecovery events, and
  native fallback chains can revisit models and renew their retry budgets.
  Keep OMP's policy and cancellation; add no Side-only retry rules.

## `/btw`

- OMP skips extension commands named like built-ins, so `btw.ts` catches the
  text in the `input` event, which runs before built-in dispatch
  (`docs/adr/0001-take-over-btw-through-input-event.md`). It returns
  `{ handled: true }` only for `source: "interactive"` in the TUI. Bare `/btw`,
  autocomplete, `side: true` file commands, the focused-subagent path (it
  skips `input` handlers), and RPC `btw` stay native.
- OMP 19.0.0's `? <question>` composer shortcut rewrites the draft to
  `/btw <question>` in `input-controller.ts` before input hooks run, so
  `btw.ts` catches it like typed `/btw`. Native draws the composer's btw mode
  color while the draft starts with `?`.
- One `BtwCycle` per session holds the thread, and a later `/btw` follows up
  in it. `before_agent_start` (a main prompt) ends it; while an answer runs,
  it marks the thread closed so the answer finishes and shows first. Session
  switch, branch, tree, and shutdown dispose it.
- The panel is a widget above the editor (`setWidget`,
  `placement: "aboveEditor"`), and the editor keeps focus. Keys come through
  `ctx.ui.onTerminalInput` and act only while the panel shows and the editor
  is empty: `app.interrupt` cancels or hides, `t` folds the tool calls.
- In Tern the panel describes a `col` with native `/btw`'s role
  `omp.overlay.btw` (a plain `col` let the composer's meter row overlap the
  hints), a `scrollBox` capped at 40% of the rows with `reveal` at the end, and
  the tool calls as a collapsible `section`. It sends its own stylesheet
  (`omp-tools-btw`, `SCROLL_BOX_CSS` from `ask-editor.ts`) so list numbers are
  not clipped.

## Picker btw

- Each ask gets one thread (`pickerBtwRunner` in `flexible-ask.ts`), opened on
  the first `?` question and disposed when the dialog closes, unless a Picker
  draft keeps it. A cancelled turn keeps the thread.
- `picker-btw.md` is its prompt, with the unsubmitted answers from
  `formatAskAnswers`.
- `?` disposes the countdown, and the next key in the options restarts it.
- Pasted images go to `SideQuestionThread.ask` as prompt images, with their
  labels renumbered in text order and sent in that order.
