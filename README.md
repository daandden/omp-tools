# omp-tools

Local OMP adapter for flexible questions. Formerly `omp-ask`.

## `ask`

Replaces the model-facing option-count guidance with “as many concise, distinct
options as there are materially different tradeoffs — no fixed count.”

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
bun run update   # omp update + newest SDK types, then check
```

Runtime value imports of `@oh-my-pi/*` resolve to the running OMP's own modules.
Development types track the `latest` SDK release; run `bun run update` so omp
and the types move together. There are currently no automated test files.
Registration changes require a fresh-session OMP smoke check.

A fresh OMP 18.3.1 session verified the Markdown picker (single question,
`Other` custom answer, two questions with multi-select, Esc cancel).
