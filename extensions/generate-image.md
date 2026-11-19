Generate or edit images. Each call runs in one Image generation mode, chosen by `mode`:
- `openai`: GPT Image 2.6 Sunburst through the OpenAI Images API, billed to the user's OpenAI API credits. Only OpenAI mode has SVG and GIF output, exact sizes, `quality`, `n`, `mask`, `markup`, and up to 16 Reference images.
- `codex`: the Codex Images endpoint, drawing on the user's ChatGPT account's Codex image allowance. Up to 5 Reference images.
The user's Default image generation mode is `{{defaultMode}}`. Always pass `mode` as the first key in the arguments. Use `{{defaultMode}}` unless a switch is needed. Use `{{otherMode}}` only when the user asks for it or the task needs a feature only that mode has. When a call fails, report the error; retry in the other mode only when the user asks.
A mode rejects the arguments it does not take. Any Reference image makes the call an edit. Every final image is returned and saved; an SVG is saved and returned as its path only.
