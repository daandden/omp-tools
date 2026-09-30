// Locate the user's omp binary from a package script. `bun run` prepends every
// ancestor `node_modules/.bin` to PATH, and the SDK dev dependency links its
// `dist/cli.js` there as `omp`, so a bare `omp` would run the dev types'
// version instead of the installed host. Bun Shell resolves commands against
// the parent PATH even with `.env()`, so callers must run the absolute path.
import * as path from "node:path";

const hostPath = (process.env.PATH ?? "")
	.split(path.delimiter)
	.filter((dir) => !(path.basename(dir) === ".bin" && path.basename(path.dirname(dir)) === "node_modules"))
	.join(path.delimiter);

export const hostEnv = { ...process.env, PATH: hostPath };
export const hostOmp = Bun.which("omp", { PATH: hostPath });
