import type { AgentSessionEvent } from "@oh-my-pi/pi-coding-agent";

export type SideQuestionRecovery = Extract<
	AgentSessionEvent,
	{ type: "auto_retry_start" | "auto_retry_end" | "retry_fallback_applied" }
>;
