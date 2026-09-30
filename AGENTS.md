# Repository Guidelines

## Project Overview

`omp-tools` is an Oh My Pi (OMP) plugin. It shadows the native `ask` tool to
change model-facing option-count and when-to-ask guidance and show questions
as full Markdown in the interactive picker; outside the TUI it delegates to
native `ask`. It ships an always-apply rule that routes all user input through
`ask`. It replaces native `generate_image` with a tool that calls the Codex
Images endpoint directly with Codex OAuth. It also wakes the agent for advisor
concerns that arrive after its final answer.

## Architecture & Data Flow

- `package.json` registers `extensions/flexible-ask.ts`,
  `extensions/generate-image.ts`, and `extensions/advisor-concern-wake.ts` as
  entry points. OMP also loads `rules/*.md` and `skills/*/SKILL.md` from the
  plugin root (the `omp-plugins` discovery provider, priority 90); a same-named
  rule in `~/.omp/agent/rules/` shadows it.
- The extension registers a shadow `ask` description/schema. In `ctx.mode ===
  "tui"` with `ctx.hasUI`, it shows its own picker (`extensions/ask-dialog.ts`)
  through `ctx.ui.custom` and formats results with native wording and details.
  The native dialog cannot be restyled from an extension: `ctx.invokeTool` runs
  it with the session UI, not the wrapper's.
- Otherwise (RPC/ACP/print, subagents), and for inputs the native tool rejects
  (reserved or duplicate labels, duplicate ids), it delegates to
  `ctx.invokeTool(params, { signal, onUpdate })` so native errors and fallbacks
  apply unchanged.
- Preserve `approval: "read"`, `concurrency: "exclusive"`, cancellation
  (`ctx.abort()` plus `ToolAbortError`), `ask.timeout` auto-selection,
  `ask.notify`, and the explicit error when native ask delegation is unavailable.
- Keep native `ask` enabled. Replace legacy `omp-ask` installations rather than
  loading duplicate wrappers.
- `generate_image` posts to `chatgpt.com/backend-api/codex/images/generations`
  (no references) or `/edits` with Codex's exact body and headers, using the
  `openai-codex` credential from `ctx.modelRegistry.getApiKeyForProvider`; no
  other provider, no fallback to native. Native `generate_image` is
  settings-gated and installed after extensions, skipping taken names, so the
  plugin tool wins even when `generate_image.enabled` is true. The schema stays
  open because OMP's argument validator deletes unknown keys from closed
  schemas (`pi-ai` `coerceArgsFromIssues`); `execute` rejects them instead.
- Keep the request guards: 64 MB body cap (larger bodies get false
  `moderation_blocked` or silently dropped references), the 0-image-token
  dropped-references check on edits, and the 5-minute timeout combined with the
  tool signal. The result is lossless WebP in `content` only, never
  `details.images` (the TUI would show it twice).

## Important Files

- `extensions/flexible-ask.ts`: tool registration, TUI/native routing, and
  native-shaped result `details`.
- `extensions/ask-result.ts`: the labeled model-facing answer text (the model
  sees only this text, never `details`).
- `extensions/ask-dialog.ts`: Markdown picker mirroring the native pi-tui
  `AskDialogComponent` (tabs, Submit review, multi-select, Other, notes,
  timeout); diff it against upstream when OMP changes the native dialog.
- `extensions/ask-editor.ts`: `Other`/note text box. Wraps the main prompt's
  `CustomEditor` with the host's suggestion provider (borrowed in
  `flexible-ask.ts` through `ctx.ui.addAutocompleteProvider`) for references
  only: `/` suggests file commands (names from `discoverSlashCommands` in
  `flexible-ask.ts`) and skills without the `skill:` prefix, found by querying
  the host provider with synthetic `/<token>` and `/skill:<token>` lines and
  gated to name or hyphen-segment prefixes; built-in and extension commands are
  dropped, `#` prompt actions are hidden,
  completion `onApplied` side effects are dropped, and `trySyncSlashCompletion`
  is not forwarded, so nothing typed runs. It subclasses
  `HookEditorComponent` only so the host routes the external-editor key to it
  while it holds focus; the base editor is dropped, and `pasteText` is hidden so
  the host does not claim the image-paste key.
- `extensions/ask-images.ts`: clipboard and path image loading for the picker's
  editors, using the host's clipboard/image-loading helpers.
- `extensions/flexible-ask.md`: static model-facing description; keep aligned
  with upstream `packages/coding-agent/src/prompts/tools/ask.md` except the
  option count (no fixed count instead of 2–5) and user-owned decisions (ask
  for decisions a skill, workflow, or instruction leaves to the user; never
  default-pick those).
- `rules/use-ask-for-user-input.md`: always-apply rule; all user input goes
  through `ask`, overriding question formats skills prescribe.
- `extensions/assets.d.ts`: ambient typing for the static Markdown import.
- `extensions/generate-image.ts`: `generate_image` registration, argument
  checks, result text, and saving to `$TMPDIR/omp-image-<id>.webp`.
