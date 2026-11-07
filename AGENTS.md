# Repository guidelines

`omp-tools` is an Oh My Pi (OMP) plugin with three parts. Terms follow
`GLOSSARY.md`; user-facing behavior is in `README.md`.

- `ask`: a shadow of native `ask` with no model-facing option count. In the
  TUI it shows the Picker; elsewhere it delegates to native `ask`.
- `generate_image`: replaces native `generate_image` with two Image generation
  modes, OpenAI mode (the default) and Codex mode.
- `/btw <question>` and the Picker btw: Side questions answered by a read-only
  mirror session.

`package.json` registers the entry points `extensions/flexible-ask.ts`,
`extensions/generate-image.ts`, and `extensions/btw.ts`. OMP also loads
`skills/*/SKILL.md` from the plugin root (the `omp-plugins` discovery
provider, priority 90).

## Commands

```sh
bun install --ignore-scripts
bun run check     # SDK version warning, then tsgo --noEmit
bun test
bun run update    # omp update, newest SDK types, then check
omp plugin link "$PWD"
```

There is no build, lint, or formatter. OMP loads the linked source directly,
so start a new OMP session after every edit; running sessions keep the
definitions they loaded.

`scripts/host-env.ts` runs omp for both scripts. `bun run` puts
`node_modules/.bin` first on PATH, where the SDK links its `cli.js` as `omp`,
and Bun Shell ignores `.env()` PATH when it resolves commands, so a bare `omp`
would run the dev dependency instead of the installed binary.

## Code conventions

Match the existing tabs, double quotes, semicolons, and trailing commas. Use
camelCase functions and locals, PascalCase types, and `import type` for SDK
types. Keep the default-exported initializer with registration state local to
it, and the execute signature `(toolCallId, params, signal, onUpdate, ctx)`.
Return native-shaped async results and propagate failures.

## SDK imports

Runtime value imports of `@oh-my-pi/*` resolve to the host's in-process
modules through OMP's extension specifier shim. Compiled binaries serve only
exported subpaths:

- `@oh-my-pi/pi-tui`, `/chrome`, `/render`, `/theme`, `/thinking`
- `@oh-my-pi/pi-coding-agent`, `/judgment`, `/modes/*`, `/tools/*`,
  `/utils/*`, and the exact subpaths `/config/model-resolver`,
  `/extensibility/plugins/loader`, and `/session/settings` (import probe,
  compiled OMP 18.13.3)
- the `@oh-my-pi/pi-utils` root

Any other subpath can load a second SDK copy and fail
(`@oh-my-pi/pi-tui/overlays/*` does). The `pi-tui` root exports the describe
builders (`node`, `col`, `md`, `span`, `text`, `kbd`). `actionButton` and
`hintsRow` live in the unserved `/native/overlay`, so `ask-dialog.ts` and
`ask-editor.ts` mirror them. Type-only imports such as
`@oh-my-pi/pi-tui/tools/renderer` are erased and safe.

Both SDK packages use the `"latest"` specifier and `bun.lock` records the
resolved version. Update through `bun run update` so the types and the
installed omp move together.

## `ask` and the Picker

- `flexible-ask.ts` registers the shadow description and schema. With
  `ctx.mode === "tui"` and `ctx.hasUI` it opens the Picker through
  `ctx.ui.custom` and formats native-shaped results. An extension cannot
  restyle the native dialog: `ctx.invokeTool` runs it with the session UI.
- Elsewhere (RPC, ACP, print, subagents), and for inputs native rejects
  (reserved or duplicate labels, duplicate ids), it calls
  `ctx.invokeTool(params, { signal, onUpdate })` so native errors and
  fallbacks apply unchanged. `ask-questions.ts` holds the reserved labels,
  `sanitizeQuestions`, and `nativeRejects`, shared with host dialogs. Keep
  native `ask` enabled for this, and replace legacy `omp-ask` installs instead
  of loading two wrappers.
