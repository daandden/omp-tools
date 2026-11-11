// The OMP module behind `/tree` re-answer through the registered `ask`
// (commit 8ed79a8, branch feat/extension-ask-replay). The npm SDK does not ship
// it; ./ask-host.ts imports it at runtime from the host. Delete this file once
// the SDK types include `tools/ask-reanswer`.
declare module "@oh-my-pi/pi-coding-agent/tools/ask-reanswer" {
	/** Tool call id the active `ask` tool receives when the user re-answers a past `ask` from `/tree`. */
	export const ASK_REANSWER_TOOL_CALL_ID: "tree-reanswer";
}
