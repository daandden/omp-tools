import { ToolAbortError } from "@oh-my-pi/pi-coding-agent/tools/tool-errors";
import type { FinalImage } from "./image-artifacts";

export const FIRST_PARTY_BASE_URL = "https://api.openai.com/v1";
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export interface SunburstRequest {
	endpoint: "generations" | "edits";
	/** The JSON body, already in the API's field names. */
	body: Record<string, unknown>;
	/** Final images a streamed response must complete (`n`); fewer means it did not finish. */
	expectedImages: number;
}

/** A streamed preview: not a final image, never saved. */
export interface SunburstPreview {
	data: string;
	mimeType: string;
}

export interface SunburstAccess {
	apiKey: string;
	/** `OpenAI-Organization` and `OpenAI-Project`, when configured. */
	attribution: Record<string, string>;
}

export interface SunburstUsage {
	input_tokens?: number;
	output_tokens?: number;
	total_tokens?: number;
	input_tokens_details?: { image_tokens?: number; text_tokens?: number };
}

/** What the API reported about a response as a whole, beside its images. */
export interface SunburstReported {
	background?: string;
	output_format?: string;
	quality?: string;
	size?: string;
}

export interface SunburstImages {
	images: FinalImage[];
	reported: SunburstReported;
	usage?: SunburstUsage;
	/** `x-request-id`: the id OpenAI support traces a request by. */
	requestId?: string;
}

interface ImagesResponse extends SunburstReported {
	data?: { b64_json?: string }[];
	usage?: SunburstUsage;
}

interface ApiError {
	message?: string;
	code?: string | null;
	type?: string;
}

function withRequestId(message: string, requestId: string | undefined): string {
	return requestId ? `${message} (request id: ${requestId})` : message;
}

function apiErrorOf(text: string): ApiError | undefined {
	try {
		const error = (JSON.parse(text) as { error?: unknown }).error;
		return error && typeof error === "object" ? (error as ApiError) : undefined;
	} catch {
		return undefined;
	}
}

function describeApiError(head: string, status: number | undefined, error: ApiError | undefined, fallback: string): string {
	const detail = error?.message?.trim() || fallback;
	const code = error?.code ? ` (code: ${error.code})` : "";
	const message = `${head}: ${detail}${code}`;
	if (error?.code === "credit_balance_exhausted" || error?.type === "insufficient_quota") {
		return (
			`${message}. The API organization's OpenAI API credits are exhausted. Add API credits, or wait for the next ` +
			"Promotional API credit grant; do not retry generate_image until then."
		);
	}
	if (status === 429 || error?.code === "rate_limit_exceeded") {
		return `${message}. This is an OpenAI rate limit; wait before calling generate_image again.`;
	}
	if (status === 401) return `${message}. Check the openai API key.`;
	if (status === 403) {
		return (
			`${message}. The key's organization or project may lack access to GPT Image 2.5 Sunburst or need API ` +
			"organization verification."
		);
	}
	return message;
}

const PREVIEW_MIME_TYPES: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
const FRAME_END = /\r?\n\r?\n/;

interface StreamEvent extends SunburstReported {
	type?: string;
	b64_json?: string;
	usage?: SunburstUsage;
	error?: ApiError;
}

async function readImageStream(
	response: Response,
	expectedImages: number,
	onPreview: ((preview: SunburstPreview) => void) | undefined,
	requestId: string | undefined,
): Promise<SunburstImages> {
	const finals: SunburstImages = { images: [], reported: {}, requestId };
	const handle = (frame: string) => {
		const data = frame
			.split(/\r?\n/)
			.filter(line => line.startsWith("data:"))
			.map(line => line.slice(5).replace(/^ /, ""))
			.join("\n");
		if (!data || data === "[DONE]") return;
		let event: StreamEvent;
		try {
			event = JSON.parse(data) as StreamEvent;
		} catch {
			throw new Error(withRequestId(`OpenAI image stream sent a malformed event: ${data.slice(0, 200)}`, requestId));
		}
		if (event.type === "error" || event.error) {
			throw new Error(
				withRequestId(describeApiError("OpenAI image stream failed", undefined, event.error, "unknown error"), requestId),
			);
		}
		if (!event.b64_json) return;
		if (event.type?.endsWith(".partial_image")) {
			onPreview?.({ data: event.b64_json, mimeType: PREVIEW_MIME_TYPES[event.output_format ?? "png"] ?? "image/png" });
		} else if (event.type?.endsWith(".completed")) {
			finals.images.push({ bytes: Buffer.from(event.b64_json, "base64"), size: event.size, quality: event.quality });
			finals.reported = {
				background: event.background,
				output_format: event.output_format,
				quality: event.quality,
				size: event.size,
			};
			if (event.usage) finals.usage = event.usage;
		}
	};
	if (!response.body) throw new Error(withRequestId("OpenAI image stream had no body.", requestId));
	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += value;
		for (let end = FRAME_END.exec(buffer); end; end = FRAME_END.exec(buffer)) {
			handle(buffer.slice(0, end.index));
			buffer = buffer.slice(end.index + end[0].length);
		}
	}
	if (buffer.trim()) handle(buffer);
	if (finals.images.length < expectedImages) {
		const count = `${finals.images.length} of ${expectedImages} final image${expectedImages === 1 ? "" : "s"}`;
		throw new Error(withRequestId(`The OpenAI image stream ended after ${count}.`, requestId));
	}
	return finals;
}

function decodeImages(text: string, requestId: string | undefined): SunburstImages {
	let payload: ImagesResponse;
	try {
		payload = JSON.parse(text) as ImagesResponse;
	} catch {
		throw new Error(withRequestId(`OpenAI Images API returned invalid JSON: ${text.slice(0, 500)}`, requestId));
	}
	const data = payload.data ?? [];
	if (data.length === 0 || data.some(image => !image.b64_json)) {
		throw new Error(withRequestId("OpenAI Images API returned no image data.", requestId));
	}
	return {
		images: data.map(image => ({
			bytes: Buffer.from(image.b64_json ?? "", "base64"),
			size: payload.size,
			quality: payload.quality,
		})),
		reported: {
			background: payload.background,
			output_format: payload.output_format,
			quality: payload.quality,
			size: payload.size,
		},
		usage: payload.usage,
		requestId,
	};
}

export async function requestSunburstImages(
	request: SunburstRequest,
	access: SunburstAccess,
	signal: AbortSignal | undefined,
	onPreview?: (preview: SunburstPreview) => void,
): Promise<SunburstImages> {
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
	try {
		const response = await fetch(`${FIRST_PARTY_BASE_URL}/images/${request.endpoint}`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${access.apiKey}`,
				...access.attribution,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(request.body),
			signal: requestSignal,
		});
		const requestId = response.headers.get("x-request-id") ?? undefined;
		if (!response.ok) {
			const text = await response.text();
			const fallback = text.trim().slice(0, 500) || response.statusText;
			const head = `OpenAI Images API returned HTTP ${response.status}`;
			throw new Error(withRequestId(describeApiError(head, response.status, apiErrorOf(text), fallback), requestId));
		}
		if (request.body.stream === true) return await readImageStream(response, request.expectedImages, onPreview, requestId);
		return decodeImages(await response.text(), requestId);
	} catch (error) {
		if (signal?.aborted) throw new ToolAbortError();
		if (timeout.aborted) throw new Error("The OpenAI Images request timed out after 5 minutes.");
		throw error;
	}
}
