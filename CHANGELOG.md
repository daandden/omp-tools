# Changelog

## [Unreleased]

### Added

- `generate_image` has two Image generation modes, set by the new plugin
  setting `imageGenerationMode`. `openai`, the default, uses GPT Image 2.5
  Sunburst through the public OpenAI Images API with the `openai` API key,
  billed to that API organization: OpenAI spends Promotional API credits
  first and then purchased credits, with no free-only guarantee. `codex` keeps
  the earlier Codex Images behavior and arguments. Installations without the
  setting move to OpenAI mode; run
  `omp plugin config set omp-tools imageGenerationMode codex` to keep Codex.
  The mode applies to new sessions, and a failure never switches modes.
- OpenAI mode supports every Sunburst control: the pinned snapshot model, `n`
  up to 10 (every image is saved and shown), `quality` up to `max`, standard
  and custom sizes, `background`, `output_format` and `output_compression`
  (explicit formats keep the API's bytes; the default is a local lossless
  WebP), `moderation`, `safety_identifier` and `user`, streamed previews with
  `partial_images`, up to 16 Reference images from paths, recent conversation
  images, URLs, or file ids, and `mask` or `markup` edits.

- Added `sideQuestionModel` to the plugin settings, default `@smol`, for both
  `/btw` and Picker btw. It honors the role's thinking level and fallback chain.
  An unavailable selector uses the main model with a warning; a history that
  exceeds the selected context window uses the main model.
- Side questions show OMP retry countdowns, fallback model switches, and final
  retry errors instead of silently waiting through session recovery.

- Cmd+V in Tern now pastes text and copied images into the picker's `Other`,
  option-note, and Submit note editors, and pasted images go with Picker btw
  questions. On the option list, the picker pastes nothing and says to open a
  note or `Other`. Text that you select with the mouse in the question or an
  option copies with Cmd+C.
- Esc no longer loses what you entered in the picker. It keeps your picks,
  notes, `Other` answers, Submit note, open tab, and Picker btw thread, and
  F5 (OMP's Retry) opens the cancelled ask with them. Any ask with the same
  questions gets them, and the picker says `Restored your answers`.
- Questions that OMP asks directly, such as Ratchet's approvals and an ask
  answered again from `/tree`, now open in the picker instead of OMP's stock
  dialog, with notes, `Other`, the Picker btw, and the Picker draft. The
  feature gets OMP's native answer, so Ratchet still records an approval only
  when you pick Approve, and Esc answers nothing.

### Fixed

- `/btw` now sends attached images and keeps them for follow-up questions.
- Side questions share the main session's spending cap rather than starting a
  separate cap for each thread.
- A model switch no longer produces a false Side question cache-miss marker.
- Picker clipboard paste over SSH no longer reads the remote system clipboard.
  Use the terminal's paste shortcut instead.

- A Side question (`/btw` or Picker btw) can now read the main session's
  `local://` files, such as a pasted image's `local://pasted-image-*.png`.
  It read its own empty folder and returned `Local file not found`.
- Option labels in the Tern picker are medium weight again, as designed. The
  stylesheet copied the terminal's font size and row height onto Tern's
  region element, which a program stylesheet cannot style, so the label rule
  was dropped and labels drew in regular weight.
- A picker with `ask.timeout` now keeps the display awake while it waits, like
  native timed `ask`. OMP 18.12 lets the Mac sleep while a dialog waits for
  you, unless the dialog states a timeout, and the picker did not state its
  timeout to OMP.

### Changed

- Updated the SDK types to OMP 18.13.3 and synchronized the `ask` description
  with upstream's instruction to show decision context before blocking.
- The isolated Tern helper exports its shell for headless starts, where Tern
  ignores the `shell` setting. Launching it from bash now finds `omp`.

- Side questions on Codex now reuse the prompt cache across threads. A
  later `/btw` or Picker btw in the same session reads the earlier one's
  cached conversation instead of sending it all uncached: about 90% lower
  API-equivalent cost for that first request in a measured run. Side
  question requests go over SSE with their own cache key. The first side
  question in a session still cannot reuse the main agent's cache.
- Side question token usage, including its background cache warms and
  judge calls, now counts in the main session's usage and cost. It was lost
  when the thread closed. The thread's copy of the transcript now sits in a
  temporary folder, so `omp stats` and the agent list never see it.
- A Side question in the `/btw` panel and the Picker btw now shows like your
  messages in the main chat: Markdown in a padded block on the user message
  background, a user bubble in Tern. It was one faint line with a `›` marker
  and was hard to find between answers.
- Updated the SDK types to OMP 18.12.5.
- The Verify skill now uses a seeded omp state for isolated Tern starts, so
  native test windows do not show Tern's omp install or update offer.
  Its `tern-isolated` helper starts headless or native instances and stops
  the instance and its daemon without touching the user's Tern.
- Sized each ask question's picker to its content, up to 70% of the
  terminal's height (in Tern, the pane's), instead of to the tallest question
  at up to half the pane. Option rows in Tern use the terminal's font size and
  row height, with 2px of padding and no gap, and a smaller radio or checkbox
  marker, so they are more compact.
- Let the Picker btw look things up with read-only tools, as `/btw` does (see
  Added). Each answer shows its text and "N tool calls" lines in the order
  they happened, and later questions in the same ask follow up in one thread.

### Removed

- Removed the Advisor wake and the release of deferred advisor concerns at a
  Picker answer. Since OMP 18.12.1, OMP itself continues the run for a concern
  or blocker that arrives after the final answer (`advisor.continueSeverity`,
  default `concern`). The wake prompts, the repeat check, the
  `advisor: N note(s) waiting` footer status, and the `js-tiktoken` dependency
  are gone with it.

### Added

- Took over `/btw <question>` in the interactive TUI: a side question that is
  offered only read, grep, glob, find, and web_search, so it cannot ask you,
  run commands, or message or stop agents; `read agent://<id>` reaches the
  main session's agents, also one still running. It starts from the main
  agent's model, thinking level, and conversation, with OMP's default system
  prompt for those tools, so a thread's first request does not reuse the main
  prompt cache. A call the main agent still waits on, such as a pending `ask`
  while you use the Picker btw, shows to it as still open, so it no longer
  asks you the same question again. The answer shows in a panel above the
  editor, which keeps focus: its text and tool calls appear in the order they
  happened, each group of calls folded into one line that `t` (or a click in
  Tern) opens, and Esc cancels or closes. A later `/btw` follows up in the
  same thread until the next main prompt. With OMP's Cache Miss Marker setting
  on, a follow-up that missed the thread's cache shows
  `⊘ cache miss · N tokens`, as the Picker btw does. Bare `/btw`, subagent
  views, and RPC keep OMP's `/btw`.
- Drew the ask picker and the `ask` and `generate_image` tool cards natively in
  Tern (terminals that speak the Tern Surface Protocol). Each option is a row
  with its full Markdown in Tern's theme (UI font, theme colors, a gray fill on
  the highlighted row), the picker spans the pane's width, the
  question and options sit in one box that scrolls (wheel,
  PgUp/PgDn, j/k), the countdown is a
  ring, buttons show each key, and clicks run the key paths: a click on an
  option is Space, a double-click is Enter, and tabs and buttons work. The
  `Other`, note, and Picker btw editors are plain
  Tern text fields. The `ask` card shows the answers like native ask, plus the
  Submit note. The `generate_image` card shows the prompt, size, quality, the
  saved path as a link, any near-limit warning, and the image.
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

- Showed the question's title (its `header`), the question, and the edited row
  with its description above the note and `Other` editors, instead of the
  question alone over empty space.
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
