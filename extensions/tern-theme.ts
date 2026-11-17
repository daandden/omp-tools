import { type Theme, theme } from "@oh-my-pi/pi-tui/theme";

/**
 * The roots omp-tools describes in Tern: the Picker (`omp.editor`, which holds
 * a `scrollBox`), the `/btw` panel and the English coach panel (both
 * `omp.overlay.btw`). Each holds an `omp-tools.*` role, which no native panel
 * does, so the rule leaves the composer and native `/btw` alone while every
 * sheet stays on the surface. The doubled class outranks Tern's layout rules
 * (`.sf-chat-reader .sf-col[data-role^='omp.overlay.']`, Tern 0.9.26), which
 * wash the panel with white.
 */
const ROOTS = ".sf-col.sf-col:is([data-role='omp.editor'], [data-role^='omp.overlay.']):has([data-role^='omp-tools.'])";

let themeCss: { theme: Theme; css: string } | undefined;

/**
 * Tern's palette variables repainted with the active omp theme on the plugin's
 * roots, so their surface, text, tones, rows, and diff marks use the omp
 * theme's colours, not Tern's own. Tern's tone and span classes read these
 * variables, so its built-in parts (keycaps, spinners, `ins`/`del` spans)
 * follow too.
 */
function ompThemeCss(): string {
	if (themeCss?.theme === theme) return themeCss.css;
	const fg = (token: Parameters<Theme["getColorHex"]>[0]) => theme.getColorHex(token);
	const panel = theme.getBgHex("selectedBg");
	// An empty `text` token means the terminal's own foreground, which Tern's --t1 already is.
	const text = theme.hasColor("text") ? `--t1: ${fg("text")};\n\t--tv-fg: ${fg("text")};` : "";
	const css = `
${ROOTS} {
	--raise: ${panel};
	--pop-bg: ${panel};
	${text}
	--t2: color-mix(in oklch, var(--t1), ${fg("muted")});
	--t3: ${fg("muted")};
	--t4: ${fg("dim")};
	--l1: color-mix(in oklch, var(--t1) 7%, transparent);
	--l2: color-mix(in oklch, var(--t1) 12%, transparent);
	--l3: color-mix(in oklch, var(--t1) 18%, transparent);
	--l4: color-mix(in oklch, var(--t1) 26%, transparent);
	--accent: ${fg("accent")};
	--accent-ink: ${fg("accent")};
	--sf-accent: ${fg("accent")};
	--sf-muted: ${fg("muted")};
	--sf-ok: ${fg("success")};
	--sf-warn: ${fg("warning")};
	--sf-bad: ${fg("error")};
	--sf-c-muted: ${fg("muted")};
	--sf-c-dim: ${fg("dim")};
	--sf-c-accent: ${fg("accent")};
	--sf-c-success: ${fg("success")};
	--sf-c-warning: ${fg("warning")};
	--sf-c-error: ${fg("error")};
	--sf-c-ins: ${fg("toolDiffAdded")};
	--sf-c-del: ${fg("toolDiffRemoved")};
	--sf-c-code: ${fg("mdCode")};
	--sf-c-link: ${fg("mdLink")};
	--sf-c-key: var(--t2);
	--composer-ring: var(--l2);
	color: var(--t1);
	background: ${panel};
	-webkit-backdrop-filter: none;
	backdrop-filter: none;
}
`;
	themeCss = { theme, css };
	return css;
}

const messages = new Map<string, { theme: Theme; css: string; message: string }>();

/**
 * The stylesheet message (`ESC _ tsp;s;{name,css} ESC \`) for one omp-tools
 * sheet, led by the omp theme rules. Senders write it with every describe, so
 * a theme change reaches the next frame.
 */
export function sheetMessage(name: string, css: string): string {
	const last = messages.get(name);
	if (last?.theme === theme && last.css === css) return last.message;
	const message = `\x1b_tsp;s;${JSON.stringify({ name, css: `${ompThemeCss()}${css}` })}\x1b\\`;
	messages.set(name, { theme, css, message });
	return message;
}
