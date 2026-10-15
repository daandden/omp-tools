# Code host: GitHub

This repo's remote and its PRs live on GitHub. Skills run every Code host operation below through the `gh` CLI, inside a clone of the repo. Pushes and local history stay with git.

- Host: GitHub (`github.com`)
- Repo: `daandden/omp-tools`
- Tool: the `gh` CLI
- Check: `gh auth status`
- Review reference in commit titles: `(#<number>)`

## Operations

Each skill looks up an operation by its id. A row that says `unsupported` means that the tool cannot do it.

- `default-branch`: `gh repo view --json defaultBranchRef`
- `list-prs`: `gh pr list --repo daandden/omp-tools --state open --json number,url,headRefName,baseRefName`. Add `--head <branch> --base <base>` to find the PR for one branch.
- `create-pr`: `gh pr create --base <base> --head <branch> --title <title> --body-file <absolute-body-path>`. Leave out `--draft`.
- `edit-pr`: `gh pr edit <pr> --title <title> --body-file <absolute-body-path>`
- `retarget-pr`: `gh pr edit <pr> --base <branch>`
- `read-pr`: `gh pr view <pr> --repo daandden/omp-tools --json number,url,title,body,author,createdAt,labels,isDraft,state,headRefName,headRefOid,baseRefName,baseRefOid,mergeStateStatus,reviewDecision,statusCheckRollup,mergedAt,mergeCommit,autoMergeRequest,closingIssuesReferences,comments,reviews`. The PR can merge when `mergeStateStatus` is `CLEAN`. A reviewer requests changes when `reviewDecision` is `CHANGES_REQUESTED`. The PR merged when `mergedAt` is set or `state` is `MERGED`.
- `mark-ready`: `gh pr ready <pr>`
- `required-checks`: `gh pr checks <pr> --repo daandden/omp-tools --required`
- `watch-checks`: `gh pr checks <pr> --repo daandden/omp-tools --required --watch`
- `ci-logs`: `gh run view <run-id> --log-failed`
- `rerun-ci`: `gh run rerun <run-id>`
- `review-threads`: `gh api graphql` on the PR's `reviewThreads`, with the owner, name, and PR number as variables. Read `id`, `isResolved`, and each comment's `id`, `databaseId`, `path`, `body`, `author`, and `commit`. Follow the thread and comment cursors to the last page.
- `reply-thread`: `gh api --method POST "repos/daandden/omp-tools/pulls/<pr>/comments/<comment-database-id>/replies" --input <payload.json>`, where the payload is `{"body": "..."}`.
- `resolve-thread`: `gh api graphql` with the `resolveReviewThread` mutation and the thread `id`.
- `comment-pr`: `gh pr comment <pr> --body-file <absolute-body-path>`
- `update-branch`: `gh pr update-branch <pr>`. Leave out `--rebase`.
- `merge-methods`: `gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed`
- `merge-pr`: `gh pr merge <pr> --squash --match-head-commit <head-sha>`, or `--merge` or `--rebase` in place of `--squash`.
- `auto-merge`: arm with `gh pr merge <pr> --auto --squash --match-head-commit <head-sha>` (same method flags as `merge-pr`). Disarm with `gh pr merge <pr> --disable-auto`.
- `set-secret`: `gh secret set <NAME>`, with the value on standard input.
- `set-variable`: `gh variable set <NAME>`, with the value on standard input.
