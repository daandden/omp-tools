# omp-tools

Local OMP adapters: flexible questions, Codex Images `generate_image`, and
advisor concern follow-up. Formerly `omp-ask`.

## `ask`

Removes the model-facing option count: the description asks for distinct
options without a number (native says 2–5). The rest of the description,
including when to ask, matches native `ask`.

The plugin ships an always-apply rule, `rules/use-ask-for-user-input.md`: all
user input goes through `ask`, overriding question formats that skills
prescribe (for example grilling's `❓ Q1 … ➡️` rounds).

In the interactive TUI the wrapper shows its own picker so questions keep their
Markdown: headings, lists, paragraph breaks, and code blocks. Option
descriptions and previews are Markdown too. Tall questions scroll with
PgUp/PgDn. After you scroll, the first move or action key brings the cursor
back into view instead of acting on a hidden row. The picker keeps the native
structure: tabs and a Submit review for several or multi-select questions,
`Other (type your own)`, `ask.timeout` auto-selection, and `ask.notify`.

### Keys

Each key means the same thing in every picker:

| Key | Action |
|---|---|
| j/k or ↑/↓ | Move between rows (on the Submit tab, scroll) |
| h/l, ←/→, or Tab | Switch tabs (when there is a Submit tab) |
| Space | Toggle the row and stay. Single-select un-picks the others |
| Enter | Finish the question. Single-select picks the row first, then goes to the next question. The last question goes to the Submit tab, or submits when there is none. On the Submit tab, submit |
| n | Edit the row's text: the option's note, the `Other` answer, or, on the Submit tab, the Submit note |
| x | Clear that text (on `Other`, also un-pick it) |

Space or Enter on an empty `Other` opens its editor. In an editor, Enter (or
Ctrl+Q) saves and stays on the row, and Esc discards the edit. Saving `Other`
text picks it.

### Differences from native `ask`

Answering differs from native `ask`:

- Nothing typed is lost by picking. Every option keeps its own note through
  select and deselect, and un-picking `Other` keeps its text (`n` and save picks
  it again).
- The Submit tab has a Submit note for the whole ask.
- On timeout, unanswered questions get the recommended option.
- The agent gets a compact labeled summary instead of `id: value` lines: each
  question's id and first line, `Selected:` with a short description of each
  option, `Other:` for your own text, `Note (<option>):` for every note
  (`Note (<option>, not picked):` on options you did not pick), `Unanswered`
  for skipped questions, and `Note on all answers:` for the Submit note.
  Checkbox questions send ticked options and `Other` text together (native ask
  drops the ticks).

### Editors

The `Other` answer, option-note, and Submit note editors are the main prompt's
own editor, so they behave like it. They have the same suggestions (`@` files,
`^` models, `/` file commands and skills, internal URLs such as `skill://`,
`rule://`, `local://`, `agent://`, `artifact://`, and `omp://`, emoji, GitHub
refs, and other extensions' providers), ghost-text word completion, typo
detection and autocorrect, vim mode, and multi-line input. Shift+Enter, Ctrl+J,
or Alt+Enter inserts a newline, and Enter or Ctrl+Q saves. Ctrl+C clears the
text and never exits omp from here.

Answers only reference things, and nothing in them runs. `/` suggests commands
you keep as files (`~/.agents/commands`, `~/.omp/commands`, project command
folders) and skills, each with its own icon. Skills insert as `/<name>` without
the `skill:` prefix. Only names that start with what you typed, or have a
hyphenated part that does, are offered. Built-in and extension commands are not
suggested. `skill://` and `rule://` also work. `#` prompt actions are hidden,
accepting a suggestion only inserts its text, and Enter saves exactly what you
typed, so a `/command` is never run or auto-completed. There is no history,
push-to-talk, or draft saving. The external editor key (`app.editor.external`,
Ctrl+G by default) opens the current text in `$VISUAL`/`$EDITOR` and writes the
result back.

Images paste as in the main prompt. The image-paste key (Ctrl+V by default)
reads a copied image, a copied Finder file, or an image path on the clipboard,
and pasting an image file path also attaches it. Each image shows as the main
prompt's image chip, and deleting the chip drops the image. Images go to the
model after the answer text, labeled `[Image #N]` to match.

### Picker btw

`?` asks a Picker btw: a side question about the ask or the conversation,
answered inside the picker. The options give way to a thread with a question
box below it (the same editor as `Other`, without image paste). Enter asks. The
answer streams into the thread, and later questions in the same ask see the
earlier ones. The side question also sees your answers so far (ticked options,
`Other` text, notes), so "is my pick a good idea?" works. Esc while an answer
streams cancels it and keeps the partial text. The next Esc returns to the
options with your answers untouched, and `?` reopens the thread. PgUp/PgDn
scroll a long thread. The thread is discarded when the ask ends, and the agent
never sees it. To tell the agent something, put it in `Other` or a note.

A Picker btw runs through the same side-request pipeline as OMP's `/btw`
(the conversation so far, no tools run, nothing added to the session), but it
is not OMP's `/btw`: it is not saved to BTW history and cannot be branched or
copied from a panel. It does not change your main prompt. `ask.timeout` stops
when you press `?` and stays stopped (the title reads `Ask (timer paused)`)
until your next key in the options, which restarts it in full. On an OMP
without side requests, `? btw` is not offered.

### Outside the TUI

Outside the TUI (RPC/ACP/print, subagents), and for inputs native `ask` rejects,
execution delegates to native `ask`. Differences from the native picker:
plan mode does not disable `ask.timeout`, answers are not spoken when
`speech.enabled` is on, and collaboration guests cannot answer.

Keep native `ask` enabled for delegation:

```yaml
ask:
  enabled: true
```

### In Tern

In [Tern](https://docs.stencil.so/tern/) (and other terminals that speak the
Tern Surface Protocol), the picker is drawn by the terminal instead of as text
rows. It sits in the composer's place, like native `ask`, but spans the full
width of the pane instead of the composer's width. Each option is a row: the
marker, then the label with its Markdown description, preview, and note or
`Other` text below it. The rows use Tern's theme as native `ask`'s rows do:
its UI font, primary and muted text colors, a gray fill on the highlighted row
and on hover, a Recommended badge, and a filled marker on a picked row. They
switch with Tern's light and dark appearance. The countdown is a ring.
A row of buttons below the options shows each key with its keycap. The editors
for `Other`, notes, the Submit note, and the Picker btw are Tern's own text
fields, without the main prompt's model chip and send button.

The question and its options sit in one box of fixed height for the whole
ask. Switching tabs, opening an editor, or opening the Picker btw does not
resize the picker. The box is as tall as the tallest tab needs, up to half the
pane. Taller content scrolls inside it: use the wheel, PgUp/PgDn, or j/k (the
highlighted row stays in view). A question first shows from its top. When the
highlighted row is below the box, the first key only brings it into view, so
no key acts on a row you have not seen. In an editor or the Picker btw, the box
above it shows the question, every answer (for the Submit note), or the thread.

The keys stay the same. The pointer runs the same paths:

| Pointer | Same as |
|---|---|
| Click a tab | Switching to that tab |
| Click an option | Moving to it, then Space |
| Double-click an option | Moving to it, then Enter |
| Click a button | Its key (`?`, Space, `n`, `x`, Esc, Enter) |

The `ask` tool card in the transcript uses native ask's Tern view: the question
and its answers with a check on each pick, plus the Submit note.
`PI_TUI_NATIVE=0` keeps the text picker.

## `generate_image`

Replaces native `generate_image`. It calls the Codex Images endpoint
(`chatgpt.com/backend-api/codex/images/generations` and `/edits`) directly, the
way the official Codex CLI does, instead of the Responses image tool. There, a
chat model rewrites your prompt and the model only gets text back. Here, the
prompt goes to the image backend unchanged with no system instructions, and the
model sees the generated image.

It needs a ChatGPT/Codex login: log in to `openai-codex` with `/login`. It never
falls back to another provider or to native `generate_image`.

Arguments match Codex's:

- `prompt` (required): the image or edit description.
- `transparent_background`: request a transparent background.
- `referenced_image_paths`: absolute paths of images to edit or draw from.
- `num_last_images_to_include` (1–5): use the last N images in the
  conversation, such as pasted images, tool results, and earlier generated
  images. It cannot be combined with `referenced_image_paths`.

Unknown arguments are rejected with an error. The backend ignores size and
quality, so state the aspect ratio in the prompt. Output is about 1.57
megapixels, and the server chooses the quality.

The bundled `generate-image` skill is a checklist the model runs on every
prompt before sending it. The criteria come from vendor prompting guides,
text-to-image research and benchmarks, and creative-brief practice
(`docs/research/image-prompting-*.md`, `docs/research/image-prompt-criteria-*.md`,
`docs/research/image-prompt-format.md`, `docs/research/gpt-image-2.5-*.md`).
OpenAI kept its gpt-image-2 prompts for GPT Image 2.5, and the endpoint accepts
any `model` value with no visible effect, so the rules work whichever model
serves:

- every prompt: purpose first, one concrete main subject, every requested
  element with nothing invented, visible terms instead of praise, attributes
  bound to their nouns, positive scene content, and constraints last
- when relevant: shape, counts, placement, actions, people, specialist terms,
  overlay space, and consistent image sets
- text and graphics: exact quoted final strings, real data, original logos
- edits: roles first, one explicit operation with its scope, a keep list, rules
  for each kind of operation, and self-contained follow-ups
- transparency set for cutouts and checked in the alpha channel, and review
  against every requirement

PNG, GIF, BMP, and other non-JPEG references are sent as lossless WebP (about
25% smaller than PNG, same image-token cost). JPEG and WebP references are sent
unchanged. The result is saved as lossless WebP to
`$TMPDIR/omp-image-<id>.webp`. The model gets the image, the saved path, and the
size and quality the backend reported. The tool result's details also keep the
request id, generation id, and output token count for tracing a result with
OpenAI. HTTP errors name the request id.

Guards:

- A request body over 64 MB is rejected before sending. Larger bodies get false
  `moderation_blocked` errors, or the backend silently drops the references and
  returns an unrelated image.
- An edit that reports 0 input image tokens fails instead of returning an image
  that ignored the references.
- Requests time out after 5 minutes. Cancelling the tool cancels the request.
- A usage limit error names the limit, the plan, and the reset time, and tells
  the model not to retry before then.
- A successful result notes when the image limit window is at least 80% used,
  with its reset time.

In Tern, the tool card heads with the prompt's first line, the reference count,
and the size and quality. Below it are the saved path (click to open the file),
the near-limit warning, a folded copy of a long prompt, and the image. An error
shows its message in red.

Turn off native image generation. The plugin's tool wins either way, because
OMP adds native tools after extensions and skips names that are taken:

```yaml
generate_image:
  enabled: false
```

## Advisor concern follow-up

OMP steers an advisor `concern` into the agent while it works, but a concern
that arrives after the final answer only shows as a card until your next
prompt. This extension starts a new turn for such concerns and asks the agent to
verify each one and fix any that hold. The card is already in the agent's
context, so the wake message only points at it instead of repeating the notes.
Nits stay passive, and blockers already wake the agent in OMP.

It sends the wake the same way OMP sends a note that starts a turn
when idle, so OMP's own rules still apply. After you interrupt a run (Esc), or
in plan mode, the wake is added to the conversation without starting a turn.
ACP clients that refuse agent-started turns get it on their next turn. The
extension also skips a wake when you have already queued a message.

The woken turn is reviewed too, so the advisor can raise another concern. To
stop an endless advisor/agent loop without stopping real work, every wake in a
prompt cycle (one prompt you send until the next) must pass three checks:

1. The concern is new. OMP's judge (TypeSafe Jev through the `judge` model
   role) compares it with the concerns the agent was already woken for. A
   concern that raises the same issue stays a card: the agent already answered
   it. When the `judge` role does not resolve to Jev, or the judge call fails,
   the extension compares words instead (half or more shared words is the same
   issue).
2. The last wake changed something. The woken turn ran `edit`, `write`,
   `ast_edit`, `bash`, `eval`, or `task` without an error. If the agent only
   read and replied, it did not agree with the advisor, and you decide.
3. Fewer than 6 wakes ran in this prompt cycle, as a safety limit.

When check 2 or 3 holds back a new concern, you get a notification that says
why. The card stays, and you can send a prompt if you want the agent to act.
Every prompt you send starts a new cycle, in the TUI, RPC, and ACP alike.
Switching sessions (`/new`, resume, fork) or jumping in `/tree` drops any
concern still waiting, so it never lands in the other conversation, and starts
a new cycle.

Limits:

- Extensions cannot see the `advisor.immuneTurns` cooldown, so it does not
  delay these wakes.
- Notifications need a UI. In RPC or ACP without one, a held-back concern stays
  a card without a notification.
- Off in print and JSON mode (`omp -p`, `--mode json`). After the last prompt,
  print mode prints the final answer and only records late advisor notes before
  exiting, so a new turn's answer would never be shown. Late concerns there stay
  as recorded advisor notes.

## Install

From the repository root:

```bash
omp plugin link "$PWD"
```

The link uses the working tree, so edits need no reinstall. Start a new OMP
session after you link the plugin or change its code. Running sessions keep the
tool definitions they loaded.

This plugin replaces the earlier `omp-ask` plugin. Do not load both, and do not
install a second loose copy of the ask extension.

## Development

```bash
bun install --ignore-scripts
bun run check    # warns if SDK types differ from `omp --version`, then typechecks
bun test         # generate_image and advisor-concern-wake behavior tests
bun run update   # runs omp update, installs the newest SDK types, then checks
```

Runtime value imports of `@oh-my-pi/*` resolve to the running OMP's own modules.
Development types track the `latest` SDK release. Run `bun run update` so omp
and the types move together. `bun test` runs `generate_image` against a stubbed
endpoint and `advisor-concern-wake` through its event handlers. Typechecking
and tests do not load the plugin into OMP, so a change to registration or the
picker needs a check in a fresh OMP session.

Fresh OMP sessions verified this behavior:

- OMP 18.3.1: the Markdown picker (one question, an `Other` custom answer, two
  questions with multi-select, Esc cancel).
- OMP 18.4.4: `generate_image` live (a generation, an edit with a PNG reference
  path, and an edit with `num_last_images_to_include`).
- OMP 18.4.8: the host judge call behind the advisor concern checks.
- OMP 18.6.1: the Picker btw (an answer that named the ticked option, a
  follow-up that quoted the earlier question, Esc cancelling a streaming answer
  and then returning to the options, the timer paused past the timeout and
  restarted in full on the next key, the thread kept on reopening, and the
  agent not seeing the thread after the ask).
- OMP 18.8.0: the picker keys (Enter picking a single-choice option and moving
  on, Space ticking a checkbox, a note saved with Enter staying on its row, a
  Submit note, and the answer text the agent got).
- OMP 18.8.6 in a headless Tern 0.6.3 window (`tern serve`, driven with
  `tern ctl`): the Tern views (option rows, keys, row, tab, and button clicks,
  the note and `Other` editors, the Picker btw thread, the countdown ring,
  Cancel, the `ask` result card with its Submit note, and a live
  `generate_image` card with its image and an error card), one picker height
  across tabs, editors, and the Picker btw, and scrolling by wheel, PgDn, and
  j/k. The same session with `PI_TUI_NATIVE=0` verified the text picker.