- `extensions/generate-image.md`: static model-facing tool description.
- `extensions/codex-images.ts`: Codex Images request body, headers (account id
  and residency from the token's JWT claims, reimplemented because
  `@oh-my-pi/pi-catalog` is not served), guards, and error text.
- `extensions/reference-images.ts`: reference images from absolute paths or the
  active branch (`getBranch()`, including native `details.images`); JPEG and
  WebP unchanged, everything else lossless WebP.
- `skills/generate-image/SKILL.md`: how the model should prompt, edit, pass
  references, and iterate. `prompt-patterns.md` beside it holds templates and
  before/after examples; `docs/research/image-prompting-*.md` holds the cited
  research behind both.
- `test/`: `bun test` behavior tests for `generate_image` through `execute`
  with a stubbed `fetch`.
- `extensions/advisor-concern-wake.ts`: listens for preserved `advisor` cards
  (`message_end`, `customType: "advisor"`) with `concern` notes and, once the
  session is idle, sends them with `deliverAs: "aside"`. Keep `aside`: its idle
  branch in core `sendCustomMessage` folds into context under plan mode or an
  active user interrupt (`autoResumeSuppressed`) and defers for ACP clients; a
  steer with `triggerTurn` only checks ACP. Local guards: queued messages, a
  per-prompt wake cap (reset on `before_agent_start`, which fires for user
  prompts in every mode but not for the extension's agent-initiated turn;
  `input` is TUI-only), and dropping held notes on `session_before_switch` /
  `_branch` / `_tree` (the runner and its timers outlive `/new`, and core's
  aside generation check runs at send time); the after-events reset the cap.
  `advisor.immuneTurns` is core-private and not applied. Disabled when
  `ctx.mode` is `"print"` or `"json"`: print mode enters a preserve-only
  headless advisor drain after the last prompt (`prepareForHeadlessAdvisorDrain`),
  prints the final text, then disposes, so a woken turn would never be emitted.
  `advisor-concern-wake.md` holds the wake prompt.
- `package.json`: OMP discovery, scripts, and SDK dependency pins.
- `tsconfig.json`: strict, no-emit TypeScript configuration for extensions.
- `README.md` and `CHANGELOG.md`: update when changing user-visible behavior.

## Development Commands

Run from the repository root:

```sh
bun install --ignore-scripts
bun run check
bun test
bun run update
omp plugin link "$PWD"
```

`bun run check` runs `scripts/check-sdk-version.ts` (warns when installed SDK
types differ from `omp --version`) and then `tsgo --noEmit`. `bun run update`
runs `scripts/update-sdk.ts`: `omp update`, `bun update --latest` for both SDK
packages, restores their `"latest"` specifiers, reinstalls, and checks. Both
scripts run omp through `scripts/host-env.ts`: `bun run` prepends
`node_modules/.bin`, where the SDK links its `cli.js` as `omp`, and Bun Shell
ignores `.env()` PATH when resolving commands, so a bare `omp` would hit the
dev dependency instead of the installed binary.

There is no separate build, lint, formatter, or standalone run script. OMP loads
linked source directly. Start a **new OMP session** after linking or editing;
reinstallation is unnecessary for linked edits.

## Code Conventions

Match existing tabs, double quotes, semicolons, and trailing commas. Use camelCase
functions/locals, PascalCase types, and `import type` for SDK types. Keep the
default-exported initializer and initializer-local registration state. Preserve
the extension execute signature `(toolCallId, params, signal, onUpdate, ctx)`.
Return native-shaped async results and propagate failures.

## Runtime and Verification

Use Bun and `bun.lock`. The private package is ESM with ESNext/Preserve modules
and Bundler resolution. SDK packages supply development types. Runtime value
imports of `@oh-my-pi/*` resolve to the host's in-process modules through OMP's
extension specifier shim; in compiled binaries only exported subpaths are served
(`@oh-my-pi/pi-tui`, `/chrome`, `/render`, `/theme`,
`@oh-my-pi/pi-coding-agent`, `/modes/*`, `/tools/*`, `/utils/*`, and the
`@oh-my-pi/pi-utils` root). The root `./*`
wildcard is not served, so never import files such as
`@oh-my-pi/pi-tui/overlays/*`, `/keybinding-matchers`, `/chrome/form-theme`, or
`/prompt/*`; they load a second copy from node_modules and fail. Both SDK packages use
the `"latest"` specifier; `bun.lock` records the resolved version, so update
through `bun run update` to keep types and the installed omp in step.

Run typechecking and `bun test` after code changes; tests cover
`generate_image` only, and there is no repository CI. Registration/ask changes
require a fresh-session OMP smoke; typechecking alone does not exercise host
integration or UI. OMP 18.3.1 was used for the latest fresh-session picker and
rendering smoke; OMP 18.4.4 for the live `generate_image` generate and edit
smoke.

## Agent skills

- Issue tracker: GitHub Issues. See `docs/agents/issue-tracker.md`.
- Triage labels: default vocabulary. See `docs/agents/triage-labels.md`.
- Domain docs: single-context. See `docs/agents/domain.md`.
