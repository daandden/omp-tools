# omp-tools

An Oh My Pi (OMP) plugin that changes three tools:

- `ask` takes native `ask`'s HTML form and answers it in its own Picker, with
  a note on every option, pasted images, and answers kept when you press Esc.
- `generate_image` has two Image generation modes: OpenAI mode (GPT Image 2.6
  Sunburst through the public OpenAI Images API) and Codex mode (the Codex
  Images endpoint with a ChatGPT login).
- `/btw <question>` asks a Side question that can look things up with
  read-only tools. `?` in the Picker asks one about the open question.

## Install

From the repository root:

```bash
bun install --ignore-scripts
omp plugin link "$PWD"
```

The link uses the working tree, so edits need no reinstall. Start a new OMP
session after you link the plugin or change its code. Running sessions keep the
tool definitions they loaded.

The plugin replaces the earlier `omp-ask` plugin. Do not load both, and do not
install a second loose copy of the ask extension.

Keep native `ask` enabled, because the plugin hands forms to it outside the
TUI. Turn off native `generate_image`. The plugin's tool takes the name even
when native is on.

```yaml
ask:
  enabled: true
generate_image:
  enabled: false
```

## `ask`

`ask` takes one argument, `html`: one HTML `<form>`, as native `ask` does since
OMP 18.18.3. The old `questions` argument is gone, with no alias. The
model-facing description follows native's, except that it states no option
count and, until the Picker has text fields, asks for choice controls only.

In the interactive TUI the plugin answers the form in its own Picker. Each
named radio group, checkbox group, `<select>`, and `<select multiple>` is a
question with its own tab, in form order. A fieldset's legend names its tab;
otherwise the control's name does. The context before a question shows above
its options: headings, paragraphs, lists, preformatted text, tables, inline
code, bold and italic, and `<img>` and inline `<svg>` pictures (display only,
loaded as native loads them). Markup native ignores is ignored here too:
scripts, styles, buttons, form actions, and file inputs never run or show.

Values follow native: a radio group or `<select>` gives the chosen `value`, a
checkbox group or `<select multiple>` gives an array, a lone checkbox gives
its value (`on` by default) or nothing, and hidden inputs go back as they are.
`checked` and `selected` options start picked. Disabled options show but
cannot be picked. Radio and checkbox groups of two or more options get
`Other (type your own)` unless an option already starts with "Other". The
Picker keeps the native structure: a Submit review for several or
multi-select questions, `ask.timeout`, and `ask.notify`.

A form with a text, number, or textarea field fails with an error that names
the field; the Picker does not show it yet, drops nothing, and does not fall
back to native `ask`'s dialog.

Tall questions scroll with PgUp/PgDn. After you scroll, the first move or
action key brings the cursor back into view instead of acting on a hidden row.

### Keys

Each key means the same thing in every Picker:

| Key | Action |
|---|---|
| j/k or ↑/↓ | Move between rows (on the Submit tab, scroll) |
| h/l, ←/→, or Tab | Switch tabs (when there is a Submit tab) |
| Space | Toggle the row and stay. Single-select un-picks the others |
| Enter | Finish the question. Single-select picks the row first, then goes to the next question. The last question goes to the Submit tab, or submits when there is none. On the Submit tab, submit |
| n | Edit the row's text: the option's note, the `Other` answer, or, on the Submit tab, the Submit note |
| x | Clear that text (on `Other`, also un-pick it) |
| ? | Ask a Picker btw |
| Ctrl+R (in an editor) | Search OMP's prompt history; the entry you pick replaces the editor's text |

Space or Enter on an empty `Other` opens its editor. In an editor, Enter (or
Ctrl+Q) saves and stays on the row, and Esc discards the edit. Saving `Other`
text picks it. Above a note or `Other` editor, the Picker shows the question's
title, its context, and the row you edit.

Submit checks `required` choices as native does: an unanswered one blocks
Submit, and the Picker opens it with native's reason.

