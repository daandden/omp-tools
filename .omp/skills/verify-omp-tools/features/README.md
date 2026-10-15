# omp-tools verification map

This directory is the maintained source for verifying what users see from the omp-tools plugin. Read this index, then use the feature file for the surface you changed. Commands assume the run entry, `$SOCK`, and `C="tern ctl --control $SOCK"` from `../SKILL.md`.

## Baseline preconditions

- Doctor in `../SKILL.md` passed: the plugin link points at this checkout, `bun run check` passes, and the socket is free.
- A headless Tern window started by this run is serving on `$SOCK`, and a fresh OMP session runs in it with `--session-dir $VERIFY_RUN_DIR/data/sessions`.
- The session has a saved transcript: send one main prompt (`Reply with only: ok`) and wait for the reply before anything that needs a session file (Side questions, Picker btw).
- Never drive a Tern window or OMP session this run did not start.

## Driving conventions

- Start each recipe from the baseline unless its preconditions say otherwise.
- Prefer `$C tree` text and CSS classes from the layout JSON over screen coordinates.
- Keys only reach the picker or panel when the editor is empty; clear the editor first.
- Treat every command as literal. Keep the double quotes inside single quotes for `type` and `run`.
- After a code change, start a new OMP session; a running one keeps the old code.

## Proof and skip reporting

- Capture the action and the resulting state: a shot before and after, plus a second view (session JSONL, files on disk, or `$C tree`).
- Shots are converted to lossless WebP as `../SKILL.md` describes, and read from the WebP path.
- Record the feature ID, entry point (Tern view, classic TUI, or RPC), and evidence path in `notes.md`.
- A check that could not run is reported with the command and the unmet precondition. A check proven through one entry point does not prove another (Tern view and classic TUI are separate entry points).

## Feature entry contract

Each feature file starts with an H1 title and one paragraph of user-visible behavior, then four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with tern ctl`, `Gotchas`.

## Features

- [Side question with /btw](./side-question-btw.md): answer with read-only tools, the tool-call fold, follow-ups, cancel, and the thread ending at the next main prompt.
- [Picker btw](./picker-btw.md): a Side question from inside the ask picker, while `ask` waits.
- [Ask picker](./ask-picker.md): Markdown questions, keys, Other and notes, Submit, and the answer the agent gets.
- [generate_image](./generate-image.md): a generation and an edit through Codex Images, and the tool card.
- [Advisor wake](./advisor-wake.md): one `advisor-wake` message per late card, a Revised answer for a fact fix, a second Revised answer that keeps the first fix, a short reply for a code-only fix, and a concern held back after an Advisor wake that changed no file.
