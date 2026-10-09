# Changelog

## [Unreleased]

### Added

- Drew the ask picker and the `ask` and `generate_image` tool cards natively in
  Tern (terminals that speak the Tern Surface Protocol). Each option is a row
  with its full Markdown in Tern's theme (UI font, theme colors, a gray fill on
  the highlighted row), the picker spans the pane's width, the
  question and options sit in one box of fixed height that scrolls (wheel,
  PgUp/PgDn, j/k), the countdown is a
  ring, buttons show each key, and clicks run the key paths: a click on an
  option is Space, a double-click is Enter, and tabs and buttons work. The
  `Other`, note, and Picker btw editors are plain
  Tern text fields. The `ask` card shows the answers like native ask, plus the
  Submit note. The `generate_image` card shows the prompt, size, quality, the
  saved path as a link, any near-limit warning, and the image.
- Woke the agent to check advisor concerns that arrive after its final answer,
  instead of leaving them as a card until the next prompt. Wakes in one prompt
  cycle stop when a concern repeats an earlier one (checked by OMP's judge,
  TypeSafe Jev, or by shared words without it), when the last woken turn
  changed no files, or after 6 wakes; the last two cases notify you.
- Added `generate_image`, replacing native `generate_image`. It calls the Codex
  Images endpoint directly with a ChatGPT/Codex login, the way the Codex CLI
  does: the prompt goes unchanged and without system instructions, the model
  sees the generated image as lossless WebP, and arguments match Codex's
  (`prompt`, `transparent_background`, `referenced_image_paths`,
  `num_last_images_to_include`). It guards against oversized requests and
  dropped references, and it explains login and usage-limit errors. A bundled
  `generate-image` skill gives the model a checklist to run before every
  prompt, drawn from vendor guides, text-to-image research, and brief practice:
  purpose and one concrete subject first, nothing invented, attributes bound to
  their nouns, explicit counts and placement, exact text, edits as one explicit
  operation plus a keep list, transparency stated in the prompt, and review
  against every requirement. Results keep the backend's request id, generation
  id, and output token count in the tool details, HTTP errors name the request
  id, and a result notes when the image usage limit is at least 80% used.
- Showed ask questions, option descriptions, and previews as full Markdown in the
  interactive picker instead of one condensed line.
- Allowed pasting images into ask `Other` answers and notes; they reach the model
  with the answer.
- Added `?` in the ask picker to ask a side question without leaving it: the
  answer streams into the picker, sees your answers so far, and supports
  follow-ups. The agent never sees it, and the ask timeout pauses meanwhile.
- Made ask `Other` answers and notes use the main prompt's editor: the same
  suggestions (`/` file commands and skills, `skill://`, `rule://`, and other internal URLs),
  word completion, autocorrect, vim mode, and multi-line keys; the external
  editor opens with the current text. Skills insert as `/<name>`. Nothing typed
  runs; built-in commands and `#` actions are not offered.

### Changed

- Renamed the plugin from `omp-ask` to `omp-tools`; flexible native ask remains included.
- Sent ask answers to the agent as a labeled summary per question (picked
  options with descriptions, the user's own `Other` text, notes, unanswered).
- Gave every ask picker key one meaning: j/k (or ↑/↓) move, h/l (or ←/→/Tab)
  switch tabs, Space toggles the row and stays, Enter finishes the question
  (single-choice picks the row first; a lone single-choice question submits), `n`
  edits the row's note or `Other` text, and `x` clears it. In editors Enter saves
  and stays, and Esc discards.
- Kept notes and `Other` text when options are picked or un-picked: each option
  has its own note, every note reaches the agent (`not picked` when its option
  isn't), and `Other` text stays after un-picking.
- Added a Submit note on the ask picker's Submit tab, sent as `Note on all
  answers`.
- Auto-selected the recommended option on ask timeout, ignoring notes.
- Dropped the option count from the ask description: it now asks for distinct
  options with no number (native says 2–5), and otherwise matches native ask's
  wording, including when to ask. The exception for decisions a skill,
  workflow, or instruction leaves to the user is gone.
- Resynced the ask description with OMP's current native wording, restoring
  "Clarifying custom input? Answer first; re-ask unresolved questions."
- Checked the `generate-image` skill against GPT Image 2.5 (Flare, Sunburst),
  which may serve the Codex endpoint whatever `model` says. OpenAI kept its
  prompts for 2.5, so the rules stay model-agnostic. The skill now rewrites
  supplied JSON or tag prompts into sentences, names concrete values for open
  choices, turns group relations into per-group counts, quotes only final
  strings, phrases compositing as an edit of image 1, treats cutout and
  background-removal requests as transparency, checks the alpha channel and
  fine edges, reviews diagram labels and period details, and tells the user the
  model or version can't be chosen.

### Fixed

- Fixed multi-question ask answers dropping ticked options when a checkbox
  question also had `Other` text.
