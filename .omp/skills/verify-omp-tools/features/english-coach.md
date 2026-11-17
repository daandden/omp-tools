# English coach

The English coach checks submitted English in the background with `@tiny`, without changing the main prompt. A private panel above the editor shows corrections, a successful check, or a reason for skipping. Long corrections scroll in Tern and end with a remaining-line count in classic.

## Sub-features

- `coach-correction`: `Checking…`, then the prompt with removed words struck through and replacements after them, and no title line. In Tern, `$C dump "[data-role='omp-tools.english-coach.change']"` gives each change's `rect` (`[x, y, w, h]`); `$C move` to its center shows a card with only that change (`removed → added`) and its reason. Classic lists `- original → corrected (pattern)` under the prompt. A long correction keeps the composer visible.
- `coach-correct`: `No mistakes`.
- `coach-theme`: in Tern, the panel's background, accent, muted text, and `del`/`ins` colors are the active omp theme's `selectedBg`, `accent`, `muted`, `toolDiffRemoved`, and `toolDiffAdded` (sample shot pixels; with `dark-catppuccin` they are `#313244`, `#fab387`, `#7f849c`, `#f38ba8`, `#a6e3a1`). The `/btw` panel shares the background; the composer keeps Tern's.
- `coach-limit`: prose over 300 tokens shows `Not checked: over 300 tokens`, with no tiny request.
- `coach-fence`: a short sentence above 500 fenced code lines is checked. The coach request contains a placeholder, not the code, and the panel shows one `[code block, 500 lines]` marker.
- `coach-btw`: one coach request for the question text, with both the correction and the Side question answer visible.
- `coach-command`: `/model coach-smoke/main` removes the coach panel and makes no tiny request. The host's handling of the command is not the coach's contract.
- `coach-close`: the `esc` keycap floats over the panel's bottom-right corner, with no line or column of its own; the body text spans the full width under it. With the editor empty, `$C key Escape` removes the panel. In Tern, `$C click '.sf-act[title="Close"]'` on that keycap also removes it. The panel spans the composer's width, as `/btw` does.

## How to get to it (user POV)

Submit a prompt in the main interactive editor. The coach starts enabled with a 300-token limit. It does not run in RPC, ACP, print mode, or subagents. The editor keeps focus while the panel shows. Submit another line to replace or clear the outcome.

For live proof, use the local provider below instead of real credentials. It supplies deterministic corrections, not a correction-quality assessment.

## Driving it with tern ctl

Use a fresh `$VERIFY_RUN_DIR` for each renderer. Read `../SKILL.md` first. This recipe replaces Doctor's plugin-link and credential checks with explicit entry paths and a local provider. Keep the version, typecheck, socket, and empty-dialog checks.

1. Set `CHECKOUT` to the checkout being verified and `OMP_BIN` to the absolute installed OMP binary whose version Doctor checked. Set `H="$CHECKOUT/.omp/skills/verify-omp-tools/helpers/english-coach-provider.ts"`.
2. Start `bun "$H" "$VERIFY_RUN_DIR"` as an owned service. Wait for `ready: http://127.0.0.1:...`. Keep its PID and output. It writes a provider extension, configuration, scenario inputs, and isolated project and agent directories. Every request goes to localhost and is recorded in `requests.jsonl`.
3. Start headless Tern with `helpers/tern-isolated`, as in the parent skill. Require `"dialogs":[]`. Size it to 900 × 650 to exercise the height cap.
4. Start OMP with this inner shell command. Quote the whole command as the argument of `sh -c`, then quote that whole string for `$C run` as in the parent skill. Use absolute paths without spaces, or shell-quote each path.

   ```sh
   cd "$VERIFY_RUN_DIR/data/project" && exec env \
   HOME="$VERIFY_RUN_DIR/data/home" \
   PI_CODING_AGENT_DIR="$VERIFY_RUN_DIR/data/agent" \
   PI_PROFILE= PI_SMOL_MODEL= PI_SLOW_MODEL= PI_PLAN_MODEL= \
   "$OMP_BIN" --no-extensions -e "$VERIFY_RUN_DIR/provider.ts" \
   -e "$CHECKOUT/extensions/flexible-ask.ts" \
   -e "$CHECKOUT/extensions/generate-image.ts" \
   -e "$CHECKOUT/extensions/english-coach.ts" \
   -e "$CHECKOUT/extensions/btw.ts" \
   --no-skills --no-rules --no-context-files --no-lsp --no-title \
   --offline --no-tools --thinking off \
   --model coach-smoke/main --smol coach-smoke/side \
   --config "$VERIFY_RUN_DIR/smoke-config.yml" \
   --session-dir "$VERIFY_RUN_DIR/data/sessions"
   ```

   Create `data/home` before launch. For classic, add `PI_TUI_NATIVE=0` to `env`. For Tern, leave that variable unset. The configuration pins `default`, `tiny`, and `smol` to local models and disables retry fallback. The project, HOME, and agent directory are fresh. Do not copy user auth or plugin state.

