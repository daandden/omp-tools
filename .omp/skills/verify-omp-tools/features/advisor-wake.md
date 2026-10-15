# Advisor wake

An advisor concern or blocker card that lands after the agent's final answer, with no turn started for it, makes the plugin send one short `advisor-wake` message that starts a turn. The message points at the card and never repeats the note. If the fix changes what the latest complete answer told the user, the final reply is only a Revised answer: that answer again from its first line to its last, in the same form, with the fix in place. Nothing comes before or after it, so it has no heading, label, or line about what changed. A code-only or file-only fix gets a short reply. Per prompt cycle, three checks hold a card back: a repeat of a woken note (check 1), a concern after an Advisor wake that changed no file (check 2), and more than 10 Advisor wakes (check 3).

## Sub-features

- `wake-once` sends exactly one `advisor-wake` message per card, and the message does not contain the note text.
- `wake-revised` answers a concern that a stated fact is wrong with a Revised answer. The intro line, the table, and the closing sentence all come back, with only the fact changed.
- `wake-blocker` gives the same result as `wake-revised` for a blocker card.
- `wake-short` answers a code-only concern, sent after a new user prompt, with a short reply that names the fix.
- `wake-second` answers a second fact concern with a new Revised answer that keeps the first fix. The first concern also asks for a file write, so check 2 lets the second concern through.
- `wake-held` keeps a new concern as a card after an Advisor wake that ran only reads (check 2). The agent gets no new turn.

## How to get to it (user POV)

- Turn the OMP advisor on, ask a question, and wait for the final answer. The advisor posts a concern or blocker card under it, and the Advisor wake starts a turn by itself.
- Proof needs a card on demand. A throwaway extension command posts it, and a `--config` overlay turns the core advisor off so it adds no cards of its own.

## Driving it with tern ctl

Preconditions:

- Doctor in `../SKILL.md` passed.
- `extensions/smoke-advisor.ts` exists in the checkout with this content. A file outside the plugin cannot resolve `@oh-my-pi/*`.

  ```ts
  import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
  import type { AdvisorNote } from "@oh-my-pi/pi-tui/chat/messages";
  import { formatAdvisories } from "./deferred-notes";

  export default function smokeAdvisor(pi: ExtensionAPI): void {
  	pi.registerCommand("smoke-advisor", {
  		description: "Post an advisor card: /smoke-advisor concern|blocker <note>",
  		handler: async args => {
  			const match = /^(concern|blocker)\s+([\s\S]+)$/.exec(args.trim());
  			if (!match) return;
  			const notes: AdvisorNote[] = [
  				{ note: match[2].trim(), severity: match[1] as "concern" | "blocker", advisor: "smoke" },
  			];
  			pi.sendMessage({ customType: "advisor", content: formatAdvisories(notes), display: true, attribution: "agent", details: { notes } });
  		},
  	});
  }
  ```

- `$VERIFY_RUN_DIR/smoke-config.yml` holds `advisor:` and `  enabled: false` on two lines.
- `$VERIFY_RUN_DIR/ws/team.md` holds a `# Team` heading and three lines: `- Alice: role Tech lead, office Lisbon`, `- Bob: role Backend engineer, office Paris`, `- Carol: role Designer, office Oslo`. Keep fixtures out of the checkout.
- The Tern window serves with `cwd` = `$VERIFY_RUN_DIR/ws`, and OMP starts without `--no-extensions`, so the linked plugin loads as it does for a user:

  ```sh
  $C run "\"omp --model anthropic/claude-haiku-5-5 -e <checkout>/extensions/smoke-advisor.ts --config $VERIFY_RUN_DIR/smoke-config.yml --session-dir $VERIFY_RUN_DIR/data/sessions --no-title --no-lsp\""
  ```

Steps for `wake-revised` in the Tern view:

1. Run `$C type '"Read team.md. Who is on the team? Start with one intro line that says how many members the team has, then a Markdown table with columns Name, Role, Office, then one closing sentence on which office has the tech lead."'`.
2. Run `$C key Enter`.
3. Run `sleep 35`.
4. Run `$C shot wake-answer`.
5. Change `Paris` to `Berlin` in `ws/team.md`.
6. Run `$C type "\"/smoke-advisor concern The answer says Bob's office is Paris. That is wrong: team.md now says Bob's office is Berlin.\""`.
7. Run `$C key Enter`.
8. Run `sleep 40`.
9. Run `$C shot wake-revised`.

