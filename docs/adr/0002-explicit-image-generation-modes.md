# Explicit image-generation modes

The accepted design keeps one `generate_image` tool with two extension-configured modes: `codex` preserves the existing Codex OAuth behavior, while `openai` uses GPT Image 2.5 Sunburst through the public Images API and the API organization's billing. The `imageGenerationMode` setting defaults to `openai`, and a new session exposes only the selected mode's arguments. Mode selection is explicit and failures never fall back to the other mode, because automatic switching could change both the credential used and the balance charged.
