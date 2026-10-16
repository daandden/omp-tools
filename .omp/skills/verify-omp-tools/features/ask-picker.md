# Ask picker

When the agent calls `ask`, the plugin shows its own picker in the composer's place. Questions, option descriptions, and previews render as Markdown. Each key has one meaning: j/k or arrows move, h/l, arrows, or Tab switch tabs, Space toggles the row, Enter finishes the question, `n` edits the row's note or `Other` text, `x` clears it. Several questions get a Submit tab. The agent receives labeled answer text.

## Sub-features

- `ask-single` picks one option with Enter.
- `ask-multi` ticks several options with Space on a multi-select question.
- `ask-other` types an `Other (type your own)` answer.
- `ask-note` saves a per-option note with `n` and Enter.
- `ask-submit` reviews and sends several answers from the Submit tab, with an optional Submit note.
- `ask-card` shows the answers in the transcript's `ask` card.
- `ask-pointer` picks a row by click (Space) and finishes by double-click (Enter) in the Tern view.
- `ask-timeout` auto-selects the recommended option for an idle picker when `ask.timeout` is set.

## How to get to it (user POV)

- Ask the agent for something that makes it call `ask`, or tell it to call `ask` with given questions.
- Keys in the picker; clicks on rows, tabs, and buttons in the Tern view (a click on an option is Space, a double-click is Enter).

## Driving it with tern ctl

Preconditions:

- Baseline from `README.md`.

- Single. Run `$C type '"Call the ask tool once: question Pick a color, options red and blue. Then reply with my answer only."'` and `$C key Enter`. When `$C tree` contains `Ask aside`, run `$C shot ask-open`. Then `$C key j`, `$C key Enter`, `sleep 12`, `$C shot ask-single`. The card shows `blue` checked and the agent replies `blue`.
- Note. Run Single again, but before `$C key j` run `$C key n`, `$C type '"why not"'`, and `$C key Enter` on the `red` row. The note shows under `red` and stays after `$C key j`, and `$C key Enter` sends `blue`. The answer text holds `Note (red, not picked): why not`, and the card shows `red (not picked): why not`.
- Several with multi-select, Other, and Submit note. Run `$C type '"Call the ask tool once with two questions. First: id color, question Pick a color, options red and blue. Second: id extras, question Pick extras, multi true, options tea and coffee. Then reply with my answers only."'` and `$C key Enter`. On the first tab, `$C key Enter` picks `red` and moves on. On the second, run `$C key Space`, `$C key j`, `$C key Space`, then `$C key j` to `Other (type your own)`, `$C key n`, `$C type '"water"'`, `$C key Enter`. Then `$C key Enter` opens the Submit tab, which shows `Submit note`. Run `$C key n`, `$C type '"all done"'`, `$C key Enter`, `$C shot ask-submit`, then `$C key Enter` to send. The card folds after a few lines. `$C key ctrl+o` shows it all: `red` checked, `tea` and `coffee` checked, `"water"`, and `Note on all answers:` with `all done`.
- Pointer (Tern view). Prompt for a two-option `ask` as in Single. Run `$C click '.sf-list-slot .sf-act:nth-child(3)'`. The second option is picked and the picker stays open. Run `$C dblclick '.sf-list-slot .sf-act:nth-child(3)'`. The picker closes and the answer text is `Selected: <second option>`.
- Timeout. Start a session with a `--config` file that holds the `advisor:` lines from `../SKILL.md` and `ask:` with `  timeout: 30`. Prompt `Call the ask tool once: question Pick a size, options small and large, recommended index 1. Then reply with my answer only.` and press nothing for 45 seconds. The card shows `auto-selected after timeout — not a user choice`, and the answer text is `Selected (auto, timed out): large`.
- Second view. The main session JSONL's `toolResult` for `ask` holds the labeled answer text the agent received: `User's answer:` with `Selected: …` for one question, `User answered N/M:` with one `- <id>: <question>` block per question for several, then `Other: …`, `Note (<option>[, not picked]): …`, and `Note on all answers: …` lines.

## Gotchas

- With `ask.timeout` set, an idle picker auto-selects; take shots before the countdown ends or press a key to restart it.
- In RPC, ACP, print, and subagents, `ask` goes to OMP's native tool; this picker is TUI only.
- A long question first shows from its top; after PgUp/PgDn the first move only reveals the highlighted row.
