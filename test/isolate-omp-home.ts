import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";

// OMP captures the settings directory when the SDK loads.
const home = mkdtempSync(join(tmpdir(), "omp-tools-test-home-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.PI_CONFIG_DIR = relative(homedir(), join(home, ".omp"));
delete process.env.OMP_PROFILE;
delete process.env.PI_PROFILE;
delete process.env.PI_CODING_AGENT_DIR;
delete process.env.XDG_DATA_HOME;
delete process.env.XDG_STATE_HOME;
delete process.env.XDG_CACHE_HOME;
process.on("exit", () => rmSync(home, { recursive: true, force: true }));

export const pluginLockfile = join(home, ".omp", "plugins", "omp-plugins.lock.json");
