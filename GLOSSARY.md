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

**/btw**:
OMP's native side-question command: a one-off question about the session whose answer the agent never sees.
_Avoid_: btw (unqualified)

**Picker btw**:
A side question asked from inside the Picker while an `ask` waits; answered like **/btw** but shown and kept only in the Picker.
_Avoid_: btw (unqualified), our /btw, custom /btw

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
