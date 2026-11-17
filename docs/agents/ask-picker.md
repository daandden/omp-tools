# `ask` and the Picker

Notes for changing `ask`, the Picker, its editors, Picker drafts, or host `askDialog` routing. Tern view rules shared with the panels are in `tern-views.md`.

- `flexible-ask.ts` takes native's one argument, `html`, and refuses any other
  key (`"+": "reject"`), so the old `questions` input gets a schema error, with
  no alias. In the TUI (`ctx.mode === "tui"` and `ctx.hasUI`) it opens the
  Picker through `ctx.ui.custom`. It requires `ctx.invokeTool` even on that
  path, and fails with an explicit error when native delegation is
  unavailable. An extension cannot restyle the native dialog, because
  `ctx.invokeTool` runs it with the session UI.
- **`/tree` re-answer.** Since OMP 18.18.3, picking an `ask` result in
  `/tree` runs native `AskTool`, not the registered `ask`, so it shows
  native's HTML form dialog, not the Picker. The new answer keeps native's
  form data and Notes on picked options, but not Notes on unpicked options,
  images, the Submit note, a Picker draft, or the Picker btw. Changing that
  needs an OMP source change, which ADR 0003 declines.
- Outside the TUI (RPC, ACP, print, subagents), and for a form with no named
  control, it calls `ctx.invokeTool(params, { signal, onUpdate })` so native
  prompting, errors, and headless outcomes apply unchanged. Keep native `ask`
  enabled for this, and replace legacy `omp-ask` installs instead of loading
  two wrappers.
- `ask-form.ts` is the one place a form is interpreted. It parses with the
  host's `html-form/parse` and uses `html-form/data` for values
  (`choiceValue`, `textValue`), validation (`fieldError`), and question names
  (`fieldQuestions`), so no widget parses HTML. It also holds the form
  identity (`AskForm.key`, the parsed model, so layout whitespace never
  matters), the rich answer state (picks, Other answers, Notes, a text
  field's text, images), and `formAnswer`, which the result builder, the
  host dialog adapter, and the Picker btw read. Host askDialog questions
  enter as `hostQuestionsForm`: choice fields named by id whose values are
  their labels.
- Every named control the native parser returns is a question: choice
  fields, and text fields (every other `<input>` type, number inputs, and
  textareas). A text field is one row; its text is edited in the same
  `AnswerEditor` as Notes, so paste, image chips, and the external editor
  apply. `setText` drops line breaks from a one-line field, as
  native's `Input` does. A form with a text field always has a Submit tab, so
  an optional field left empty can still be submitted. The Picker masks a
  password outside its editor (rows and review); `AnswerEditor` has no mask,
  so the open editor shows the text.
- Manual Submit runs native `fieldError` and opens the first refused
  question, so invalid `min`/`max` and patterns are ignored as native ignores
  them, and `step` and dates are not checked. The timeout submits the state
  as it stands with `timedOut`, with no validation and no recommendation
  filled in, as native does.
- Unlike native `ask` (`tools/ask.ts`), the Picker keeps `ask.timeout` in
  plan mode and does not speak the questions under `speech.enabled`.
- Preserve `approval: "read"`, `concurrency: "exclusive"`, cancellation
  (`ctx.abort()` plus `ToolAbortError`), `ask.timeout`, and `ask.notify`.
- Pass the timeout to `ui.custom` as `{ signal, timeout }` (`timeout` is not
  in `ExtensionCustomOptions`). Since OMP 18.12 the host treats an extension
  dialog without a positive `timeout` as a wait for the user, which ends the
  computer turn so the display can sleep.
- `ask-dialog.ts` keeps pi-tui `AskDialogComponent`'s structure (tabs, Submit
  review, multi-select, Other, timeout) with its own key flow, one meaning
  per key in every Picker (README keys table). Diff the structure against
  upstream when OMP changes the native dialog. `ask-pictures.ts` draws form
  pictures as native's form dialog does (`loadMedia`, `Image`,
  `SvgFigure`, `nativeImageNode`); a classic picture the scroll window cuts
  shows as one placeholder line.
- `ask-result.ts` writes the result: native's form data JSON, then labeled
  Option notes (unpicked ones marked), Other answers, and the Submit note,
  the only part the model sees. `details` are native `AskToolDetails`
  (`answers`, picked `notes`, `timedOut`) plus `unpickedNotes`, `other`, and
  `submitNote`. Images go only in `content`, after their labels.
- `flexible-ask.md` is the model-facing description. Keep it aligned with
  upstream `packages/coding-agent/src/prompts/tools/ask.md`, except that it
  states no option count where upstream says 2–5.

## Editors and paste

- `ask-editor.ts` wraps the main prompt's `CustomEditor` with the host's
  suggestion provider, borrowed through `ctx.ui.addAutocompleteProvider`, for
  references only:
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

## The Picker in Tern

