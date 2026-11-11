# Ask picker

When the agent calls `ask` with an HTML `<form>`, the plugin shows its own picker in the composer's place. Each named radio group, checkbox group, `<select>`, `<select multiple>`, text or number `<input>`, and `<textarea>` is a question tab; the form's context (headings, paragraphs, lists, `<pre>`, tables, `<img>`, inline `<svg>`) shows above the options. Each key has one meaning: j/k or arrows move, h/l, arrows, or Tab switch tabs, Space toggles the row (on a text field, opens its editor), Enter finishes the question, `n` edits the row's note, `Other` text, or text field, `x` clears it. Several questions, multi-select, or a text field get a Submit tab. The agent receives native form data JSON (a number input as a number), then labeled Notes, Other answers, the Submit note, and pasted images.

## Sub-features

- `ask-single` picks one radio option with Enter.
- `ask-multi` ticks several options with Space on a checkbox group.
- `ask-other` types an `Other (type your own)` answer.
- `ask-note` saves a per-option note with `n` and Enter; a note on an unpicked option is still sent.
- `ask-image` pastes an image into a note; it reaches the agent after its `[Image #N]` label.
- `ask-submit` reviews and sends several answers from the Submit tab, with an optional Submit note.
- `ask-required` refuses Submit while a field breaks native's rules (`required`, `min`/`max`, length, email, URL, `pattern`) and opens the first such field.
- `ask-context` shows the form's context blocks and pictures above the options.
- `ask-card` shows the answers in the transcript's `ask` card.
- `ask-pointer` picks a row by click (Space) and finishes by double-click (Enter) in the Tern view.
- `ask-timeout` submits the current answers of an idle picker when `ask.timeout` is set, marked as not the user's choice.
- `ask-draft` keeps the answers through Esc and restores them on F5.
- `ask-text` answers text, number, and textarea fields beside choices in the same editor as notes; a password shows as bullets outside its editor.
- `ask-history` fills an open editor (note, `Other`, text field, Submit note, Picker btw) from OMP's Ctrl+R prompt history search.

## How to get to it (user POV)

- Ask the agent for something that makes it call `ask`, or tell it to call `ask` with a given form. A local OpenAI-compatible fixture provider loaded with `-e` can send an exact `html` argument instead of relying on a model.
- Keys in the picker; clicks on rows, tabs, and buttons in the Tern view (a click on an option is Space, a double-click is Enter).

## Driving it with tern ctl

Preconditions:

- Baseline from `README.md`.

