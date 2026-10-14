# Picker btw

While the ask picker waits for an answer, `?` swaps the options for a thread where the user asks a Side question. It may use the same read-only tools as `/btw`, sees the unsubmitted answers, and each answer shows an "N tool calls" line. Later questions in the same ask follow up in one thread. Esc returns to the options with the answers untouched. The thread ends when the picker closes, and the agent never sees it.

## Sub-features

- `pbtw-open` opens the thread with `?` and pauses the countdown.
- `pbtw-answer` answers with a read-only tool while `ask` waits.
- `pbtw-follow` keeps later questions in the same thread.
- `pbtw-back` returns to the options with answers kept.
- `pbtw-end` ends the thread when the picker closes.

## How to get to it (user POV)

- Press `?` in the picker, or click the `Ask aside` button (Tern view).
- Type a question in the box and press Enter.

## Driving it with tern ctl

Preconditions:

- Baseline from `README.md` (the first main prompt below also creates the session file).

- Open picker. Run `$C type '"Call the ask tool once: question Pick a color, options red and blue. Then reply with my answer only."'`, `$C key Enter`, `sleep 20`, `$C shot pbtw-picker`. The picker shows `Pick a color` with `red` and `blue`.
- Ask aside. Run `$C key '?'`, `sleep 2`, `$C type '"which file in extensions registers the ask tool? use grep"'`, `$C key Enter`, `sleep 25`, `$C shot pbtw-answer`. The thread shows the question, a `1 tool call` line, and an answer naming `extensions/flexible-ask.ts`; the box below reads `Picker btw · only you see the answers`.
- Thread file. `ls $VERIFY_RUN_DIR/data/sessions/*/` lists one `SideQuestion-*.jsonl` while the picker is open.
- Back and answer. Run `$C key Escape`, `sleep 1`, `$C key Enter`, `sleep 12`, `$C shot pbtw-answered`. The ask card shows `red` checked and the agent replies `red`.
- End. `ls $VERIFY_RUN_DIR/data/sessions/*/` lists no `SideQuestion-*.jsonl`.

## Gotchas

- `?` only works in the options, not inside the note or `Other` editor.
- The Picker btw is not offered when the session has no saved transcript.
- The tool-call line opens only by click in the Tern view; the classic picker has no key for it, because the question box owns the keys.
- Esc while an answer streams cancels it first; a second Esc goes back to the options.
