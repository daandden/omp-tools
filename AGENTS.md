# Repository Guidelines

## Project Overview

`omp-tools` is an Oh My Pi (OMP) plugin. It shadows the native `ask` tool to
drop the model-facing option count and show questions
as full Markdown in the interactive picker; outside the TUI it delegates to
native `ask`. It replaces native `generate_image` with a tool that has two
Image generation modes: OpenAI mode (GPT Image 2.5 Sunburst through the public
Images API, the default) and Codex mode (the Codex Images endpoint with Codex
OAuth). It takes
over `/btw <question>` with a Side question that may use read-only tools, and
the Picker btw asks the same kind of Side question.

## Architecture & Data Flow

- `package.json` registers `extensions/flexible-ask.ts`,
  `extensions/generate-image.ts`, and `extensions/btw.ts` as entry points.
  OMP also loads `skills/*/SKILL.md` from the plugin root (the `omp-plugins`
  discovery provider, priority 90).
- The extension registers a shadow `ask` description/schema. In `ctx.mode ===
  "tui"` with `ctx.hasUI`, it shows its own picker (`extensions/ask-dialog.ts`)
  through `ctx.ui.custom` and formats results with native wording and details.
  The native dialog cannot be restyled from an extension: `ctx.invokeTool` runs
  it with the session UI, not the wrapper's.
- Otherwise (RPC/ACP/print, subagents), and for inputs the native tool rejects
  (reserved or duplicate labels, duplicate ids), it delegates to
  `ctx.invokeTool(params, { signal, onUpdate })` so native errors and fallbacks
  apply unchanged.
- Host dialogs (`extensions/host-ask-dialog.ts`): OMP code that asks without
  the `ask` tool calls the shared UI context's `askDialog` (Ratchet approvals
  in `ratchet/prelude-definition.ts`, the `/tree` ask re-answer). In the TUI,
  `session_start` routes that method to the picker: it replaces `askDialog`
  on the context object itself, which the runner hands to extensions and the
  tool context store wraps (`trackUserWaits`), both proxies with only a `get`
  trap, so a write through `ctx.ui` lands on the object and the tool context
  and every handler run started later read it (a handler run already in
  flight keeps the method its proxy captured). The native `askDialog`,
  `custom`, and `notify` are read through property descriptors, because the
  runner's `get` returns per-handler wrappers bound to that handler's
  signal. This is undocumented OMP internals, proved live with OMP 18.12.6.
  The object keeps one wrapper under
  `Symbol.for("omp-tools.host-ask-dialog")`, shared by every module load;
  further routes stack in its list, not as wrappers, and the last one to end
  puts the native method back (`session_shutdown`). `askInPicker` opens the
  picker through `openPicker`, the same draft and Picker btw steps as `ask`,
  and answers in the native `ExtensionAskDialogResult` shape: the caller's
  own ids, question text, and labels (the picker shows them without `\r`),
  picks, `Other` text, one note (each option note after its option, then the
  Submit note), and images split by whether `customInput` names their label.
  Esc and an aborted signal give `undefined`; Esc keeps a Picker draft in the
  same `PickerDraftSlot` as `ask`. Only the caller's `timeout` counts down,
  and its `onTimeout` is called once on expiry before answers are picked, as
  native does; no notification is sent. Malformed questions (which the native method
  coerces) and questions `nativeRejects` go to the native method. Collab
  guests cannot answer, since the native method's guest race is skipped (an
  accepted limit: no extension API reports a guest).
