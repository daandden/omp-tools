# omp-tools

Local OMP adapters: flexible questions, Codex Images `generate_image`, and
advisor concern follow-up. Formerly `omp-ask`.

## `ask`

Replaces the model-facing option-count guidance with “as many concise, distinct
options as there are materially different tradeoffs — no fixed count.” It also
tells the model to ask when a skill, workflow, or instruction leaves a decision
to the user (interview rounds, approvals, confirmations), not only for
tradeoffs.

The plugin ships an always-apply rule, `rules/use-ask-for-user-input.md`: all
user input goes through `ask`, overriding question formats that skills
prescribe (for example grilling's `❓ Q1 … ➡️` rounds).

In the interactive TUI the wrapper shows its own picker so questions keep their
Markdown: headings, lists, paragraph breaks, and code blocks. Option
descriptions and previews are Markdown too. Tall questions scroll with
PgUp/PgDn; the first ↑/↓ or Enter after scrolling brings the cursor back into
view instead of acting on a hidden row. The picker keeps the native controls:
tabs and a Submit review for several or multi-select questions, `Other (type
your own)`, `n` notes, `ask.timeout` auto-selection, and `ask.notify`.

Answering differs from native `ask` in two ways:

- A single-choice question still has one answer, an option or `Other` text.
  Add detail to the chosen option with a note: with the cursor on it, the
  footer shows `n add note to this choice`. Enter on the picked option
  unselects it.
- The agent gets a compact labeled summary instead of `id: value` lines: each
  question's id and first line, `Selected:` with a short description of each
  option, `Other:` for your own text, `Note (<option>):`, and `Unanswered` for
  skipped questions. Checkbox questions send ticked options and `Other` text
  together (native ask drops the ticks).

The `Other` answer and note editors are the main prompt's own editor, so they
behave like it: the same suggestions (`@` files, `^` models, `/` file commands
and skills, internal URLs such as `skill://`, `rule://`, `local://`, `agent://`,
`artifact://`, and `omp://`, emoji, GitHub refs, and other extensions'
providers), ghost-text word completion, typo detection and autocorrect, vim
mode, and multi-line input (Shift+Enter, Ctrl+J, or Alt+Enter inserts a
newline; Enter or Ctrl+Q submits). Ctrl+C clears the text (it never exits omp
from here).

Answers only reference things; nothing in them runs. `/` suggests commands you
keep as files (`~/.agents/commands`, `~/.omp/commands`, project command folders)
and skills, each with its own icon; skills insert as `/<name>` without the
`skill:` prefix, and only names that start with (or have a hyphenated part
starting with) what you typed are offered. Built-in and extension commands are
not suggested. `skill://` and `rule://` also work. `#` prompt actions are
hidden, accepting a suggestion only inserts its text, and Enter submits exactly
what you typed, so a `/command` is never run or auto-completed. There is no
history, push-to-talk, or draft saving. The external editor key
(`app.editor.external`, Ctrl+G by default) opens the current text in
`$VISUAL`/`$EDITOR` and writes the result back.

Images paste as in the main prompt: the image-paste key (Ctrl+V by default)
reads a copied image, a copied Finder file, or an image path on the clipboard,
and pasting an image file path also attaches it. Each image shows as the main
prompt's image chip; deleting the chip drops the image. Images are sent to the
model after the answer text, labeled `[Image #N]` to match.

Outside the TUI (RPC/ACP/print, subagents), and for inputs native `ask` rejects,
execution delegates to native `ask`. Differences from the native picker:
plan mode does not disable `ask.timeout`, answers are not spoken when
`speech.enabled` is on, and collaboration guests cannot answer.

Keep native `ask` enabled for delegation:

```yaml
ask:
  enabled: true
```

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
  images. It can't be combined with `referenced_image_paths`.

Unknown arguments are rejected with an error. The backend ignores size and
quality, so the prompt should state the aspect ratio. Output is about 1.57
megapixels, and the server chooses the quality.

The bundled `generate-image` skill teaches the model how to prompt, based on
OpenAI's GPT Image guidance and other vendors' prompting guides
(`docs/research/image-prompting-*.md`). It covers:

- the prompt order: purpose, scene, details, shape in words, and a short list
  of things to leave out
- exact text in quotes, with a count and "No other text"
- edits as one change plus a list of what stays unchanged, with a role for
  each reference image
- transparency described in the prompt, not only the flag
- one change per retry

`skills/generate-image/prompt-patterns.md` holds templates and before/after
examples.

PNG, GIF, BMP, and other non-JPEG references are sent as lossless WebP (about
25% smaller than PNG, same image-token cost). JPEG and WebP references are sent
unchanged. The result is saved as lossless WebP to
`$TMPDIR/omp-image-<id>.webp`. The model gets the image, the saved path, and the
size and quality the backend reported.

Guards:

- A request body over 64 MB is rejected before sending. Larger bodies get false
  `moderation_blocked` errors, or the backend silently drops the references and
  returns an unrelated image.
- An edit that reports 0 input image tokens fails instead of returning an image
  that ignored the references.
- Requests time out after 5 minutes. Cancelling the tool cancels the request.
- A usage limit error names the limit, the plan, and the reset time, and tells
  the model not to retry before then.

Disable native image generation. The plugin's tool takes precedence either
way, because native is added after extensions and skips taken names:

```yaml
generate_image:
  enabled: false
```

## Advisor concern follow-up

OMP steers an advisor `concern` into the agent while it works, but a concern
that arrives after the final answer only shows as a card until your next
prompt. This extension starts a new turn for such concerns and asks the agent to
verify each one and fix any that hold. Nits stay passive,
and blockers already wake the agent in OMP.

It sends the concern the same way OMP sends a note that should start a turn
when idle, so OMP's own rules still apply. After you interrupt a run (Esc), or
in plan mode, the concern is added to the conversation without starting a turn.
ACP clients that refuse agent-started turns get it on their next turn. The
extension also skips a wake when you have already queued a message, and wakes
at most twice per prompt you send so the advisor and agent cannot loop. The
count resets on every prompt you send, in the TUI, RPC, and ACP alike.
Switching sessions (`/new`, resume, fork) or jumping in `/tree` drops any
concern still waiting, so it never lands in the other conversation, and resets
the count.

Limits:

- Extensions cannot see the `advisor.immuneTurns` cooldown, so it does not
  delay these wakes.
- Off in print and JSON mode (`omp -p`, `--mode json`). After the last prompt,
  print mode prints the final answer and only records late advisor notes before
  exiting, so a new turn's answer would never be shown. Late concerns there stay
  as recorded advisor notes.

## Install

```bash
omp plugin link /Users/vanguyen/work/tries/omp-tools
```

The link uses the working tree directly; edits do not require reinstalling.
Start a **new OMP session** after installation or code changes. Existing sessions
retain their loaded tool definitions.

The renamed plugin replaces the previous `omp-ask` installation. Do not load both
packages or install a second loose copy of the ask extension.

## Development and verification

```bash
bun install --ignore-scripts
bun run check    # warns if SDK types differ from `omp --version`, then typechecks
bun test         # generate_image behavior tests (stubbed fetch)
bun run update   # omp update + newest SDK types, then check
```

Runtime value imports of `@oh-my-pi/*` resolve to the running OMP's own modules.
Development types track the `latest` SDK release; run `bun run update` so omp
and the types move together. `bun test` covers `generate_image` against a
stubbed endpoint. Registration changes require a fresh-session OMP smoke check.

A fresh OMP 18.3.1 session verified the Markdown picker (single question,
`Other` custom answer, two questions with multi-select, Esc cancel).

A fresh OMP 18.4.4 session verified `generate_image` live: a generation, an edit
with a PNG reference path, and an edit with `num_last_images_to_include`.
