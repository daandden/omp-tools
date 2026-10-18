---
name: verify-omp-tools
description: Live proof for the omp-tools OMP plugin. Drives a fresh OMP session inside a headless Tern window (Tern views) or with PI_TUI_NATIVE=0 (classic text TUI), plus OMP RPC mode for checks that need no screen. Surfaces are the ask picker, the Picker btw, /btw Side questions, generate_image, the Advisor wake, and the Picker release. Use it for any change to registration, the picker, Side questions, tool cards, or extension event handling.
---

# Verify omp-tools

omp-tools is an OMP plugin, not an app with its own process. Proof means a fresh OMP session that loads this checkout, driven as a user would. The harness is a headless Tern window: `tern serve` runs it, and `tern ctl` types, presses keys, clicks CSS selectors, and takes shots (PNG plus a layout JSON). RPC mode (`omp --mode rpc`) covers checks that need no screen.

Read `features/README.md` for the conventions, then the feature file for the surface you changed.

## Run entry

Resolve Scratch through `skill://vstack-tmp` at the top level, or use the Scratch dir from your prompt. Pick a run id and create the entry:

```sh
RUN_ID=$(date +%Y%m%d-%H%M%S)
VERIFY_RUN_DIR="<Scratch dir>/verify/omp-tools-$RUN_ID"
mkdir -p "$VERIFY_RUN_DIR/data"
SOCK="/tmp/verify-omp-tools-$RUN_ID.sock"
printf 'advisor:\n  enabled: false\n' > "$VERIFY_RUN_DIR/smoke-config.yml"
```

`smoke-config.yml` turns the core advisor off for every session this run starts. The user's own config can turn it on, and then its cards start Advisor wakes in the middle of other drives.

Shots, notes, and copied session lines go at the top level of `$VERIFY_RUN_DIR`. OMP session dirs go in `$VERIFY_RUN_DIR/data/`. A session dir holds one `<timestamp>_<id>.jsonl` transcript per session, and a folder of the same name beside it holds that session's `SideQuestion-*.jsonl` and `__advisor*.jsonl` files.

## Doctor

Run these read-only checks before launch, on each fresh OMP session, and whenever anything looks off. Stop and report on any failure.

1. `omp --version` and `tern --version` both print a version.
2. `ls -la ~/.omp/plugins/node_modules/omp-tools` points at this checkout (`git rev-parse --show-toplevel`). If it points elsewhere, OMP loads other code: stop and report. Do not relink; the link is the user's global state.
3. `bun run check` passes (it warns when the installed SDK types differ from `omp --version`; a warning is fine).
4. The socket matches the phase of the run. Before launch, `test -S "$SOCK"` fails, so no other run owns the socket. After this run starts Tern, `tern ctl --control "$SOCK" tree` exits 0 and prints `"ok":true`, so the run's own instance still responds.
5. A model with working credentials exists. The cheap default is `anthropic/claude-haiku-5-5`; Codex paths use `openai-codex/gpt-5.6-luna`.

For the isolated launch guard alone, no OMP session runs. Check the Tern version, `lsof`, `bun run check`, and the socket phase instead. The plugin-link and model-credential checks apply only when the drive starts OMP.

## Launch

For the default headless check, keep the user's Tern configuration. Start the window as a long-lived service (bash tool with a unique `name`, `ready.log` = `serving`, `cwd` = the checkout):

```sh
tern serve --control "$SOCK" --out "$VERIFY_RUN_DIR"
```

Shots land in `$VERIFY_RUN_DIR/serve/<name>.png` and `.layout.json`. Then size the window and start OMP in it. The inner command is one quoted argument, so it is double-quoted inside single quotes:

```sh
C="tern ctl --control $SOCK"
$C size 1400 900
$C run "\"omp --model anthropic/claude-haiku-5-5 --config $VERIFY_RUN_DIR/smoke-config.yml --session-dir $VERIFY_RUN_DIR/data/sessions\""
sleep 12
```

For the classic text TUI, prefix the inner command with `env PI_TUI_NATIVE=0 `. To start OMP in another directory, wrap the inner command in `sh -c 'cd <dir> && exec omp …'`. A new OMP session is needed after every code change; `$C type '"/quit"'` then `$C key Enter` ends the current one, and the next `$C run` starts another. A feature that needs other settings (for example `ask.timeout`) passes its own `--config` file, which also holds the `advisor:` lines.

### Isolated starts and native windows

For every start with a fresh config dir, use `helpers/tern-isolated`. This is the only fresh-config launcher, for both `tern serve` and native `tern --control` windows. Native windows are allowed when a check needs one, such as clipboard or paste.

The helper assigns its own `TERN_CONFIG_DIR` and `TERN_DAEMON_SOCKET` and clears the calling pane's routing variables. Before Tern starts, it writes `omp/state.json` with the state from **Not Now**. Without that state, a native window shows "Tern is better with omp. Install it?" on top of the user's screen. Tern 0.9.4 with omp on `PATH` instead shows "Let Tern keep omp up to date?". A shot does not show native alerts.

