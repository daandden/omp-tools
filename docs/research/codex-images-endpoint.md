# Codex OAuth image endpoints (`chatgpt.com/backend-api/codex/images/*`): research notes

Researched 2026-09-29. No requests were sent to `chatgpt.com/backend-api/*` while preparing this document, and no credentials were used. Sources were public web pages, the public `openai/codex` source, and public GitHub issues and PRs.

`openai/codex` source was read at `main` = [`c248f6d4`](https://github.com/openai/codex/tree/c248f6d48b97eb4a2aa56147a0b11b7d763278b9) (2026-09-29). Line anchors below point to that snapshot, so they stay valid after `main` moves.

Evidence labels:

- **[PRIMARY]**: OpenAI documentation, OpenAI Help Center, the official changelog, or source/PRs in `openai/codex`.
- **[STAFF]**: a public statement by an OpenAI employee outside formal documentation, such as a post on X.
- **[SECONDARY]**: community reports, reverse engineering, or third-party code.
- **[INFERENCE]**: my conclusion from the evidence above. It was not directly observed.

---

## TL;DR

- **OpenAI does not document the endpoint.** I found no OpenAI reference page, OpenAPI entry, Codex doc, Help Center article, or changelog entry for `chatgpt.com/backend-api/codex/images/generations|edits`, or for any other `backend-api` route. The official docs mention `https://chatgpt.com/backend-api/` only once, as the `chatgpt_base_url` config value, described as the "Base URL for ChatGPT auth flow (not OpenAI API)". Everything about the wire contract comes from `openai/codex` source code. [PRIMARY]
- **The Codex CLI sends a small, fixed request body.** The body is `{prompt, background: "transparent"|"opaque", model: "gpt-image-2", quality: "auto", size: "auto"}`. Edits add `images: [{image_url}|{file_id}]` with at most 5 images. The request is a plain non-streaming JSON POST to `{base}/images/generations|edits`. The response is `{created, data[{b64_json, generation_id?}], background?, quality?, size?}`, and extra fields are ignored. No other Images API parameter is ever sent: no `n`, `stream`, `partial_images`, `output_format`, `mask`, `moderation`, `input_fidelity`, or `user`. [PRIMARY]
- **The CLI sends these headers.** `Authorization: Bearer <access_token>`, `ChatGPT-Account-ID`, optional `X-OpenAI-Fedramp: true`, `originator` (default `codex_cli_rs`), and `User-Agent: <originator>/<ver> (<os> <ver>; <arch>) <terminal>`. It also sends `version: <cli version>`, optional `OpenAI-Organization`/`OpenAI-Project` taken from environment variables, optional `x-openai-internal-codex-residency: us`, and `x-codex-image-turn-id: <turn id>`. It reads the `x-codex-imagegen-request-id` response header. A PR says the originator is forwarded "for billing attribution". [PRIMARY]
- **Official docs describe the product, not the API.** Codex's built-in image generation uses `gpt-image-2` and counts toward general Codex usage limits, at about 3–5x faster consumption than similar turns without images. It is not available on the Free plan. With an API key, API pricing applies instead. The CLI source also hides the tool when the account's plan is Free. `gpt-image-2-codex` does not appear in any official doc. [PRIMARY]
- **The documented usage-limit signal is exercised only by tests.** Codex maps HTTP 429 with `error.type == "usage_limit_reached"` and header `x-codex-active-limit: image_gen` (plus the `x-image-gen-primary-*` window headers) to `ImageGenerationFailure::UsageLimitExceeded { limitId: "image_gen", resetsAt }`. That exact shape appears only in Codex's own test fixtures. [PRIMARY]
- **The public Images API is a superset of what Codex sends.** It supports `n`, `stream`+`partial_images`, `output_format`, `output_compression`, `moderation`, `user`, `response_format`/`style` (DALL·E only), and on edits `mask` and `input_fidelity`. It also has the new models `gpt-image-2.5-flare` and `gpt-image-2.5-sunburst`, whose quality values include `xhigh` and `max`. None of this is documented as supported on the Codex endpoint. [PRIMARY]
- **Community probes show the Codex endpoint does not honor request parameters reliably.** Deliberately invalid `model` ids return HTTP 200. `size` and `quality` are often replaced (`high`→`medium`, `auto`→`low`, square→`1254x1254`). The response has no effective-model field. No OpenAI maintainer has answered any of the open issues about parameters, originator, or 403s. [SECONDARY]
- **Third-party OAuth use has no formal contract.** The closest official statements are an OpenAI program page saying "Developers should code in the tools they prefer, whether that's Codex, OpenCode, Cline, pi, OpenClaw, or something else" [PRIMARY], and Tibo Sottiaux's post reminding users they "can use your ChatGPT account in a flourishing set of other tools" [STAFF]. Against these, the Terms of Use forbid circumventing rate limits and "automatically or programmatically extract[ing] data or Output" [PRIMARY]. Harness authors report that OpenAI asked them to send their own `originator` rather than impersonate `codex_cli_rs` [SECONDARY]. A request for a documented contract ([openai/codex#36886](https://github.com/openai/codex/issues/36886)) is still open with no reply.

---

## Q1. Does OpenAI publicly document `backend-api/codex/images/*` (or any `backend-api` endpoint)?

**Answer: No.** I found no public documentation, spec, or changelog entry for these endpoints.

What I checked:

- **API reference and OpenAPI spec.** The Images API reference documents only `POST /images/generations` and `POST /images/edits` on the public API host (`api.openai.com/v1`), with API-key auth. Examples use `curl https://api.openai.com/v1/images/edits`. [PRIMARY] ([generate](https://developers.openai.com/api/reference/resources/images/methods/generate), [edit](https://developers.openai.com/api/reference/resources/images/methods/edit)) A GitHub code search for `backend-api` in `openai/openai-openapi` returns 0 results. [PRIMARY]
- **Codex docs.** The docs index is at `learn.chatgpt.com/llms.txt`; `developers.openai.com/codex/*` redirects to `learn.chatgpt.com/docs/*`. The full machine-readable manual (`codex-manual.md`) never mentions `backend-api/codex` or `images/generations`. The only `backend-api` mention is the `chatgpt_base_url` config key: `chatgpt_base_url = "https://chatgpt.com/backend-api/"` with the comment "Base URL for ChatGPT auth flow (not OpenAI API)", plus a managed-config description ("Enforce the ChatGPT service base URL before authentication…"). [PRIMARY] ([codex-manual.md](https://learn.chatgpt.com/docs/codex-manual.md))
- **Help Center.** "Using Codex with your ChatGPT plan" covers plans, limits, and terms, but no endpoints. [PRIMARY] ([help article 11369540](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan))
- **Changelog.** The Codex CLI 0.158.0 entry (2026-09-28) says: "Image generation and editing can explicitly request transparent backgrounds, and edits now accept file-backed conversation images. (#47484, #47956)". It describes the feature only, not the wire format. [PRIMARY] ([changelog](https://learn.chatgpt.com/docs/changelog))
- **App-server docs.** The docs list item types and `codexErrorInfo` values (including `UsageLimitExceeded`) and rate-limit `limitId` buckets such as `codex`. They do not document the `imageGeneration` item, although the generated schema in the repo contains it. [PRIMARY] ([app-server.md](https://learn.chatgpt.com/docs/app-server.md))
- **Other `backend-api` routes.** Public docs do not describe any of them either, including `/codex/responses`, `/codex/models`, `/wham/*`, and `/plugins/*`. They appear only in `openai/codex` source and tests. [PRIMARY: code search of the openai org for `"backend-api/codex"` found about 32 files, all in `openai/codex`] The one public ChatGPT-hosted admin API is `chatgpt.com/public/admin/api-reference` (Compliance and Enterprise Analytics). It is a separate API and has no image endpoints. [PRIMARY] (linked from the help article above)

**Closest official statements:**

1. The built-in path "uses `gpt-image-2` and counts toward your general Codex usage limits… For larger batches, set `OPENAI_API_KEY` … so API pricing applies." [PRIMARY] ([learn.chatgpt.com/docs/image-generation](https://learn.chatgpt.com/docs/image-generation))
2. The CLI source itself: `CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex"` is the default base URL for ChatGPT, token, agent-identity, and PAT auth modes. API-key auth uses `https://api.openai.com/v1`. That means the same `ImagesClient` calls the **public** Images API when Codex is signed in with an API key. [PRIMARY] ([model-provider-info/src/lib.rs#L77](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/model-provider-info/src/lib.rs#L77), [#L420-L438](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/model-provider-info/src/lib.rs#L420-L438))
3. [INFERENCE] Because the Codex request and response shapes are a subset of the public Images API schema, the Codex route is most likely a proxy with its own entitlement, metering, and parameter-override layer. OpenAI has not confirmed this.

---

## Q2. What do official Codex docs, help, and changelog say about Codex image generation?

| Topic | Official statement | Source |
|---|---|---|
| Model | "Built-in image generation uses `gpt-image-2`." `gpt-image-2-codex` appears nowhere in official docs; it comes only from community probes of the Responses tool echo. | [PRIMARY] [image-generation doc](https://learn.chatgpt.com/docs/image-generation) |
| Images 2.5 | "Images 2.5 is available to all ChatGPT, ChatGPT Work, and Codex users across desktop, mobile, and web." and "rolling out today to … Codex users across all tiers". The API models are `gpt-image-2.5-flare` and `gpt-image-2.5-sunburst`. No doc says how Codex maps to them. | [PRIMARY] [Images 2.5 announcement, 2026-09-08](https://openai.com/index/introducing-chatgpt-images-2-5/) |
| Plan availability | "Image generation isn't available on the Free plan. When you use Codex with an API key, API pricing applies…". The plan matrix lists "Image generation and editing" as available on Plus, Pro, Business, Enterprise, and API. | [PRIMARY] [pricing FAQ](https://learn.chatgpt.com/docs/pricing#image-generation-usage-limits) |
| Usage limits | "Image generation counts toward the same general usage limits as local messages and cloud chats. Image generations use included limits 3-5x faster on average… After you reach your included limits, image generation also draws from credits." | [PRIMARY] same |
| Credit rates | "GPT-Image-2 (image)": 200 / 50 (cached) / 750 credits per 1M input/cached/output tokens. "GPT-Image-2 (text)": 125 / 31.25 / 250. | [PRIMARY] same, token-rates table |
| ChatGPT image caps | ChatGPT image-generation caps ("50 images in the last day" banners) "do not apply to Codex". | [PRIMARY] [help 11369540](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan) |
| `image_gen` limit id | Not in the docs. It exists in source and tests (see Q3). The docs mention only `limitId` values such as `codex` and `codex_other`. | [PRIMARY] [app-server.md](https://learn.chatgpt.com/docs/app-server.md) |
| Quality and size | The docs expose no quality or size controls for the built-in path. The bundled `$imagegen` skill says built-in `image_gen` and the CLI fallback "do not expose the same controls", and that `quality`, `input_fidelity`, masks, `background`, and `output_format` are "fallback-only execution controls". | [PRIMARY] [skill image-api.md](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/skills/src/assets/samples/imagegen/references/image-api.md) |
| Transparency | Changelog 0.158.0 says generation and edits "can explicitly request transparent backgrounds". The API reference says transparent backgrounds for `gpt-image-2` are "in preview". The bundled fallback CLI script still rejects `gpt-image-2` + transparent ([#43757](https://github.com/openai/codex/issues/43757)). | [PRIMARY] [changelog](https://learn.chatgpt.com/docs/changelog), [generate ref](https://developers.openai.com/api/reference/resources/images/methods/generate) |
| Edits | CLI: attach with `-i/--image`. IDE: Shift-drag. Changelog: "edits now accept file-backed conversation images". | [PRIMARY] [image-generation doc](https://learn.chatgpt.com/docs/image-generation) |
| Saved location | The docs do not name it. The official bundled skill says: "Codex saves generated images under `$CODEX_HOME/*` by default … move or copy the selected output from `$CODEX_HOME/generated_images/...`". Source saves to `$CODEX_HOME/generated_images/<thread_id>/<call_id>.png`, sanitizing each path segment to `[A-Za-z0-9_-]`. | [PRIMARY] [SKILL.md#L33-L41](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/skills/src/assets/samples/imagegen/SKILL.md#L33-L41), [artifact.rs#L5-L35](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/src/artifact.rs#L5-L35), [app-server/src/extensions.rs#L101-L103](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/app-server/src/extensions.rs#L101-L103) |
| Feature flag | Feature `image_generation` (legacy alias `imagegenext`) is `Stage::Stable` and `default_enabled: true`. A maintainer said: "Feature flags are used when a feature is being developed… Once a feature is stable, it is generally always on." | [PRIMARY] [features/src/lib.rs#L1552-L1557](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/features/src/lib.rs#L1552-L1557), [#26643](https://github.com/openai/codex/issues/26643) |

---

## Q3. What does openai/codex source show? [PRIMARY throughout]

### Where the client lives, and when it changed

- The request and response types are in [`codex-rs/codex-api/src/images.rs`](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/codex-api/src/images.rs).
- The HTTP client is in [`codex-rs/codex-api/src/endpoint/images.rs`](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/codex-api/src/endpoint/images.rs).
- The tool, backend, and extension are in [`codex-rs/ext/image-generation/src/`](https://github.com/openai/codex/tree/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/src).
- History:
  - #23989: typed Images client (2026-05-22)
  - #24723: standalone extension (2026-05-28)
  - #33677: forward thread originator (2026-07-16)
  - #36092: `x-codex-image-turn-id` (2026-07-30)
  - #38024: usage-limit failures (2026-08-11)
  - #40714 and #47327: request ids (2026-08-25, 2026-09-22)
  - #47484: explicit background (2026-09-23)
  - #47956: `file_id` edits (2026-09-24)
- The older hosted-Responses `image_generation` tool is no longer planned. `spec_plan.rs` only gates `image_gen.imagegen` ([#L1493-L1497](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/core/src/tools/spec_plan.rs#L1493-L1497)).

### Request structs ([images.rs#L5-L49](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/codex-api/src/images.rs#L5-L49))

```rust
struct ImageGenerationRequest { prompt: String, background: Option<ImageBackground>, model: String,
                                n: Option<u64>, quality: Option<ImageQuality>, size: Option<String> }
struct ImageEditRequest       { images: Vec<ImageReference>, prompt, background, model, n, quality, size }
enum ImageBackground { Transparent, Opaque, Auto }         // lowercase
enum ImageQuality    { Low, Medium, High, Auto }           // lowercase; no xhigh/max
// All Option fields are skip_serializing_if = None.
// ImageReference serializes as {"image_url": "..."} or {"file_id": "..."}
```

### What the tool actually sends ([tool.rs#L427-L497](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/src/tool.rs#L427-L497))

- `IMAGE_MODEL = "gpt-image-2"` is hardcoded ([#L58](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/src/tool.rs#L58)). Other constants: `MAX_EDIT_IMAGES = 5`, and a 32 MiB cap on decoded output bytes ([#L59-L62](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/src/tool.rs#L59-L62)).
- The model-facing args are strict (`deny_unknown_fields`): `prompt`, `transparent_background: bool` (default false), `referenced_image_paths` (≤5 absolute paths), and `num_last_images_to_include` (1–5). The two image arguments are mutually exclusive ([#L87-L98](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/src/tool.rs#L87-L98)).
- Generate: `{prompt, background: transparent|opaque, model: "gpt-image-2", n: None, quality: Auto, size: "auto"}`.
- Edit: the same fields plus `images`. Local paths are read through the sandboxed FS and sent as `data:` URLs. With `num_last_images_to_include`, recent conversation images are sent as `image_url` or `file_id` in chronological order, and prior `ImageGenerationCall.result` values are re-sent as `data:image/png;base64,…` ([#L499-L555](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/src/tool.rs#L499-L555)).
- `background` never goes out as `auto` from the tool. Since #47484, `false` or an omitted value maps to `opaque`.
- Only `data[0]` is used. `transparent_background` in the item is taken from the **response** `background` ([#L182-L201](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/src/tool.rs#L182-L201)).
- `revised_prompt` in the item is the **model's own prompt argument** (`Some(args.prompt)`), not a server-revised prompt ([#L208](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/src/tool.rs#L208), [#L238](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/src/tool.rs#L238)).
- The tool description tells the model that imagegen "needs a few minutes to finish" and suggests a 120 s first yield in code mode ([imagegen_description.md#L7](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/imagegen_description.md#L7)).

### Wire bodies asserted in tests

- **Generate**, app-server integration test ([imagegen_extension.rs#L166-L175](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/app-server/tests/suite/v2/imagegen_extension.rs#L166-L175)):

  ```json
  {"prompt":"paint a blue whale","background":"opaque|transparent","model":"gpt-image-2","quality":"auto","size":"auto"}
  ```

  The same test asserts the `originator` header equals the thread originator (`chatgpt_cca`) and that `x-codex-image-turn-id` equals the turn id ([#L176-L185](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/app-server/tests/suite/v2/imagegen_extension.rs#L176-L185), [#L1074-L1078](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/app-server/tests/suite/v2/imagegen_extension.rs#L1074-L1078)).
- **Unit tests** in [endpoint/images.rs#L245-L378](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/codex-api/src/endpoint/images.rs#L245-L378). The client posts to `{base_url}/images/generations` and `{base_url}/images/edits`. The edit body is `{"images":[{"image_url":"data:image/png;base64,Zm9v"},{"file_id":"file-image"}],"prompt":"add a red hat","model":"gpt-image-1.5"}`.
- **Response fixture** ([#L198-L221](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/codex-api/src/endpoint/images.rs#L198-L221)):

  ```json
  {"created":1778832973,"background":"opaque","data":[{"b64_json":"…"}],"output_format":"png",
   "quality":"medium","size":"1024x1536",
   "usage":{"input_tokens":1474,"input_tokens_details":{"image_tokens":1457,"text_tokens":17},
            "output_tokens":1372,"output_tokens_details":{"image_tokens":1372,"text_tokens":0},"total_tokens":2846}}
  ```

  Parsed response struct: `ImageResponse { created, data: Vec<ImageData{b64_json, generation_id?}>, background?, quality?, size? }`. `output_format` and `usage` are ignored ([images.rs#L51-L68](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/codex-api/src/images.rs#L51-L68)). A response without `data` fails with `failed to decode image generation response: missing field 'data'`.

### Headers sent

| Header | Value | Where |
|---|---|---|
| `Authorization` | `Bearer <ChatGPT access_token>`. Agent-identity auth uses a signed agent-task value instead. | [bearer_auth_provider.rs#L31-L47](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/model-provider/src/bearer_auth_provider.rs#L31-L47), [model-provider/src/auth.rs#L87-L113](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/model-provider/src/auth.rs#L87-L113) |
| `ChatGPT-Account-ID` | account/workspace id | same |
| `X-OpenAI-Fedramp` | `true` for FedRAMP accounts only | same |
| `originator` | Process default comes from `default_headers()`, normally `codex_cli_rs`. A per-thread override is added only when it differs from the process default. | [default_client.rs#L121-L139](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/login/src/auth/default_client.rs#L121-L139), [#L456-L469](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/login/src/auth/default_client.rs#L456-L469), [backend.rs#L132-L141](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/src/backend.rs#L132-L141) |
| `User-Agent` | `{originator}/{version} ({os_type} {os_version}; {arch}) {terminal-ua}[ ({client suffix})]` | [default_client.rs#L152-L179](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/login/src/auth/default_client.rs#L152-L179) |
| `x-openai-internal-codex-residency` | `us` when residency is enforced by managed config | [model-provider-info/src/lib.rs#L38](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/model-provider-info/src/lib.rs#L38), [#L440-L446](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/model-provider-info/src/lib.rs#L440-L446) |
| `version` | CLI crate version, a static provider header on the built-in `openai` provider | [lib.rs#L532-L536](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/model-provider-info/src/lib.rs#L532-L536) |
| `OpenAI-Organization`, `OpenAI-Project` | only if the `OPENAI_ORGANIZATION` / `OPENAI_PROJECT` env vars are set | [lib.rs#L537-L546](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/model-provider-info/src/lib.rs#L537-L546) |
| `x-codex-image-turn-id` | current turn id | [backend.rs#L17](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/src/backend.rs#L17), [#L132-L141](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/src/backend.rs#L132-L141) |
| Cookies | Process-global jar holding only Cloudflare infrastructure cookies and the `__oailb` routing cookie | [http-client/src/chatgpt_cloudflare_cookies.rs#L17-L22](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/http-client/src/chatgpt_cloudflare_cookies.rs#L17-L22), [default_client.rs#L416-L420](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/login/src/auth/default_client.rs#L416-L420) |

Response header read: `x-codex-imagegen-request-id`, kept on both success and HTTP errors ([endpoint/images.rs#L17](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/codex-api/src/endpoint/images.rs#L17), [#L30-L42](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/codex-api/src/endpoint/images.rs#L30-L42), [#L110-L116](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/codex-api/src/endpoint/images.rs#L110-L116)). The images client does not send `OpenAI-Beta`, `session_id`, or `conversation_id`.

### Streaming

**Codex does not stream images.** `post_image_request` calls `EndpointSession::execute` (a buffered POST) and deserializes the whole body. The test transport's `stream()` returns `"stream should not run"` ([endpoint/images.rs#L85-L107](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/codex-api/src/endpoint/images.rs#L85-L107), [#L176-L178](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/codex-api/src/endpoint/images.rs#L176-L178)).

Retry policy is `retry_5xx: true`, `retry_transport: true`, `retry_429: false`, with a 200 ms base delay ([model-provider-info/src/lib.rs#L447-L453](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/model-provider-info/src/lib.rs#L447-L453), [session.rs#L80-L114](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/codex-api/src/endpoint/session.rs#L80-L114)).

### Error and usage-limit mapping

Source: [api_bridge.rs#L143-L255](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/codex-api/src/api_bridge.rs#L143-L255) and [tool.rs#L261-L286](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/src/tool.rs#L261-L286).

- **400** with `error.code` ∈ {`cyber_policy`, bio policy, `invalid_prompt`} maps to typed policy errors. A body containing "The image data you provided does not represent a valid image" maps to `InvalidImageRequest`. Anything else maps to `InvalidRequest(body)`.
- **429** results depend on the body:
  - `error.type == "usage_limit_reached"` → `UsageLimitReached { plan_type, resets_at, limit_window_minutes, rate_limits, promo_message, rate_limit_reached_type }`. The limit id comes from the `x-codex-active-limit` response header. Rate-limit windows are read from `x-<limit-id with _→->>-primary-used-percent|window-minutes|reset-at` and the matching `secondary-*` headers ([rate_limits.rs#L57-L73](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/codex-api/src/rate_limits.rs#L57-L73)).
  - `usage_not_included` → `UsageNotIncluded`.
  - `insufficient_quota` or a spend-limit code → `QuotaExceeded`.
  - Otherwise → `RetryLimit`.
- **Image-specific handling:** only when `rate_limits.limit_id == "image_gen"` does the tool emit `ImageGenerationFailure::UsageLimitExceeded { limitId: "image_gen", resetsAt }`. `resetsAt` comes from `error.resets_at`, or else from the max `resets_at` among windows with `used_percent >= 100`. Every failure is also returned to the model as `image generation failed: <message>`.
- **Fixture used by the app-server test** ([imagegen_extension.rs#L590-L606](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/app-server/tests/suite/v2/imagegen_extension.rs#L590-L606)):

  ```text
  HTTP 429
  x-codex-active-limit: image_gen
  x-image-gen-primary-used-percent: 100
  x-image-gen-primary-window-minutes: 1440
  x-image-gen-primary-reset-at: <unix>
  {"error":{"type":"usage_limit_reached","message":"image limit reached","resets_at":<unix>,"plan_type":"plus"}}
  ```

  This is a test fixture, so production values such as the 1440-minute window are unverified.

### Availability gating (client side)

- The tool is registered only when the provider `is_openai()`, `requires_openai_auth`, or uses actor authorization ([extension.rs#L41-L49](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/src/extension.rs#L41-L49)).
- It is exposed only if all of these hold ([spec_plan.rs#L727-L763](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/core/src/tools/spec_plan.rs#L727-L763)):
  - the `ImageGeneration` feature is on,
  - the plan type is not `Free`,
  - the provider supports image generation and namespace tools,
  - the chat model accepts image input,
  - auth uses the Codex backend or actor auth.

### App-server protocol items

- `ImageGenerationItem` has `{ id, status: "in_progress"|"completed"|"failed", revisedPrompt: string|null, result: <base64>, transparentBackground?: boolean, failure: ImageGenerationFailure|null, savedPath?: AbsolutePathBuf }`. Two more fields, `imagegen_request_id` and `generation_id`, are `#[serde(skip)]`: they are used only for in-process analytics and are not sent on the wire ([ext/items/src/image_generation.rs#L7-L54](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/items/src/image_generation.rs#L7-L54); TS: `app-server-protocol/schema/typescript/ImageGenerationItem.ts`).
- `ImageGenerationFailure = { type: "usageLimitExceeded", limitId: string, resetsAt: number|null }`.
- Legacy events `ImageGenerationBegin` and `ImageGenerationEnd` carry `{call_id, status, revised_prompt, result, transparent_background, failure, saved_path}` ([tool.rs#L100-L110](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/src/tool.rs#L100-L110)).
- The model receives an `input_image` (`detail: "high"`) and a text hint of at most 1024 bytes: "Generated images are saved to {dir} as {path} by default…" ([artifact.rs#L37-L46](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/src/artifact.rs#L37-L46)).
- The legacy hosted Responses item `image_generation_call {id, status, revised_prompt?, result}` is still parsed from history ([protocol/src/models.rs#L1205-L1226](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/protocol/src/models.rs#L1205-L1226)).

---

## Q4. What does the public OpenAI Images API accept, and how does that differ from Codex?

Sources: [generate ref](https://developers.openai.com/api/reference/resources/images/methods/generate), [edit ref](https://developers.openai.com/api/reference/resources/images/methods/edit), [Images resource and stream events](https://developers.openai.com/api/reference/resources/images/index.md), [image generation guide](https://developers.openai.com/api/docs/guides/image-generation). All [PRIMARY].

**Generations (`POST /v1/images/generations`):**

- `prompt`: up to 32000 characters for GPT image models.
- `background`: `transparent|opaque|auto`. Transparent is "in preview" for `gpt-image-2` and requires `png` or `webp`.
- `model`: `gpt-image-1`, `gpt-image-1-mini`, `gpt-image-1.5`, `gpt-image-2`, `gpt-image-2-2026-04-21`, `gpt-image-2.5-sunburst(-2026-09-08)`, `gpt-image-2.5-flare(-2026-09-08)`, `dall-e-2`, `dall-e-3`.
- `moderation`: `low|auto`.
- `n`: 1–10.
- `output_compression`: 0–100, jpeg/webp only.
- `output_format`: `png|jpeg|webp`.
- `partial_images`: 0–3.
- `quality`: `low|medium|high|auto`, plus `xhigh|max` for 2.5 models; `hd|standard` for DALL·E.
- `response_format`: `url|b64_json`, DALL·E only. GPT image models always return base64.
- `size`: `WxH`, both edges multiples of 16, aspect ratio 1:3–3:1, above `2560x1440` experimental, max `3840x2160`, total pixels 655,360–8,294,400. Or `auto`.
- `stream`: bool.
- `style`: DALL·E 3 only.
- `user`.

**Edits (`POST /v1/images/edits`, JSON):**

- `images: [{file_id}|{image_url}]`, up to 16 images for GPT image models.
- `prompt`, `background`, `model` (also `chatgpt-image-latest`), `moderation`, `n`, `output_compression`, `output_format`, `partial_images`, `quality`, `size`, `stream`, `user`.
- `input_fidelity: high|low`. For `gpt-image-2`, "omit this parameter; the API doesn't allow changing it".
- `mask: {file_id}|{image_url}`.

**Response:** `{created, background?, data[{b64_json?, revised_prompt? (dall-e-3), url? (dall-e)}], output_format?, quality?, size?, usage?}`.

**Streaming events (SSE):**

- `image_generation.partial_image` / `image_edit.partial_image`: `{type, b64_json, background, created_at, output_format, partial_image_index, quality, size}`
- `image_generation.completed` / `image_edit.completed`: `{type, b64_json, background, created_at, output_format, quality, size, usage}`
- Each partial image costs an extra 100 image output tokens.
- The Responses-API equivalent is `response.image_generation_call.partial_image` (`partial_image_index`, `partial_image_b64`).

**Errors:** `error.type = "image_generation_user_error"`, `error.code = "moderation_blocked"`, with optional `moderation_details {moderation_stage: input|output|unknown, categories[]}`.

**Where Codex differs from the public API:**

- Codex sends no `n`, `stream`, `partial_images`, `output_format`, `output_compression`, `moderation`, `user`, `mask`, or `input_fidelity`.
- Codex's `ImageQuality` enum cannot express `xhigh` or `max`.
- Codex caps edits at 5 references, not 16.
- Codex's response struct has a `generation_id` per image, which is not in the public schema. It ignores `usage` and `output_format`.
- Codex requests transparency on `gpt-image-2`, which the public API calls "preview".
- The public API has no `x-codex-*` headers and uses API-key auth.

---

## Q5. What `originator` values exist, and what has OpenAI said about third-party clients?

### Values found in source [PRIMARY]

| Value | Where it comes from |
|---|---|
| `codex_cli_rs` | `DEFAULT_ORIGINATOR`. Overridable with env `CODEX_INTERNAL_ORIGINATOR_OVERRIDE` ([default_client.rs#L42-L83](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/login/src/auth/default_client.rs#L42-L83)) |
| `codex_exec` | `codex exec` sets it at startup ([exec/src/lib.rs#L260](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/exec/src/lib.rs#L260)) |
| `codex_sdk_ts` | The TypeScript SDK sets `CODEX_INTERNAL_ORIGINATOR_OVERRIDE` ([sdk/typescript/src/exec.ts#L45-L46](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/sdk/typescript/src/exec.ts#L45-L46), [#L186-L187](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/sdk/typescript/src/exec.ts#L186-L187)) |
| any `clientInfo.name` (e.g. `codex-tui`, `codex_vscode`, `Codex Desktop`) | The app-server `initialize` validates it as a header value and uses it as the process originator. `codex_app_server_daemon` and `codex-backend` do not change the global identity ([initialize_processor.rs#L19](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/app-server/src/request_processors/initialize_processor.rs#L19), [#L93-L132](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/app-server/src/request_processors/initialize_processor.rs#L93-L132), [#L166-L184](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/app-server/src/request_processors/initialize_processor.rs#L166-L184)) |
| `codex_work_desktop`, `codex_work_web`, `codex_work_mobile`, `codex_work_cca`, `chatgpt_cca` | Thread `service_name` → originator ([core/src/thread_manager.rs#L356-L370](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/core/src/thread_manager.rs#L356-L370)) |
| First-party predicates | `is_first_party_originator`: `codex_cli_rs`, `codex-tui`, `codex_vscode`, or prefix `Codex `. `is_first_party_chat_originator`: `codex_atlas`, `codex_chatgpt_desktop` ([default_client.rs#L141-L150](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/login/src/auth/default_client.rs#L141-L150)). Client-side, the first predicate only gates MCP skill-dependency prompts ([core/src/mcp_skill_dependencies.rs#L47-L51](https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/core/src/mcp_skill_dependencies.rs#L47-L51)). |

What the originator is for:

- PR [#33677](https://github.com/openai/codex/pull/33677): "Standalone web search and image requests need to preserve the trusted, thread-scoped originator used for billing attribution." [PRIMARY]
- The server behaves differently by originator. The `/codex/models` catalog returned different GPT-5.6 Sol context windows for coding originators (`codex_cli_rs`, `codex-tui`, `Codex Desktop`, `codex_vscode`) than for omitted, `foo`, `codex_atlas`, or `codex_chatgpt_desktop` ([#40258](https://github.com/openai/codex/issues/40258), closed after a server-side change, with no maintainer comment). [SECONDARY]

### Statements about third-party clients and OAuth tokens

- **Codex for Open Source page:** "Developers should code in the tools they prefer, whether that's Codex, OpenCode, Cline, pi, OpenClaw, or something else, and this program supports that work." [PRIMARY] ([developers.openai.com/community/codex-for-oss](https://developers.openai.com/community/codex-for-oss))
- **Tibo Sottiaux (OpenAI), May 23:** "About 5% of our production traffic is on the Pi harness, about another 5% is on OpenCode. Reminder you can use your ChatGPT account in a flourishing set of other tools." [STAFF] ([x.com/thsottiaux/status/2058071172361998482](https://x.com/thsottiaux/status/2058071172361998482))
- **Terms of Use (effective 2026-01-01):** "You may not share your account credentials…". Prohibited uses include "Automatically or programmatically extract data or Output" and "circumvent any rate limits or restrictions or bypass any protective measures". The Codex help article says the ChatGPT Terms of Use apply to Codex sign-ins. [PRIMARY] ([terms](https://openai.com/policies/row-terms-of-use/), [help 11369540](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan))
- **Auth docs:** they treat `~/.codex/auth.json` like a password. Copying it to headless machines, CI, or containers is documented only for running Codex itself. [PRIMARY] ([auth.md](https://learn.chatgpt.com/docs/auth.md))
- **Harness identification.** Hermes PR [#90162](https://github.com/NousResearch/hermes-agent/pull/90162), by `vignesh-oai` (OpenAI affiliation not verified), says "OpenAI requires third-party Codex harnesses to identify the originating harness". The merged salvage PR [#94097](https://github.com/NousResearch/hermes-agent/pull/94097) describes it as "requested by OpenAI". Hermes now sends `originator: hermes-agent` and `User-Agent: HermesAgent/<ver>`. OpenCode sends `originator: opencode` ([anomalyco/opencode#42959](https://github.com/anomalyco/opencode/pull/42959)). Pi switched to `originator: "pi"` in a commit titled "Prepare for alternative Codex harness certification" ([earendil-works/pi@6dcb645](https://github.com/earendil-works/pi/commit/6dcb64565a66de609413de6c98457ca7ab450da9)). [SECONDARY]
- **Open request for a contract:** [openai/codex#36886](https://github.com/openai/codex/issues/36886) (2026-08-04) asks for a documented auth contract for third-party clients. It is open with 0 comments. [SECONDARY]
- [INFERENCE] The path OpenAI tolerates most visibly is: an honest, product-specific `originator` and `User-Agent`, the user's own login, no impersonation of `codex_cli_rs`, and no bypassing of limits. None of this is a written guarantee.

---

## Q6. GitHub issues and PRs in openai/codex

Issues are open unless marked otherwise. "No maintainer reply" means that no OpenAI member or collaborator commented; the `github-actions` duplicate bot is excluded.

| Issue | Topic | Key facts | Maintainer? |
|---|---|---|---|
| [#28723](https://github.com/openai/codex/issues/28723) | `size`/`quality` ignored, `gpt-image-2-codex` | Hosted Responses tool echoes `gpt-image-2-codex / auto / auto` for a `gpt-image-2 / high / 2160x3040` request. A comment from 2026-07-21 reproduces it on the **native** `POST …/codex/images/generations`: requested high/2160x3040, got `medium / 1024x1536`, with dimensions verified from the IHDR. One comment says "quality low is overridden to auto". Labels: bug, app-server, imagen. | No reply (as of 2026-09-29) |
| [#43965](https://github.com/openai/codex/issues/43965) | No model selector / effective model (Images 2.5) | Two independent native-endpoint probes. `gpt-image-2.5-flare` and an intentionally invalid model both returned 200 with the same reported fields. `gpt-image-2.5-sunburst` gave 1536×1024 while the invalid model gave 1254×1254, with `quality=low` honored in that run. Response keys: `background, created, data, output_format, quality, size, usage`. `data[]` holds `b64_json, generation_id`. No effective-model field. C2PA shows `gpt-image / 2.0`. | No reply |
| [#45452](https://github.com/openai/codex/issues/45452) | C2PA cannot distinguish Codex / Flare / Sunburst | All three carry `softwareAgent gpt-image 2.0`. | No reply |
| [#20839](https://github.com/openai/codex/issues/20839) (closed) | Request: explicit `size`, `quality`, `output_format`, path on `image_gen` | Closed automatically for lack of upvotes. | Auto-close by `etraut-openai` |
| [#38620](https://github.com/openai/codex/issues/38620) | Docs: built-in vs CLI quality controls | Labeled documentation. | No reply |
| [#42482](https://github.com/openai/codex/issues/42482) | 403 `{"code":"INSUFFICIENT_BALANCE"}` on built-in image gen with Pro + 21% weekly remaining + 0 credits | Suggests a separate image entitlement or credit check. | No reply |
| [#26595](https://github.com/openai/codex/issues/26595), [#26731](https://github.com/openai/codex/issues/26731) | `TooManyRequests` / "image generation request was rate limited" while dashboard shows quota | | Translation only (`etraut-openai`) |
| [#36767](https://github.com/openai/codex/issues/36767) | Failed attempts consume quota | | No reply |
| [#25965](https://github.com/openai/codex/issues/25965) cluster (#25966–#25982, closed) | 2026-06-03 incident: "The model 'gpt-image-2' does not exist." | "This incident has been mitigated". | Yes (`etraut-openai`) |
| [#29645](https://github.com/openai/codex/issues/29645), [#32297](https://github.com/openai/codex/issues/32297), [#34891](https://github.com/openai/codex/issues/34891), [#45381](https://github.com/openai/codex/issues/45381) | `network error: error sending request for url (…/codex/images/generations or edits)` after ~240–308 s on complex prompts or references | Simple prompts succeed. Suggests a server- or edge-side timeout of about 5 min. | No reply |
| [#43250](https://github.com/openai/codex/issues/43250) | Immediate `http 404 Not Found: Some("")`, also 502s | | No reply |
| [#42743](https://github.com/openai/codex/issues/42743) | Transparency lost whenever a reference image is supplied | | No reply |
| [#43757](https://github.com/openai/codex/issues/43757) | Fallback CLI rejects `gpt-image-2` + transparent despite "preview" docs | | No reply |
| [#40248](https://github.com/openai/codex/issues/40248), [#44039](https://github.com/openai/codex/issues/44039) | `image_gen` tool not exposed despite skill | | No reply |
| [#26643](https://github.com/openai/codex/issues/26643) (closed) | `image_generation = false` ignored | "Feature flags… not intended to control stable features". | Yes |
| [#36886](https://github.com/openai/codex/issues/36886) | Third-party auth contract / `originator` meaning | | No reply |
| [#40258](https://github.com/openai/codex/issues/40258) (closed) | Model catalog gated by originator | Fixed server-side per reporter. | No comment |

Relevant merged PRs [PRIMARY]: [#24723](https://github.com/openai/codex/pull/24723), [#33677](https://github.com/openai/codex/pull/33677), [#36092](https://github.com/openai/codex/pull/36092), [#38024](https://github.com/openai/codex/pull/38024), [#40714](https://github.com/openai/codex/pull/40714), [#43953](https://github.com/openai/codex/pull/43953), [#47327](https://github.com/openai/codex/pull/47327), [#47484](https://github.com/openai/codex/pull/47484), [#47742](https://github.com/openai/codex/pull/47742), [#47956](https://github.com/openai/codex/pull/47956).

---

## Q7. Community reverse engineering [SECONDARY throughout]

| Project | Route and body | Headers | Observations and claims |
|---|---|---|---|
| [foksa/codex-img](https://github.com/foksa/codex-img) (Rust CLI, pushed 2026-09-28) | `POST …/codex/images/generations`: `{prompt, model:"gpt-image-2", size?, quality?, background?}`. Edits: `+images:[{image_url:"data:…"}]`, max 5. Fallback: `/codex/responses` with an `image_generation` tool and its own `instructions` string. | `Authorization`, `chatgpt-account-id`, **`originator: codex_cli_rs`** (impersonates), `OpenAI-Beta: responses=experimental` ([src/backend.rs#L140-L153](https://github.com/foksa/codex-img/blob/main/src/backend.rs)) | README claims: "The backend picks the image model and ignores the `model` field". `size` "is a hint" (1536x1024 came back as 1536x1024 and as 1370x1148; square ≈1254x1254). "`background: transparent` gives real alpha". "`quality` is capped at medium on the subscription". "The endpoint doesn't validate its inputs and ignores unknown values". Returns PNG only, so other formats are converted locally. Sends `-n` as separate parallel requests. Retries 429/5xx except quota. Treats `cf-mitigated: challenge` as a separate failure. |
| [luckyabsoluter/codex-imagegen-free-reference](https://github.com/luckyabsoluter/codex-imagegen-free-reference) (Python skill) | Default is `/codex/responses` (stream required: "rejects non-streaming requests with `Stream must be set to true`"), with an `image_generation` tool supporting `model`, `quality`, `size`, `background`, `output_format`, `output_compression`, `moderation`, `action`, `partial_images`, `input_image_mask`, and `instructions`. `--transport image-api` goes to `/codex/images/generations` via the OpenAI SDK with `{model, prompt, output_format, response_format:"b64_json", background?, moderation?, output_compression?, partial_images?, quality?, size?}`, and sets `stream:true` when partials are requested. Edits are sent as JSON with `images:[{image_url}]` because the SDK's multipart helper "does not match this Codex endpoint". | `Authorization`, `ChatGPT-Account-ID`, `User-Agent: codex-imagegen-free-reference`, **no `originator`** on the Images path | `--instructions` is allowed only on the Responses transport. Claims "Image API edits do not support partial streaming", enforced client-side and not proven. Its stream parser handles `image_generation.partial_image` / `.completed`, but only mocks are in tests. Author commented on #28723 that low quality is overridden to auto. |
| [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) `plugins/image_gen/openai-codex` (PR [#111000](https://github.com/NousResearch/hermes-agent/pull/111000)) | Native `images/generations` or `edits`: `{prompt, model:"gpt-image-2", n:1, quality, size, background:"opaque", images?}` | `Authorization`, `ChatGPT-Account-ID` and `x-openai-internal-codex-residency` (from JWT claim `https://api.openai.com/auth`), `originator: hermes-agent`, `User-Agent: HermesAgent/<ver>`, **random** `x-codex-image-turn-id` UUID | Reports `reported_quality`, `reported_size`, `pixel_size`, and `imagegen_request_id`, because "nonexistent model ids → 200, quality/size replaced" (maintainer `teknium1`, [issue #107233](https://github.com/NousResearch/hermes-agent/issues/107233)). #107233 found that `/codex/responses` echoes `model=gpt-image-2-codex quality=auto size=auto` for every tool spec, including `quality=max/xhigh`, invalid models, and an empty spec. A follow-up saw native `/images/edits` return `medium` for `high` and `low` for `auto`, but also got `high` in other runs. Hermes docs say residency-enforced workspaces return 401 without the residency header. |
| [eagleagentic/codex-imagegen-143](https://github.com/eagleagentic/codex-imagegen-143) | Delegates to pinned `@openai/codex@0.143.0` to avoid network-error regressions | n/a | Workaround only. |
| [twe4k/codex-image](https://github.com/twe4k/codex-image), [serah-creates/codex-image-gen](https://github.com/serah-creates/codex-image-gen) | Shell out to the Codex CLI's built-in `image_gen` | n/a | No direct endpoint use. |
| [IanShaw027/codex-image](https://github.com/IanShaw027/codex-image) | Public Images API with `OPENAI_API_KEY` | n/a | Not the OAuth route. |

What the community evidence says on each specific question:

- **`instructions`:** not an Images API field. It exists only on the `/codex/responses` route, where foksa and lucky send it. No one reports sending it to `/images/*`.
- **`model` override (e.g. `gpt-image-2.5-*`):** accepted with 200, but indistinguishable from an invalid id. No effective-model field. Selection is **unverified** (#43965, hermes #107233).
- **`stream`:** lucky's code sends `stream:true` plus `partial_images` to `/codex/images/generations` and parses SSE. There is no public log of a live SSE response. Codex itself never streams.

---

## Parameter comparison

| Parameter | Official Images API | Codex CLI sends | Documented behavior on Codex endpoint (plus community observation) |
|---|---|---|---|
| `prompt` | required, ≤32000 chars | tool `prompt` arg, unchanged | Undocumented. Reaches image model unchanged per foksa. [SECONDARY] |
| `model` | enum incl. `gpt-image-2`, `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst` (+ snapshots) | hardcoded `"gpt-image-2"` | Undocumented. Invalid ids accepted with 200; no effective-model field. [SECONDARY] |
| `background` | `transparent`/`opaque`/`auto` (gpt-image-2 transparent = preview) | `transparent` or `opaque` (never `auto`) | Changelog documents "explicit transparent backgrounds" as a feature, not a wire param. Real alpha reported (foksa), lost with references (#42743). |
| `quality` | `low/medium/high/auto`, `xhigh/max` (2.5) | `"auto"` | Undocumented. Overrides observed (`high`→`medium`, `auto`/`low` swaps); `high` sometimes honored. [SECONDARY] |
| `size` | `WxH` (constraints) or `auto` | `"auto"` | Undocumented. Treated as a hint; square ≈`1254x1254`; `2160x3040` → `1024x1536`. [SECONDARY] |
| `n` | 1–10 | omitted (field exists, `None`) | Undocumented. Codex parses multiple `data[]` in tests but uses `data[0]`. Hermes sends `n:1`. |
| `output_format` | `png/jpeg/webp` | omitted | Undocumented. foksa: endpoint returns PNG. Response carries `output_format: "png"`. |
| `output_compression` | 0–100 (jpeg/webp) | omitted | Undocumented; no reports. |
| `moderation` | `low`/`auto` | omitted | Undocumented. lucky allows sending it; effect unreported. #28723 commenter says moderation is stricter than API. |
| `stream` | bool | omitted (Codex client is non-streaming) | Undocumented. lucky implements it; live behavior unconfirmed. |
| `partial_images` | 0–3 | omitted | Undocumented; same as `stream`. |
| `response_format` | DALL·E only | omitted | Undocumented. lucky sends `b64_json`; apparently not rejected. |
| `style` | DALL·E 3 only | omitted | n/a |
| `user` | string | omitted | Undocumented. |
| `images` (edits) | ≤16 `{file_id}` or `{image_url}` | ≤5, `data:` URLs or `file_id` from conversation | Undocumented. Which file store `file_id` refers to is unknown. |
| `mask` (edits) | `{file_id}` or `{image_url}` | never | Undocumented; untested by anyone publicly on `/images/edits`. |
| `input_fidelity` (edits) | `high`/`low` (not for gpt-image-2) | never | Undocumented. |
| `instructions` | not a parameter | never | Not applicable to `/images/*`; only exists on `/codex/responses`. |
| Response `generation_id` | not in public schema | parsed per image | Codex-only field. |
| Response `usage` | present (GPT image) | ignored | Present per community probes and Codex fixture. |

---

## Unknowns to verify by live probe

Probe with an honest `originator` and `User-Agent`, a real `x-codex-image-turn-id`, and `ChatGPT-Account-ID`. Log `x-codex-imagegen-request-id` and all `x-*` response headers. Verify pixel dimensions from the PNG IHDR, not from response metadata.

1. **Baseline:** the exact Codex CLI body (`{prompt, background, model:"gpt-image-2", quality:"auto", size:"auto"}`) returns 200. Record the response keys, `quality`, `size`, `output_format`, `usage`, and `generation_id`.
2. **`originator`:** check whether a non-first-party value (e.g. `omp`) is accepted, whether omitting it matters, and whether any response differs by originator: 403, Cloudflare `cf-mitigated`, different quality, or different limits.
3. **`x-codex-image-turn-id`:** check whether it is required, and whether a random UUID works (Hermes uses one).
4. **`stream: true` + `partial_images`** on `/images/generations`: does the response come back as SSE with `image_generation.partial_image` / `.completed`, or is the flag ignored or rejected? Test the same on `/images/edits`.
5. **`n > 1`:** check whether multiple `data[]` entries come back and whether each is billed separately.
6. **`quality`:** does `high` (and `low`) hold on both generations and edits? Are `xhigh` and `max` rejected or silently normalized?
7. **`size`:** do fixed sizes like `1024x1024`, `1536x1024`, `2048x2048`, and a non-standard `WxH` come back exactly? Test the gap between the response `size` and the actual pixels.
8. **`model`:** does `gpt-image-2.5-flare` or `-sunburst` change latency, dimensions, or C2PA compared with `gpt-image-2` and an invalid id? Is there any response field or header indicating the effective model?
9. **`output_format`, `output_compression`:** does `jpeg` or `webp` return non-PNG bytes?
10. **`moderation: "low"`, `user`, `response_format`:** accepted, rejected with 400, or ignored?
11. **Edits:** is `mask` accepted? Is `input_fidelity` accepted or rejected for `gpt-image-2`? What is the maximum reference count the server enforces: 5, 16, or other? What `file_id` namespace applies?
12. **Transparency:** check `background:"transparent"` with and without reference images for a real alpha channel (#42743).
13. **Error shapes:** capture actual bodies and headers for:
    - 429 `usage_limit_reached` (`x-codex-active-limit: image_gen`, `x-image-gen-primary-*`)
    - 403 `INSUFFICIENT_BALANCE`
    - 400 `moderation_blocked` / `image_generation_user_error`
    - 401 expired token
    - residency 401

    Also check whether rate-limit headers appear on success responses.
14. **Timeouts:** is there a server-side cutoff around 240–308 s? Choose the client timeout accordingly.
15. **Plans:** does a Free-plan account get a server-side rejection? The CLI gates Free on the client only.
16. **Metering:** do image calls draw from the `codex` bucket, the `image_gen` bucket, or both? Watch `x-codex-*-primary-used-percent` before and after a call.

---

## Sources

**OpenAI documentation, help, changelog, and announcements [PRIMARY]**

- https://developers.openai.com/api/reference/resources/images/methods/generate
- https://developers.openai.com/api/reference/resources/images/methods/edit
- https://developers.openai.com/api/reference/resources/images/index.md (stream event types)
- https://developers.openai.com/api/docs/guides/image-generation
- https://developers.openai.com/api/docs/models/gpt-image-2
- https://learn.chatgpt.com/docs/image-generation
- https://learn.chatgpt.com/docs/pricing#image-generation-usage-limits
- https://learn.chatgpt.com/docs/changelog (redirect target of https://developers.openai.com/codex/changelog)
- https://learn.chatgpt.com/docs/codex-manual.md
- https://learn.chatgpt.com/docs/auth.md
- https://learn.chatgpt.com/docs/app-server.md
- https://learn.chatgpt.com/llms.txt
- https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- https://openai.com/index/introducing-chatgpt-images-2-5/
- https://openai.com/policies/row-terms-of-use/
- https://developers.openai.com/community/codex-for-oss

**openai/codex source at `c248f6d4` [PRIMARY]**

- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/codex-api/src/images.rs
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/codex-api/src/endpoint/images.rs
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/codex-api/src/endpoint/session.rs
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/codex-api/src/api_bridge.rs
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/codex-api/src/rate_limits.rs
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/src/tool.rs
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/src/backend.rs
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/src/extension.rs
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/src/artifact.rs
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/image-generation/imagegen_description.md
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/ext/items/src/image_generation.rs
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/login/src/auth/default_client.rs
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/model-provider/src/bearer_auth_provider.rs
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/model-provider/src/auth.rs
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/model-provider-info/src/lib.rs
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/core/src/tools/spec_plan.rs
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/core/src/thread_manager.rs
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/app-server/src/request_processors/initialize_processor.rs
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/app-server/tests/suite/v2/imagegen_extension.rs
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/exec/src/lib.rs
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/sdk/typescript/src/exec.ts
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/http-client/src/chatgpt_cloudflare_cookies.rs
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/skills/src/assets/samples/imagegen/SKILL.md
- https://github.com/openai/codex/blob/c248f6d48b97eb4a2aa56147a0b11b7d763278b9/codex-rs/skills/src/assets/samples/imagegen/references/image-api.md
- PRs: https://github.com/openai/codex/pull/24723, /33677, /36092, /38024, /47484, /47956

**Issues in openai/codex (reporters SECONDARY; maintainer replies PRIMARY)**

- https://github.com/openai/codex/issues/28723
- https://github.com/openai/codex/issues/43965
- https://github.com/openai/codex/issues/45452
- https://github.com/openai/codex/issues/42482
- https://github.com/openai/codex/issues/38620
- https://github.com/openai/codex/issues/20839
- https://github.com/openai/codex/issues/26595
- https://github.com/openai/codex/issues/26731
- https://github.com/openai/codex/issues/36767
- https://github.com/openai/codex/issues/29645
- https://github.com/openai/codex/issues/32297
- https://github.com/openai/codex/issues/34891
- https://github.com/openai/codex/issues/45381
- https://github.com/openai/codex/issues/43250
- https://github.com/openai/codex/issues/42743
- https://github.com/openai/codex/issues/43757
- https://github.com/openai/codex/issues/40248
- https://github.com/openai/codex/issues/44039
- https://github.com/openai/codex/issues/26643
- https://github.com/openai/codex/issues/25965
- https://github.com/openai/codex/issues/36886
- https://github.com/openai/codex/issues/40258

**OpenAI staff [STAFF]**

- https://x.com/thsottiaux/status/2058071172361998482

**Community [SECONDARY]**

- https://github.com/foksa/codex-img
- https://github.com/luckyabsoluter/codex-imagegen-free-reference (see `references/codex-direct.md`, `scripts/codex_image_gen.py`)
- https://github.com/NousResearch/hermes-agent/issues/107233
- https://github.com/NousResearch/hermes-agent/pull/111000
- https://github.com/NousResearch/hermes-agent/pull/90162
- https://github.com/NousResearch/hermes-agent/pull/94097
- https://github.com/NousResearch/hermes-agent/pull/6391
- https://github.com/anomalyco/opencode/pull/42959
- https://github.com/earendil-works/pi/commit/6dcb64565a66de609413de6c98457ca7ab450da9
- https://github.com/eagleagentic/codex-imagegen-143
- https://github.com/twe4k/codex-image
- https://github.com/serah-creates/codex-image-gen
- https://github.com/IanShaw027/codex-image
- https://manifest.build/blog/chatgpt-plus-tokens-third-party-harnesses (secondary summary of the Tibo post)
