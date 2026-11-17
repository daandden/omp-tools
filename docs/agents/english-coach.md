# English coach

- `englishCoach` defaults to `true`, `englishCoachMaxTokens` to `300`, and
  `englishCoachLanguage` to `Vietnamese`. Read them through
  `getPluginSettings("omp-tools", ctx.cwd)` at session start and on session
  switch. A non-positive or non-number limit, or an empty or non-string
  language, warns once and disables coaching for that session. The language
  fills `{{language}}` in `english-coach.md`: pattern names come in it, the
  rewrite stays English.
- Only interactive input to the main agent in a TUI with a UI qualifies.
  The observer returns no handled result and never changes the prompt.
  Slash commands qualify only for sentence arguments after `/btw`,
  `/skill:<name>`, and prompt-file names discovered once per session.
- `english-coach-input.ts` shares the observation channel under
  `Symbol.for("omp-tools.english-coach-input")`. `/btw` forwards a consumed
  line through it, and the observer deduplicates the two delivery paths.
  Manifest order alone is insufficient because OMP 18.20.3 can defer
  unchanged entry points.
- The pure preparation module replaces fenced code, inline code, paths, and
  URLs with numbered placeholders. Only the remaining text counts toward
  the token budget. `checkCoachPlaceholders` refuses a rewrite that drops,
  repeats, reorders, or invents a placeholder.
- `english-coach-diff.ts` splits the prepared prompt and the rewrite at
  their placeholders, which must match in order, and diffs only the prose
  between them by token (words, punctuation, whitespace of any kind
  matching), so each protected text shows once. It returns `CoachSegment`
  lines: kept, `del`, `ins`, `punct`, and protected (each placeholder's
  protected text, a fenced block as one `[code block, N lines]`), plus the
  reported mistakes with placeholders shown. Line breaks come from the
  prompt. Word changes join across the whitespace between them; a
  punctuation change stands alone. Tokens that differ only in case match, so
  the prompt's casing stays, and `replyView` drops case-only mistakes (none
  left is `no mistakes`): the coach never corrects capitalization, and
  `english-coach.md` also tells it to leave technical terms as written.
  Each change's parts share a `change` id
  and carry `mistakes`: every reported mistake whose original, found in the
  prompt in reply order, overlaps the change's place; else the best one only
  whitespace away or with matching words. Punctuation alone has none.
  `english-coach.md` asks for one fix per mistake line (the changed words plus
  at most one neighbour), so each change gets its own reason.
- The panel takes a `CoachView` (`checking`, `clean`, `note`, `correction`).
  It has no title line: `checking` and `clean` show one muted line
  (`Checking…` after a spinner in Tern, `No mistakes`). The close key is an
  overlay that takes no space: in Tern the sheet positions the `kbd` keycap
  absolutely at the bottom right of the frame on the panel's `--raise`
  colour, over any text there, centred on the last line. A plain last line
  is about as tall as the key (`omp-tools.english-coach.close`, `bottom: 0`);
  when the correction ends in a diff line (no unplaced mistakes), the key is
  `omp-tools.english-coach.close.diff`, raised to `bottom: 0.875em` (half of
  the 1.75 line height) and moved down by half its height. Classic writes
  `esc` over the right end of the last line, cutting the text it covers.
  Without the styles feature, the keycap follows the body. The overlay role
  pads 16px above and 18px below, and the last line's descent adds about 3px
  under the glyphs, so the sheet sets the panel's `padding-bottom` to 13px
  to show equal space above and below the text. Classic draws `del` struck
  through in `toolDiffRemoved`, `ins` and `punct` (punctuation that replaced
  punctuation, shown alone) in `toolDiffAdded`, protected text `dim`. Tern
  gets `del`, `ins`, `success`, and `dim` spans; its sheet puts `del`/`ins`
  on tinted chips. Each line is a wrapping `row` of pieces (a kept word, or
  one explained change) because only a node, not a span, takes a
  `hovercard`; edge spaces are no-break so a piece's trailing space does not
  hang. A change's piece has role `omp-tools.english-coach.change`, a `title`,
  and a `hovercard`: that change alone (`removed → added`, `+ added`, or the
  struck removal), then one pattern line per mistake it carries. Mistakes no
  change carries list under the prompt. Classic has no pointer and lists
  every mistake, one per line.
- Resolve `@tiny` through `ctx.models.resolve`, refresh its named providers
  once if unresolved, and obtain the credential from the model registry.
  Missing model or credential warns once and disables coaching. There is
  no main-model fallback.
- One background `completeSimple` invocation per checked prompt requests
  reasoning disabled and caps output at twice the limit plus 200 tokens.
  The helper can retry stalled attempts. Each attempt records `model_usage`
  with purpose `english-coach` on the initiating live session, guarded
  against a changed session. No correction becomes a conversation message.
- The widget has its own key above the editor. Its wrapped body has a 40%
  terminal-row cap, with a final `… N more lines` in classic and a wheel
  scroll box in Tern. Tern uses the native overlay role, without a width of
  its own, so the panel spans the composer like `/btw`. The body column has
  the role `omp-tools.english-coach.body` in every state, so the theme sheet
  finds the panel.
- `app.interrupt` (Esc) closes the panel, as on the `/btw` panel, only while
  the main editor is empty and has focus. The focus is the component focused
  when the widget was created, read with `tui.getFocused()`, so a Picker or
  selector keeps its Esc. In Tern the bottom-right `esc` keycap is also a
  click target. Closing aborts an unfinished check.
- Every interactive submission clears the previous outcome and aborts an
  unfinished check. Session switch, branch, tree, and shutdown do the same.
  Failures stay in the panel and never reject input dispatch.
