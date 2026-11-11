// Every test file runs as if on an OMP host with the `/tree` re-answer
// integration, which the npm SDK lacks. The host is the system boundary;
// test/ask-host.test.ts runs a process without this preload for an older host.
import { mock } from "bun:test";

mock.module("@oh-my-pi/pi-coding-agent/tools/ask-reanswer", () => ({ ASK_REANSWER_TOOL_CALL_ID: "tree-reanswer" }));