Ctrl+R (`app.history.search`) in an `Other`, note, Submit note, or Picker btw
editor opens OMP's prompt history search. The entry you pick replaces that
editor's text, and you can edit it before saving. Esc in the search keeps the
text, and either way the editor keeps focus. Nothing is sent, the main prompt
keeps its text, and answers are not added to the history.

### Differences from native `ask`

- Picking never loses typed text. Every option keeps its own note through
  select and deselect. Un-picking `Other` keeps its text, and `n` then save
  picks it again.
- The Submit tab has a Submit note for the whole ask.
- On timeout, the Picker submits the form as it stands, as native does: picks
  and defaults, with no recommendation filled in, even when a required choice
  is empty. The result is marked as timed out, and the card says it was not
  your choice.
- Plan mode does not turn off `ask.timeout`, and `speech.enabled` does not
  read the questions aloud.
- Collaboration guests cannot answer.
- The agent gets native's form data first, then what native does not send:
  - `Option notes:` for every note, `(not picked)` on an option you did not
    pick (native sends notes on picked options only)
  - `Other answers` for each `Other` text, so an `Other` answer equal to an
    option's value is still yours
  - `Note on all answers:` for the Submit note
  - pasted images, each after its `[Image #N]` label

### Editors

The `Other`, option-note, and Submit note editors are the main prompt's own
editor, so they behave like it. They offer the same suggestions: `@` files, `^`
models, `/` file commands and skills, internal URLs such as `skill://`,
`rule://`, `local://`, `agent://`, `artifact://`, and `omp://`, emoji, GitHub
refs, and other extensions' providers. They also have ghost-text word
completion, typo detection and autocorrect, vim mode, and multi-line input.
Shift+Enter, Ctrl+J, or Alt+Enter inserts a newline. Ctrl+C clears the text and
never exits omp from here. Ctrl+R searches the prompt history (see Keys).
Up/Down does not step through history, and there is no push-to-talk or draft
saving.
The external editor key (`app.editor.external`, Ctrl+G by default) opens the
text in `$VISUAL` or `$EDITOR` and writes the result back.

Nothing typed in an answer runs. `/` suggests only commands you keep as files
(`~/.agents/commands`, `~/.omp/commands`, and project command folders) and
skills, each with its own icon. Built-in and extension commands are not
offered. A skill inserts as `/<name>` without the `skill:` prefix. A name is
offered only when it, or one of its hyphenated parts, starts with what you
typed. `#` prompt actions are hidden. Accepting a suggestion only inserts its
text, and Enter saves exactly what you typed.

Images paste as in the main prompt:

- In Tern, Cmd+V pastes text or a copied image into an open editor. On the
  option list, the Picker pastes nothing and says to open a note with `n` or
  choose `Other`.
- The image-paste key (Ctrl+V by default) reads a copied image, a file copied
  in Finder, or an image path on the clipboard. Cmd+V on a file copied in
  Finder pastes only the text Tern offers for it, so use the image-paste key
  for those.
- Pasting an image file path also attaches the image.

Each image shows as the main prompt's image chip, and deleting the chip drops
the image. Images go to the model after the answer text, labeled `[Image #N]`
to match. To copy question or option text, select it with the mouse and press
Cmd+C.

### Picker btw

`?` asks a Picker btw: a Side question about the ask or the conversation,
answered inside the Picker. The options give way to a thread with a question
box below it, the same editor as `Other`. Enter asks, and pasted images go with
the question. The answer streams into the thread, and later questions in the
same ask follow up on the earlier ones.

