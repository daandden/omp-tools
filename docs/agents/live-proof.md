# Live proof

Dated results of live OMP smokes through the `verify-omp-tools` skill, newest first. Add an entry after each smoke: the OMP and Tern versions, what was driven, what was observed, and the evidence path.

- 2026-11-18, per-call `mode`: OMP 18.22.2, headless Tern 0.9.27, isolated
  `HOME` and agent dir without OpenAI or Codex credentials, the project
  default `codex`, only this checkout's `generate-image.ts` loaded with `-e`,
  and `helpers/image-mode-provider.ts` making the `generate_image` calls. The
  model request listed `mode` among the tool's parameters. A call with
  `mode: "openai"` and `output_format: "svg"` showed a card head with
  `OpenAI mode` and `svg` and the OpenAI API key error offering Codex mode or
  a new `defaultImageGenerationMode`. The first run showed `Codex mode` on
  that error card because OMP stores a thrown error with empty details; the
  fix landed red-first. Under `always-ask`, the approval prompt showed
  `Mode: Codex mode, the Default image generation mode` and the arguments for
  a call without `mode`, and `Mode: OpenAI mode` for `mode: "openai"`. Both
  denials returned `Tool call denied by user`, so no image request ran.
  Evidence:
  `/Users/vanguyen/.vstack/tmp/omp-tools-4663ab/implement-spec/20261118-agent-mode/70/smoke/`.
- 2026-11-18, `defaultImageGenerationMode` rename: OMP 18.22.2, headless Tern
  0.9.27, isolated `HOME` and agent dir, local SSE provider, and only this
  checkout's `generate-image.ts` loaded with `-e`. With only
  `imageGenerationMode: "codex"` in the isolated lockfile, the card showed
  the command to set `defaultImageGenerationMode codex`. With the project
  override `defaultImageGenerationMode: "openai"` and no OpenAI credential,
  the card showed the OpenAI API key error naming the new key. Neither call
  sent a paid image request. Evidence:
  `/Users/vanguyen/.vstack/tmp/omp-tools-4663ab/implement-spec/20261118-agent-mode/69/smoke/`.
- 2026-11-17, English coach padding: installed OMP 18.22.0, headless Tern
  0.9.26, local SSE provider. Measured in CSS pixels from the shots, the space
  between the panel edge and the text was 20.5px above and 24px below a long
  correction before the fix; after it, 20.5px and 19px, and 17.5px and 17px
  around `No mistakes`. Evidence:
  `/Users/vanguyen/.vstack/tmp/omp-tools-4663ab/verify/coach-padding-20261117-153548/`.
