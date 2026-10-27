# Side question with /btw

`/btw <question>` in the main editor asks a Side question that is offered only read, grep, glob, find, and web_search. The answer shows in a panel above the editor, and the editor keeps focus. The answer's text and its tool calls show in the order they happened; each group of calls folds into one "N tool calls" line. A later `/btw` follows up in the same thread; the next main prompt ends the thread and clears the panel. The main agent never sees a Side question. Bare `/btw` still opens OMP's own BTW history.

## Sub-features

- `btw-answer` answers using a read-only tool and shows the panel.
- `btw-fold` folds each group of tool calls; `t` (or a click on a line in Tern) opens and folds them.
- `btw-order` shows text written before a tool call above its "N tool calls" line, and the answer after it.
- `btw-follow` keeps a later `/btw` in the same thread, also after Esc closed the panel.
- `btw-cancel` cancels a running answer with Esc; the next Esc closes the panel.
- `btw-tools` offers only the five read-only tools: bash, write, and others cannot be called.
- `btw-usage` records each Side question request in the main session's usage ledger, and a later thread's first request reads the earlier thread's cached prefix.
- `btw-agent` reads `agent://<id>` of a main-session agent that is still running and has no output yet.
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

- Answer. Run `$C type '"/btw which extensions does package.json register? read it"'` and `$C key Enter`. While it runs, `$C tree` contains `Answering…` and `to cancel`. When `$C tree` contains `to close`, run `$C shot btw-answer`. In the Tern view the heading reads `/btw` and `side question · only you see the answers` (two text nodes in `$C tree`), the question shows as a user bubble like the main chat's (a `sf-card` with an `sf-card-body` in `$C tree`), a `1 tool call` line shows, and the answer lists the extension files. In the classic TUI the question is a padded block on the user message background. The count is the number of calls the model made, so it can differ from 1.
- Fold. Run `$C key t`, `$C shot btw-fold-open`. The fold shows `read <path>` under it, and the hint reads `to fold tool calls`. In Tern, `$C click '.sf-section-head'` toggles the same line.
- Order. Run `$C type '"/btw First write one short line saying you will check package.json. Then read package.json. Then say which test runner it uses."'` and `$C key Enter`. When the answer is done, run `$C shot btw-order`. The panel shows the short line, then the `1 tool call` line, then the answer naming `bun test`.
- Follow-up. Run `$C key Escape` (the panel closes), then `$C type '"/btw what file did you read for my first side question? one line, no tools"'`, `$C key Enter`, `sleep 20`, `$C shot btw-follow`. The answer names `package.json`, the earlier turns show in the panel, and the Side question listing in `../SKILL.md` still shows the same single new `SideQuestion-*.jsonl` with every `<btw>` prompt.
- Cancel. Run `$C type '"/btw read README.md and summarize every section in detail"'` and `$C key Enter`. As soon as `$C tree` contains `to cancel`, run `$C key Escape` and `$C shot btw-cancel`. The turn ends with `Cancelled`. `$C key Escape` again closes the panel (`$C tree` no longer contains `only you see`).
- Tools. Run `../helpers/side-question-probe.ts` as `../SKILL.md` (Helpers) describes, with `VERIFY_PROBE=tools`, and send one prompt (`Reply with only: ok`). In `tools.json`, `threads[0].tools` is exactly `read`, `grep`, `glob`, `find`, `web_search`, `calls` lists only `read` calls (`done`), and neither `/tmp/btw-probe.txt` nor `/tmp/btw-probe2.txt` exists. Check the offered list, not the answer's account of it.
- Usage. Run the same helper with `VERIFY_PROBE=usage` on `openai-codex/gpt-5.6-luna`, and send one main prompt of about 20k tokens (`Reply with only: ok.` followed by the text of `README.md` and `AGENTS.md`). The helper asks two threads different questions. `usage.json` holds one entry with purpose `side-question` per Side request (two here); entries with purpose `side-question:<purpose>` are the mirror's own off-transcript calls (cache warms, the `unexpected-stop` judge). The first `side-question` entry's `cacheRead` is near 0, since a thread's first request cannot reuse the main prompt cache. The second one's `cacheRead` is at least the first one's prompt (`input + cacheRead + cacheWrite`) less the first question's length (a few hundred tokens): the second thread reuses the shared conversation, not just an identical prompt. Assert on these numbers, not on the cache-miss marker, which never shows on Codex.
- Agent. Run the same helper with `VERIFY_PROBE=agent` and send `Use the task tool to spawn exactly one subagent named Sleeper (agent: task). Its task: run bash \`sleep 120\`, then yield the word done. Do not wait for it: right after spawning, end your turn with one short line.` `agent.json` shows `read agent://Sleeper` as `done`, and the answer quotes `# Sleeper (running)`.
- Main prompt ends it. With a thread open, run `$C type '"Reply with only: done"'`, `$C key Enter`, `sleep 15`. The Side question listing shows no new `SideQuestion-*.jsonl` and the panel is gone. A new `/btw` answers as a first question: the panel shows only the new turn.
- Running answer at a main prompt. Run `$C type '"/btw how many lines does AGENTS.md have? read it"'` and `$C key Enter`. While `$C tree` contains `to cancel`, send a main prompt, then `sleep 25`. The main reply and the Side answer both show, and the `SideQuestion-*.jsonl` is gone. The next main prompt clears the panel.
- Private. `jq -c 'select(.type=="message") | .message.role' <main session>.jsonl` and a read of the main transcript show no Side question text.

## Gotchas

- `/btw` sent before the main prompt's reply lands is answered from the transcript as it was then; the Side question does not see the reply still streaming.
- The Side question's thread file (`SideQuestion-<uuid>.jsonl` under `$TMPDIR/omp-side-question-*/`, never in the sessions dir) exists only while the thread lives. Read usage from the main session's `model_usage` entries with `purpose: "side-question"` instead (`jq -c 'select(.type=="model_usage" and .purpose=="side-question") | .usage' <main session>.jsonl`).
- `t` and Esc are ignored while the editor has text. Esc is the default `app.interrupt` key. If the user's keybindings change it, use that key.
- Bare `/btw`, a focused subagent view, and RPC go to OMP's own `/btw`; they are not this feature.
- Classic TUI (`PI_TUI_NATIVE=0`) and the Tern view are separate entry points.
