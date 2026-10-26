# CI service: GitHub Actions

This repo's builds and checks run on GitHub Actions. Run the CI operations below through the `gh` CLI, inside a clone of the repo. Required PR checks and their status stay in `code-host.md`.

- CI service: GitHub Actions
- Repo: `daandden/omp-tools`
- Tool: the `gh` CLI
- Check: `gh auth status`

## Operations

Each skill looks up an operation by its id. A row that says `unsupported` means that the tool cannot do it.

- `ci-logs`: `gh run view <run-id> --log-failed`
- `rerun-ci`: `gh run rerun <run-id>`
- `set-secret`: `gh secret set <NAME>`, with the value on standard input.
- `set-variable`: `gh variable set <NAME>`, with the value on standard input.