- 2026-11-17, English coach without a title line: installed OMP 18.22.0,
  headless Tern 0.9.26, local SSE provider. In Tern the panel showed
  `Checking…` after a spinner, then the marked prompt across the full width
  or `No mistakes`, with the `esc` keycap floating over the bottom-right
  corner (rect at the frame's right and bottom edges). Clicking the keycap
  and pressing Escape each removed the panel. Classic wrote `esc` at the right
  end of the `No mistakes` line, and Escape removed the panel. Evidence:
  `/Users/vanguyen/.vstack/tmp/omp-tools-4663ab/verify/coach-overlay-esc-20261117-153153/`.
- 2026-11-17, English coach diff view, hover reasons, and omp theme colors:
  installed OMP 18.22.0, headless Tern 0.9.26, local SSE provider,
  `dark-catppuccin`. In Tern the coach showed `checking…`, `N fixes` with
  struck and added words on tinted chips, and `no mistakes`; hovering a change
  showed only that change and its Vietnamese reason, two reasons for a change
  that fixes two reported mistakes. Shot pixels of the coach and `/btw`
  panels matched the theme exactly (`#313244` surface, `#fab387` accent,
  `#7f849c` muted, `#f38ba8` removed, `#a6e3a1` added), while the composer
  kept Tern's colors. Classic showed the same diff in ANSI with the mistakes
  listed below. The reasons came from a local provider; the real `@tiny`
  (`gpt-6.1-terra`) was checked only through `omp -p` with the coach prompt,
  where it kept capitalization and technical terms. Evidence:
  `/Users/vanguyen/.vstack/tmp/omp-tools-4663ab/verify/coach-theme-104127/serve/`
  and `coach-fine-131906/serve/` beside it.
- 2026-11-17, `ask` pictures after the `/media` move: compiled OMP 18.22.0,
  headless Tern 0.9.26, fresh HOME and agent directory, and a local SSE
  provider. In the Tern view and with `PI_TUI_NATIVE=0`, the Picker drew a
  form's PNG `<img>` and inline `<svg>` above the options, and Enter
  submitted the pick (`{"pick":"svg"}` and `{"pick":"raster"}` in the session
  JSONL) to the provider. Evidence:
  `/Users/vanguyen/.vstack/tmp/omp-tools-4663ab/verify/omp-tools-ask-media-20261117-103728/`.
- 2026-11-16, English coach acceptance: compiled OMP 18.20.3, headless Tern
  0.9.23 (`35c63ab`), fresh isolated agent directories, and a local SSE
  provider for the main, `@tiny`, and Side question roles. Both Tern and
  `PI_TUI_NATIVE=0` showed a correction, `No mistakes`, the over-300-token
  skip, a checked sentence above 500 fenced code lines shown as one
  `[code block, 500 lines]` marker, a coached `/btw` beside its Side question
  answer, and no coach panel or tiny request for `/model`. At 900 × 650 the
  long Tern correction stayed above the composer in a capped scroll box;
  wheel scrolling reached its last mistake. Classic ended with
  `… 4 more lines`. No paid model was called. The first drive's multiline
  input was invalid; its captures are excluded from acceptance proof.
  The repaired drive used bracketed paste. Two proof gaps remain: the smoke
  covers one real startup order, and real tiny-model correction quality is
  not assessed. Recipe: `features/english-coach.md` in the Verify skill.
  Evidence: the `63/native-retry/` and `63/classic/` runs under
  `/Users/vanguyen/.vstack/tmp/omp-tools-4663ab/implement-spec/coach-20261116-1343/`.
- 2026-11-16, OMP 18.20.3 and Tern 0.9.23, local SSE provider: a Submit
  review with two answers and a Note on a long option label keeps every value
  inside the Picker at 1200px and 900px pane widths. A fresh native window
  with the user's dark theme and Iosevka fonts also passes at 1741px.
  Before the fix, the label column grew beyond the pane and answers had zero
  width. The headless drive submits both picks and the Note unchanged.
- 2026-11-12, final acceptance of the HTML `ask` migration: OMP source at
  `8ed79a8`, headless Tern 0.9.16, local SSE provider, fresh agent dir. In
  both renderers: a mixed form with context blocks; Submit refused on a
  number above `max`; `ask.timeout` sending an empty required field and an
  out-of-range number marked not the user's choice; an image Note on an
  unpicked option, `Other`, and the Submit note; Esc then F5 restoring the
  answers and the Picker btw thread; Ctrl+R in a textarea; a ratchet
  `askDialog` with a Note. Side question requests after compaction, after
  `/tree` with and without a new prompt, and during a pending `ask` hold the
  selected saved history. RPC-UI hands the form to native `ask`; RPC and
  print return `Native ask tool unavailable for delegation`.
- OMP 18.18.8, headless Tern 0.9.16, local SSE provider: Ctrl+R in a Picker
  note, `Other` answer, and Picker btw question puts the picked history entry
  in that editor; a second Ctrl+R opens over the same editor, Esc keeps its
  text, and the answer stays out of prompt history.
- OMP 18.14.2, headless Tern 0.9.9: Esc then F5 on an `ask` replays the same
  call id with no model request between, and the Picker restores picks, option
  notes, and the Picker btw turn.
- OMP 18.13.3, Tern 0.9.7: in both renderers, Side question model selection,
  role thinking, retry countdowns, fallback switches, terminal failure, and Esc
  in `/btw` and the Picker btw; host `askDialog` picks, notes, Other, draft,
  and timeout; eager and deferred `generate_image` precedence; each mode's
  schema, a live Codex card, and OpenAI error cards (no live OpenAI request);
  over compiled RPC, Side question images, the five-tool limit, privacy, and
  the shared cost gate.
- OMP 18.12.x, Tern 0.9.4–0.9.5: every surface in both renderers (Picker
  keys, `Other`, notes, Submit, pointer, `ask.timeout`; Picker btw, also in an
  `ask` started by a subagent's IRC message; `/btw`; `generate_image`
  generate and edit), the Picker label's computed font, and Picker Cmd+C and
  Cmd+V in native Tern.
- 2026-11-05: the three live OpenAI checks passed in 45 seconds.
