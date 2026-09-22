# omp-tools

Local OMP adapter for flexible questions. Formerly `omp-ask`.

## `ask`

Replaces the model-facing option-count guidance with “as many concise, distinct
options as there are materially different tradeoffs — no fixed count.” Execution
still delegates to native `ask`: picker UI, timeout, approval tier, and `/tree`
re-answer behavior are retained.

Keep native `ask` enabled for delegation:

```yaml
ask:
  enabled: true
```

## Install

```bash
omp plugin link /Users/vanguyen/work/tries/omp-tools
```

The link uses the working tree directly; edits do not require reinstalling.
Start a **new OMP session** after installation or code changes. Existing sessions
retain their loaded tool definitions.

The renamed plugin replaces the previous `omp-ask` installation. Do not load both
packages or install a second loose copy of the ask extension.

## Development and verification

```bash
bun install --ignore-scripts
bun run check
```

Runtime code uses OMP's injected host API; SDK imports are type-only. Development
types are pinned to OMP 18.1.16. There are currently no automated test files.
Registration changes require a fresh-session OMP smoke check.

A fresh OMP 18.2.8 session verified that the flexible ask description loads and
that the removed custom image tool is absent from the tool registry.
