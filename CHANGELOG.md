# Changelog

## [Unreleased]

### Added

- Showed ask questions, option descriptions, and previews as full Markdown in the
  interactive picker instead of one condensed line.
- Allowed pasting images into ask `Other` answers and notes; they reach the model
  with the answer.

### Changed

- Renamed the plugin from `omp-ask` to `omp-tools`; flexible native ask remains included.

### Removed

- Removed custom image generation, including its implementation, request tests,
  description assets, manifest registration, and image-specific documentation.
  The plugin now provides only the flexible native ask adapter.