- A Side question (`extensions/side-question.ts`) is a full agent run in a
  mirror session built the way OMP's `/tan` builds one
  (`tan-command-controller.ts`): `SessionManager.forkFrom` the main transcript
  (with `repairInterruptedTail`, since the main agent may be mid-turn) into
  `$TMPDIR/omp-side-question-<random>/SideQuestion-<uuid>.jsonl`, outside the
  sessions tree: omp-stats and the Agent Hub scan that tree and counted the
  fork's usage again on top of the main ledger copy. Then
  `createMirrorSession`, the one way to build the mirror. Its input type
  takes no `systemPrompt`, tool list, or plain-string cache key, so the old
  wiring fails typecheck. It offers only read, grep, glob, find, and
  web_search with `restrictToolNames`
  (also no MCP, LSP, IRC, or ambient extension tools) and OMP's default prompt
  for them; there is no call-time gate. Copying the main prompt and tools to
  reuse the main prompt cache let a Picker btw call `ask`, `bash`, and `write`
  (3 of 15 replays, 0 of 15 now), so a thread's first request cannot reuse
  the main cache. Every thread of one main session shares a Side-only key
  (`sideQuestionCacheKey`) sent as `providerPromptCacheKey` and Codex
  `parentSessionId`, over SSE (`preferWebsockets: false`): a later thread's
  first request then read the earlier thread's prefix in 10 of 10 Codex runs,
  against 0 of 5 on a new websocket with the same key; Anthropic reused it
  either way. The mirror gets subagent settings, the parent's
  prepared extensions, and a `SideQuestionRegistry`: its own `AgentRegistry`
  (out of the Agent Hub, so nothing can message or list it) whose `get` and
  `list` fall back to `AgentRegistry.global()`. `read agent://<id>` resolves
  a running agent with no published output through the reader's registry, so
  without the fallback it returned `Not found`. As in `/tan`, the mirror is a
  child session (`parentTaskPrefix`, so it binds no process-wide state) with
  `localProtocolOptions` snapshotting the main session's artifacts dir and
  session id: `local://` resolves to the main session's files (a pasted
  image's `local://pasted-image-*.png`, large pastes). The fork copies no
  artifacts, so without it those reads returned `Local file not found`. Then
  `seedMessages` replaces
  the mirror's messages with a copy of `main.agent.state.messages`
  (`structuredClone`, plus a still-open result for each call the last reply
  still waits on: for `ask`, the user is answering it now; for others, still
  running; both say not to call it again). An "aborted" result there made the
  model ask the user again. The copy is also on the main session's selected
  branch, which the file does not record, and it holds messages the live
  session adds that the file lacks (the `eval-state-context` message after a
  `/tree` jump, #15933). The fork file still holds the mirror's own turns.
  `sideQuestionModel` in the plugin's `omp.settings` selects the primary model
  for both callers, default `@smol`; an empty value keeps the main model.
  `side-question-model.ts` reads it per thread with `getPluginSettings` and
  resolves the role and thinking level with `resolveModelOverride`. The fork
  records the selected role so shared-model roles retain their own fallback
  chains. An unresolved selector warns and keeps the main model. The mirror's
  tokenizer checks the live history with prompt and tool overhead before the
  first request; a known context window too small uses the main model instead.
  OMP still owns overflow recovery if that model also cannot fit. The mirror
  shares `main.costGate`, as `/tan` does.
  A `SideQuestionCache` per main session hands each thread a tracker that
  flags a request reading more than 2048 tokens less than expected: the
  thread's previous request on that provider and model, or for a thread's first
  one the earlier thread's first request on that route, while the main messages still
  start with the ones that thread saw (`sharedPrefixPrompt`). It counts only
  when the request wrote cache (`cacheWrite > 0`, so never on Codex) and shows
  OMP's `⊘ cache miss · N tokens` label only while `display.cacheMissMarker`
  is on (`/modes/settings`). Each mirror request's usage goes to the main
  session's ledger as a `model_usage` entry with purpose `side-question`
  (`recordSideQuestionUsage`), and every entry the mirror records off its own
  transcript (cache warms, judge calls) is copied there as
  `side-question:<purpose>` (`forwardSideQuestionUsage` wraps the fork's
  `appendModelUsage`), so session cost counts them after the fork file is
  deleted; none is a message. The mirror keeps OMP's cache warming: an idle
  panel on a 5-minute cache tier is warmed like the main session (1-hour
  entries outlive the 30-minute idle window, so they are not). The thread
  reports each assistant message's start (`onMessageStart`), its streamed
  text, tool calls, and native retry/fallback events (`onRecovery`).
  `answerInto` keeps them as ordered parts, with a live retry countdown, so
  a later message never replaces earlier text. `ask` returns the last
  assistant message's text; the fork file is deleted on dispose. A Side
  question needs a live main session (`AgentRegistry.global()`) and a session
  file; without them `/btw` falls through to native and Picker btw is off.
  Transport retries precede TurnRecovery events. Native fallback chains can
  revisit models and renew their retry budgets. Preserve that policy and
  cancellation rather than adding Side-only retry rules.
- `/btw <question>` (`extensions/btw.ts`): OMP skips extension commands named
  like built-ins, so the plugin catches the text in the `input` event, which
  runs before built-in dispatch (docs/adr/0001), and returns `{ handled: true }`
  only for `source: "interactive"` in the TUI. Attached images go to the thread.
  Bare `/btw` (the history), autocomplete, `side: true` file commands, the
  focused-subagent path (it skips `input` handlers), and RPC `btw` stay native.
  One `BtwCycle` per session holds the thread: a later
  `/btw` follows up on the same mirror; `before_agent_start` (a main prompt)
  ends it, or, while an answer runs, marks it closed so the answer finishes,
  shows, and the thread is disposed afterwards. Session switch, branch, tree,
  and shutdown dispose it. The panel (`extensions/btw-panel.ts`) is a widget
  above the editor (`setWidget`, `placement: "aboveEditor"`); the editor keeps
  focus. Keys come through `ctx.ui.onTerminalInput` and act only while the
  panel shows and the editor is empty: `app.interrupt` cancels a running
  answer or hides the panel, `t` opens or folds the tool calls. In Tern the
  panel describes a `col` with native `/btw`'s role `omp.overlay.btw` (Tern
  styles it as that sheet; a plain `col` let the composer's meter row overlap
  the hints), a `scrollBox` capped at 40% of the rows with `reveal` at the
  end, and the tool calls as a collapsible `section` (a click opens it). The
  panel sends its own stylesheet (`omp-tools-btw`, `SCROLL_BOX_CSS` from
  `ask-editor.ts`) so list numbers are not clipped.
