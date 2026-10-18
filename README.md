# omp-tools

Local OMP adapters: flexible questions, Codex Images `generate_image`, advisor
wakes, and read-only side questions (`/btw` and the Picker btw).
Formerly `omp-ask`.

## `ask`

Removes the model-facing option count: the description asks for distinct
options without a number (native says 2–5). The rest of the description,
including when to ask, matches native `ask`.

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
text picks it. Above a note or `Other` editor, the picker shows the question's
title (its `header`), the question, and the row you edit with its description.

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

Images paste as in the main prompt. In Tern, Cmd+V pastes text or a copied
image into an open `Other`, option-note, or Submit note editor. On the option
list, the picker pastes nothing and says to open a note with `n` or choose
`Other`. The image-paste key (Ctrl+V by default) reads a copied image, a copied
Finder file, or an image path on the clipboard, and pasting an image file path
also attaches it. For a file copied in Finder, Cmd+V in Tern pastes only the
text Tern offers for it, as in the main prompt, so use the image-paste key to
attach the file. Each image shows as the main prompt's image chip, and deleting
the chip drops the image. Images go to the model after the answer text,
labeled `[Image #N]` to match. To copy question or option text, select it with
the mouse and press Cmd+C.

### Picker btw

`?` asks a Picker btw: a side question about the ask or the conversation,
answered inside the picker. The options give way to a thread with a question
box below it (the same editor as `Other`). Pasted images go with the question.
Enter asks. The
answer streams into the thread, and later questions in the same ask follow up
on the earlier ones. The side question also sees your answers so far (ticked
options, `Other` text, notes), so "is my pick a good idea?" works. It can look
things up with read-only tools (see [Side questions](#side-questions)); its
tool calls fold into "N tool calls" lines between the answer's text, and each
opens with a click in Tern. Esc
while an answer streams cancels it and keeps the partial text. The next Esc
returns to the options with your answers untouched, and `?` reopens the
thread. PgUp/PgDn scroll a long thread. The thread is discarded when the ask
ends, and the agent never sees it. To tell the agent something, put it in
`Other` or a note.

A Picker btw is not OMP's `/btw`: it is not saved to BTW history and cannot be
branched or copied from a panel. It does not change your main prompt.
`ask.timeout` stops when you press `?` and stays stopped (the title reads
`Ask (timer paused)`) until your next key in the options, which restarts it in
full. When side questions cannot run (no saved session, a subagent),
`? btw` is not offered.

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

The question and its options sit in one box that is as tall as the current
question needs, up to 70% of the pane's height (70% of the terminal in the
classic text picker). A short question gives a short picker, so the picker can
change height when you switch tabs. Taller content scrolls inside the box: use
the wheel, PgUp/PgDn, or j/k (the
highlighted row stays in view). A question first shows from its top. When the
highlighted row is below the box, the first key only brings it into view, so
no key acts on a row you have not seen. In an editor or the Picker btw, the box
above it shows the question with its title and the row you edit, every answer
(for the Submit note), or the thread.

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

## Advisor wake

While the agent works, OMP defers advisor nits and concerns: it sends them only
at the final answer. After the final answer, a concern only shows as a card
until your next prompt. OMP starts a turn for a late blocker, but not after you
interrupted the run earlier in the prompt cycle (Esc, or cancelling the
Picker), even when the run went on and finished. This extension starts a new
turn for such concerns and blockers and asks the agent to check the notes and
fix what holds. The card is already in the agent's context, so the wake message
only points at it instead of repeating the notes. Nits stay passive.

When a fix changes what the agent's latest complete answer told you, the agent
ends the Advisor wake with a Revised answer. A Revised answer is that answer
again in full and in the same form, with the corrections in place. The agent's
final reply holds only the Revised answer. It has no heading, and no lines about
what changed come before or after it. You can read it and ignore the earlier
answer, which stays in the chat. The latest complete answer is the latest
Revised answer if there is one, else the agent's final answer to your prompt.
If a fix changes nothing that you were told (for example, a code-only fix), the
agent replies briefly with what it fixed. Advisor wakes for concerns and
blockers follow the same rule in the TUI, RPC, and ACP.

The wake no longer asks for a Revised answer after a long answer. When the
agent's final answer to your prompt is longer than 600 tokens (counted with
tiktoken's `o200k_base` encoding), the wake only asks the agent to check the
notes and fix what holds. The agent may still restate the answer on its own.
If the count fails, the wake does the same. The first Advisor wake
after your prompt chooses the message, and later wakes until your next prompt
use the same one, so a short reply to a wake never counts as the answer.

A card wakes the agent only when it follows the agent's final answer and no
turn starts for it. A run that you stopped and did not resume ends without a
final answer, so its cards stay passive. In plan mode the card stays passive
too, as in OMP. The wake starts a turn even when an earlier interrupt is still
in effect. ACP clients that refuse agent-started turns get it on their next
turn. The extension also skips a wake when you have already queued a message.

The woken turn is reviewed too, so the advisor can raise another note. To stop
an endless advisor/agent loop without stopping real work, every wake in a
prompt cycle (one prompt you send until the next) must pass these checks:

1. The note is new. OMP's judge (TypeSafe Jev through the `judge` model role)
   compares it with the notes the agent was already woken for. A note that
   raises the same issue stays a card: the agent already answered it. A
   blocker is compared only with earlier blockers, so a concern that comes back
   as a blocker wakes the agent again. When the `judge` role does not resolve
   to Jev, or the judge call fails, the extension compares words instead (half
   or more shared words is the same issue).
2. Fewer than 10 wakes ran in this prompt cycle, as a safety limit.

A new note wakes the agent whatever the last woken turn did. A Revised answer
fixes the answer in text, with no tool call, and the advisor's next note is
often about that new text.

When check 2 keeps a new note back, the card stays and the footer shows
`advisor: 1 note waiting` (in Tern, in the composer's bottom row) until your
next prompt. Send a prompt if you want the agent to act. Every prompt you send
starts a new cycle, in the TUI, RPC, and ACP alike. Switching sessions (`/new`,
resume, fork) or jumping in `/tree` drops any note still waiting to be checked,
so it never lands in the other conversation, and starts a new cycle.

Limits:

- Extensions cannot see the `advisor.immuneTurns` cooldown, so it does not
  delay these wakes.
- Extensions cannot see OMP's interrupt state either. The extension reads plan
  mode from the session's mode changes.
- The footer status needs a UI. In RPC or ACP without one, a note kept back
  stays a card with no status.
- Off in print and JSON mode (`omp -p`, `--mode json`). After the last prompt,
  print mode prints the final answer and only records late advisor notes before
  exiting, so a new turn's answer would never be shown. Late notes there stay
  as recorded advisor notes.

### Release at a Picker answer

When you answer the Picker (Submit, or the timeout's pick), the extension sends
the concerns that OMP deferred in the current run to the agent at once, as an
advisor card. OMP sends a blocker the same way. The agent reads the concerns in
its next model call, not at its final answer. Nits stay deferred. Concerns
that the advisor writes after your answer keep OMP's timing.

At the final answer, OMP still sends the released concerns, so their card shows
a second time. That card does not wake the agent. A release is not a wake: it
does not count toward the 10-wake limit.

Limits:

- OMP keeps deferred notes in a private list in memory. The extension reads
  them from OMP's advisor transcript (`__advisor*.jsonl` in the session
  folder). That format is private to OMP (checked in 18.10.4). If an OMP update
  changes it, nothing is released and concerns keep OMP's timing.
- A release steers in plan mode too.
- Only the Picker releases. A delegated native `ask` (RPC, ACP, subagents)
  keeps OMP's timing.

## Side questions

`/btw <question>` in the main editor asks a side question that can look things
up. It replaces OMP's `/btw` answer for that form; bare `/btw` still opens OMP's
BTW history, and autocomplete is OMP's.

- Tools: only read, grep, glob, find, and web_search are offered, whatever
  tools the main agent has, so a side question cannot ask you, run commands,
  or message or stop agents. Each tool keeps its own size limits, and there is
  no cap on rounds. `read agent://<id>` reads the main session's agents, also
  one still running that has no output yet.
- Model and context: the main agent's model, thinking level, and conversation
  so far, copied from the live session when the thread starts, with OMP's
  default system prompt for those five tools. A call the main agent still
  waits on (a pending `ask`, or a tool still running) shows to the side
  question as still open, not as failed. The first request of a thread does
  not reuse the main agent's prompt cache; later ones reuse the thread's.
- Cache misses: with OMP's Cache Miss Marker setting on
  (`display.cacheMissMarker`), a follow-up whose requests had to write the
  thread's cached prompt again shows `⊘ cache miss · N tokens` under it, in
  the panel and in the Picker btw. Like OMP's marker, it shows only for
  providers that report cache writes (Anthropic), not for Codex.
- Privacy: only you see the answers. Nothing is added to the main session, and
  the agent never sees a side question.
- Panel: answers show in a panel above the editor, and the editor keeps focus.
  An answer shows its text and its tool calls in the order they happened; each
  group of calls folds into one "N tool calls" line. With the editor empty,
  `t` opens or folds them (a click on a line works in Tern), and Esc cancels a
  running answer or closes the panel.
- Threads: a later `/btw` follows up in the same thread, also after Esc closed
  the panel. Your next main prompt ends the thread and clears the panel when
  the agent takes it (a prompt queued while the agent works ends it then). If
  an answer is still running at that point, it finishes and shows, but takes no
  follow-up; the next `/btw` starts a new thread.
- Images attached to `/btw` are not sent.
- Where it applies: the interactive TUI with a saved session. In a focused
  subagent view, RPC, ACP, or print mode, `/btw` stays OMP's.

A side question runs as a separate agent session (a copy of the main
transcript in the session folder, deleted when the thread ends), so it costs
tokens like a short agent turn.

## Install

From the repository root:

```bash
bun install --ignore-scripts
omp plugin link "$PWD"
```

`bun install` fetches `js-tiktoken`, which the Advisor wake uses to count tokens.

The link uses the working tree, so edits need no reinstall. Start a new OMP
session after you link the plugin or change its code. Running sessions keep the
tool definitions they loaded.

This plugin replaces the earlier `omp-ask` plugin. Do not load both, and do not
install a second loose copy of the ask extension.

## Development

```bash
bun install --ignore-scripts
bun run check    # warns if SDK types differ from `omp --version`, then typechecks
bun test         # generate_image, advisor-wake, and /btw parsing tests
bun run update   # runs omp update, installs the newest SDK types, then checks
```

Runtime value imports of `@oh-my-pi/*` resolve to the running OMP's own modules.
Development types track the `latest` SDK release. Run `bun run update` so omp
and the types move together. `bun test` runs `generate_image` against a stubbed
endpoint, `advisor-wake` through its event handlers, and the `/btw`
question parser. Typechecking and tests do not load the plugin into OMP, so a
change to registration, the picker, or side questions needs a check in a fresh
OMP session.

Fresh OMP sessions verified this behavior:

- OMP 18.3.1: the Markdown picker (one question, an `Other` custom answer, two
  questions with multi-select, Esc cancel).
- OMP 18.4.4: `generate_image` live (a generation, an edit with a PNG reference
  path, and an edit with `num_last_images_to_include`).
- OMP 18.4.8: the host judge call behind the advisor wake checks.
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
- OMP 18.8.9 in a headless Tern 0.7.2 window: each question's box as tall as
  its content up to the cap, a long question scrolling at the cap, and the
  same in the text picker.
- OMP 18.10.4 in a headless Tern 0.8.3 window: the release at a Picker answer.
  A deferred concern was written to the session's `__advisor.jsonl` in OMP's
  format while the Picker was open. After Submit, the advisor card showed
  below the `ask` result, the session file held it between the `ask` result
  and the agent's reply, and the agent quoted the `<advisory>` text.
- OMP 18.10.4 in a headless Tern 0.8.3 window: side questions. `/btw` answered
  with read, also when sent while the main agent was still running; a follow-up
  stayed in the thread; `t` opened and folded the tool calls; Esc cancelled a
  running answer and then closed the panel; a main prompt sent during an
  answer let it finish and ended the thread; the next main prompt cleared the
  panel and a new `/btw` started a fresh thread. A Picker btw used grep while
  `ask` waited, and its thread file was deleted when the Picker closed. The
  same with `PI_TUI_NATIVE=0` verified the text panel.
- OMP 18.11.0 in RPC mode with Claude Haiku 5.5: the Revised answer. A
  throwaway command posted an advisor card after a final answer. In 32 of 32
  Advisor wakes, a concern or blocker that a stated fact was wrong ended the
  wake with only the whole answer, in the same form, with the fact corrected.
  In 16 of them, the wrong fact was on the answer's first line. A code-only
  concern got a short reply. A second fact concern, after a first Advisor wake
  that also wrote a file, got a Revised answer that kept the first correction.
- OMP 18.11.1 in RPC mode with Claude Haiku 5.5: the wake message by answer
  length, over fact-fix Advisor wakes (the answer had to contain a wrong fact,
  and the user prompt said not to question it). Final answers over 600 tokens
  got the short message in 11 of 11 wakes (4 with the wrong fact on the first
  line). The agent stated the correction in 9 of 11. In 2 it pointed to the
  "do not question" instruction and offered to fix instead. In 2 of the 9 it
  restated the whole answer anyway. Shorter answers got the Revised answer
  message, and 13 of 13 wakes ended with only the corrected answer (6 with the
  wrong fact on the first line). Three answers that refused to state the
  wrong fact got a short reply. The linked plugin loaded `js-tiktoken` from
  its `node_modules`.
- OMP 18.11.3: side questions offered only the five read-only tools.
  Replaying a real session where a subagent's IRC message led to a pending
  `ask` (Claude Opus 5.5), the Picker btw made no call outside the five in
  15 of 15 answers (before: `ask`, `bash`, or `write proc://…/kill` in 3 of
  15, each hiding the earlier text). In a headless Tern 0.9.2 window with
  Claude Haiku 5.5, a Picker btw during that `ask` showed its first line, the
  folded tool calls, and the answer in order. In RPC mode, `read
  agent://Sleeper` on a running subagent with no output returned its progress
  (before: `Not found`).