5. Wait for startup. If OMP opens setup, press Ctrl+C to leave setup. Wait one second, then click `.tv-input` to focus the terminal. The first input immediately after setup can otherwise disappear.
6. For each scenario below, run `bun "$H" "$VERIFY_RUN_DIR" <scenario>` to paste its input, then `$C key Enter` to submit. The helper sends literal bracketed-paste delimiters, preserving multiline input. For `fence`, first choose **Paste inline** in OMP's paste dialog with Down, Down, Enter, wait half a second, then submit with Enter. Do not choose **Attach as local file**.

   | Scenario | Expected panel and request evidence |
   |---|---|
   | `mistakes` | `Checking…`, then the prompt with marked changes across the full width and `esc` over the bottom-right corner; hovering the last change shows `hear → hearing.` and its reason. One tiny request. The 1.2-second provider delay permits a checking screenshot. |
   | `correct` | `No mistakes`; one tiny request. This also creates a saved main session before `/btw`. |
   | `over` | `Not checked: over 300 tokens`; no tiny request. |
   | `fence` | `it not` struck through before `It doesn't work.`, one `[code block, 500 lines]` line, and the pattern line; one tiny request with `[[COACH_1]]` and no `const value` code. |
   | `btw` | The coach correction and `Local Side question answer.` coexist; exactly one tiny request for `why it not work?`. |
   | `model` | No English coach panel and no tiny request. |

   Wait for each completed outcome before sending the next scenario. Capture a shot and tree for every scenario. In classic, `$C expect '"<expected text>"'` checks grid text when the tree has no terminal contents. Pair screenshots with `requests.jsonl` and the saved session JSONL. Record request indices before and after each submission, rather than counting the entire file.

7. On the long correction, check that the panel stays above the composer and within the pane width. In Tern, inspect `.sf-list-scroll` geometry, hover `[data-role="omp-tools.english-coach.body"]`, and run `$C wheel 0 600`. Capture the last mistake, `I look forward to hearing`, after scrolling. The capped body must not grow. In classic, the panel must end with `… N more lines` and leave the editor visible.
8. Convert PNGs to lossless WebP and inspect them as the parent skill requires. Record each feature ID, renderer, command, observed state, and evidence path in `notes.md`. Stop the isolated Tern instance through `tern-isolated stop` and stop only the provider PID this run started. Preserve transcripts and captures.

## Gotchas

- Tern's scenario parser does not decode JSON `\u001b` escapes. The input helper emits actual ESC bytes. Plain `type` with embedded newlines submits separate prompts and invalidates the fenced-paste check.
- Repetitive synthetic replies can trigger `completeSimple` stall retries. The fixture uses distinct mistakes so the long-panel scenario tests layout instead of retry behavior.
- Side question startup may make auxiliary skill-hint requests on `smol`. They remain local. Count coach requests on the `tiny` model separately from `side` requests.
- The local provider ignores the real semantic task. It cannot prove real tiny-model correction quality. A smoke also covers only one real eager/deferred startup order; the input-handler tests cover the two explicit entry-point orders. Keep both proof gaps named in the result.