- The Picker describes a `col` with role `omp.editor` in the composer's place,
  as `AskDialogComponent` does: `tabs`, a ring `meter` re-described each second
  (`CountdownTimer`'s `elapsed` node when the terminal lacks `meter`), one
  compact `row` per option, and `omp.btn` buttons. Inline `min`/`max` widths
  of 100% override the composer's measure, so it spans the pane.
- The question and options share one `scrollBox`. It is as tall as its content
  up to `DIALOG_HEIGHT_RATIO` of the pane's rows less `NATIVE_CHROME_LINES`
  (status line, tabs, buttons, and insets, measured in Tern 0.7.2). Only the
  Picker btw thread fixes that height (`min.h`). The classic Picker caps at the
  same ratio of the terminal, with the row cap scaled because a list row is a
  text line plus 6px.
- Pointer `action` events run the key commands (`#runRowCommand`,
  `#runSubmitCommand`). Option rows use `omp-tools.*` roles, not `omp.ask.*`,
  and no `mark: "pick"`, which collapsed the marker column.
- `NATIVE_SHEET` reads Tern's variables (`--sans`, `--t1`, `--t3`, `--l1`,
  `--l2`), and row text reads `--sf-fs` and `--sf-lh` so each line is one
  terminal row. `NATIVE_STYLED_ROW_LINES`, the height estimate, includes the
  sheet's row padding and gap.
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
- Tool cards come from `describeCall`/`describeResult` (Tern) and
  `renderCall`/`renderResult` (classic). An extension tool never gets the
  built-in renderer of its name, so `ask` reuses the exported
  `askToolRenderer` with the call's `html` (password masking, the pending
  form). Its details carry unpicked notes as `notes` marked `(not picked)`;
  the Tern card adds the Submit note as a row, the classic card as a last
  answer. `mergeCallAndResult` is forwarded from the definition like
  `concurrency`. The host appends result images from `content` after the
  card in both renderers.

## Picker draft

- Esc (or Tern's Cancel button) resolves the Picker with `kind: "cancel"`
  and a Picker draft: the `QuestionState`s, tab, Submit note, image count, and
  Picker btw turns. `flexible-ask.ts` stores it with the Picker btw runner in
  a per-load `PickerDraftSlot` (`picker-draft.ts`) before `ctx.abort()`.
- F5 (`app.retry`) replays the cancelled call with its stored id and arguments
  before any model request (OMP `turn-recovery.ts`), so the same `ask` runs
  again. No key is bound. Since OMP 18.14, a custom message after the abort
  other than an eval-state snapshot (a background job result between Esc and
  F5) makes F5 drop the aborted turn and call the model. A re-ask with the
  same form still gets the draft.
- `take` hands the draft to a Picker whose `AskForm.key` matches: the parsed
  form (questions, option values and labels, defaults, `required`, `multi`,
  hidden values, context), so whitespace and layout markup never decide it.
  Another form disposes the thread. A main prompt keeps the draft: a manual
  retry fires no `before_agent_start`, and a re-ask after "go on" should
  match.
- A restored Picker shows `Restored your answers` only when the draft differs
  from how the form opens (a pick, text, a Submit note, or a turn), and
  restarts the full `ask.timeout`.
- The slot ends every Picker btw thread (`end`): dropped, mismatched,
  submitted, or failed. `drop` waits for all of them.
  `session_before_switch`, `session_before_branch`, `session_tree`, and
  `session_shutdown` drop the draft, so no thread outlives its session.
- `openPicker` shows a Picker with its matching draft and keeps or ends the
  draft and thread, for `ask` and host dialogs alike.

## Host dialogs

OMP code that asks with structured questions instead of the `ask` tool calls
the shared UI context's `askDialog`, such as Ratchet approvals
(`ratchet/prelude-definition.ts`). `host-ask-dialog.ts` routes it to the
Picker in the TUI. The `/tree` re-answer runs native `AskTool` instead (see
the top of this file). The route relies on undocumented OMP internals, proved
live with OMP 18.12.6; recheck it when OMP changes the extension runner.

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
- `askInPicker` normalizes the questions with `hostQuestionsForm` and
  answers in the native `ExtensionAskDialogResult` shape: the caller's ids,
  question text, and labels (shown without `\r`), picks, `Other` text, one
  note per question (each option note after its option; the Submit note goes
  after the last question's notes), and images split by whether `customInput`
  names their label.
- Esc and an aborted signal give `undefined`, and Esc keeps a Picker draft in
  the same slot as `ask`.
- Only the caller's `timeout` counts down. Its `onTimeout` runs once on
  expiry, as native does, and no notification is sent. Each question still
  unanswered then gets its recommended option with `timedOut`, as native
  `timedOutAskDialogResult` does; this is the host dialog's contract, not the
  `ask` tool's.
- Malformed questions, which native coerces, and `nativeRejects` questions go
  to the native method.
- Collaboration guests cannot answer, because the native method's guest race
  is skipped. This is an accepted limit: no extension API reports a guest.
