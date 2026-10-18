# Repository Guidelines

## Project Overview

`omp-tools` is an Oh My Pi (OMP) plugin. It shadows the native `ask` tool to
drop the model-facing option count and show questions
as full Markdown in the interactive picker; outside the TUI it delegates to
native `ask`. It replaces native `generate_image` with a tool that calls the Codex
Images endpoint directly with Codex OAuth. It also wakes the agent for advisor
concerns and blockers that arrive after its final answer and that OMP leaves
without a turn, and sends the concerns that OMP deferred during a run to the
agent when the user answers the picker. It takes
over `/btw <question>` with a Side question that may use read-only tools, and
the Picker btw asks the same kind of Side question.

## Architecture & Data Flow

- `package.json` registers `extensions/flexible-ask.ts`,
  `extensions/generate-image.ts`, `extensions/advisor-wake.ts`, and
  `extensions/btw.ts` as entry points. OMP also loads `skills/*/SKILL.md` from
  the plugin root (the `omp-plugins` discovery provider, priority 90).
- The extension registers a shadow `ask` description/schema. In `ctx.mode ===
  "tui"` with `ctx.hasUI`, it shows its own picker (`extensions/ask-dialog.ts`)
  through `ctx.ui.custom` and formats results with native wording and details.
  The native dialog cannot be restyled from an extension: `ctx.invokeTool` runs
  it with the session UI, not the wrapper's.
- Otherwise (RPC/ACP/print, subagents), and for inputs the native tool rejects
  (reserved or duplicate labels, duplicate ids), it delegates to
  `ctx.invokeTool(params, { signal, onUpdate })` so native errors and fallbacks
  apply unchanged.
