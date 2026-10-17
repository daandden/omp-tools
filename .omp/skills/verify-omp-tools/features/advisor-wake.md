# Advisor wake

An advisor concern or blocker card that lands after the agent's final answer, with no turn started for it, makes the plugin send one short `advisor-wake` message that starts a turn. The message points at the card and never repeats the note. If the fix changes what the latest complete answer told the user, the final reply is only a Revised answer: that answer again from its first line to its last, in the same form, with the fix in place. Nothing comes before or after it, so it has no heading, label, or line about what changed. A code-only or file-only fix gets a short reply. Per prompt cycle, two checks hold a card back: a repeat of a woken note (check 1) and more than 10 Advisor wakes (check 2). What the last woken turn did is not checked. A card that check 2 keeps back shows as the footer status `advisor: N note(s) waiting` until the next user prompt, with no toast.

The Picker release is the second path. While a run waits in the ask picker, OMP keeps the advisor's concerns for the end of the run (deferred notes). When the user answers the picker, the plugin reads those concerns from the session's `__advisor*.jsonl` and steers them into the run as one `advisor` card, so the agent gets them before its final answer. That card has `details.releasedBy: "omp-tools"` and no `advisor-wake`.

## Sub-features

- `wake-once` sends exactly one `advisor-wake` message per card that passes the checks, and the message does not contain the note text. A repeated or waiting card gets none.
- `wake-revised` answers a concern that a stated fact is wrong with a Revised answer. The intro line, the table, and the closing sentence all come back, with only the fact changed.
- `wake-first-line` answers a concern about a fact on the answer's first line with a Revised answer whose first line carries the corrected fact.
- `wake-blocker` gives the same result as `wake-revised` for a blocker card.
- `wake-short` answers a code-only concern, sent after a new user prompt, with a short reply that names the fix.
- `wake-second` answers a second fact concern with a new Revised answer that keeps the first fix.
- `wake-after-text` wakes again for a new concern after an Advisor wake that ran only reads and replied in text.
- `wake-waiting` keeps an eleventh new concern in a prompt cycle as a card and shows `advisor: 1 note waiting` in the footer until the next user prompt.
- `release-picker` steers a deferred concern into the run when the user answers the picker. The agent acts on it before its final answer.
- `release-repeat` keeps the same concern as a card with no Advisor wake when it arrives again after the final answer.

## How to get to it (user POV)

- Turn the OMP advisor on, ask a question, and wait for the final answer. The advisor posts a concern or blocker card under it, and the Advisor wake starts a turn by itself.
- With the advisor on, answer an ask picker while the advisor holds a concern for the end of the run. The concern shows as an Advisor card right after the `ask` card, and the agent acts on it in the same run.
- Proof needs a card or a deferred concern on demand. A throwaway extension command posts a card, a line written by hand to the session's `__advisor.smoke.jsonl` stands in for a deferred concern, and a `--config` overlay turns the core advisor off so it adds no cards of its own.

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

- `$VERIFY_RUN_DIR/smoke-config.yml` exists (Run entry in `../SKILL.md`).
- `$VERIFY_RUN_DIR/ws/team.md` holds a `# Team` heading and three lines: `- Alice: role Tech lead, office Lisbon`, `- Bob: role Backend engineer, office Paris`, `- Carol: role Designer, office Oslo`. Keep fixtures out of the checkout.
- The Tern window serves as `../SKILL.md` describes, and OMP starts in `$VERIFY_RUN_DIR/ws` without `--no-extensions`, so the linked plugin loads as it does for a user:

  ```sh
  $C run "\"sh -c 'cd $VERIFY_RUN_DIR/ws && exec omp --model anthropic/claude-haiku-5-5 -e <checkout>/extensions/smoke-advisor.ts --config $VERIFY_RUN_DIR/smoke-config.yml --session-dir $VERIFY_RUN_DIR/data/sessions --no-title --no-lsp'\""
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

The chat shows the Advisor card (`CONCERN [smoke]`), an `advisor-wake` card, a `read`, and then the reply. Pass: the reply is the final answer with `Paris` changed to `Berlin` and every other line the same. It starts at the final answer's first line, and nothing comes before or after it.

Steps for `wake-after-text`, in the same session:

1. Run `$C type '"/smoke-advisor concern Carol now works remotely according to HR records; mention remote work for Carol."'`.
2. Run `$C key Enter`.
3. Run `sleep 30`.
4. Run `$C shot wake-after-text`.

Pass: the card shows, then an `advisor-wake` card and a new reply, although the `wake-revised` turn ran only `read`.

Steps for `wake-waiting`, in a new session in the same window:

1. Send a one-sentence question as a prompt, such as `In one short sentence, what is a pear?`, and wait 15 s.
2. Send 11 `/smoke-advisor concern <note>` cards about different topics, one at a time, each with `$C key Enter` and `sleep 16`. Check 1 may count a close topic as a repeat; send one more card per repeat.
3. Run `$C shot wake-waiting`.
4. Send `Thanks, that's all.` and wait 15 s.
5. Run `$C shot wake-cleared`.

Pass: the session has 10 `advisor-wake` messages. In `wake-waiting` the composer's bottom row shows `advisor: 1 note waiting` and no toast. `wake-cleared` shows no `waiting` text (check the layout JSON). With `PI_TUI_NATIVE=0` the same text is a line under the status bar. In the RPC drive it is an `extension_ui_request` with `method` `setStatus`, `statusKey` `advisor-wake`, cleared by one with no `statusText` when the next prompt starts.