- `?` in the picker opens a Picker btw (`extensions/picker-btw-view.ts`): a
  Side question answered inside the picker (`extensions/picker-btw.ts`, prompt
  `picker-btw.md` with the unsubmitted answers from `formatAskAnswers`). It is
  not native `/btw`. Each ask gets one thread (`pickerBtwRunner` in
  `flexible-ask.ts`), opened on the first question, followed up by later ones,
  and disposed when the dialog closes, unless a Picker draft keeps it; a
  cancelled turn keeps the thread.
  `?` disposes the countdown and the next key in the options restarts it.
  `?` is off when Side questions cannot run. Pasted images in the Picker btw
  go to `SideQuestionThread.ask` as prompt images.
- Esc (or the Tern Cancel button) resolves the picker with a Picker draft
  (`kind: "cancel"`): the `QuestionState`s, tab, Submit note, image count, and
  Picker btw turns. A restored picker shows `Restored your answers` only when
  the draft holds a pick, text, a Submit note, or a turn, and it keeps the
  full `ask.timeout` countdown.
  `flexible-ask.ts` keeps it with the Picker btw runner in a per-load
  `PickerDraftSlot` (`extensions/picker-draft.ts`) before `ctx.abort()`. F5
  (`app.retry`) replays a cancelled tool call with its stored id and
  arguments before any model request (OMP `turn-recovery.ts`), so the same
  `ask` runs again; no key is bound. `take` hands the draft to a picker whose
  question ids, text, option labels, and `multi` match, and disposes the
  thread on any other questions. A main prompt keeps it (a manual retry fires
  no `before_agent_start`, and a re-ask after "go on" should match).
  The slot ends every Picker btw thread (`end`): a dropped draft's, a
  mismatched draft's, and a submitted or failed Picker's. `drop` waits for
  all of them. `session_before_switch`, `session_before_branch`,
  `session_tree`, and `session_shutdown` drop it, so no thread outlives the
  session it answers about.
- Tern sends Cmd+V as OSC 5522 enhanced paste. OMP reads it and calls the
  focused component's paste contract: `pasteText`, `beginPaste`,
  `acceptsImages`, and `attachImage`. `AnswerEditor` accepts host text and
  images, turns host markers into image chips, and queues keys until pending
  pastes finish. The option list implements the same contract only to refuse
  a paste and show `Open a note (n) or Other to paste`. Native selection copy
  stays Tern's.
