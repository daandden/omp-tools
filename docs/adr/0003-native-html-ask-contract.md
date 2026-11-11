# Use the native HTML ask contract

OMP 18.18.3 replaced structured question arguments with an HTML form. omp-tools adopts that public HTML contract instead of keeping `questions[]` and adding a generated HTML companion. The host and the plugin can then consume the same saved form for execution, presentation, and native `/tree` re-answer.

Keeping structured questions would preserve existing callers, but it would leave the plugin responsible for two representations and would not expose native mixed text, number, and choice forms. The accepted trade-off is to migrate the plugin's callers, descriptions, result handling, and UI integration to HTML. This decision does not remove the Picker's extra behavior by itself.

The interactive TUI keeps the Picker and extends it to every control, context block, and validation rule in the native form contract. Notes on unpicked options, answer images, Submit notes, cancellation drafts, and Picker btw remain available across forms. We rejected choosing the renderer by whether a form contains only choice fields, because adding a text field must not silently remove those features. We also rejected replacing the Picker entirely with native UI. This retains more custom UI responsibility than native delegation.

Native `/tree` re-answer must use the same rich Picker while omp-tools owns `ask`. This requires an extension-aware replay integration in OMP that returns the complete tool result; patching `formDialog` alone would lose answer channels. The host owns history mutation and tool resolution, and the plugin owns form interaction. Completion therefore requires the paired host change, not a plugin-only patch on unmodified OMP 18.18.8.

Timeout follows native form-data behavior: it returns current values with an explicit timed-out marker even when manual validation would fail. This deliberately does not promise that an automatic answer satisfies required fields or bounds. Automatic values are not user consent.
