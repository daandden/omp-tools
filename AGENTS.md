# Repository Guidelines

## Project Overview

`omp-tools` is an Oh My Pi (OMP) plugin that shadows the native `ask` tool. It
changes model-facing option-count guidance and shows questions as full Markdown
in the interactive picker. Outside the TUI it delegates to native `ask`.

## Architecture & Data Flow

- `package.json` registers `extensions/flexible-ask.ts` as its sole entry point.
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

## Important Files

- `extensions/flexible-ask.ts`: tool registration, TUI/native routing, and
  native-shaped result formatting.
- `extensions/ask-dialog.ts`: Markdown picker mirroring the native pi-tui
  `AskDialogComponent` (tabs, Submit review, multi-select, Other, notes,
  timeout); diff it against upstream when OMP changes the native dialog.
- `extensions/ask-images.ts`: clipboard and path image loading for the picker's
  editors, using the host's clipboard/image-loading helpers.
- `extensions/flexible-ask.md`: static model-facing description; keep aligned
  with upstream `packages/coding-agent/src/prompts/tools/ask.md` except the
  option-count caution.
- `extensions/assets.d.ts`: ambient typing for the static Markdown import.
- `package.json`: OMP discovery, scripts, and SDK dependency pins.
- `tsconfig.json`: strict, no-emit TypeScript configuration for extensions.
- `README.md` and `CHANGELOG.md`: update when changing user-visible behavior.

## Development Commands

Run from the repository root:

```sh
bun install --ignore-scripts
bun run check
omp plugin link "$PWD"
```

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
`@oh-my-pi/pi-coding-agent`, `/modes/*`, `/tools/*`), so never import
unexported files such as `@oh-my-pi/pi-tui/overlays/*`. Keep SDK pins aligned
with the host; development types target 18.3.1.

Run typechecking after code changes. There are currently no automated test files
or repository CI. Registration/ask changes require a fresh-session OMP smoke;
typechecking alone does not exercise host integration or UI. OMP 18.3.1 was used
for the latest fresh-session picker and rendering smoke.

## Agent skills

- Issue tracker: GitHub Issues. See `docs/agents/issue-tracker.md`.
- Triage labels: default vocabulary. See `docs/agents/triage-labels.md`.
- Domain docs: single-context. See `docs/agents/domain.md`.