- In Tern (terminals that speak the Tern Surface Protocol), OMP calls a
  component's `describe(cx)` instead of `render()`. The picker describes a
  `col` with role `omp.editor` (in the composer's place, as pi-tui's
  `AskDialogComponent`): `tabs`, a ring `meter` (re-described each second;
  `CountdownTimer`'s `elapsed` node when the terminal lacks `meter`), one
  compact `row` per option, and `omp.btn` buttons. Inline `min`/`max` widths
  of 100% override the composer's measure, so the picker spans the pane. The
  question and options sit in one `scrollBox` (`ask-editor.ts`): a capped
  `list`, because a `col` with `max.h` only clips. It is as tall as its
  content up to `DIALOG_HEIGHT_RATIO` of the pane's rows less
  `NATIVE_CHROME_LINES` (the status line, tabs, buttons, and insets, measured
  in Tern 0.7.2); the Picker btw thread alone keeps that height fixed
  (`min.h`). The classic panel is its tab's content up to the same ratio of
  the terminal. Its row cap is scaled because a list
  row is a text line plus 6px. The `scroll` request goes on the content, since
  Tern scrolls the scroller at or above the asking node and the list's scroller
  is inside the list node. Pointer `action` events run the same commands as
  keys (`#runRowCommand`, `#runSubmitCommand`); option rows use `omp-tools.*`
  roles, not `omp.ask.*`, and no `mark: "pick"`, which collapsed the marker
  column. Tern's sheets only style `omp.*` roles, so the picker sends its own
  stylesheet (`NATIVE_SHEET`, the `s` verb written to the terminal with every
  `describe` when `cx.feature("styles")`; a sheet belongs to one surface, and
  pi-tui opens a new inline surface on `gone` with the same describe context,
  so a once-only send is lost): theme variables only (`--sans`, `--t1`,
  `--t3`, `--l1`, `--l2`), so rows follow Tern's theme and appearance. Row
  text reads the terminal's `--sf-fs` and `--sf-lh` directly, so each line
  is one terminal row. Tern scopes a program sheet to strict descendants of
  its region, so a rule on `.sf-region` itself never applies (a copy of the
  variables there left them unset and dropped the label's `font` shorthand,
  Tern 0.9.5). The sheet's row padding and gap are in
  `NATIVE_STYLED_ROW_LINES`, the height estimate.
  Tern's Markdown hangs list numbers left of a 2-cell indent, into the page
  margin; a scroll box clips them, so the sheet pads each `scrollBox` scroller
  by 2 cells on the left and cancels it with a negative margin.
  Tern never reports what is on screen, so after PgUp/PgDn
  (`#nativePagedAway`) the next j/k, action key, or button only reveals the
  highlighted row (`#revealCursor` bumps its `reveal` token), as the classic
  picker does with a row it did not draw. A question's first showing keeps the
  question at the top: `#nativeHold` withholds the cursor's `reveal` until the
  cursor moves or a reveal is asked for, and `#nativeCursorFits` (estimated
  from the classic layout) sets `#nativePagedAway` when the row ends below the
  box, checked again whenever the box size changes while the hold lasts. A
  scroller mounted again (tab switch, back from an editor) reveals the
  highlighted row by a placement `reveal`.
  Wheel scrolling is not reported, so it does not trigger this guard.
  `AnswerEditor` and the Picker btw view describe themselves with the
  `CustomEditor` as a child component; `AnswerEditor` replaces the composer
  layout and placeholder so no model chip or send bar shows.
- Tool cards in Tern come from `describeCall`/`describeResult` on the
  definition. An extension tool never gets the built-in renderer of its name,
  so `ask` reuses the exported `askToolRenderer` (plus the Submit note, kept in
  `details.submitNote`) and `generate_image` has its own view.
  `mergeCallAndResult` is forwarded from the definition like `concurrency`. The
  host appends result images from `content` after the view's body.
- Preserve `approval: "read"`, `concurrency: "exclusive"`, cancellation
  (`ctx.abort()` plus `ToolAbortError`), `ask.timeout` auto-selection,
  `ask.notify`, and the explicit error when native ask delegation is unavailable.
  The Picker passes its timeout to `ui.custom` as `{ signal, timeout }`
  (`timeout` is not in `ExtensionCustomOptions`): since OMP 18.12 the host
  runs each extension dialog as a wait for the user, which ends the computer
  turn so the display can sleep, unless an options argument has a positive
  `timeout`, as native timed ask does.
- Keep native `ask` enabled. Replace legacy `omp-ask` installations rather than
  loading duplicate wrappers.
- `generate_image` composes the selected Image generation mode
  (`extensions/image-modes.ts`: description, schema, card facts, and `run`)
  with the shared artifact step (`extensions/image-artifacts.ts`), so a mode is
  an entry, not a branch. The async initializer reads `imageGenerationMode`
  with `getPluginSettings("omp-tools", process.cwd())` (absent or null is
  `openai`). OMP runs it once per process, so `session_switch` (`/new`,
  `/resume`, `/fork`) reads it again from `ctx.cwd` and registers the tool
  anew; the host refreshes a re-registered name, and a running call keeps the
  definition it started with. An invalid value, `""` included, registers a
  tool whose every call fails with the fix. No mode falls back to another
  (ADR 0002).
  Native `generate_image` is settings-gated. Eager extension registration makes
  native skip the taken name; deferred extension registration replaces native
  through the host's late tool-registration path. The plugin wins in either
  case. The schema stays open because OMP's argument validator deletes unknown
  keys from closed schemas (`pi-ai` `coerceArgsFromIssues`); `execute` rejects
  them and checks the schema itself.
- Final images go in `content` only, never `details.images` (the TUI would show
  them twice); `details.outputs` lists each saved path, MIME type, size, and
  quality. Policy `lossless-webp` re-encodes (Bun's WebP encoder drops the
  color under alpha 0; visible pixels and alpha are kept); `as-returned` keeps
  the provider's bytes. Streamed previews go through `onUpdate` with
  `details.stage: "preview"` and are never saved.
- Codex mode posts to `chatgpt.com/backend-api/codex/images/generations` (no
  references) or `/edits` with Codex's exact body and headers, using the
  `openai-codex` credential. Keep its request guards: 64 MB body cap (larger
  bodies get false `moderation_blocked` or silently dropped references), the
  0-image-token dropped-references check on edits, and the 5-minute timeout
  combined with the tool signal. The Images endpoint returns PNG with a signed
  C2PA manifest whatever `output_format` is sent (checked 2026-10-08), so the
  local re-encode drops that manifest. Only the hosted `/codex/responses` image
  tool returns WebP (lossless, manifest kept), but it puts a chat model in the
  loop and drew on the weekly `premium` limit rather than the daily
  `imagegen_premium` one. `details` keeps `x-codex-imagegen-request-id`,
  `generation_id`, and `usage.output_tokens` for tracing; errors append the
  request id. Success text warns at 80% of a limit window. The Images endpoint
  reports its image window as `x-codex-primary-*` under `x-codex-active-limit:
  imagegen_premium`, so limit-named headers are tried first and `x-codex-*` is
  the fallback; zero-minute windows are skipped.
- OpenAI mode (`extensions/openai-mode.ts`) uses the `openai` key from
  `getApiKeyForProvider`, only for `https://api.openai.com/v1`: a different
  `getProviderBaseUrl("openai")` (or `OPENAI_BASE_URL` when OMP reports none)
  fails the call. `OpenAI-Organization` and `OpenAI-Project` come from
  `getProviderHeaders("openai")`, else `OPENAI_ORG_ID` and `OPENAI_PROJECT_ID`.
  `extensions/sunburst-images.ts` sends one JSON request (no retries), decodes
  JSON or SSE (`*.partial_image`, `*.completed`, `error`; a stream needs `n`
  completions), and keeps `x-request-id`. The 5-minute timeout covers the
  stream. Omitted `output_format` requests PNG and saves lossless WebP; an
  explicit one keeps the API's bytes. Mask and markup bytes go out unchanged;
  local files and data URLs are checked first (`extensions/image-checks.ts`:
  alpha from the file header, transparency from decoded pixels, sizes from
  `Bun.Image` metadata, which applies EXIF orientation). No Codex guard
  applies. `details.requested` holds the sent settings (never the identifiers)
  and `details.reported` what the API reported.

## Important Files

- `extensions/flexible-ask.ts`: tool registration, TUI/native routing, and
  native-shaped result `details`.
- `extensions/ask-result.ts`: the labeled model-facing answer text (the model
  sees only this text, never `details`) and `joinOptionNotes`, the one note
  string native details hold per question.
- `extensions/ask-questions.ts`: the reserved labels, `sanitizeQuestions`,
  and `nativeRejects`, shared by `ask` and host dialogs.
- `extensions/ask-dialog.ts`: Markdown picker with the native pi-tui
  `AskDialogComponent` structure (tabs, Submit review, multi-select, Other,
  timeout) but its own key flow, one meaning per key in every picker: j/k or
  ↑/↓ move, h/l or ←/→/Tab switch tabs, Space toggles the row, Enter finishes
  the question (single-select picks the row first; no Submit tab means submit),
  `n` edits the row's text (option note, `Other`, Submit note), `x` clears it;
  editors save on Enter and stay, Esc discards. Notes are per option, survive
  picking, and are all sent; `Other` text survives un-picking. Diff the
  structure against upstream when OMP changes the native dialog.
- `extensions/ask-editor.ts`: `Other`/note text box. Wraps the main prompt's
  `CustomEditor` with the host's suggestion provider (borrowed in
  `flexible-ask.ts` through `ctx.ui.addAutocompleteProvider`) for references
  only: `/` suggests file commands (names from `discoverSlashCommands` in
  `flexible-ask.ts`) and skills without the `skill:` prefix, found by querying
  the host provider with synthetic `/<token>` and `/skill:<token>` lines and
  gated to name or hyphen-segment prefixes; built-in and extension commands are
  dropped, `#` prompt actions are hidden,
  completion `onApplied` side effects are dropped, and `trySyncSlashCompletion`
  is not forwarded, so nothing typed runs. It subclasses
  `HookEditorComponent` so the host routes the external-editor key and paste
  contract to it while it holds focus; the base editor is dropped. The plugin
  reader still handles bracketed pastes inside the `CustomEditor`.