- Unlike native `ask` (`tools/ask.ts`), the Picker keeps `ask.timeout` in
  plan mode and does not speak the questions under `speech.enabled`.
- Preserve `approval: "read"`, `concurrency: "exclusive"`, cancellation
  (`ctx.abort()` plus `ToolAbortError`), `ask.timeout` auto-selection,
  `ask.notify`, and the explicit error when native delegation is unavailable.
- Pass the timeout to `ui.custom` as `{ signal, timeout }` (`timeout` is not
  in `ExtensionCustomOptions`). Since OMP 18.12 the host treats an extension
  dialog as a wait for the user, which ends the computer turn so the display
  can sleep, unless the options carry a positive `timeout`, as native timed
  ask does.
- `ask-dialog.ts` keeps pi-tui `AskDialogComponent`'s structure (tabs, Submit
  review, multi-select, Other, timeout) with its own key flow, one meaning
  per key in every Picker (README keys table). Diff the structure against
  upstream when OMP changes the native dialog.
- `ask-result.ts` writes the labeled answer text, the only part the model
  sees, and `joinOptionNotes`, the one note string native details hold per
  question.
- `flexible-ask.md` is the model-facing description. Keep it aligned with
  upstream `packages/coding-agent/src/prompts/tools/ask.md`, except that it
  states no option count where upstream says 2–5. `assets.d.ts` types the
  Markdown import.

### Editors and paste

- `ask-editor.ts` wraps the main prompt's `CustomEditor` with the host's
  suggestion provider, borrowed in `flexible-ask.ts` through
  `ctx.ui.addAutocompleteProvider`, for references only:
  - `/` suggests file commands (names from `discoverSlashCommands`) and skills
    without the `skill:` prefix, found by querying the host provider with
    synthetic `/<token>` and `/skill:<token>` lines and kept to name or
    hyphen-segment prefixes.
  - Built-in and extension commands, `#` prompt actions, and completion
    `onApplied` side effects are dropped, and `trySyncSlashCompletion` is not
    forwarded, so nothing typed runs.
  - It subclasses `HookEditorComponent` so the host routes the external-editor
    key and the paste contract to it while it has focus. The plugin reader
    still handles bracketed pastes inside the `CustomEditor`.
- Tern sends Cmd+V as OSC 5522 enhanced paste, and OMP calls the focused
  component's paste contract (`pasteText`, `beginPaste`, `acceptsImages`,
  `attachImage`). `AnswerEditor` accepts host text and images, turns host
  markers into image chips, and queues keys until pending pastes finish. The
  option list implements the contract only to refuse a paste with
  `Open a note (n) or Other to paste`. Selection copy stays Tern's.
- `ask-images.ts` loads clipboard and path images with the host's helpers.

### The Picker in Tern

In terminals that speak the Tern Surface Protocol, OMP calls `describe(cx)`
instead of `render()`.

