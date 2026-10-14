# Ask picker

When the agent calls `ask`, the plugin shows its own picker in the composer's place. Questions, option descriptions, and previews render as Markdown. Each key has one meaning: j/k or arrows move, h/l, arrows, or Tab switch tabs, Space toggles the row, Enter finishes the question, `n` edits the row's note or `Other` text, `x` clears it. Several questions get a Submit tab. The agent receives labeled answer text.

## Sub-features

- `ask-single` picks one option with Enter.
- `ask-multi` ticks several options with Space on a multi-select question.
- `ask-other` types an `Other (type your own)` answer.
- `ask-note` saves a per-option note with `n` and Enter.
- `ask-submit` reviews and sends several answers from the Submit tab, with an optional Submit note.
- `ask-card` shows the answers in the transcript's `ask` card.

## How to get to it (user POV)

- Ask the agent for something that makes it call `ask`, or tell it to call `ask` with given questions.
- Keys in the picker; clicks on rows, tabs, and buttons in the Tern view (a click on an option is Space, a double-click is Enter).

## Driving it with tern ctl

Preconditions:

- Baseline from `README.md`.

- Single. Run `$C type '"Call the ask tool once: question Pick a color, options red and blue. Then reply with my answer only."'`, `$C key Enter`, `sleep 20`, `$C shot ask-open`. Then `$C key j`, `$C key Enter`, `sleep 12`, `$C shot ask-single`. The card shows `blue` checked and the agent replies `blue`.
- Several with multi-select. Prompt the agent to call `ask` with two questions, the second `multi: true`. On the first tab, `$C key Enter`; on the second, `$C key Space`, `$C key j`, `$C key Space`, `$C key Enter`; on Submit, `$C key Enter`. The card lists both ticks on the second question.
- Note. On a row, `$C key n`, `$C type '"why not"'`, `$C key Enter`. The note shows under the row and stays after moving away; the agent's answer text quotes it.
- Other. Move to `Other (type your own)`, `$C key n`, type text, `$C key Enter`, then `$C key Enter` to finish. The card shows the typed text.
- Second view. The main session JSONL's `toolResult` for `ask` holds the labeled answer text the agent received.

## Gotchas

- With `ask.timeout` set, an idle picker auto-selects; take shots before the countdown ends or press a key to restart it.
- In RPC, ACP, print, and subagents, `ask` goes to OMP's native tool; this picker is TUI only.
- A long question first shows from its top; after PgUp/PgDn the first move only reveals the highlighted row.