- `extensions/ask-images.ts`: clipboard and path image loading for the picker's
  editors, using the host's clipboard/image-loading helpers.
- `extensions/picker-btw.ts`, `picker-btw.md`, `picker-btw-view.ts`: the
  Picker btw runner (one Side question thread per ask), its prompt, and its
  thread view.
- `extensions/host-ask-dialog.ts`: `routeHostAskDialog` (the host
  `askDialog` route) and `askInPicker` (the picker answering in the native
  result shape).
- `extensions/picker-draft.ts`: `PickerDraftSlot`, the session's one kept
  Picker draft with its Picker btw runner, the question key it matches on, and
  the Picker btw threads still ending; `openPicker`, which shows a picker
  with its matching draft and keeps or ends the draft and thread, for `ask`
  and host dialogs alike.
- `extensions/side-question.ts`: `SideQuestionThread` (the mirror session with
  only the five read-only tools, its `SideQuestionRegistry`, `seedMessages`,
  and the message-start, text, and tool-call callbacks; an already-aborted
  signal is rejected before any request), `createMirrorSession` with the
  Side cache key and stream options, `SideQuestionCache`, the usage ledger
  (`recordSideQuestionUsage`, `forwardSideQuestionUsage`),
  `LazySideQuestionThread` (opened on first use,
  shared by both callers), and `sideQuestionsAvailable`.
