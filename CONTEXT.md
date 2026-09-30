# omp-tools

Local OMP plugin that replaces selected native OMP tools with adapted versions.

## Language

**Native tool**:
A tool built into the running OMP host, such as native `ask` or native `generate_image`.
_Avoid_: stock tool, built-in tool, origin tool

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