Use a new `$VERIFY_RUN_DIR` for each instance. Set `V` to this skill's absolute directory plus `/helpers/tern-isolated`:

```sh
V="<directory of this SKILL.md>/helpers/tern-isolated"
"$V" start "$VERIFY_RUN_DIR" serve
# For a native window instead:
# "$V" start "$VERIFY_RUN_DIR" window "$VERIFY_RUN_DIR"
SOCK="$(cat "$VERIFY_RUN_DIR/tern/sock-dir")/ctl.sock"
C="tern ctl --control $SOCK"
sleep 5
"$V" ctl "$VERIFY_RUN_DIR" system
```

Require `"dialogs":[]` before the drive. The config starts with only the seeded omp state and has none of the user's Tern plugins or settings. Use the default headless check for proof that depends on those.

Logs and pids stay in `$VERIFY_RUN_DIR/tern/`. Sockets live in a short `/tmp/omp-tools-tern.*` directory because macOS limits Unix socket paths to 104 bytes. Headless shots stay in `$VERIFY_RUN_DIR/serve/`. For native shots, use the paths returned by `$C shot <name>`.

For the launch guard itself, start a native window on an empty run dir. After five seconds, save `system` output with `"dialogs":[]`. Save the window and daemon pids. Run `"$V" stop "$VERIFY_RUN_DIR"`. Verify that both pids exited and no process names the run's socket directory.

## Drive

- Type text: `$C type '"<text>"'` (the inner double quotes keep spaces). Submit: `$C key Enter`.
- Keys: `$C key Escape`, `$C key t`, `$C key '?'`, `$C key Tab`, `$C key ctrl+o` (expands a folded tool card).
- Click: `$C click '<css selector>'` and `$C dblclick '<css selector>'`. The selector parser takes descendant and `:nth-child` selectors. It rejects `~` and `:has`. Examples: `.sf-section-head` for a collapsible section head, `.sf-list-slot .sf-act:nth-child(3)` for the second option row of the picker (child 1 is the question).
- Inspect: `$C tree` prints the visible element tree with text as JSON. Search it for visible strings instead of reading pixels.
- Wait by polling `$C tree` for the string that marks the state (for example `to cancel` while a Side answer runs), or with `sleep`. Model turns take 10 to 30 seconds with Haiku. A shot taken too early shows a running state, not a result.

RPC drive for checks without a screen: spawn `omp --mode rpc --model <m> --config "$VERIFY_RUN_DIR/smoke-config.yml" --session-dir "$VERIFY_RUN_DIR/data/rpc"` with the checkout as cwd, write `{"id":"p1","type":"prompt","message":"..."}` lines to stdin, and wait for the `{"type":"prompt_result","id":"p1"}` line on stdout. A turn that starts later (an Advisor wake) ends with an `{"type":"agent_end"}` line.

## Helpers

- `helpers/side-question-probe.ts` is the throwaway extension for the `btw-tools` and `btw-agent` checks in `features/side-question-btw.md`. Copy it to `<checkout>/extensions/verify-side-question-probe.ts`, because a file outside the plugin cannot import `@oh-my-pi/*`. Run it with the RPC drive plus `--no-extensions -e <checkout>/extensions/verify-side-question-probe.ts`, with `VERIFY_PROBE=tools` or `VERIFY_PROBE=agent` and `VERIFY_PROBE_LOG=$VERIFY_RUN_DIR/<check>.json` in the environment. Delete the copy after the drive.

## Evidence

- Take a shot at each step: `$C shot <feature>-<step>`. Convert each PNG to lossless WebP in eval and read the WebP:

  ```js
  await Bun.write(out, await new Bun.Image(await Bun.file(pngPath).bytes()).webp({ lossless: true }).bytes());
  ```

  `out` is the PNG path with `.webp`. Do not resize.
- Pair each visible result with a second view of state: the session JSONL under `$VERIFY_RUN_DIR/data/<session dir>/` (read it with `jq`), files on disk, or `$C tree` text.
- Write `$VERIFY_RUN_DIR/notes.md`: feature ID, entry point, command, observed result, and evidence path for every check.

## Cleanup

Stop only what this run started. For an isolated instance, use the helper instead of `$C quit`:

```sh
"$V" stop "$VERIFY_RUN_DIR"
```

It stops the window and its daemon, checks for leftover processes of the instance, and removes its config and sockets. It keeps logs, pids, shots, and OMP session data. If start fails, use the same stop command to clean up the partial instance.

For the default headless service:

```sh
$C type '"/quit"'; $C key Enter; sleep 2
$C quit
```

Then stop the named service if it is still listed. Delete `$VERIFY_RUN_DIR/data/` only when the notes do not cite files in it; keep the shots and `notes.md`. Remove any probe files the run created (for example `/tmp/btw-probe*.txt`) and every throwaway file the run copied into `extensions/`. Never kill `tern` or `omp` processes by name: the user's own sessions run the same binaries.
