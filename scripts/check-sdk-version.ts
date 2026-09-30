// Warn when the installed SDK dev types differ from the omp binary on PATH.
// The plugin runs against the host's own modules, so types that are newer or
// older than the host can pass `bun run check` yet fail when omp loads the
// plugin. Warning only: typechecking still runs.
import * as path from "node:path";
import { $ } from "bun";
import { hostEnv, hostOmp } from "./host-env";

const SDK_PACKAGES = ["@oh-my-pi/pi-coding-agent", "@oh-my-pi/pi-tui"];

const hostOutput = hostOmp ? await $`${hostOmp} --version`.env(hostEnv).quiet().nothrow() : undefined;
const host = hostOutput?.exitCode === 0 ? /(\d+\.\d+\.\d+\S*)/.exec(hostOutput.text())?.[1] : undefined;
if (!host) {
	console.warn("warning: could not read `omp --version`; skipping SDK/host version check");
	process.exit(0);
}

const root = path.resolve(import.meta.dir, "..");
const mismatches: string[] = [];
for (const name of SDK_PACKAGES) {
	let version: string | undefined;
	try {
		const manifest = await Bun.file(path.join(root, "node_modules", name, "package.json")).json();
		version = typeof manifest.version === "string" ? manifest.version : undefined;
	} catch {
		version = undefined;
	}
	if (version !== host) mismatches.push(`${name}@${version ?? "missing"}`);
}

if (mismatches.length > 0) {
	console.warn(
		`warning: installed omp is ${host} but SDK types are ${mismatches.join(", ")}.\n` +
			"         Run `bun run update` to update omp and the SDK types together.",
	);
}
