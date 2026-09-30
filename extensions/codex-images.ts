// Client for the Codex Images endpoint (`chatgpt.com/backend-api/codex/images/*`),
// the Codex OAuth image backend the official Codex CLI calls. OpenAI does not
// document it; the wire format follows `openai/codex` (codex-api/src/images.rs,
// ext/image-generation/src/tool.rs). Findings measured live are in
// docs/research/codex-images-endpoint.md and issue #11.
import { ToolAbortError } from "@oh-my-pi/pi-coding-agent/tools/tool-errors";
import { USER_AGENT } from "@oh-my-pi/pi-utils";

const IMAGES_URL = "https://chatgpt.com/backend-api/codex/images";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
/**
 * Bodies above ~80 MB get a false `moderation_blocked`; above ~100 MB, edits
 * return 200 with the references and prompt silently dropped. 75 MB worked.
 */
const MAX_BODY_BYTES = 64 * 1024 * 1024;
/** Complex prompts and references take minutes; the edge cuts off near 5 min. */
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export interface ImageRequest {
	prompt: string;
	transparent: boolean;
	/** Reference images as `data:` URLs; any reference makes the call an edit. */
	references: string[];
}

export interface GeneratedImage {
	/** Decoded image bytes as returned (always PNG in practice). */
	bytes: Uint8Array;
	/** Backend-reported size and quality, e.g. `1370x1148` and `low`. */
	size?: string;
	quality?: string;
}

interface ImagesResponse {
	data?: { b64_json?: string }[];
	quality?: string;
	size?: string;
	usage?: { input_tokens_details?: { image_tokens?: number } };
}

interface ErrorBody {
	error?: { message?: string; code?: string; type?: string; plan_type?: string };
}

