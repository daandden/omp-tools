// Update the omp binary and the SDK dev types together, keeping the
// `"latest"` specifiers in package.json. `bun update` rewrites the specifier
// to a caret range of the resolved version, so this restores `"latest"`
// afterwards and reinstalls to record it in bun.lock.
import * as path from "node:path";
import { $ } from "bun";

const SDK_PACKAGES = ["@oh-my-pi/pi-coding-agent", "@oh-my-pi/pi-tui"];
const root = path.resolve(import.meta.dir, "..");
const manifestPath = path.join(root, "package.json");

await $`omp update`.cwd(root);
await $`bun update --ignore-scripts --latest ${SDK_PACKAGES}`.cwd(root);

const manifest = await Bun.file(manifestPath).json();
for (const name of SDK_PACKAGES) manifest.devDependencies[name] = "latest";
await Bun.write(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);

await $`bun install --ignore-scripts`.cwd(root);
await $`bun run check`.cwd(root);
