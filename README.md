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

The `Other` answer and note editors accept images through the image-paste key
(Ctrl+V by default), like the main prompt: a copied image, a copied Finder file,
or an image path on the clipboard. Terminal paste (Cmd+V) inserts text only.
Each image inserts an `[Image #N]` label; deleting the label drops the image.
Images are sent to the model after the answer text, labeled to match.

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
