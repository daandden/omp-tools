# Changelog

## [Unreleased]

### Added

- Showed ask questions, option descriptions, and previews as full Markdown in the
  interactive picker instead of one condensed line.
- Allowed pasting images into ask `Other` answers and notes; they reach the model
  with the answer.
- Made ask `Other` answers and notes use the main prompt's editor: the same
  suggestions (`/` file commands and skills, `skill://`, `rule://`, and other internal URLs),
  word completion, autocorrect, vim mode, and multi-line keys; the external
  editor opens with the current text. Skills insert as `/<name>`. Nothing typed
  runs; built-in commands and `#` actions are not offered.

### Changed

- Renamed the plugin from `omp-ask` to `omp-tools`; flexible native ask remains included.
- Sent ask answers to the agent as a labeled summary per question (picked
  options with descriptions, the user's own `Other` text, notes, unanswered).
- Showed `n add note to this choice` and `Enter unselect` on a picked
  single-choice ask option.

### Fixed

- Fixed multi-question ask answers dropping ticked options when a checkbox
  question also had `Other` text.

### Removed

- Removed custom image generation, including its implementation, request tests,
  description assets, manifest registration, and image-specific documentation.
  The plugin now provides only the flexible native ask adapter.