/** The `https://api.openai.com/auth` claims of a Codex access token (mirrors pi-catalog `wire/codex.ts`). */
function authClaims(accessToken: string): Record<string, unknown> | undefined {
	try {
		const parts = accessToken.split(".");
		if (parts.length !== 3) return undefined;
		const payload = JSON.parse(Buffer.from(parts[1] ?? "", "base64").toString("utf-8")) as Record<string, unknown>;
		const claims = payload[JWT_CLAIM_PATH];
		return claims && typeof claims === "object" ? (claims as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

function requestHeaders(accessToken: string, turnId: string): Record<string, string> {
	const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
	const claims = authClaims(accessToken);
	const accountId = claims?.chatgpt_account_id;
	if (typeof accountId === "string" && accountId) headers["chatgpt-account-id"] = accountId;
	// Region-pinned workspaces reject requests that do not declare residency.
	for (const claim of [claims?.chatgpt_data_residency, claims?.chatgpt_compute_residency]) {
		const residency = typeof claim === "string" ? claim.trim() : "";
		if (residency) {
			headers["x-openai-internal-codex-residency"] = residency;
			break;
		}
	}
	headers.originator = "omp";
	headers["User-Agent"] = USER_AGENT;
	headers["x-codex-image-turn-id"] = turnId;
	headers["Content-Type"] = "application/json";
	return headers;
}

/** Codex's exact body: edits lead with `images`, as its request struct serializes. */
function requestBody({ prompt, transparent, references }: ImageRequest): string {
	const fields = {
		prompt,
		background: transparent ? "transparent" : "opaque",
		model: "gpt-image-2",
		quality: "auto",
		size: "auto",
	};
	if (references.length === 0) return JSON.stringify(fields);
	return JSON.stringify({ images: references.map(url => ({ image_url: url })), ...fields });
}

function formatMegabytes(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCountdown(seconds: number): string {
	const minutes = Math.max(1, Math.ceil(seconds / 60));
	const days = Math.floor(minutes / 1440);
	const hours = Math.floor((minutes % 1440) / 60);
	const parts = [days && `${days}d`, hours && `${hours}h`, minutes % 60 && `${minutes % 60}m`];
	return parts.filter(Boolean).join(" ");
}

function numberHeader(headers: Headers, name: string): number | undefined {
	const value = Number(headers.get(name) ?? Number.NaN);
	return Number.isFinite(value) ? value : undefined;
}

/** Reset time in epoch ms from `<prefix>-primary-reset-after-seconds` or `-reset-at` (epoch seconds). */
function resetTime(headers: Headers, prefix: string, now: number): number | undefined {
	const after = numberHeader(headers, `${prefix}-primary-reset-after-seconds`);
	if (after !== undefined) return now + after * 1000;
	const at = numberHeader(headers, `${prefix}-primary-reset-at`);
	return at === undefined ? undefined : at * 1000;
}

function usageLimitMessage(headers: Headers, body: ErrorBody): string {
	const limit = headers.get("x-codex-active-limit");
	const plan = body.error?.plan_type ?? "unknown";
	const now = Date.now();
	// Codex reads a limit's window from `x-<limit id, "_" as "-">-primary-*`;
	// `x-codex-*` is the general Codex window.
	const resetMs =
		(limit ? resetTime(headers, `x-${limit.replaceAll("_", "-")}`, now) : undefined) ??
		resetTime(headers, "x-codex", now);
	const head = `Codex usage limit reached (limit: ${limit ?? "unknown"}, plan: ${plan}).`;
	if (resetMs === undefined) {
		return `${head} The reset time was not reported. Do not retry generate_image until the limit resets.`;
	}
	const resetsAt = new Date(resetMs).toLocaleString();
	const countdown = formatCountdown((resetMs - now) / 1000);
	return `${head} It resets at ${resetsAt} local time (in ${countdown}). Do not retry generate_image before then.`;
}

function httpErrorMessage(response: Response, text: string): string {
	let body: ErrorBody = {};
	try {
		body = JSON.parse(text) as ErrorBody;
	} catch {}
	const error = body.error;
	if (response.status === 429 && error?.type === "usage_limit_reached") {
		return usageLimitMessage(response.headers, body);
	}
	if (error?.code === "moderation_blocked" && error.message) return error.message;
	const detail = error?.message ?? (text.trim().slice(0, 500) || response.statusText);
	const code = error?.code ? ` (code: ${error.code})` : "";
	return `Codex Images endpoint returned HTTP ${response.status}: ${detail}${code}`;
}

export async function requestImage(
	request: ImageRequest,
	accessToken: string,
	turnId: string,
	signal: AbortSignal | undefined,
): Promise<GeneratedImage> {
	const body = requestBody(request);
	const bodyBytes = Buffer.byteLength(body);
	if (bodyBytes > MAX_BODY_BYTES) {
		throw new Error(
			`The image request is ${formatMegabytes(bodyBytes)}, over the ${formatMegabytes(MAX_BODY_BYTES)} limit. ` +
				"Larger requests make the Codex Images endpoint fail with a false moderation_blocked error or silently " +
				"drop the reference images. Use fewer or smaller reference images.",
		);
	}
	const endpoint = request.references.length > 0 ? "edits" : "generations";
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
	let response: Response;
	let text: string;
	try {
		response = await fetch(`${IMAGES_URL}/${endpoint}`, {
			method: "POST",
			headers: requestHeaders(accessToken, turnId),
			body,
			signal: requestSignal,
		});
		text = await response.text();
	} catch (error) {
		if (signal?.aborted) throw new ToolAbortError();
		if (timeout.aborted) throw new Error("The Codex Images request timed out after 5 minutes.");
		throw error;
	}
	if (!response.ok) throw new Error(httpErrorMessage(response, text));

	let payload: ImagesResponse;
	try {
		payload = JSON.parse(text) as ImagesResponse;
	} catch {
		throw new Error(`Codex Images endpoint returned invalid JSON: ${text.slice(0, 500)}`);
	}
	const encoded = payload.data?.[0]?.b64_json;
	if (!encoded) throw new Error("Codex Images endpoint returned no image data.");
	if (request.references.length > 0 && payload.usage?.input_tokens_details?.image_tokens === 0) {
		throw new Error(
			"The Codex Images endpoint dropped the reference images: the edit reported 0 input image tokens, so the " +
				"returned image ignores them and was discarded. Retry with fewer or smaller reference images.",
		);
	}
	return { bytes: Buffer.from(encoded, "base64"), size: payload.size, quality: payload.quality };
}