- Single. Run `$C type '"Call the ask tool once with an HTML form: a radio group named color asking Pick a color, options red and blue. Then reply with my answer only."'` and `$C key Enter`. When `$C tree` contains `Ask aside`, run `$C shot ask-open`. Then `$C key j`, `$C key Enter`, `sleep 12`, `$C shot ask-single`. The card shows `blue` checked and the agent replies `blue`.
- Note on an unpicked option. Run Single again, but before `$C key j` run `$C key n`, `$C type '"why not"'`, and `$C key Enter` on the `red` row. The note shows under `red` and stays after `$C key j`, and `$C key Enter` sends `blue`. The answer text holds `Option notes:` with `red` and `(not picked)` and `why not`, and the card shows `red (not picked): why not`.
- History (`ask-history`). After the baseline prompt, run Single but stop at the open Picker. Run `$C key n`, `$C type '"draft"'`, `$C key ctrl+r`; `$C tree` shows `Search prompts…` with the baseline prompt. Run `$C key Down` until it is highlighted, then `$C key Enter`: the `Note for red` editor holds `Reply with only: ok` in place of `draft`. Run `$C key ctrl+r` and `$C key Escape`: the search opens over the same editor and closing it keeps the text. Run `$C key Enter`, then `j`, `j`, `$C key Enter` and the same search on the `Other answer` editor, then `$C key Enter` twice to send. The answer text holds both entries. Second view: `sqlite3 <agent dir>/history.db 'select prompt from history'` lists only the main prompts.
- Image in a note. In a note editor, paste an image with the image-paste key or Cmd+V (Tern native window, see `../SKILL.md`). A chip shows. Save and submit. The session JSONL's `toolResult` content holds a text block `[Image #1]` followed by an image block, and `details` holds no image data.
- Several with multi-select, Other, and Submit note. Ask for a form with a radio group `color` (red, blue) and a checkbox group `extras` (tea, coffee). On the first tab, `$C key Enter` picks `red` and moves on. On the second, run `$C key Space`, `$C key j`, `$C key Space`, then `$C key j` to `Other (type your own)`, `$C key n`, `$C type '"water"'`, `$C key Enter`. Then `$C key Enter` opens the Submit tab, which shows `Submit note`. Run `$C key n`, `$C type '"all done"'`, `$C key Enter`, `$C shot ask-submit`, then `$C key Enter` to send. `$C key ctrl+o` shows the card: `red`, `tea, coffee, Other: water`, and `Note on all answers` with `all done`. The data is `{"color":"red","extras":["tea","coffee","water"]}`.
- Required. Ask for a form with a `required` radio group and a second question. Press `h` to the Submit tab and Enter: the picker stays, opens the required question, and shows `Required`.
- Context. Ask for a form with a heading, a list, a `<pre>`, a `<table>`, and an `<img src>` of a small PNG in the repository. The picker shows them above the options; in the classic TUI a picture the scroll window cuts shows as one `▣ <alt>` line.
- Pointer (Tern view). Prompt for a two-option `ask` as in Single. Run `$C click '.sf-list-slot .sf-act:nth-child(3)'`. The second option is picked and the picker stays open. Run `$C dblclick '.sf-list-slot .sf-act:nth-child(3)'`. The picker closes and the form data holds the second option's value.
- Timeout. Start a session with a `--config` file that holds the `advisor:` lines from `../SKILL.md` and `ask:` with `  timeout: 30`. Prompt for a form with a radio group `size` (small, and large `checked`) and press nothing for 45 seconds. The card shows `auto-selected after timeout — not a user choice`, the data is `{"size":"large"}`, and the answer text says the values were submitted automatically. With no option checked, the data omits `size`: nothing is invented. With a `required` empty text field and `<input type="number" name="days" max="10" value="99">`, the timeout still submits `{"name":"","days":99}` with `details.timedOut`.
- Esc and F5. Pick an option and add a note, press Esc, then F5. The picker reopens with `Restored your answers`, the pick and the note, and sends nothing until Enter.
- Text fields (`ask-text`). Ask for a form with a radio group, `<input name="title">`, `<input type="number" name="days" min="1" max="90">`, `<textarea name="why">`, and `<input type="password" name="token">`. On the title row `$C key Enter` opens its editor; type, paste an image chip, `$C key Enter` saves. On days type `200`, save, go to the Submit tab, and `$C key Enter`: the picker opens Days with `Must be at most 90`. Fix it and submit. The data holds `days` as a number, the textarea's lines, and the token; the token row, the Submit tab, and the card show bullets. Esc before submitting and F5 restore the typed text.
- Second view. The main session JSONL's `toolResult` for `ask` holds the text the agent received: `User answers:` (or the timeout line) and the form data JSON, then `Option notes:`, `Other answers`, and `Note on all answers:` lines when present. `details.answers` holds one entry per question.

## Gotchas

- With `ask.timeout` set, an idle picker submits; take shots before the countdown ends or press a key to restart it.
- In RPC, ACP, print, and subagents, `ask` goes to OMP's native tool; this picker is TUI only.
- A long question first shows from its top; after PgUp/PgDn the first move only reveals the highlighted row.
- An ask answered again from `/tree` shows OMP's own form dialog on OMP 18.18.8, not this picker.
