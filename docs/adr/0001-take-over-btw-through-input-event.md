# Take over /btw through the input event

The plugin answers `/btw <question>` with its own Side question, which can use read-only tools. OMP has no way to replace a built-in command: it skips an extension command whose name is a built-in name. So the plugin catches the text in an `input` handler, which OMP runs before it dispatches built-in commands in the main editor, and marks the input as handled. We chose this over a new command name because `/btw` is the command the user already types.

## Consequences

- Native /btw still owns `/btw` with no question (its history browser), the `/btw` autocomplete entry, the b/c/f keys on its answers, `/btw` typed while a subagent's transcript has focus, and the RPC `btw` command. Plugin answers do not appear in native BTW history.
- If OMP starts to dispatch built-in commands before `input` handlers, `/btw` falls back to native /btw without an error.