The chat shows the Advisor card (`CONCERN [smoke]`), an `advisor-wake` card, a `read`, and then the reply. Pass: the reply starts with the first line of the final answer, word for word. The table with Berlin and the closing sentence follow, and nothing comes before or after.

Steps for `wake-held`, in the same session:

1. Run `$C type '"/smoke-advisor concern Carol now works remotely according to HR records; mention remote work for Carol."'`.
2. Run `$C key Enter`.
3. Run `sleep 20`.
4. Run `$C shot wake-held`.

Pass: the card shows and no new turn starts.

The other sub-features use the RPC drive from `../SKILL.md` with the same flags plus `--auto-approve`. Give each run a fresh `ws` directory as `cwd` and its own `--session-dir`. Runs in separate directories can go in parallel.

Steps for `wake-blocker`:

1. Write `team.md` into the fresh `ws` directory.
2. Send the team prompt from `wake-revised`.
3. Wait for its `prompt_result`.
4. Change `Paris` to `Berlin` in `team.md`.
5. Send `/smoke-advisor blocker <the Bob note from wake-revised>` as a prompt. Its `prompt_result` has `agentInvoked: false`.
6. Wait for the next `agent_end`. The Advisor wake turn ends there.

Pass: the same as `wake-revised`.

Steps for `wake-second`:

1. Run steps 1 to 4 of `wake-blocker`.
2. Send `/smoke-advisor concern The answer says Bob's office is Paris. That is wrong: team.md now says Bob's office is Berlin. Also save the corrected roster table to roster.md.` as a prompt.
3. Wait for the next `agent_end`.
4. Change `Oslo` to `Bergen` in `team.md`.
5. Send `/smoke-advisor concern Carol moved: per the latest team.md her office is Bergen, yet the reply still lists Oslo for her.` as a prompt.
6. Wait for the next `agent_end`.

Pass: `roster.md` exists. Each of the two replies passes the `wake-revised` check. The second reply has Berlin and Bergen and no Paris or Oslo.

Steps for `wake-short`:

1. Start a new session in a fresh `ws` directory.
2. Send `Create greet.py with a function greet(name) that returns 'Hello, <name>!'. Then tell me in two or three sentences what you created and how to call it.` as a prompt.
3. Wait for its `prompt_result`.
4. Send `/smoke-advisor concern greet.py has no module docstring. Add a one-line module docstring to greet.py.` as a prompt.
5. Wait for the next `agent_end`.

Pass: the reply names the fix in one or two sentences and restates nothing, and `greet.py` starts with a docstring.

Steps for `wake-once`, the second view of every run:

1. Run `jq -r 'select(.type=="custom_message") | .customType' <session>.jsonl`. It prints `advisor` and then `advisor-wake`, once per card.
2. Run `jq -r 'select(.type=="custom_message" and .customType=="advisor-wake") | .content' <session>.jsonl`. The output does not contain the note.
3. Run `jq -r 'select(.type=="message" and .message.role=="assistant" and .message.stopReason=="stop") | [.message.content[] | select(.type=="text") | .text] | join("")' <session>.jsonl`. The reply of each Advisor wake is the last of these messages after its `advisor-wake` message.

## Gotchas

- The reply of an Advisor wake varies from run to run. Run at least 12 fact-fix Advisor wakes across `wake-revised` and `wake-blocker`, and report the pass count. Expect no failure. One pass does not prove the prompt.
- Send the card only after the final answer lands. A card during a run reaches the live turn and never wakes.
- Two `advisor-wake` messages for one card mean two copies of `advisor-wake.ts` loaded. Do not add `-e <checkout>/extensions/advisor-wake.ts` while the plugin link is in place.
- Check 1 treats a note with the same wording pattern as a woken note (for example "X's office is Y. That is wrong: team.md now says ...") as a repeat. It stays a card with no notice. Word `wake-held` notes differently to reach check 2.
- RPC has no UI, so the check 2 and check 3 notices show only in the TUI views. In the Tern view (OMP 18.11.0, Tern 0.8.3), the check 2 notice did not show in `$C tree` or in the bell inbox. Treat the notice as unproven there.
- Esc does not close the Tern bell inbox (`button.tn-ib-badge`), and typed text goes nowhere while it is open. Click the bell again before typing.
- Delete `extensions/smoke-advisor.ts` after the drive. `git status -s` must not list it.
