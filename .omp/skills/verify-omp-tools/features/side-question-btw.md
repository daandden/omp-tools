# Side question with /btw

`/btw <question>` in the main editor asks a Side question that may use read, grep, glob, find, and web_search. The answer shows in a panel above the editor, and the editor keeps focus. Tool calls fold into one "N tool calls" line. A later `/btw` follows up in the same thread; the next main prompt ends the thread and clears the panel. The main agent never sees a Side question. Bare `/btw` still opens OMP's own BTW history.

## Sub-features

- `btw-answer` answers using a read-only tool and shows the panel.
- `btw-fold` folds tool calls; `t` (or a click on the line in Tern) opens and folds them.
- `btw-follow` keeps a later `/btw` in the same thread, also after Esc closed the panel.
- `btw-cancel` cancels a running answer with Esc; the next Esc closes the panel.
- `btw-refuse` refuses every call that is not a read (bash, write, edit, and others).
- `btw-main-ends` ends the thread at the next main prompt; an answer still running finishes and shows first.
- `btw-private` keeps Side questions out of the main transcript.

## How to get to it (user POV)

- Type `/btw <question>` in the main editor and press Enter (Tern view or classic TUI).
- Press `t` or Esc with an empty editor while the panel shows.
- Click the "N tool calls" line (Tern view only).

## Driving it with tern ctl

Preconditions:

- Baseline from `README.md`, including one answered main prompt.
- `/tmp/btw-probe.txt` does not exist.

- Answer. Run `$C type '"/btw which extensions does package.json register? read it"'`, `$C key Enter`, `sleep 25`, `$C shot btw-answer`. The panel heading reads `/btw side question · only you see the answers`, a `› ` line shows the question, a `1 tool call` line shows, and the answer lists the extension files.
- Fold. Run `$C key t`, `$C shot btw-fold-open`. The fold shows `read <path>` under it, and the hint reads `to fold tool calls`. In Tern, `$C click '.sf-section-head'` toggles the same line.
- Follow-up. Run `$C type '"/btw what did I ask you before? one line"'`, `$C key Enter`, `sleep 20`, `$C shot btw-follow`. The answer names the earlier question; both turns show in the panel.
- Cancel. Run `$C type '"/btw read README.md and summarize every section in detail"'`, `$C key Enter`, `sleep 4`, `$C key Escape`, `$C shot btw-cancel`. The turn ends with `Cancelled`. `$C key Escape` again closes the panel (`$C tree` no longer contains `only you see`).
- Refuse. The `/btw` prompt makes the model decline before it calls a blocked tool, so the panel alone does not prove the refusal. Copy a throwaway extension into `extensions/` (a file outside the plugin cannot import `@oh-my-pi/*`) that, on the first `agent_end`, opens `SideQuestionThread` from `./side-question` and calls `ask` with a prompt asking for a bash `touch /tmp/btw-probe.txt`, a write to `/tmp/btw-probe2.txt`, and a read of `package.json`, then writes the recorded calls and answer to `$VERIFY_RUN_DIR/gate.json`. Run it with the RPC drive and `--no-extensions -e <that file>`. `gate.json` shows bash and write `blocked`, read `done`, and neither probe file exists. Delete the throwaway file afterwards.
- Main prompt ends it. With a thread open, run `$C type '"Reply with only: done"'`, `$C key Enter`, `sleep 15`. `ls $VERIFY_RUN_DIR/data/sessions/*/` lists no `SideQuestion-*.jsonl` and the panel is gone. A new `/btw` answers as a first question.
- Running answer at a main prompt. Run `$C type '"/btw how many lines does AGENTS.md have? read it"'`, `$C key Enter`, `sleep 3`, then a main prompt and `sleep 25`. The main reply and the Side answer both show; the next main prompt clears the panel.
- Private. `jq -c 'select(.type=="message") | .message.role' <main session>.jsonl` and a read of the main transcript show no Side question text.

## Gotchas

- `/btw` sent before the main prompt's reply lands is answered from the transcript as it was then; the Side question does not see the reply still streaming.
- The Side question's thread file (`SideQuestion-<uuid>.jsonl` in the session folder) exists only while the thread lives. Read it before the next main prompt if you need token usage (`.message.usage.cacheRead` on the first assistant message after the `<btw>` prompt).
- `t` and Esc are ignored while the editor has text.
- Bare `/btw`, a focused subagent view, and RPC go to OMP's own `/btw`; they are not this feature.
- Classic TUI (`PI_TUI_NATIVE=0`) and the Tern view are separate entry points.