The Side question sees your answers so far (ticked options, `Other` text, and
notes), so "is my pick a good idea?" works. It can look things up with
read-only tools (see [Side questions](#side-questions)). Its tool calls fold
into "N tool calls" lines between the answer's text, and in Tern a click opens
each one.

Esc while an answer streams cancels it and keeps the partial text. The next Esc
returns to the options with your answers untouched, and `?` reopens the thread.
PgUp/PgDn scroll a long thread. The thread is discarded when the ask ends,
unless Esc keeps it in a Picker draft (see
[Esc keeps your answers](#esc-keeps-your-answers)).

The agent never sees the thread. To tell the agent something, put it in
`Other` or a note. A Picker btw is not native `/btw`: it is not saved to BTW
history, cannot be branched or copied from a panel, and does not change your
main prompt.

`?` stops `ask.timeout`, and the title reads `Ask (timer paused)` until your
next key in the options, which restarts the countdown in full. When Side
questions cannot run (no saved session, or a subagent), `? btw` is not offered.

### Esc keeps your answers

Esc (or **Cancel** in Tern) on the options or the Submit tab cancels the ask,
as in native `ask`. The Picker keeps a Picker draft: your picks, notes, `Other`
answers, the Submit note, the open tab and row, and the Picker btw thread.

Press F5 (OMP's Retry) to run the cancelled ask again. The Picker opens where
you left it and says `Restored your answers` until your next key. The restore
sends nothing by itself. With `ask.timeout` set, the countdown starts again in
full. An Esc before you answer anything keeps only the tab and row, and the
Picker reopens there without the message.

The draft opens for any ask with the same form: the same questions, options,
values, defaults, `required`, hidden values, and context. Whitespace and layout
markup do not count, so the agent can re-ask the same form after "go on". Each
session keeps one draft. A Picker with another form drops it, and so do a
submit, `/new`, `/resume`, `/fork`, a branch, a tree jump, and quitting omp.

### Questions from OMP itself

Some OMP features ask you directly with structured questions instead of the
`ask` tool, such as Ratchet's approvals. In the interactive TUI these
questions open in the same Picker, with notes, `Other`, the Picker btw, and
the Picker draft.

The feature gets the answer in its native form: your picks and `Other` text,
and one note per question that lists each note after its option, with the
Submit note last. Esc answers nothing, as in the native dialog, and keeps a
Picker draft. The same question opens with it again and waits for Enter.

A timeout counts down only when the feature sets one, and on expiry it picks
each unanswered question's recommended option, as the native dialog does.
`ask.timeout` and `ask.notify` apply to the `ask` tool only. A question that
the native dialog would refuse (a reserved label, or a repeated id or label)
opens the native dialog. Collaboration guests cannot answer these questions.

An ask answered again from `/tree` runs native `ask` in OMP 18.18.8, not the
Picker.

### Outside the TUI

Outside the interactive TUI (RPC, ACP, print mode, and subagents) the plugin
passes the form unchanged to native `ask`, which prompts where the transport
can and otherwise returns its own headless or unavailable outcome. A form with
no named control also goes to native `ask`, which answers with its own error.

### The Picker in Tern

In [Tern](https://docs.stencil.so/tern/) and other terminals that speak the
Tern Surface Protocol, the terminal draws the Picker instead of text rows. It
sits in the composer's place, like native `ask`, but spans the full width of
the pane. Each option is a row: the marker, then the label with its Markdown
description, preview, and note or `Other` text below it.

The rows follow Tern's theme and its light and dark appearance, as native
`ask`'s rows do: its UI font, primary and muted text colors, a gray fill on the
highlighted row and on hover, a Recommended badge, and a filled marker on a
picked row. The countdown is a ring. A row of buttons below the options shows
each key with its keycap. The editors are Tern's own text fields, without the
main prompt's model chip and send button.

The question and its options sit in one box that is as tall as the current
question needs, up to 70% of the pane's height (70% of the terminal in the
text Picker). A short question gives a short Picker, so the Picker can change
height when you switch tabs. Taller content scrolls inside the box with the
wheel, PgUp/PgDn, or j/k, and j/k keeps the highlighted row in view. A
question first shows from its top. When the highlighted row is below the box,
the first key only brings it into view. In an editor or the Picker btw, the box
shows the question with its title and the row you edit, every answer (for the
Submit note), or the thread.

The keys stay the same, and the pointer runs the same actions:

| Pointer | Same as |
|---|---|
| Click a tab | Switching to that tab |
| Click an option | Moving to it, then Space |
| Double-click an option | Moving to it, then Enter |
| Click a button | Its key (`?`, Space, `n`, `x`, Esc, Enter) |

The `ask` tool card uses native `ask`'s card in both renderers: each question
with its answer and notes, an unpicked note marked `(not picked)`, an `Other`
answer as `Other: …`, the Submit note, and the timeout notice. Pasted images
follow the card. `PI_TUI_NATIVE=0` keeps the text Picker.

## `generate_image`

The plugin replaces native `generate_image`. The prompt goes to the image
service unchanged, with no chat model in between. The model sees raster
results and gets a path to read for SVG results. The plugin setting
`imageGenerationMode` picks one of two Image generation modes:

- `openai` (the default): GPT Image 2.6 Sunburst through the public OpenAI
  Images API (`api.openai.com/v1/images/generations` and `/edits`), with an
  OpenAI API key, billed to that key's API organization.
- `codex`: the Codex Images endpoint
  (`chatgpt.com/backend-api/codex/images/generations` and `/edits`) with a
  ChatGPT login, called the way the official Codex CLI calls it, drawing on
  the account's Codex image allowance.

Installations without the setting use OpenAI mode. To keep the Codex behavior,
run:

```sh
omp plugin config set omp-tools imageGenerationMode codex
```

The mode is read when a session starts, including `/new`, `/resume`, and
`/fork`, so a change applies to the next session. A running call keeps its
mode. An invalid value, including an empty one, makes every call fail with the
fix instead of picking a service.

Neither mode falls back to the other, to native `generate_image`, or to
another provider when it fails, because a fallback would change the credential
and the balance charged (`docs/adr/0002-explicit-image-generation-modes.md`).

Each mode registers only its own arguments and rejects unknown ones. Requests
time out after 5 minutes, cancelling the tool cancels the request, and the
tool never retries a request.

### OpenAI mode

OpenAI mode needs an OpenAI API key for OMP's `openai` provider:
`OPENAI_API_KEY`, or a key stored for `openai` in OMP. A ChatGPT login does not
cover the public Images API. The key goes only to `https://api.openai.com/v1`.
If the `openai` provider uses another base URL, calls fail. The
`OpenAI-Organization` and `OpenAI-Project` headers come from the `openai`
provider's configured headers, or else from `OPENAI_ORG_ID` and
`OPENAI_PROJECT_ID`.

Billing is normal API billing on the API organization. OpenAI spends
Promotional API credits (the free grant some ChatGPT subscriptions link to an
API organization) before purchased OpenAI API credits, and requests continue
on purchased credits once the grant runs out. The tool cannot limit a request
to free credits, does not select a credit grant, and does not report which
balance paid. When the organization has no credits left, the error says so and
tells the model not to retry. An ordinary rate limit says to wait.

OpenAI mode always sends `gpt-image-2.6-sunburst`. There is no per-call
`model` argument.

All arguments except `prompt` are optional, and `null` counts as omitted:

- `prompt`: the image or edit description, up to 32,000 characters.
- `n`: 1–10 images. Every image is saved and returned, in the API's order.
- `quality`: `auto`, `low`, `medium`, `high`, `xhigh`, or `max`.
- `complexity`: `low`, `medium`, or `high`, separate from rendering `quality`.
  The API default is `high`.
- `size`: `auto`, `1024x1024`, `1536x1024`, `1024x1536`, or `WIDTHxHEIGHT`
  with both edges multiples of 16 and an aspect ratio from 1:3 to 3:1. OpenAI
  publishes no edge or total-pixel bounds for 2.6, so the API checks the rest.
  For GIF output, `size` is each frame's size.
- `background`: `auto`, `opaque`, or `transparent`. Transparency works with
  PNG, WebP, SVG, and the default format.
- `output_format`: `png`, `jpeg`, `webp`, `gif`, or `svg`.
- `output_compression`: 0–100, for JPEG and WebP only.
- `frame_count` (2–16, default 9) and `frame_duration_ms` (20–2000, default
  200): both require `output_format: "gif"`. GIF is for new images only,
  without Reference images, streaming, or `output_compression`.
- `svg`: SVG author settings for `output_format: "svg"`, with `model` and
  `reasoning: { effort }`. Effort is `none`, `minimal`, `low`, `medium`,
  `high`, `xhigh`, or `max`, if the author supports it. A call's settings
  override the plugin's SVG author. SVG is for new images only, with `n` 1 or
  omitted, without Reference images, streaming, or `output_compression`.
- `moderation`: `auto` or `low` (less strict filtering, not none).
- `safety_identifier` (up to 128 characters) or the deprecated `user`. A
  nonempty `safety_identifier` is sent instead of `user`. The tool sends only
  identifiers the caller gives and never shows them in the result.
- `stream` and `partial_images` (0–3): stream the response and show previews
  while the image renders. Each preview costs 100 extra image output tokens,
  and fewer previews may arrive. Previews are never saved.
- Reference images, from one source per call: `referenced_image_paths`
  (absolute paths), `num_last_images_to_include` (the last 1–16 conversation
  images, oldest first), or `images` (`{ image_url }` with an https or data URL,
  or `{ file_id }`). A call takes up to 16 references, and any reference makes
  it an edit. PNG, JPEG, and WebP files go out unchanged. Other formats go out
  as PNG.
- `mask` or `markup`, for edits: `{ path }`, `{ image_url }`, or `{ file_id }`.
  They cannot be combined. A mask is a PNG or WebP with alpha, in the format
  and size of the first Reference image, and the edit applies where it is
  transparent. A markup is a transparent PNG with visual instructions, the size
  of the first Reference image after its EXIF orientation. The tool checks
  local files and data URLs before sending and sends them byte for byte. The
  API checks remote URLs and file ids.

With `output_format` omitted, the tool requests PNG and saves a lossless WebP
converted locally. It keeps every visible pixel and alpha value, but the
encoder drops the color hidden under fully transparent pixels. With an explicit
format, the tool saves the API's bytes unchanged. Files go to
`$TMPDIR/omp-image-<id>.<png|jpg|webp|gif|svg>`, with the extension matching
the bytes.

The model gets every raster image, its saved path, and the size and quality
the API reported. GIF content goes back unchanged as `image/gif`. The tested
Claude Haiku 5.5 and Codex gpt-6-luna routes accepted it but saw only the
first frame. An SVG result returns only its path, with an instruction to read
the file.

The result's details keep the requested settings (`details.requested`,
including complexity, frame controls, and the sent `svg` object) apart from
the reported ones, with token usage and the `x-request-id`.
`details.svgUsage` keeps the API's separate `svg_usage`. Errors name the
request id.

Choose the SVG author in **Settings > Plugins > omp-tools**, or run:

```sh
omp plugin config set omp-tools svgAuthorModel gpt-6.1-sol
```

`svgAuthorModel` defaults to `gpt-6.1-sol`, and an empty value uses that
default. It is read when a session starts, including `/new`, `/resume`, and
`/fork`. Each SVG request sends `svg: { model }`, because the API requires an
author model. A call's `svg.model` overrides the setting.
`svg.reasoning.effort` controls the author's reasoning, not image complexity.

### Codex mode

Codex mode needs a ChatGPT login: log in to `openai-codex` with `/login`. The
arguments match Codex's:

- `prompt` (required): the image or edit description.
- `transparent_background`: request a transparent background.
- `referenced_image_paths`: absolute paths of images to edit or draw from.
- `num_last_images_to_include` (1–5): use the last N images in the
  conversation, such as pasted images, tool results, and earlier generated
  images. It cannot be combined with `referenced_image_paths`.

The Codex Images endpoint ignores size and quality, so state the aspect ratio
in the prompt. Output is about 1.57 megapixels, and the server chooses the
quality and the model.

JPEG and WebP references go out unchanged. PNG, GIF, BMP, and other formats go
out as lossless WebP, about 25% smaller than PNG at the same image-token cost.
The result is saved as lossless WebP to `$TMPDIR/omp-image-<id>.webp`. The
model gets the image, the saved path, and the size and quality the endpoint
reported. The result's details also keep the request id, generation id, and
output token count for tracing a result with OpenAI. HTTP errors name the
request id.

Codex mode also guards each request:

- A request body over 64 MB fails before sending. Larger bodies get false
  `moderation_blocked` errors, or the endpoint silently drops the references
  and returns an unrelated image.
- An edit that reports 0 input image tokens fails instead of returning an image
  that ignored the references.
- A usage limit error names the limit, the plan, and the reset time, and tells
  the model not to retry before then.
- A successful result notes when the image limit window is at least 80% used,
  with its reset time.

### Prompting skill

The bundled `generate-image` skill is a checklist the model runs on every
prompt before sending it. Its prompt rules hold in both modes, and it also
covers OpenAI complexity, GIF, and SVG:

- Every prompt: purpose first, one concrete main subject, every requested
  element with nothing invented, visible terms instead of praise, attributes
  bound to their nouns, positive scene content, and constraints last.
- When relevant: shape, counts, placement, actions, people, specialist terms,
  overlay space, and consistent image sets.
- Text and graphics: exact quoted final strings, real data, and original logos.
- Edits: roles first, one explicit operation with its scope, a keep list, rules
  for each kind of operation, and self-contained follow-ups.
- Transparency: set for cutouts, checked in the alpha channel, and reviewed
  against every requirement.

The criteria come from vendor prompting guides, text-to-image research and
benchmarks, and creative-brief practice, in `docs/research/`:
`image-prompting-*.md`, `image-prompt-criteria-*.md`,
`image-prompt-format.md`, and `gpt-image-2.6.md`. The `gpt-image-2.5-*.md`
notes keep the earlier research.

### Tool card in Tern

The card's header shows the prompt's first line, the reference count, the
mode's settings (such as `n 2` or `transparent`), and the size and quality.
Below it are each saved path (click to open the file), the Codex near-limit
warning, a folded copy of a long prompt, and the images. While a stream runs,
the card shows the latest preview as in progress. An error shows its message
in red.

## Side questions

`/btw <question>` in the main editor asks a Side question that can look things
up. It replaces native `/btw`'s answer for that form. Bare `/btw` still opens
OMP's BTW history, and autocomplete is OMP's.

A Side question runs as a separate agent session on a copy of the main
transcript in a temporary folder, deleted when the thread ends. It costs tokens
like a short agent turn. Only you see the answers. The agent never sees a Side
question.

### What a Side question can do

It gets only read, grep, glob, find, and web_search, whatever tools the main
agent has, so it cannot ask you, run commands, or message or stop agents. Each
tool keeps its own size limits, and there is no cap on rounds. `read
agent://<id>` reads the main session's agents, including one still running
that has no output yet.

Each thread starts from the saved transcript on the branch you have selected,
including after `/tree` with no new prompt, and uses OMP's default system
prompt for its five tools. It sees the eval state OMP saves after `/tree` and
compaction. A call the main agent still waits on (a pending `ask`, or a tool
still running) shows to the Side question as still open, not as failed, with
an instruction not to ask you again or repeat the call.
Images attached to `/btw` go with the question and stay in the thread for
follow-ups, as pasted images do in a Picker btw.

### The panel and threads

Answers show in a panel above the editor, and the editor keeps focus. Each
Side question shows as your messages do in the main chat: Markdown on the user
message background, or a user bubble in Tern. An answer shows its text and its
tool calls in the order they happened, and each group of calls folds into one
"N tool calls" line. With the editor empty, `t` opens or folds them (in Tern, a
click on a line also works), and Esc cancels a running answer or closes the
panel.

A later `/btw` follows up in the same thread, also after Esc closed the panel.
Your next main prompt ends the thread and clears the panel when the agent takes
the prompt. A prompt queued while the agent works ends the thread at that
point. If an answer is still running then, it finishes and shows but takes no
follow-up, and the next `/btw` starts a new thread.

### Side question model

`/btw` and the Picker btw use the `sideQuestionModel` plugin setting, default
`@smol`, with that role's thinking level. An empty value uses the main model.
Choose the model in **Settings > Plugins > omp-tools**, or run:

```sh
omp plugin config set omp-tools sideQuestionModel '@smol'
```

The value takes OMP model selectors such as `@smol:low` or
`provider/model:high`. A change applies when the next thread opens.

If the selector does not resolve, the plugin refreshes the providers it names
and looks again. If it still does not resolve, the thread uses the main model
and warns with the missing model's name. If the history exceeds the selected
model's context window, the thread also uses the main model.

Side questions use OMP's configured retry and fallback chains, including the
selected role's chain. Both views show retry countdowns, model switches, and
the final retry error. Provider transport retries happen before OMP reports
them, so the panel can keep showing `Answering…`. Esc cancels either kind of
wait.

OMP's fallback chains can inherit the default chain and revisit an earlier
model, so a run where every route fails can continue until you press Esc. Side
questions keep OMP's policy. To make a model the last one tried, give it an
empty chain in OMP's configuration:

```yaml
retry:
  fallbackChains:
    smol:
      - provider/backup:low
    provider/backup: []
```

### Cost and cache

Each Side question request's token usage, and that of its background calls
such as cache warms, goes into the main session's usage, so the session's cost
includes it without adding a message. Side questions also share the main
session's spending cap.

The first Side question in a main session does not reuse the main agent's
prompt cache. Its follow-ups, and later Side questions in the same session,
reuse a cache of their own.

With OMP's Cache Miss Marker setting on (`display.cacheMissMarker`), an answer
whose requests had to write the cached prompt again shows `⊘ cache miss · N
tokens` under it, in the panel and in the Picker btw. As with OMP's marker, it
shows only for providers that report cache writes (Anthropic), not for Codex.
Each provider and model is tracked separately, so a model switch does not count
as a miss.

### Where native `/btw` answers

Side questions need the interactive TUI and a saved session. In a focused
subagent view and in RPC, ACP, and print mode, `/btw` stays native. File
commands with `side: true` also use native `/btw`.

## Development

```bash
bun install --ignore-scripts
bun run check    # warns if SDK types differ from `omp --version`, then typechecks
bun test
bun run update   # runs omp update, installs the newest SDK types, then checks
```

Runtime value imports of `@oh-my-pi/*` resolve to the running OMP's own
modules. Development types track the `latest` SDK release. Run
`bun run update` so omp and the types move together.

`bun test` covers `generate_image` in both modes against stubbed endpoints
(including streamed responses), the `/btw` question parser, the Picker's paste
handling, the Picker draft, host questions through the Picker, and the Side
question session: its model, thinking level, context limit, images, fallback,
cost cap, cache-miss tracking, usage ledger, and recovery display. Typechecking
and tests do not load the plugin into OMP. Check a change to registration, the
Picker, or Side questions in a fresh OMP session.

The opt-in `test/generate-image-openai.live.test.ts` sends three paid OpenAI
requests: a still image with complexity, an SVG, and a GIF. It runs only with
both `OMP_TOOLS_LIVE_IMAGES=1` and `OPENAI_API_KEY`, and the requests are
billed to the key's API organization:

```sh
OMP_TOOLS_LIVE_IMAGES=1 bun test live
```

These API checks do not verify the OMP tool cards.
