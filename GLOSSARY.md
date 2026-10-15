# omp-tools

Local OMP plugin that replaces selected native OMP tools with adapted versions.

## Language

**Native tool**:
A tool built into the running OMP host, such as native `ask` or native `generate_image`.
_Avoid_: stock tool, built-in tool, origin tool

**Picker**:
This plugin's interactive question UI for `ask` in the terminal, shown instead of native `ask`'s dialog.
_Avoid_: custom ask, Markdown dialog, ask dialog

**Note**:
Free text the user attaches to one option of a question in the **Picker**. Each option keeps its own note whether or not it is picked, and every note is sent with the answer.
_Avoid_: comment, annotation

**Other answer**:
The user's own typed answer to a question, instead of a listed option or, in multi-select, alongside them. Un-picking it keeps the text.
_Avoid_: custom input, custom answer

**Submit note**:
Free text for the whole `ask`, written on the Submit tab and not tied to any question.
_Avoid_: general note, global note

**Side question**:
A question about the session that is answered aside from the main conversation, with read-only tools, and that the main agent never sees. The user asks one through **/btw** or **Picker btw**.
_Avoid_: btw (unqualified), side turn, btw agent

**/btw**:
The editor command that asks a **Side question**. Typing it runs this plugin's version, not **Native /btw**. Later `/btw` questions follow up in the same thread until the user's next main prompt ends it.
_Avoid_: btw (unqualified)

**Native /btw**:
OMP's own side-question command, which answers without tools. It still answers where this plugin cannot take over `/btw`.
_Avoid_: stock /btw, OMP btw

**Picker btw**:
A **Side question** asked from inside the **Picker** while an `ask` waits; shown and kept only in the **Picker**.
_Avoid_: btw (unqualified), our /btw, custom /btw

**Advisor note**:
One item of advice from OMP's advisor, with a severity: nit, concern, or blocker. A concern is an advisor note of severity concern.
_Avoid_: advice (as a countable item), advisory

**Advisor card**:
The message in the chat that shows one or more **Advisor notes** to the user and the main agent.
_Avoid_: advisor message, advice card

**Deferred note**:
An **Advisor note** that OMP holds back while the agent's run continues and sends only at the agent's final answer. Blocker notes are never deferred. Sending a deferred note earlier is a release.
_Avoid_: held note, withheld note, queued note

**Advisor wake**:
A turn this plugin starts so the agent acts on an **Advisor card** with a concern or blocker that arrived after the agent's final answer and that OMP left without a turn.
_Avoid_: concern wake, wake (unqualified), nudge

**Revised answer**:
The reply that ends an **Advisor wake** and restates, in full and in the same form, the latest complete answer to the user's prompt: the agent's final answer, or an earlier **Revised answer**. The agent writes one only when a fix changes what that answer told the user.
_Avoid_: corrected answer, restated answer, updated reply

**generate_image**:
This plugin's image tool. It replaces native `generate_image`, which the user disables.
_Avoid_: custom image tool, image wrapper

**Codex Images endpoint**:
The ChatGPT-login image backend the official Codex CLI calls: `/backend-api/codex/images/generations` and `/backend-api/codex/images/edits`.
_Avoid_: codex-us image generation, Codex image API

**Responses image tool**:
The hosted `image_generation` tool reached through `/backend-api/codex/responses`, used by native `generate_image`.
_Avoid_: hosted image path

**Codex OAuth**:
Authentication with a ChatGPT account through OMP's `openai-codex` login, as opposed to an OpenAI API key.
_Avoid_: subscription auth, ChatGPT key

**Reference image**:
An existing image sent with an edit request for the backend to modify or draw from.
_Avoid_: input image, attachment, source image