- A Side question (`extensions/side-question.ts`) is a full agent run in a
  mirror session built the way OMP's `/tan` builds one
  (`tan-command-controller.ts`): `SessionManager.forkFrom` the main transcript
  (with `repairInterruptedTail`, since the main agent may be mid-turn) into
  `<session dir>/SideQuestion-<uuid>.jsonl`, then `createAgentSession` with the
  main session's model and thinking level, `toolNames` read, grep, glob, find,
  and web_search, and `restrictToolNames` (which also turns off MCP, LSP, IRC,
  and ambient extension tools). No `systemPrompt` is passed, so OMP renders
  its default prompt for those five tools. Offering only these is the read-only
  limit; there is no call-time gate. The mirror once copied the main system
  prompt and tool list so its first request read the main prompt cache, and
  refused other tools at call time. With `ask`, `bash`, and `write` offered,
  a Picker btw during a pending `ask` from a subagent's IRC message called
  them in 3 of 15 replays of a real session (0 of 15 now); the first request
  is a cache miss by design. The mirror gets subagent settings, the parent's
  prepared extensions, and a `SideQuestionRegistry`: its own `AgentRegistry`
  (out of the Agent Hub, so nothing can message or list it) whose `get` and
  `list` fall back to `AgentRegistry.global()`. `read agent://<id>` resolves
  a running agent with no published output through the reader's registry, so
  without the fallback it returned `Not found`. Then `seedMessages` replaces
  the mirror's messages with a copy of `main.agent.state.messages`
  (`structuredClone`, plus a still-open result for each call the last reply
  still waits on: for `ask`, the user is answering it now; for others, still
  running; both say not to call it again). An "aborted" result there made the
  model ask the user again. The copy is also on the main session's selected
  branch, which the file does not record, and it holds messages the live
  session adds that the file lacks (the `eval-state-context` message after a
  `/tree` jump, #15933). The fork file still holds the mirror's own turns.
  `cacheMissTokens` flags a follow-up request that reads more than 2048
  tokens less than the thread's previous one, only when it wrote cache
  (`cacheWrite > 0`, so never on Codex) and only while
  `display.cacheMissMarker` is on (`/modes/settings`); the answer then shows
  OMP's `⊘ cache miss · N tokens` label. The thread reports each assistant
  message's start (`onMessageStart`), its streamed text, and tool calls;
  `answerInto` keeps them as ordered parts (text, then a group of calls), so
  a later message never replaces earlier text. `ask` returns the last
  assistant message's text; the fork file is deleted on dispose. A Side
  question needs a live main session (`AgentRegistry.global()`) and a session
  file; without them `/btw` falls through to native and Picker btw is off.
- `/btw <question>` (`extensions/btw.ts`): OMP skips extension commands named
  like built-ins, so the plugin catches the text in the `input` event, which
  runs before built-in dispatch (docs/adr/0001), and returns `{ handled: true }`
  only for `source: "interactive"` in the TUI. Bare `/btw` (the history),
  autocomplete, the focused-subagent path (it skips `input` handlers), and RPC
  `btw` stay native. One `BtwCycle` per session holds the thread: a later
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
  and disposed when the dialog closes; a cancelled turn keeps the thread.
  `?` disposes the countdown and the next key in the options restarts it.
  `?` is off when Side questions cannot run. Pasted images in the Picker btw
  go to `SideQuestionThread.ask` as prompt images.
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
  text takes the terminal's `--sf-fs` and `--sf-lh`, copied on `.sf-region`
  because the composer sets its own `--sf-lh` below it, so each line is one
  terminal row (the `reader-terminal-text` Tern plugin does the same for
  omp's text). The sheet's row padding and gap are in
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
- Keep native `ask` enabled. Replace legacy `omp-ask` installations rather than
  loading duplicate wrappers.
- `generate_image` posts to `chatgpt.com/backend-api/codex/images/generations`
  (no references) or `/edits` with Codex's exact body and headers, using the
  `openai-codex` credential from `ctx.modelRegistry.getApiKeyForProvider`; no
  other provider, no fallback to native. Native `generate_image` is
  settings-gated and installed after extensions, skipping taken names, so the
  plugin tool wins even when `generate_image.enabled` is true. The schema stays
  open because OMP's argument validator deletes unknown keys from closed
  schemas (`pi-ai` `coerceArgsFromIssues`); `execute` rejects them instead.
- Keep the request guards: 64 MB body cap (larger bodies get false
  `moderation_blocked` or silently dropped references), the 0-image-token
  dropped-references check on edits, and the 5-minute timeout combined with the
  tool signal. The result is lossless WebP in `content` only, never
  `details.images` (the TUI would show it twice). The Images endpoint returns
  PNG with a signed C2PA manifest whatever `output_format` is sent (checked
  2026-10-08), so the local re-encode drops that manifest. Only the hosted
  `/codex/responses` image tool returns WebP (lossless, manifest kept), but it
  puts a chat model in the loop and drew on the weekly `premium` limit rather
  than the daily `imagegen_premium` one.
- `details` keeps `x-codex-imagegen-request-id`, `generation_id`, and
  `usage.output_tokens` for tracing; errors append the request id. Success text
  warns at 80% of a limit window. The Images endpoint reports its image window
  as `x-codex-primary-*` under `x-codex-active-limit: imagegen_premium`, so
  limit-named headers are tried first and `x-codex-*` is the fallback;
  zero-minute windows are skipped.

## Important Files

- `extensions/flexible-ask.ts`: tool registration, TUI/native routing, and
  native-shaped result `details`.
- `extensions/ask-result.ts`: the labeled model-facing answer text (the model
  sees only this text, never `details`).
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
- `extensions/side-question.ts`: `SideQuestionThread` (the mirror session with
  only the five read-only tools, its `SideQuestionRegistry`, `seedMessages`,
  and the message-start, text, and tool-call callbacks; an already-aborted
  signal is rejected before any request), `LazySideQuestionThread` (opened on
  first use, shared by both callers), and `sideQuestionsAvailable`.
- `extensions/side-question-view.ts`: what both views share: the turn
  (`SideQuestionTurn` with ordered `parts`, `answerInto`), the interrupt key,
  and `SideQuestionTurnView`, which draws a turn's text and each group of tool
  calls as a folded "N tool calls" line, in order (classic lines, or one Tern
  collapsible `section` per group).
- `extensions/btw.ts`, `btw.md`, `btw-panel.ts`: the `/btw` takeover
  (`parseBtwQuestion`, `BtwCycle`, keys), its prompt, and its panel.
- `extensions/flexible-ask.md`: static model-facing description; keep aligned
  with upstream `packages/coding-agent/src/prompts/tools/ask.md` except the
  option count (the plugin states no number instead of 2–5).
- `extensions/assets.d.ts`: ambient typing for the static Markdown import.
- `extensions/generate-image.ts`: `generate_image` registration, argument
  checks, result text, and saving to `$TMPDIR/omp-image-<id>.webp`.
- `extensions/generate-image.md`: static model-facing tool description.
- `extensions/codex-images.ts`: Codex Images request body, headers (account id
  and residency from the token's JWT claims, reimplemented because
  `@oh-my-pi/pi-catalog` is not served), guards, and error text.
- `extensions/reference-images.ts`: reference images from absolute paths or the
  active branch (`getBranch()`, including native `details.images`); JPEG and
  WebP unchanged, everything else lossless WebP.
- `skills/generate-image/SKILL.md`: the pre-send criteria for prompts and edits,
  plus reference, transparency, and retry rules. It is generic and has no
  examples; the cited research behind it is in
  `docs/research/image-prompting-*.md`, `image-prompt-criteria-*.md`,
  `image-prompt-format.md` (prose vs labeled lines vs JSON),
  `gpt-image-2.5-*.md` (rules checked against Images 2.5; the endpoint accepts
  any `model` with no visible effect, so rules stay model-agnostic), and
  `codex-image-backend-model.md` (live check of which model serves; inconclusive).
- `test/`: `bun test` behavior tests for `generate_image` through `execute`
  with a stubbed `fetch`, for `advisor-wake` through its event
  handlers with a mocked `@oh-my-pi/pi-coding-agent/judgment`, for
  `parseBtwQuestion`, `AnswerEditor`'s host paste contract, Picker btw
  `numberImagesByAppearance`, and for the Side
  question's `seedMessages`, `cacheMissTokens`, and `answerInto`. The tool
  limit, the thread cycle, the mirror session, and the panel have live smoke
  only.
- `extensions/advisor-wake.ts`: listens for preserved `advisor` cards
  (`message_end`, `customType: "advisor"`) with `concern` or `blocker` notes
  that follow a final answer (the last assistant `message_end` had
  `stopReason: "stop"`; a stopped, failed, or mid-run reply never wakes) and,
  once the session is idle with no turn started for the card, sends a short
  wake prompt with `deliverAs: "steer"` and `triggerTurn`. The card is
  already in LLM context (a `developer` `<advisory>` message), so the wake
  must not repeat the notes. Core leaves a late blocker without a turn while
  `autoResumeSuppressed` is set (OMP 18.10.4). Every user-reason abort sets
  it: Esc (also while idle, with no `aborted` reply), `ctx.abort()` from a
  Picker cancel, RPC and ACP abort. Only a user prompt, a typed steer, a tree
  jump, or (in OMP after 18.11.1, PR #14831) `/retry` clears it, so a run that
  resumes any other way still ends with passive cards. Extensions cannot read
  the flag, hence the outcome rule. Do
  not go back to `aside`: its idle branch in core `sendCustomMessage` folds
  into context while the flag is set. A steer with `triggerTurn` only checks
  ACP deferral, so the wake reads plan mode itself (the branch's latest
  `mode_change` entry is `plan`) and skips it there, as core does for
  advisor cards. Local guards: queued messages and two per-prompt-cycle
  checks before each wake. (1) New note: one host
  judge call (`resolveJudge` from `@oh-my-pi/pi-coding-agent/judgment` with the
  root `settings` and `ctx.modelRegistry`, used only when `hasNativeJudge`)
  asks one Choice per new note against the woken ones
  (`extensions/concern-match.ts`); a concern is compared with every woken note,
  a blocker only with woken blockers (an escalation wakes, as in core's
  emission guard). No native judge, an error, or a 15 s timeout
  falls back to word-overlap Jaccard ≥ 0.5. (2) `MAX_WAKES_PER_PROMPT = 10`.
  What the woken turn did is not checked: a Revised answer fixes the answer
  with no tool call, and the next note is often about that text (a former
  "last wake ran a changing tool" check held back valid notes; in 85 recorded
  wakes no disagreement loop showed). Notes check 2 keeps back are counted in
  the footer through `ctx.ui.setStatus("advisor-wake", "advisor: N note(s)
  waiting")` (when `ctx.hasUI`; in Tern a composer-bar fact), cleared when the
  cycle resets; no toast. A repeat stays silent. The
  cycle resets on `before_agent_start`, which fires for user prompts in every
  mode but not for the extension's agent-initiated turn (`input` is TUI-only),
  and a counter drops a judge result that lands after the reset or after any
  assistant `message_start` (a blocker or extension turn that ran during the
  judge call already saw the cards). Held notes are
  dropped on `session_before_switch` / `_branch` / `_tree` (the runner and its
  timers outlive `/new`); the after-events reset the cycle.
  `advisor.immuneTurns` is core-private and not applied. Disabled when
  `ctx.mode` is `"print"` or `"json"`: print mode enters a preserve-only
  headless advisor drain after the last prompt (`prepareForHeadlessAdvisorDrain`),
  prints the final text, then disposes, so a woken turn would never be emitted.
  `advisor-wake.md` holds the wake prompt; the custom type is `advisor-wake`.
  `advisor-wake-short.md` holds the short prompt, without the Revised answer
  rule. The first wake of a prompt cycle counts the text of the last final
  answer (`js-tiktoken`, `o200k_base`, loaded on first use, ~125 ms) and sends
  the short prompt when it is over `REVISED_ANSWER_MAX_TOKENS` (600) or the
  count fails; later wakes in the cycle reuse that choice, so a brief wake
  reply is never measured. `js-tiktoken` is the plugin's only runtime
  dependency; OMP resolves it from the plugin's `node_modules`.
  `advisor-wake.md` also states the Revised answer rule (GLOSSARY.md). When a fix
  changes what the latest complete answer told the user, the final reply of
  the Advisor wake is only that answer, restated in full and in the same form.
  Nothing comes before or after it. When no fix changes what the user was
  told, the reply stays short. The rule lives only in the prompt. Do not pin
  its wording in a test. Check a prompt change with live Advisor wakes. Post
  the `advisor` card after a final answer with a throwaway command in
  `extensions/`. The reply varies from run to run. Count the passes over at
  least 12 fact-fix Advisor wakes, with the wrong fact on the answer's first
  line in at least 4.
  Release: on `PICKER_ANSWERED` (emitted on `pi.events` by the Picker path of
  `flexible-ask.ts` after Submit or a timeout pick, before `execute` returns)
  it steers the run's deferred concerns as a `customType: "advisor"` card
  (`deliverAs: "steer"`, `triggerTurn`, `details.releasedBy: "omp-tools"`),
  the way core steers a blocker; the loop reads it at the boundary after
  `ask`. Core's deferred list (`AdviseTool#deferredNotes`, OMP 18.10.4) is
  private and in memory; core flushes it only at the run's terminal boundary.
  Keep the `advisor` custom type: core keeps such cards on interrupt and leaves
  them out of the advisor's review input. The handler is synchronous so the
  steer is queued before `ask` returns. A release is not a wake (check 2
  skips it); released notes join `woken`, and a later card's concern with the
  same text does not wake. `agent_start` snapshots the transcript sizes and
  clears the notes that cards carried in the run (never released) and the
  release receipts. Receipts live per run, not per prompt cycle: a prompt
  queued during a run fires `before_agent_start` (agent-core dequeue, then
  `#prepareAgentStart`) with no `agent_start`, and the run's final card follows.
- `extensions/deferred-notes.ts`: reads deferred concerns from
  `<session dir>/__advisor*.jsonl` after a run's start: `advise` tool results
  whose text is core's `ADVISOR_ACK_DEFERRED` and whose `details` hold the
  note. Core's recorder appends each advisor message as it finalizes. The
  format and the acknowledgment text are private to OMP; check them when OMP
  changes the advisor. Also `formatAdvisories`, a copy of core's
  `formatAdvisorBatchContent` (not served).
- `extensions/concern-match.ts`: check 1 for the Advisor wake. `judgeRepeats`
  builds one judge request (state: `earlier_concerns` and `new_concerns`; one
  Choice per new concern over the earlier ids plus `none`), and
  `wordOverlapRepeats` is the fallback.
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
(`@oh-my-pi/pi-tui`, `/chrome`, `/render`, `/theme`,
`@oh-my-pi/pi-coding-agent`, `/judgment`, `/modes/*`, `/tools/*`, `/utils/*`,
and the `@oh-my-pi/pi-utils` root; `/judgment` was checked in OMP 18.4.8,
`/tools/approval` in OMP 18.10.4). The root `./*`
wildcard is not served, so never import files such as
`@oh-my-pi/pi-tui/overlays/*`, `/keybinding-matchers`, `/chrome/form-theme`, or
`/prompt/*`; they load a second copy from node_modules and fail. The
`@oh-my-pi/pi-tui` root exports the describe builders (`node`, `col`, `md`,
`span`, `text`, `kbd`); `actionButton` and `hintsRow` from `/native/overlay`,
which is not on the checked list, are mirrored in `ask-dialog.ts` and
`ask-editor.ts`. Type-only imports such as
`@oh-my-pi/pi-tui/tools/renderer` are erased and safe. Both SDK packages use
the `"latest"` specifier; `bun.lock` records the resolved version, so update
through `bun run update` to keep types and the installed omp in step.

Run typechecking and `bun test` after code changes; tests cover
`generate_image`, `advisor-wake`, `parseBtwQuestion`, `AnswerEditor` paste
handling, and the Side question's `seedMessages`, `cacheMissTokens`, and
`answerInto`, and there is
no repository CI. Registration, ask, and Side question changes
require a fresh-session OMP smoke; typechecking alone does not exercise host
integration or UI. OMP 18.3.1 was used for the latest fresh-session picker and
rendering smoke; OMP 18.4.4 for the live `generate_image` generate and edit
smoke; OMP 18.4.8 for the host judge call behind the advisor wake checks; OMP
18.6.1 for the Picker btw; OMP 18.8.0 for the picker key flow and Submit note;
OMP 18.8.6 with Tern 0.6.3 for the Tern views; OMP 18.10.4 with Tern 0.8.3 for
the Picker release (a deferred concern written by hand to the session's
`__advisor.jsonl` while the Picker was open) and for Side questions (`/btw`
and Picker btw); OMP 18.11.0 for the Revised answer (RPC mode with
Claude Haiku 5.5, the linked plugin loaded as for a user, a throwaway extension
command that posted `advisor` cards, and the core advisor off through
`--config`; OMP 18.11.1 for the short wake prompt, the same way); OMP 18.11.3
for the read-only Side question (RPC mode with a throwaway extension in
`extensions/` that replayed a real session's messages into the main agent and
ran Picker btw questions through `SideQuestionThread` and `answerInto`, and
one that read `agent://` of a running subagent; a file outside the plugin
cannot resolve `@oh-my-pi/*`), and Tern 0.9.2 for a Picker btw during an
`ask` that a subagent's IRC message started; OMP 18.11.3 with Tern 0.9.2 and
RPC for the Advisor wake without the "last wake changed files" check and its
footer status; OMP 18.12.1 with native Tern 0.9.4 for Picker Cmd+C and Cmd+V
(with a temporary picker extension). A headless Tern window drives
the Tern smokes: `tern serve --control <sock>`, then `tern ctl --control <sock>`
`run`, `type`, `key`, `click '<css selector>'`, and `shot <name>` (PNG plus a
layout JSON of every element). `PI_TUI_NATIVE=0` in the same window checks the
text renderer.

## vstack

- Issue tracker: GitHub Issues. See `docs/vstack/issue-tracker.md`.
- Code host: GitHub, through the `gh` CLI. See `docs/vstack/code-host.md`.
- Triage labels: default vocabulary. See `docs/vstack/triage-labels.md`.
- Domain docs: single-context. See `docs/vstack/domain.md`.