- `extensions/side-question-view.ts`: what both views share: the turn
  (`SideQuestionTurn` with ordered `parts`, `answerInto`), the interrupt key,
  and `SideQuestionTurnView`, which draws the question as the main chat draws
  the user's message (Markdown on `userMessageBg` padded by a row and a
  column; in Tern a `card` with role `omp.user`, which Tern's sheet styles
  as the user bubble anywhere), then the turn's text and each group of tool
  calls as a folded "N tool calls" line, in order (classic lines, or one Tern
  collapsible `section` per group).
- `extensions/btw.ts`, `btw.md`, `btw-panel.ts`: the `/btw` takeover
  (`parseBtwQuestion`, `BtwCycle`, keys), its prompt, and its panel.
- `extensions/flexible-ask.md`: static model-facing description; keep aligned
  with upstream `packages/coding-agent/src/prompts/tools/ask.md` except the
  option count (the plugin states no number instead of 2–5).
- `extensions/assets.d.ts`: ambient typing for the static Markdown import.
- `extensions/generate-image.ts`: `generate_image` registration (the mode
  setting, the invalid-setting tool), the argument check, result content, and
  the Tern card for previews, saved images, and errors.
- `extensions/image-modes.ts`: the `ImageMode` entry type and Codex mode.
- `extensions/openai-mode.ts`: OpenAI mode: schema, argument rules (sizes,
  formats, reference sources, mask and markup), access, and request body.
- `extensions/generate-image.md`, `generate-image-openai.md`: the static
  model-facing description of each mode.
- `extensions/image-artifacts.ts`: saving final images by policy and the
  model-facing saved-path text.
- `extensions/image-codecs.ts`: format sniffing, MIME types, lossless WebP.
- `extensions/image-checks.ts`: alpha channel, transparent pixels, and
  oriented size, for local masks and markups.