Steps for `release-picker`, in the same session:

1. Run `$C type '"Call the ask tool once: question Proceed?, options yes and no. After my answer, apply any advisor note you receive, then reply with only: finished"'`.
2. Run `$C key Enter`. Wait until `$C tree` contains `Ask aside`.
3. While the picker is open, append one line to `<session file without .jsonl>/__advisor.smoke.jsonl` (create the folder if it is missing). The line is a deferred `advise` result in the format that OMP's advisor recorder writes:

   ```json
   {"type":"message","message":{"role":"toolResult","toolName":"advise","content":[{"type":"text","text":"Queued for the end of the turn. Do not re-raise."}],"details":{"note":"Write release-probe.txt in the working directory with the text: release received","severity":"concern","advisor":"smoke"}}}
   ```

4. Run `$C key Enter` to answer `yes`.
5. Run `sleep 30`.
6. Run `$C shot release-card`.

Pass: an Advisor card `CONCERN [smoke] Write release-probe.txt …` shows under the `ask` card, then a `Write release-probe.txt` card, then `finished`. `ws/release-probe.txt` holds `release received`. The session JSONL has a `custom_message` with `customType` `advisor` and `details.releasedBy` `omp-tools`, and no `advisor-wake` after it.

Steps for `release-repeat`, in the same session:

1. Run `$C type '"/smoke-advisor concern Write release-probe.txt in the working directory with the text: release received"'`.
2. Run `$C key Enter`.
3. Run `sleep 25`.

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

Steps for `wake-first-line`:

1. Write `team.md` into the fresh `ws` directory.
2. Send `Read team.md. Who is on the team? Start with one intro line that says how many members the team has and which office Bob works in, then a Markdown table with columns Name, Role, Office, then one closing sentence on which office has the tech lead.` as a prompt. A one-line answer (`Read team.md. In which office does Bob work? Answer in exactly one sentence on one line.`) covers the same rule.
3. Run steps 3 to 6 of `wake-blocker`, with `concern` in place of `blocker`.

Pass: the same as `wake-revised`. The first line names Berlin, and no line names Paris.

Steps for `wake-second`:

1. Run steps 1 to 4 of `wake-blocker`.
2. Send `/smoke-advisor concern The answer says Bob's office is Paris. That is wrong: team.md now says Bob's office is Berlin.` as a prompt.
3. Wait for the next `agent_end`.
4. Change `Oslo` to `Bergen` in `team.md`.
5. Send `/smoke-advisor concern Carol moved: per the latest team.md her office is Bergen, yet the reply still lists Oslo for her.` as a prompt.
6. Wait for the next `agent_end`.

Pass: each of the two replies passes the `wake-revised` check. The second reply has Berlin and Bergen and no Paris or Oslo.

Steps for `wake-short`:

1. Start a new session in a fresh `ws` directory.
2. Send `Create greet.py with a function greet(name) that returns 'Hello, <name>!'. Then tell me in two or three sentences what you created and how to call it.` as a prompt.
3. Wait for its `prompt_result`.
4. Send `/smoke-advisor concern greet.py has no module docstring. Add a one-line module docstring to greet.py.` as a prompt.
5. Wait for the next `agent_end`.

Pass: the reply names the fix in one or two sentences and restates nothing, and `greet.py` starts with a docstring.

Steps for `wake-once`, the second view of every run:

1. Run `jq -r 'select(.type=="custom_message") | .customType' <session>.jsonl`. Each card that passes the checks is followed by one `advisor-wake`. A repeated, waiting, or released card has none.
2. Run `jq -r 'select(.type=="custom_message" and .customType=="advisor-wake") | .content' <session>.jsonl`. The output does not contain the note.
3. Run `jq -r 'select(.type=="message" and .message.role=="assistant" and .message.stopReason=="stop") | [.message.content[] | select(.type=="text") | .text] | join("")' <session>.jsonl`. The reply of each Advisor wake is the last of these messages after its `advisor-wake` message.

## Gotchas

- The reply of an Advisor wake varies from run to run. Run at least 12 fact-fix Advisor wakes across `wake-revised`, `wake-blocker`, and `wake-first-line`, with at least 4 of `wake-first-line`, and report the pass count. Expect no failure. One pass does not prove the prompt. A Markdown table with its columns padded to a new width is the same form.
- Send the card only after the final answer lands. A card during a run reaches the live turn and never wakes.
- Two `advisor-wake` messages for one card mean two copies of `advisor-wake.ts` loaded. Do not add `-e <checkout>/extensions/advisor-wake.ts` while the plugin link is in place.
- Check 1 treats a note with the same wording pattern as a woken note (for example "X's office is Y. That is wrong: team.md now says ...") as a repeat. It stays a card with no notice. Word the `wake-after-text` and `wake-waiting` notes differently so each is new.
- Tern draws the footer status as a fact in the composer's bottom row (OMP 18.11.3, Tern 0.9.2). At very narrow pane widths Tern can drop it.
- Esc does not close the Tern bell inbox (`button.tn-ib-badge`), and typed text goes nowhere while it is open. Click the bell again before typing.
- Delete `extensions/smoke-advisor.ts` after the drive. `git status -s` must not list it.
- The deferred line format and its acknowledgment text are private to OMP. If OMP changes them, the Picker release finds nothing. Compare the fixture with `ADVISOR_ACK_DEFERRED` in OMP's `advisor/advise-tool.ts` (`Queued for the end of the turn. Do not re-raise.` in OMP 18.11.1).
