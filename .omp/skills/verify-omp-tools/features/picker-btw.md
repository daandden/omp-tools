# Picker btw

While the ask picker waits for an answer, `?` swaps the options for a thread where the user asks a Side question. It may use the same read-only tools as `/btw`, sees the unsubmitted answers, and an answer that used tools shows an "N tool calls" line. Later questions in the same ask follow up in one thread. Esc returns to the options with the answers untouched. The thread ends when the picker closes, and the agent never sees it.

## Sub-features

- `pbtw-open` opens the thread with `?` and stops the countdown until the next key in the options.
- `pbtw-answer` answers with a read-only tool while `ask` waits, and sees the unsubmitted answers.
- `pbtw-follow` keeps later questions in the same thread, also after Esc and `?` again.
- `pbtw-back` cancels a running answer with Esc, then returns to the options with answers kept.
- `pbtw-end` ends the thread when the picker closes.

## How to get to it (user POV)

- Press `?` in the picker, or click the `Ask aside` button (Tern view).
- Type a question in the box and press Enter.

## Driving it with tern ctl

Preconditions:

- Baseline from `README.md`, started with a `--config` file that holds the `advisor:` lines from `../SKILL.md` and `ask:` with `  timeout: 30` on the next line.

- Open picker. Run `$C type '"Call the ask tool once: question Pick a color, options red and blue. Then reply with my answer only."'` and `$C key Enter`. When `$C tree` contains `Ask aside`, run `$C shot pbtw-picker`. The picker shows `Pick a color` with `red` and `blue`.
- Open the thread. Run `$C key j`, `$C key Space`, `$C key '?'`, `sleep 2`, `$C shot pbtw-open`. `$C tree` contains `Picker btw · only you see the answers`, `Ask about this question or the conversation. The agent never sees the answer.`, and `timer paused`. `ls $VERIFY_RUN_DIR/data/sessions/*/` lists no `SideQuestion-*.jsonl` yet, because the first question opens the thread.
- Countdown stopped. Run `sleep 35`. The thread is still open, so the 30-second timeout did not fire.
- Ask aside. Run `$C type '"which file in extensions registers the ask tool? use grep. Also which color have I picked so far?"'` and `$C key Enter`. While it runs, `$C tree` contains `Answering… esc cancels`. When that text is gone, run `$C shot pbtw-answer`. The thread shows the question, an `N tool calls` line, and an answer naming `extensions/flexible-ask.ts` and `blue`. If the model also tried `ask`, the line adds `· 1 refused`. `ls $VERIFY_RUN_DIR/data/sessions/*/` now lists one `SideQuestion-*.jsonl`.
- Follow-up. Run `$C type '"which file did you name in your last answer? one line, no tools"'`, `$C key Enter`, `sleep 15`, `$C shot pbtw-follow`. The answer names `extensions/flexible-ask.ts`, and the same `SideQuestion-*.jsonl` holds both questions.
- Back and reopen. Run `$C key Escape`, `sleep 1`, `$C shot pbtw-back`. The options show `blue` picked and `timer paused`. Run `$C key '?'`: both turns show again. Run `$C key Escape`.
- Cancel. Run `$C key '?'`, then `$C type '"Write a long, detailed explanation of this repository architecture."'` and `$C key Enter`. As soon as `$C tree` contains `Answering… esc cancels`, run `$C key Escape` and `$C shot pbtw-cancel`. The turn ends with `Cancelled` inside the thread. A second `$C key Escape` returns to the options.
- Countdown restarts. Run `$C key k`. `$C tree` no longer contains `timer paused`.
- Answer. Run `$C key j`, `$C key Enter`, `sleep 12`, `$C shot pbtw-answered`. The ask card shows `blue` checked and the agent replies `blue`. The main session's `ask` tool result reads `User's answer:` and `Selected: blue`.
- End. `ls $VERIFY_RUN_DIR/data/sessions/*/` lists no `SideQuestion-*.jsonl`, and `grep -c '<btw>'` on the main session JSONL prints 0.

## Gotchas

- `?` only works in the options, not inside the note or `Other` editor.
- The Picker btw is not offered when the session has no saved transcript, in a subagent, or when the main session has no model.
- The tool-call line opens only by click in the Tern view; the classic picker has no key for it, because the question box owns the keys.
- Esc while an answer streams cancels it first; a second Esc goes back to the options.
- The thread file is deleted shortly after the picker closes, not at the same instant. Check for it after the agent's reply.