- `extensions/codex-images.ts`: Codex Images request body, headers (account id
  and residency from the token's JWT claims, reimplemented because
  `@oh-my-pi/pi-catalog` is not served), guards, and error text.
- `extensions/sunburst-images.ts`: the public Images API client (JSON and SSE
  decoding, error text, timeout, cancellation).
- `extensions/reference-images.ts`: reference images from absolute paths or the
  active branch (`getBranch()`, including native `details.images`). Codex mode
  keeps JPEG and WebP and sends the rest as lossless WebP; OpenAI mode keeps
  PNG, JPEG, and WebP and sends the rest as PNG.
- `skills/generate-image/SKILL.md`: the pre-send criteria for prompts and edits,
  plus reference, mask, markup, transparency, and retry rules for each mode.
  It is generic and has no examples; the cited research behind it is in
  `docs/research/image-prompting-*.md`, `image-prompt-criteria-*.md`,
  `image-prompt-format.md` (prose vs labeled lines vs JSON),
  `gpt-image-2.5-*.md` (rules checked against Images 2.5; the Codex endpoint
  accepts any `model` with no visible effect, so rules stay model-agnostic),
  `codex-image-backend-model.md` (live check of which model serves;
  inconclusive), and `codex-api-credit-images.md` (the public Sunburst
  contract and API credit billing).
- `test/`: `bun test` behavior tests for `generate_image` in both modes through
  `execute` (settings from a real project `.omp/plugin-overrides.json`; a
  `mock.module` would leak into other test files) with a stubbed `fetch`,
  including split-chunk SSE, for `parseBtwQuestion`, `AnswerEditor`'s host paste
  contract, Picker btw `numberImagesByAppearance`, the Picker draft (the slot's
  match rule, and Esc then reopen through `showMarkdownAskDialog` with a stub
  `ui.custom`), host `askDialog` through the route (picks, notes, Esc and
  draft, abort, native fallback for reserved labels and malformed input,
  caller ids echoed, `onTimeout`, no stacking), and for the Side question's
  `seedMessages`, cache key and stream options, `cacheMissTokens`,
  `SideQuestionCache`, `sharedPrefixPrompt`, the usage ledger and its
  forwarding, and `answerInto`. The tool limit, the thread cycle, the
  mirror session, the panel, and a kept Picker btw thread have live smoke only.
- `package.json`: OMP discovery, scripts, and SDK dependency pins.
- `tsconfig.json`: strict, no-emit TypeScript configuration for extensions.
- `README.md` and `CHANGELOG.md`: update when changing user-visible behavior.

## Development Commands

Run from the repository root:

```sh
bun install --ignore-scripts
bun run check
bun test
bun run update
omp plugin link "$PWD"
```

`bun run check` runs `scripts/check-sdk-version.ts` (warns when installed SDK
types differ from `omp --version`) and then `tsgo --noEmit`. `bun run update`
runs `scripts/update-sdk.ts`: `omp update`, `bun update --latest` for both SDK
packages, restores their `"latest"` specifiers, reinstalls, and checks. Both
scripts run omp through `scripts/host-env.ts`: `bun run` prepends
`node_modules/.bin`, where the SDK links its `cli.js` as `omp`, and Bun Shell
ignores `.env()` PATH when resolving commands, so a bare `omp` would hit the
dev dependency instead of the installed binary.

There is no separate build, lint, formatter, or standalone run script. OMP loads
linked source directly. Start a **new OMP session** after linking or editing;
reinstallation is unnecessary for linked edits.

## Code Conventions

Match existing tabs, double quotes, semicolons, and trailing commas. Use camelCase
functions/locals, PascalCase types, and `import type` for SDK types. Keep the
default-exported initializer and initializer-local registration state. Preserve
the extension execute signature `(toolCallId, params, signal, onUpdate, ctx)`.
Return native-shaped async results and propagate failures.

## Runtime and Verification

