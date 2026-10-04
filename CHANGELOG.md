# Changelog

## [Unreleased]

### Added

- Woke the agent to check advisor concerns that arrive after its final answer,
  instead of leaving them as a card until the next prompt.
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
  against every requirement.
- Showed ask questions, option descriptions, and previews as full Markdown in the
  interactive picker instead of one condensed line.
- Allowed pasting images into ask `Other` answers and notes; they reach the model
  with the answer.
- Made ask `Other` answers and notes use the main prompt's editor: the same
  suggestions (`/` file commands and skills, `skill://`, `rule://`, and other internal URLs),
  word completion, autocorrect, vim mode, and multi-line keys; the external
  editor opens with the current text. Skills insert as `/<name>`. Nothing typed
  runs; built-in commands and `#` actions are not offered.
- Shipped an always-apply rule (`rules/use-ask-for-user-input.md`) that sends
  all user input through `ask`, overriding question formats prescribed by skills.

### Changed

- Renamed the plugin from `omp-ask` to `omp-tools`; flexible native ask remains included.
- Sent ask answers to the agent as a labeled summary per question (picked
  options with descriptions, the user's own `Other` text, notes, unanswered).
- Showed `n add note to this choice` and `Enter unselect` on a picked
  single-choice ask option.
- Told the model to use ask for decisions a skill, workflow, or instruction
  leaves to the user, not only for tradeoffs; skills such as grilling asked
  their rounds as chat text.
- Resynced the ask description with OMP's current native wording, restoring
  "Clarifying custom input? Answer first; re-ask unresolved questions."

### Fixed

- Checked the `generate-image` skill against GPT Image 2.5 (Flare, Sunburst),
  which may serve the Codex endpoint whatever `model` says. OpenAI kept its
  prompts for 2.5, so the rules stay model-agnostic. The skill now rewrites
  supplied JSON or tag prompts into sentences, names concrete values for open
  choices, turns group relations into per-group counts, quotes only final
  strings, phrases compositing as an edit of image 1, treats cutout and
  background-removal requests as transparency, checks the alpha channel and
  fine edges, reviews diagram labels and period details, and tells the user the
  model or version can't be chosen.
- Fixed multi-question ask answers dropping ticked options when a checkbox
  question also had `Other` text.
