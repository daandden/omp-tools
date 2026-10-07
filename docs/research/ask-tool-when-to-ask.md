# When to ask: ask-tool guidance in other coding-agent harnesses

Researched 2026-10-08. The question: what do other harnesses tell the model about **when** to use their ask/question tool (and when not to), and how do their option-count, batching, `Other`, and recommended-option rules compare with this plugin's `ask` description (`extensions/flexible-ask.md`)?

Snapshots read (quotes below are verbatim from these):

- **OMP native `ask`**: `@oh-my-pi/pi-coding-agent@18.8.1`, `src/prompts/tools/ask.md` and `src/tools/ask.ts` (npm tarball).
- **opencode**: [`sst/opencode@b1fe25ab`](https://github.com/sst/opencode/tree/b1fe25ab5ecc9f9bc911a8a2e6a51565cc764322) (`dev`, 2026-10-07).
- **Codex CLI**: [`openai/codex@622e9e36`](https://github.com/openai/codex/tree/622e9e36962105af50b9c250902e8b8c66a950d8) (2026-10-07).
- **pi**: [`badlogic/pi-mono@f10993bc`](https://github.com/badlogic/pi-mono/tree/f10993bc7f28145df1375f3ff39c7f5c4cfc05f0) (2026-10-07).
- **Claude Code**: official docs at [code.claude.com](https://code.claude.com/docs/en/agent-sdk/user-input) (fetched 2026-10-08), and the model-facing text from [`Piebald-AI/claude-code-system-prompts@9b3512fe`](https://github.com/Piebald-AI/claude-code-system-prompts/tree/9b3512fe8a0746aa2c3f00b416dc316a838b5d27/system-prompts) (2026-10-06), a prompt extraction repo. Claude Code is closed source, so these quotes are **[SECONDARY]**. Each file states the Claude Code version it came from.

Claims I did not observe directly are marked **[INFERENCE]**.

## Comparison

| | Where the when-to-ask rule lives | Default when not blocked | Option count | Questions per call | `Other` | Recommended option |
|---|---|---|---|---|---|---|
| **This plugin** | Tool description | Act; on decisions not left to the user, pick the conservative/standard option and state it | No fixed count | Batch related questions | UI adds it; model must not | `recommended` index; UI adds " (Recommended)" |
| **OMP native** | Tool description | Act; pick the conservative/standard option and state it | 2–5 | Batch related questions | UI adds it; model must not | `recommended` index; UI adds " (Recommended)" |
| **Claude Code** | Tool description, plus plan-mode and proactivity reminders | Pick the obvious option, mention it, proceed | 2–4 (enforced) | 1–4 | UI adds it; model must not add `Other` or `Skip` | First option, label suffixed " (Recommended)" |
| **Codex CLI** | Collaboration-mode prompts (`default.md`, `plan.md`) | Default mode: "strongly prefer making reasonable assumptions and executing" | Schema says 2–3; plan prompt says 2–4 | 1–3, "Prefer 1" | Client adds it; model must not | First option, label suffixed "(Recommended)" |
| **opencode** | Plan-mode prompts and per-model system prompts; the tool description gives none | Depends on the model prompt; only `codex.txt` says "do the work without asking" | No rule | Array accepted; no batching rule | On by default; model must not add it | First option, label suffixed "(Recommended)" |
| **pi** | No native tool. The first-party example extensions say only when to use it | Nothing stated | No rule | `questionnaire` takes several | Always on (`question`); `allowOther` defaults to true (`questionnaire`) | No convention |

## This plugin and OMP native

This plugin (`extensions/flexible-ask.md`):

> Ask only for materially different tradeoffs the user must decide, or for decisions a skill, workflow, or instruction leaves to the user (interview rounds, approvals, confirmations). Default: act using code/config/docs/history and conventions. Several viable choices on a decision not left to the user: pick conservative/standard, proceed, state choice.
>
> - Batch related questions; as many concise, distinct options as there are materially different tradeoffs — no fixed count; short labels, tradeoffs in `description`.

OMP native, 18.8.1 (unchanged since 18.4.4):

> Ask only for materially different tradeoffs the user must decide. Default: act using code/config/docs/history and conventions. Several viable choices: pick conservative/standard, proceed, state choice.
>
> - Batch related questions; 2–5 distinct options each; short labels, tradeoffs in `description`.

The native schema also describes three fields: `header` "display chip", `preview` "rich preview", and `recommended` "0-based default index". This plugin's schema has no descriptions on those fields.

## Claude Code: `AskUserQuestion`

The tool description, from `tool-description-askuserquestion.md` (ccVersion 2.1.154) **[SECONDARY]**:

> Use this tool only when you are blocked on a decision that is genuinely the user's to make: one you cannot resolve from the request, the code, or sensible defaults.

The decision guidance appended to it, from `tool-description-askuserquestion-decision-guidance.md` (2.1.173) **[SECONDARY]**:

> Reserve this for decisions where the user's answer changes what you do next — not for choices with a conventional default or facts you can verify in the codebase yourself. In those cases pick the obvious option, mention it in your response, and proceed.

The plan-mode note in the description **[SECONDARY]**:

> Once in plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?", "Should I proceed?", or otherwise reference "the plan" in questions — the user cannot see the plan until you call ${EXIT_PLAN_MODE_TOOL_NAME} for approval.

A user-chosen proactivity level changes the rule. These reminders are from ccVersion 2.1.290 **[SECONDARY]**:

- Low:
  > use ${ASK_USER_QUESTION_TOOL_NAME} whenever intent, scope, or approach has more than one reasonable reading … Skip both for a request that is small and unambiguous
- Medium:
  > Use ${ASK_USER_QUESTION_TOOL_NAME} only when you genuinely cannot proceed without an answer — a decision that is the user's to make and that you cannot resolve from the request, the code, or sensible defaults. Otherwise make the reasonable call, state it, and continue.
- High:
  > Do not ask questions (including via ${ASK_USER_QUESTION_TOOL_NAME}) unless the request is truly ambiguous and proceeding under any reading would waste significant work.

If a call has a question with fewer than 2 options, it is rejected and the model receives this, from `system-reminder-askuserquestion-minimum-options-validation.md` (2.1.216) **[SECONDARY]**:

> Do not retry this call and do not invent a filler second option. Instead, state the one path you were going to offer as the approach you are taking, then continue with the task. … Ask a question only when the person has at least two genuinely distinct choices.

Limits, from the official docs (Agent SDK [user input](https://code.claude.com/docs/en/agent-sdk/user-input)) **[PRIMARY]**: each call supports "1-4 questions with 2-4 options each", and `header` is at most 12 characters. The tool is not available in subagents spawned with the Agent tool.

## Codex CLI: `request_user_input`

The tool description, from `codex-rs/core/src/tools/handlers/request_user_input_spec.rs`:

> Request user input for one to three short questions and wait for the response. This tool is only available in {allowed_modes}.

The schema descriptions: `questions` reads "Prefer 1 and do not exceed 3", and `options` reads:

> Provide 2-3 mutually exclusive choices. Put the recommended option first and suffix its label with "(Recommended)". Do not include an "Other" option in this list; the client will add a free-form "Other" option automatically.

The tool is available only in Plan mode. Default mode gets it only behind the under-development feature `default_mode_request_user_input`, which is off by default.

The Default-mode prompt, `codex-rs/collaboration-mode-templates/templates/default.md`:

> In Default mode, strongly prefer making reasonable assumptions and executing the user's request rather than stopping to ask questions.
>
> Use the `request_user_input` tool only for optional questions where the answer would materially improve the quality of the work.
>
> If `request_user_input` returns no answers, continue with best judgment instead of asking again or treating the turn as blocked.
>
> Never use the `request_user_input` tool for permission requests or permission-related escalations.
>
> If explicit user input is required for another reason before progress can safely continue, do not use the `request_user_input` tool. Ask the user directly with one concise plain-text question instead. Never write a multiple choice question as a textual assistant message.

The Plan-mode prompt, `templates/plan.md` (excerpts):

> Do not ask questions that can be answered from the repo or system (for example, "where is this struct?" or "which UI component should we use?" when exploration can make it clear). Only ask once you have exhausted reasonable non-mutating exploration.

> You SHOULD ask many questions, but each question must:
>
> * materially change the spec/plan, OR
> * confirm/lock an assumption, OR
> * choose between meaningful tradeoffs.
> * not be answerable by non-mutating commands.

> 2. **Preferences/tradeoffs** (not discoverable): ask early.
>    * Provide 2–4 mutually exclusive options + a recommended default.
>    * If unanswered, proceed with the recommended option and record it as an assumption in the final plan.

## opencode: `question`

The tool description, `packages/opencode/src/tool/question.txt`, says when the tool is useful but never when not to ask:

> Use this tool when you need to ask the user questions during execution. This allows you to:
> 1. Gather user preferences or requirements
> 2. Clarify ambiguous instructions
> 3. Get decisions on implementation choices as you work
> 4. Offer choices to the user about what direction to take.

Its usage notes say not to add "Other" or catch-all options, and to put a recommended option first with "(Recommended)". The schema limits `label` to "1-5 words" and `header` to "max 30 chars", and sets no option count.

The plan-mode prompts lean toward asking. From `session/prompt/plan-mode.txt`:

> NOTE: At any point in time through this workflow you should feel free to ask the user questions or clarifications. Don't make large assumptions about user intent.

> Do NOT use question tool to ask "Is this plan okay?" - that's what plan_exit does.

Only one per-model system prompt has a default-to-act rule: `session/prompt/codex.txt`, lines 43–49.

> - Default: do the work without asking questions. Treat short tasks as sufficient direction; infer missing details by reading the codebase and following existing conventions.
> - Questions: only ask when you are truly blocked after checking relevant context AND you cannot safely pick a reasonable default. This usually means one of:
>   * The request is ambiguous in a way that materially changes the result and you cannot disambiguate by reading the repo.
>   * The action is destructive/irreversible, touches production, or changes billing/security posture.
>   * You need a secret/credential/value that cannot be inferred (API key, account id, etc.).
> - If you must ask: do all non-blocked work first, then ask exactly one targeted question, include your recommended default, and state what would change based on the answer.
> - Never ask permission questions like "Should I proceed?" or "Do you want me to run tests?"; proceed with the most reasonable option and mention what you did.

The other model prompts are looser. `gpt.txt`: "if unclear, ask one short question instead of guessing". `kimi.txt`: "Ask the user for clarification if there is anything unclear". `anthropic.txt` has no asking rule at all.

Availability: the tool exists only on the `app`, `cli`, and `desktop` clients, or with `enableQuestionTool`. The `build` and `plan` agents allow it; other agents deny it by default (`agent.ts`).

## pi

pi has no native ask tool. `packages/coding-agent/src/core/tools/` holds bash, edit, find, grep, ls, powershell, read, and write. The system prompt (`src/core/system-prompt.ts`) never says when to ask the user or when not to.

The first-party example extensions are opt-in and set no `promptGuidelines`.

- `examples/extensions/question.ts`:
  > Ask the user a question and let them pick from options. Use when you need user input to proceed.
- `examples/extensions/questionnaire.ts`:
  > Ask the user one or more questions. Use for clarifying requirements, getting preferences, or confirming decisions. For single questions, shows a simple option list. For multiple questions, shows a tab-based interface.
- `examples/extensions/plan-mode/index.ts` adds `questionnaire` to its tool allowlist and injects:
  > Ask clarifying questions using the questionnaire tool.

None of them limits the option count or has a recommended-option convention.

## Takeaways for this plugin

- **The default to act is common ground.** Claude Code ("pick the obvious option, mention it in your response, and proceed"), Codex Default mode, and opencode's `codex.txt` all say what this plugin says: act on conventions, and state the choice. Only pi and opencode's tool description leave it out.
- **Nobody else carves out "decisions left to the user".** No harness gives skills, workflows, or instructions an exception like this plugin's "(interview rounds, approvals, confirmations)". The nearest are Claude Code's general tool description ("a decision that is genuinely the user's to make"), which applies in every mode, and Codex Plan mode ("You SHOULD ask many questions", each changing the plan, locking an assumption, or choosing a tradeoff). Neither names skills, workflows, or instructions as a source of user-owned decisions. **[INFERENCE]** This carve-out is unique to this plugin.
- **"No fixed count" is an outlier.** Claude Code enforces 2–4 options, Codex says 2–3 (or 2–4 in plan mode), and OMP native says 2–5. opencode and pi set no limit, but they don't say "as many as there are tradeoffs" either. Claude Code and Codex both forbid filler options, as this plugin's "materially different tradeoffs" does.
- **Plan approval and permission questions are routed elsewhere; confirmations in general are not.** Claude Code and opencode send "Is this plan okay?" / "Should I proceed?" to a plan-exit tool, and Codex forbids permission requests through the tool. Confirming decisions through the tool is allowed elsewhere, though: Codex Plan mode asks questions that "confirm/lock an assumption", and pi's `questionnaire` is described as being for "confirming decisions". This plugin lists "approvals, confirmations" as reasons to ask. Its confirmations match Codex and pi. Its approvals differ from the others only where they mean plan approval or permission to proceed, which OMP has no separate plan-exit tool for in this flow **[INFERENCE]**.
- **No answer means continue.** Codex says what to do then: continue with best judgment, or with the recommended option in plan mode. This plugin's description says nothing about it; the picker's `ask.timeout` picks the recommended option instead.
- **Batching differs.** This plugin says "Batch related questions". Codex says "Prefer 1", and opencode's `codex.txt` says "ask exactly one targeted question".

**Applied 2026-10-08.** This plugin dropped the "decisions left to the user" exception and the "as many … as there are materially different tradeoffs — no fixed count" wording. Its description now matches OMP native except for one line, which states no option count: "Batch related questions; distinct options; short labels, tradeoffs in `description`." The table and quotes above show the description as it was before this change.