- The Picker describes a `col` with role `omp.editor` in the composer's place,
  as `AskDialogComponent` does: `tabs`, a ring `meter` re-described each second
  (`CountdownTimer`'s `elapsed` node when the terminal lacks `meter`), one
  compact `row` per option, and `omp.btn` buttons. Inline `min`/`max` widths
  of 100% override the composer's measure, so it spans the pane.
- The question and options share one `scrollBox` (`ask-editor.ts`), a capped
  `list`, because a `col` with `max.h` only clips. It is as tall as its content
  up to `DIALOG_HEIGHT_RATIO` of the pane's rows less `NATIVE_CHROME_LINES`
  (status line, tabs, buttons, and insets, measured in Tern 0.7.2). Only the
  Picker btw thread fixes that height (`min.h`). The classic Picker caps at the
  same ratio of the terminal, with the row cap scaled because a list row is a
  text line plus 6px.
- Put the `scroll` request on the content: Tern scrolls the scroller at or
  above the asking node, and the list's scroller is inside the list node.
- Pointer `action` events run the key commands (`#runRowCommand`,
  `#runSubmitCommand`). Option rows use `omp-tools.*` roles, not `omp.ask.*`,
  and no `mark: "pick"`, which collapsed the marker column.
- Tern's sheets style only `omp.*` roles, so the Picker sends `NATIVE_SHEET`
  (the `s` verb) with every `describe` when `cx.feature("styles")`. A sheet
  belongs to one surface, and pi-tui opens a new inline surface on `gone` with
  the same describe context, so a once-only send is lost.
  - The sheet uses theme variables only (`--sans`, `--t1`, `--t3`, `--l1`,
    `--l2`), and row text reads `--sf-fs` and `--sf-lh` so each line is one
    terminal row.
  - Tern scopes a program sheet to strict descendants of its region, so a rule
    on `.sf-region` never applies (Tern 0.9.5).
  - `NATIVE_STYLED_ROW_LINES`, the height estimate, includes the sheet's row
    padding and gap.
  - Tern's Markdown hangs list numbers 2 cells left of the text, where a scroll
    box clips them, so the sheet pads each `scrollBox` scroller 2 cells left
    and cancels it with a negative margin.
- Tern never reports what is on screen. After PgUp/PgDn (`#nativePagedAway`)
  the next j/k, action key, or button only reveals the highlighted row
  (`#revealCursor` bumps its `reveal` token). A question's first showing keeps
  its top in view: `#nativeHold` withholds the cursor's `reveal` until the
  cursor moves or a reveal is asked for, and `#nativeCursorFits`, estimated
  from the classic layout, sets `#nativePagedAway` when the row ends below the
  box, rechecked on every box resize while the hold lasts. A remounted
  scroller (tab switch, back from an editor) reveals the row by a placement
  `reveal`. Wheel scrolling is not reported and does not arm this guard.
- `AnswerEditor` and the Picker btw view describe the `CustomEditor` as a child
  component. `AnswerEditor` replaces the composer layout and placeholder so no
  model chip or send bar shows.
- Tool cards come from `describeCall` and `describeResult`. An extension tool
  never gets the built-in renderer of its name, so `ask` reuses the exported
  `askToolRenderer` plus the Submit note (`details.submitNote`).
  `mergeCallAndResult` is forwarded from the definition like `concurrency`.
  The host appends result images from `content` after the view's body.

### Picker draft

- Esc (or Tern's Cancel button) resolves the Picker with `kind: "cancel"`
  and a Picker draft: the `QuestionState`s, tab, Submit note, image count, and
  Picker btw turns. `flexible-ask.ts` stores it with the Picker btw runner in
  a per-load `PickerDraftSlot` (`picker-draft.ts`) before `ctx.abort()`.
- F5 (`app.retry`) replays the cancelled call with its stored id and arguments
  before any model request (OMP `turn-recovery.ts`), so the same `ask` runs
  again. No key is bound. Since OMP 18.14, a custom message after the abort
  other than an eval-state snapshot (a background job result between Esc and
  F5) makes F5 drop the aborted turn and call the model. A re-ask with the
  same questions still gets the draft.
- `take` hands the draft to a Picker whose question ids, text, option labels,
  and `multi` match, and disposes the thread on other questions. A main
  prompt keeps the draft: a manual retry fires no `before_agent_start`, and a
  re-ask after "go on" should match.
- A restored Picker shows `Restored your answers` only when the draft holds a
  pick, text, a Submit note, or a turn, and restarts the full `ask.timeout`.
- The slot ends every Picker btw thread (`end`): dropped, mismatched,
  submitted, or failed. `drop` waits for all of them.
  `session_before_switch`, `session_before_branch`, `session_tree`, and
  `session_shutdown` drop the draft, so no thread outlives its session.
- `openPicker` shows a Picker with its matching draft and keeps or ends the
  draft and thread, for `ask` and host dialogs alike.

### Host dialogs

OMP code that asks without the `ask` tool calls the shared UI context's
`askDialog`: Ratchet approvals (`ratchet/prelude-definition.ts`) and the
`/tree` ask re-answer. `host-ask-dialog.ts` routes it to the Picker in the
TUI. The route relies on undocumented OMP internals, proved live with OMP
18.12.6; recheck it when OMP changes the extension runner.

- `session_start` replaces `askDialog` on the context object itself. The
  runner's context and the tool context store's wrapper (`trackUserWaits`)
  are proxies with only a `get` trap, so a write through `ctx.ui` lands on the
  object, and every later handler run reads it. A run already in flight keeps
  the method its proxy captured.
- Read the native `askDialog`, `custom`, and `notify` through property
  descriptors: the runner's `get` returns per-handler wrappers bound to that
  handler's signal.
- One wrapper lives under `Symbol.for("omp-tools.host-ask-dialog")`, shared by
  every module load. Further routes stack in its list, and the last one to end
  (`session_shutdown`) restores the native method.
- `askInPicker` opens the Picker through `openPicker` and answers in the
  native `ExtensionAskDialogResult` shape: the caller's ids, question text,
  and labels (shown without `\r`), picks, `Other` text, one note per question
  (each option note after its option, then the Submit note), and images split
  by whether `customInput` names their label.
- Esc and an aborted signal give `undefined`, and Esc keeps a Picker draft in
  the same slot as `ask`.
- Only the caller's `timeout` counts down. Its `onTimeout` runs once on expiry
  before answers are picked, as native does, and no notification is sent.
- Malformed questions, which native coerces, and `nativeRejects` questions go
  to the native method.
- Collaboration guests cannot answer, because the native method's guest race
  is skipped. This is an accepted limit: no extension API reports a guest.

## Side questions

`side-question.ts` holds `SideQuestionThread`, `createMirrorSession`,
`SideQuestionCache`, the usage ledger, `LazySideQuestionThread` (opened on
first use, shared by `/btw` and the Picker btw), and `sideQuestionsAvailable`.
A Side question is a full agent run in a mirror session built the way OMP's
`/tan` builds one (`tan-command-controller.ts`).

- **Fork.** `SessionManager.forkFrom` copies the main transcript, with
  `repairInterruptedTail` because the main agent may be mid-turn, into
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
- **Seed.** `seedMessages` replaces the mirror's messages with a
  `structuredClone` of `main.agent.state.messages`. The live copy is on the
  selected branch, which the file does not record, and holds messages the file
  lacks (the `eval-state-context` message after a `/tree` jump, #15933). Each
  call the last reply still waits on gets a still-open result (`ask`: the user
  is answering now; others: still running; both say not to call it again).
  An "aborted" result made the model ask the user again.
- **Model.** `side-question-model.ts` reads `sideQuestionModel` (default
  `@smol`; empty keeps the main model) per thread with `getPluginSettings`,
  and resolves the role and thinking level with `resolveModelOverride`. The
  fork records the selected role so shared-model roles keep their own
  fallback chains.
  - An unresolved selector calls `refreshDiscoverableProviders(..., "online")`
    for the providers its patterns name, then resolves again. Use that, not
    `refreshProvider`, whose static reload drops discovered models. A running
    OMP can lose discovery-only models such as Codex `gpt-6.1-terra` after a
    denied discovery with no usable cache.
  - The caller's signal, passed through `LazySideQuestionThread.get` and
    `open`, ends the wait without aborting the shared refresh.
  - Still unresolved, it warns with the missing model and uses the main model.
  - Before the first request, the tokenizer checks the live history plus
    prompt and tool overhead. A known context window that is too small uses
    the main model. OMP owns overflow recovery after that.
- **Cache misses.** `SideQuestionCache` gives each thread a tracker that flags
  a request reading more than 2048 tokens below the expected cached prefix:
  the thread's previous request on that provider and model, or for a first
  request, the earlier thread's first request on that route while the main
  messages still start with the ones it saw (`sharedPrefixPrompt`). It counts
  only when the request wrote cache (`cacheWrite > 0`, never on Codex) and
  shows `⊘ cache miss · N tokens` only while `display.cacheMissMarker` is on.
- **Usage.** `recordSideQuestionUsage` writes each mirror request to the main
  session's ledger as `model_usage` with purpose `side-question`.
  `forwardSideQuestionUsage` wraps the fork's `appendModelUsage` and copies
  every entry the mirror records off its transcript (cache warms, judge calls)
  as `side-question:<purpose>`. Session cost counts them after the fork file is
  gone, and none is a message.
- **Cache warming.** OMP's warming stays on: an idle panel on a 5-minute tier
  is warmed like the main session. 1-hour entries outlive the 30-minute idle
  window, so they are not.
- **Streaming.** The thread reports each assistant message's start
  (`onMessageStart`), its text, tool calls, and native retry and fallback
  events (`onRecovery`, `side-question-recovery.ts`). `answerInto`
  (`side-question-view.ts`) keeps them as ordered parts with a live retry
  countdown, so a later message never replaces earlier text. `ask` returns the
  last assistant message's text, and rejects an already-aborted signal before
  any request.
- **Recovery.** Transport retries happen before TurnRecovery events, and
  native fallback chains can revisit models and renew their retry budgets.
  Keep OMP's policy and cancellation; add no Side-only retry rules.
- **Availability.** A Side question needs a live main session
  (`AgentRegistry.global()`) and a session file. Without them `/btw` falls
  through to native and the Picker btw is off.
- **View.** `SideQuestionTurnView` draws the question as the main chat draws a
  user message (Markdown on `userMessageBg`, padded a row and a column; in
  Tern a `card` with role `omp.user`, styled as the user bubble), then the
  text and each group of tool calls as a folded "N tool calls" line (one Tern
  collapsible `section` per group).

### `/btw`

`btw.ts`, `btw.md`, and `btw-panel.ts` hold the takeover (`parseBtwQuestion`,
`BtwCycle`, keys), its prompt, and its panel.

- OMP skips extension commands named like built-ins, so the plugin catches the
  text in the `input` event, which runs before built-in dispatch
  (`docs/adr/0001-take-over-btw-through-input-event.md`). It returns
  `{ handled: true }` only for `source: "interactive"` in the TUI. Bare `/btw`,
  autocomplete, `side: true` file commands, the focused-subagent path (it
  skips `input` handlers), and RPC `btw` stay native.
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

### Picker btw

`picker-btw.ts`, `picker-btw.md`, and `picker-btw-view.ts` hold the runner,
its prompt (with the unsubmitted answers from `formatAskAnswers`), and the
thread view.

- Each ask gets one thread (`pickerBtwRunner` in `flexible-ask.ts`), opened on
  the first `?` question and disposed when the dialog closes, unless a Picker
  draft keeps it. A cancelled turn keeps the thread.
- `?` disposes the countdown, and the next key in the options restarts it.
- Pasted images go to `SideQuestionThread.ask` as prompt images.

## `generate_image`

`generate-image.ts` composes the selected mode (`image-modes.ts`: an
`ImageMode` entry with description, schema, card facts, and `run`) with the
shared artifact step (`image-artifacts.ts`), so a new mode is an entry, not a
branch. `generate-image.md` and `generate-image-openai.md` are the
model-facing descriptions.

- **Mode setting.** The async initializer reads `imageGenerationMode` with
  `getPluginSettings("omp-tools", process.cwd())`; absent or null is
  `openai`. OMP runs the initializer once per process, so `session_switch`
  (`/new`, `/resume`, `/fork`) reads it again from `ctx.cwd` and registers the
  tool anew. The host refreshes a re-registered name, and a running call keeps
  the definition it started with. An invalid value, `""` included, registers a
  tool whose every call fails with the fix. No mode falls back to another
  (`docs/adr/0002-explicit-image-generation-modes.md`).
- **Precedence.** Native `generate_image` is settings-gated. Eager extension
  registration makes native skip the taken name, and deferred registration
  replaces native through the host's late registration path. The plugin wins
  either way.
- **Schema.** Keep the schema open: OMP's validator deletes unknown keys from
  closed schemas (`pi-ai` `coerceArgsFromIssues`). `execute` rejects unknown
  keys and checks the schema itself.
- **Results.** Raster images go in `content` only, never `details.images`
  (the TUI would show them twice). SVG returns a saved path and an instruction
  to read it, without image content. `details.outputs` lists each path, MIME
  type, size, and quality. Policy `lossless-webp` re-encodes (Bun's encoder
  drops the color under alpha 0 and keeps visible pixels and alpha);
  `as-returned` keeps the provider's bytes, GIF and SVG included. GIF content
  stays `image/gif`. Streamed previews go through `onUpdate` with
  `details.stage: "preview"` and are never saved.
- **References.** `reference-images.ts` reads absolute paths or the active
  branch (`getBranch()`, including native `details.images`). Codex mode keeps
  JPEG and WebP and sends the rest as lossless WebP. OpenAI mode keeps PNG,
  JPEG, and WebP and sends the rest as PNG. `image-codecs.ts` sniffs formats
  and encodes WebP.

### Codex mode

`codex-images.ts` posts to `chatgpt.com/backend-api/codex/images/generations`
(no references) or `/edits` with Codex's exact body and headers and the
`openai-codex` credential. It reimplements the account id and residency from
the token's JWT claims because `@oh-my-pi/pi-catalog` is not served.

- Keep the request guards: the 64 MB body cap (larger bodies get false
  `moderation_blocked` or silently dropped references), the 0-image-token
  dropped-references check on edits, and the 5-minute timeout combined with
  the tool signal.
- The endpoint returns PNG with a signed C2PA manifest whatever
  `output_format` says (checked 2026-10-08), and the local re-encode drops the
  manifest. Only the hosted `/codex/responses` image tool returns WebP, but it
  puts a chat model in the loop and drew on the weekly `premium` limit instead
  of the daily `imagegen_premium` one.
- `details` keeps `x-codex-imagegen-request-id`, `generation_id`, and
  `usage.output_tokens`; errors append the request id.
- Success text warns at 80% of a limit window. The endpoint reports its image
  window as `x-codex-primary-*` under
  `x-codex-active-limit: imagegen_premium`, so limit-named headers come first
  and `x-codex-*` is the fallback. Zero-minute windows are skipped.

### OpenAI mode

`openai-mode.ts` holds the schema, argument rules, access, and request body.
`sunburst-images.ts` is the Images API client.

- The `openai` key from `getApiKeyForProvider` goes only to
  `https://api.openai.com/v1`. A different `getProviderBaseUrl("openai")`, or
  `OPENAI_BASE_URL` when OMP reports none, fails the call.
  `OpenAI-Organization` and `OpenAI-Project` come from
  `getProviderHeaders("openai")`, else `OPENAI_ORG_ID` and
  `OPENAI_PROJECT_ID`.
- It always sends `gpt-image-2.6-sunburst`. Size checks keep only `auto` or
  multiples of 16 with aspect ratio 1:3 to 3:1. The undocumented 2.6 edge and
  pixel limits are left to the API.
- Registration reads `svgAuthorModel` at session start and on session switch;
  absent or empty means `gpt-6.1-sol`. SVG requests always send
  `svg: { model }`, and a call's `svg` settings override it.
- The client sends one JSON request (no retries), decodes JSON or SSE
  (`*.partial_image`, `*.completed`, `error`; a stream needs `n`
  completions), and keeps `x-request-id`. The 5-minute timeout covers the
  stream.
- Mask and markup bytes go out unchanged. Local files and data URLs are
  checked first (`image-checks.ts`: alpha from the file header, transparency
  from decoded pixels, sizes from `Bun.Image` metadata with EXIF
  orientation). No Codex guard applies.
- `details.requested` holds the sent settings, never the identifiers.
  `details.reported` holds what the API reported, and `details.svgUsage` the
  SVG author's `svg_usage`.

### Prompting skill

`skills/generate-image/SKILL.md` holds the pre-send criteria for prompts and
edits and the reference, mask, markup, transparency, and retry rules for each
mode. It stays generic, with no examples. Its cited research is in
`docs/research/`: `image-prompting-*.md`, `image-prompt-criteria-*.md`,
`image-prompt-format.md` (prose, labeled lines, or JSON), `gpt-image-2.6.md`
(controls, pricing, documentation conflicts, and GIF, SVG-author, and Codex
probes), `gpt-image-2.5-*.md` (earlier checks), `codex-image-backend-model.md`
(which model serves; inconclusive), and `codex-api-credit-images.md` (the
public Sunburst contract and API credit billing).

## Verification

Run `bun run check` and `bun test` after code changes. Tests drive
`generate_image` through `execute` with a stubbed `fetch` and settings from a
real project `.omp/plugin-overrides.json`; a `mock.module` would leak into
other test files.

The opt-in `test/generate-image-openai.live.test.ts` sends three paid
requests (a still image with complexity, an SVG, and a GIF) and runs only with
`OMP_TOOLS_LIVE_IMAGES=1` and `OPENAI_API_KEY`:
`OMP_TOOLS_LIVE_IMAGES=1 bun test live`.

There is no CI. Changes to registration, `ask`, the Picker, Side questions,
tool cards, or event handling need a fresh-session OMP smoke through the
`verify-omp-tools` skill (headless Tern, `PI_TUI_NATIVE=0` for the text
renderer, RPC for checks without a screen). The five-tool limit, the `/btw`
thread cycle, the mirror session, the panel, and a kept Picker btw thread have
live smoke only.

Last live proof, newest first:

- OMP 18.14.2, headless Tern 0.9.9: Esc then F5 on an `ask` replays the same
  call id with no model request between, and the Picker restores picks, option
  notes, and the Picker btw turn.
- OMP 18.13.3, Tern 0.9.7: in both renderers, Side question model selection,
  role thinking, retry countdowns, fallback switches, terminal failure, and Esc
  in `/btw` and the Picker btw; host `askDialog` picks, notes, Other, draft,
  and timeout; eager and deferred `generate_image` precedence; each mode's
  schema, a live Codex card, and OpenAI error cards (no live OpenAI request);
  over compiled RPC, Side question images, the five-tool limit, privacy, and
  the shared cost gate.
- OMP 18.12.5, headless Tern 0.9.5: every surface in both renderers (Picker
  keys, `Other`, notes, Submit, pointer, `ask.timeout`; Picker btw, also in an
  `ask` started by a subagent's IRC message; `/btw`; `generate_image`
  generate and edit) and the Picker label's computed font (DevTools Console
  `element:style(prop)`).
- OMP 18.12.1, native Tern 0.9.4: Picker Cmd+C and Cmd+V.
- 2026-11-05: the three live OpenAI checks passed in 45 seconds.

## Docs

- Update `README.md` and `CHANGELOG.md` when user-visible behavior changes.
  `README.md` is for users: install, settings, keys, and behavior. Smoke
  results go in Verification above.

## Sibling repos

The OMP source is at `~/work/tries/oh-my-pi` (`origin` is `can1357/oh-my-pi`).
Read it at the tag matching `omp --version` (`v<version>`) for host behavior,
the upstream files named above, and `/tan` or `/btw` internals.

`~/work/tries/tern-plugins` also starts isolated Tern instances and seeds the
same omp state to keep Tern's omp offer alert off the screen. When a Tern
update changes that state, the alert, or how an isolated instance starts, fix
both `tern-verify start` there and
`.omp/skills/verify-omp-tools/helpers/tern-isolated` here.

## vstack

- Issue tracker: GitHub Issues. See `docs/vstack/issue-tracker.md`.
- Code host: GitHub, through the `gh` CLI. See `docs/vstack/code-host.md`.
- CI service: GitHub Actions, through the `gh` CLI. See `docs/vstack/ci.md`.
- Triage labels: default vocabulary. See `docs/vstack/triage-labels.md`.
- Domain docs: single-context. See `docs/vstack/domain.md`.