Use Bun and `bun.lock`. The private package is ESM with ESNext/Preserve modules
and Bundler resolution. SDK packages supply development types. Runtime value
imports of `@oh-my-pi/*` resolve to the host's in-process modules through OMP's
extension specifier shim; in compiled binaries only exported subpaths are served
(`@oh-my-pi/pi-tui`, `/chrome`, `/render`, `/theme`, `/thinking`,
`@oh-my-pi/pi-coding-agent`, `/judgment`, `/modes/*`, `/tools/*`, `/utils/*`,
and the `@oh-my-pi/pi-utils` root). Compiled OMP 18.13.3 also loaded the exact
`pi-coding-agent` subpaths `/config/model-resolver`,
`/extensibility/plugins/loader`, and `/session/settings` in a live import
probe. Do not assume other wildcard subpaths work: unserved paths such as
`@oh-my-pi/pi-tui/overlays/*` can load a second SDK copy and fail.
`@oh-my-pi/pi-tui` root exports the describe builders (`node`, `col`, `md`,
`span`, `text`, `kbd`); `actionButton` and `hintsRow` from `/native/overlay`,
which is not on the checked list, are mirrored in `ask-dialog.ts` and
`ask-editor.ts`. Type-only imports such as
`@oh-my-pi/pi-tui/tools/renderer` are erased and safe. Both SDK packages use
the `"latest"` specifier; `bun.lock` records the resolved version, so update
through `bun run update` to keep types and the installed omp in step.

Run typechecking and `bun test` after code changes; tests cover
`generate_image`, `parseBtwQuestion`, `AnswerEditor` paste handling, the Picker
draft, the host `askDialog` route, the real Side question session's model,
thinking, context boundary, images, fallback and cost cap, cache-miss tracking,
usage ledger, and recovery rendering. There is
no repository CI. Registration, ask, and Side question changes
require a fresh-session OMP smoke; typechecking alone does not exercise host
integration or UI. OMP 18.13.3 with Tern 0.9.7 proved both renderers' primary
model selection, role thinking, retry countdowns, fallback switches, terminal
failure and Esc in `/btw` and Picker btw; host `askDialog` picks, notes,
Other, draft and timeout; eager and deferred tool precedence; and compiled RPC
Side question images, five-tool restriction, privacy and shared cost gate.
The isolated headless helper was proved from a bash launcher. The same
versions proved each `generate_image` mode's schema, a live Codex generation
card, and OpenAI error cards; live OpenAI requests are unproven because no
valid `openai` key was available.
OMP 18.12.5 with headless Tern 0.9.5 (Tern view and
`PI_TUI_NATIVE=0`) was used for every surface: the picker (keys, `Other`,
notes, Submit, pointer, `ask.timeout`), the Picker btw (also during an `ask`
that a subagent's IRC message started), `/btw`, the `generate_image`
generate and edit, and the Picker label's computed font (DevTools Console
`element:style(prop)`); RPC mode for the read-only Side question probes
(`helpers/side-question-probe.ts`: the five tools, and `read agent://` of a
running subagent; a file outside the plugin cannot resolve `@oh-my-pi/*`).
OMP 18.12.1 with native Tern 0.9.4 was used for Picker Cmd+C and Cmd+V (with
a temporary picker extension). A headless Tern window drives
the Tern smokes: `tern serve --control <sock>`, then `tern ctl --control <sock>`
`run`, `type`, `key`, `click '<css selector>'`, and `shot <name>` (PNG plus a
layout JSON of every element). `PI_TUI_NATIVE=0` in the same window checks the
text renderer.

## Sibling repos

The OMP source is checked out at `~/work/tries/oh-my-pi` (`origin` is
`can1357/oh-my-pi`). Read it for host behavior, the upstream files named above
(the native dialog, `packages/coding-agent/src/prompts/tools/ask.md`), and
`/tan` or `/btw` internals, at the tag matching `omp --version` (`v<version>`).

tern-plugins (`~/work/tries/tern-plugins`) also starts isolated Tern instances
and seeds the same omp state to keep Tern's omp offer alert off the screen.
When a Tern update changes the omp state, the alert, or how an isolated
instance starts, fix the start in both repos: `tern-verify start` there and
`.omp/skills/verify-omp-tools/helpers/tern-isolated` here.

## vstack

- Issue tracker: GitHub Issues. See `docs/vstack/issue-tracker.md`.
- Code host: GitHub, through the `gh` CLI. See `docs/vstack/code-host.md`.
- CI service: GitHub Actions, through the `gh` CLI. See `docs/vstack/ci.md`.
- Triage labels: default vocabulary. See `docs/vstack/triage-labels.md`.
- Domain docs: single-context. See `docs/vstack/domain.md`.
