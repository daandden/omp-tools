# ChatGPT-linked API credits for public Sunburst image generation

Researched on 2026-10-29 against current OpenAI documentation, including Context7's `/websites/developers_openai_api` and the linked first-party pages. Scope: whether the new subscription benefit can fund `generate_image` through the public Images API. No credentials, account billing pages, or live generation requests were accessed. This note does not establish this user's eligibility.

## Bottom line

OpenAI announced free API credits for eligible ChatGPT Pro and Business subscriptions on October 28, 2026. Calling this a benefit for all "Codex plan users" is too broad. The benefit explicitly covers Images API generation and editing, but excludes Codex usage through API keys and does not increase signed-in Codex limits. [CL] [GUIDE] [HELP]

`gpt-image-2.5-sunburst` is a documented public Images API model. **[INFERENCE]** Its billed image generation and editing can use this benefit because Images API usage is expressly covered and the current terms name no Sunburst exclusion. Actual access still depends on activation, the receiving organization, available credits, and model permissions. No account-specific credit deduction was tested. [GUIDE] [HELP] [MODEL]

This is a different authentication and billing path from the undocumented Codex route investigated in [codex-image-backend-model.md](codex-image-backend-model.md). That note's inconclusive Codex backend identification does not prevent selecting the documented public Sunburst model.

## Eligibility and credit amounts

The published full-period allowances are as follows. The first grant is prorated for the remaining paid billing period. [GUIDE] [HELP]

| Eligible subscription | API credits in USD |
| --- | --- |
| Pro $100 tier | $100 per monthly billing period |
| Pro $200 tier | $200 per monthly billing period |
| Pro $500 tier | $500 per monthly billing period |
| Business Standard | $20 per paid seat, pooled for the workspace |
| Business Premium | $100 per paid seat, pooled for the workspace |
| Business cap | $500 per monthly billing period, or $6,000 per annual billing period |

- The paid subscription must have been active for at least seven days. Trials and complimentary subscriptions do not qualify. Plus, Go, and Free are ineligible. Enterprise is ineligible. The Help Center does not establish Edu or legacy Codex seats as eligible. [GUIDE] [HELP]
- The person who activates must own both the Pro subscription or Business workspace and the receiving API organization, with billing-management permission. Business membership, an admin role alone, or a custom API billing role alone is insufficient. ChatGPT and API linking accounts must use the same email. [HELP]
- Availability depends on the enabled cohort and country. The benefit pages publish no country-by-country eligibility list. General [API supported countries][COUNTRIES] are a separate access requirement, not proof of promotional eligibility. [HELP]
- One subscription or workspace can link to one API organization, and an API organization can have only one active benefit link. ChatGPT seats do not grant API organization or project access. Changing the receiving organization requires Support and does not guarantee a credit transfer. [HELP]

## Activation, renewal, and expiry

Activation is opt-in. The claim flow is available in ChatGPT's **Settings > Billing**, Business workspace billing, or API Platform billing. It asks the owner to select and confirm the receiving API organization. Linking alone is not proof that a grant was issued. The organization's billing overview and **Credit grants** show the issued amount and expiry. No API payment method is required for an active free grant. [GUIDE] [HELP]

After activation, eligible renewals issue grants automatically while the benefit remains available. Monthly credits expire at subscription billing-cycle end without rollover. Annually prepaid Business workspaces receive the full-year grant upfront, prorated for the remaining term on first activation, with expiry at annual-cycle end. These are not credits valid for twelve months regardless of billing cadence. [GUIDE] [HELP]

Cancellation alone does not revoke an existing grant before expiry, but future grants stop when the subscription becomes ineligible. The benefit can change or end. Credits have no cash redemption value and cannot be transferred or sold. The offer's billing-cycle expiry applies rather than assuming the general service-credit default. [GUIDE] [HELP] [TERMS]

## Public API contract and project constraints

- Public alias: `gpt-image-2.5-sunburst`. Current default and available dated snapshot: `gpt-image-2.5-sunburst-2026-09-08`. The snapshot pins the model version. [MODEL]
- Direct endpoints: `POST https://api.openai.com/v1/images/generations` and `POST https://api.openai.com/v1/images/edits`, with the image model in the request's `model` field. Responses is a separate option with a supported mainline model and Sunburst selected inside its `image_generation` tool, not as the top-level Responses model. [IMAGE] [MODEL]
- Authentication: a standard API credential using HTTP Bearer authentication, normally a project API key supplied through `OPENAI_API_KEY`. The API also supports workload-identity-federation tokens. These docs do not establish that a Codex OAuth access token authenticates the public Images API. Official SDKs are optional because direct HTTP is supported. [AUTH] [IMAGE]
- Credits belong to the linked API organization. Requests must use a project API key from that organization. Organization and project headers select attribution when applicable, including legacy user keys. Credits do not override model access, API key permissions, verification requirements, or organization and project limits. GPT Image access may require API organization verification. [GUIDE] [HELP] [AUTH] [IMAGE]
- Sunburst supports `background: "transparent"` with PNG or WebP, and quality `low`, `medium`, `high`, `xhigh`, `max`, or `auto`. Image results are base64 data, not GPT Image URL responses. Prompts permit up to 32,000 characters, `n` is 1–10, and edits accept up to 16 source images. [IMAGE] [GENERATE] [EDIT]
- Custom dimensions must be multiples of 16, with aspect ratio between 1:3 and 3:1, neither edge above 3,840 pixels, and 655,360–8,294,400 total pixels. Resolutions above `2560x1440` are experimental. Rate limits remain organization-specific. The model page lists Build, Launch, and Grow limits of 20, 150, and 250 images per minute, respectively. [IMAGE] [MODEL]

## Exhaustion and paid usage

The organization spends promotional API credits before purchased API credits. If purchased credits remain after the promotional balance runs out, requests continue against purchased credits. If neither remains, requests fail with HTTP `429` and `error.code: "credit_balance_exhausted"`. Adding paid API credits or enabling Auto Recharge permits further use. A ChatGPT subscription payment is not itself an API payment method. [GUIDE] [HELP]

The documented benefit provides no per-request "promotional credits only" selector. **[INFERENCE]** An API key in an organization with purchased credits does not by itself guarantee free-only operation. Organization and project hard spend limits are available, but they cap tracked spend rather than select a credit source. Enforcement can lag and slightly exceed the configured amount. Spend alerts alone do not stop requests. [GUIDE] [SPEND]

Purchased ChatGPT usage credits are a different balance. They extend eligible signed-in feature usage, including Codex, and are explicitly not API credits. Their twelve-month purchase expiry is not the expiry rule for this new API grant. [USAGE]

## Full Images API parameter inventory

The user expanded the requested design to every parameter supported by Sunburst, with a separate Codex mode retaining current behavior. The inventory below comes from the current generation and edit references. A field appearing in their combined schema does not establish that Sunburst supports it. [GENERATE] [EDIT]

| Parameter | Endpoint | Documented behavior |
| --- | --- | --- |
| `model` | Both | Sunburst alias `gpt-image-2.5-sunburst` or snapshot `gpt-image-2.5-sunburst-2026-09-08`. |
| `prompt` | Both | Text description, up to 32,000 characters. The edit reference requires at least one character. |
| `background` | Both | `auto`, `opaque`, or `transparent`. Transparency requires PNG or WebP output. |
| `moderation` | Both | `auto` or `low`. `low` is less restrictive filtering, not disabled moderation. |
| `n` | Both | One to ten final outputs. Supporting this field requires returning and saving every final image, not taking only the first. |
| `quality` | Both | `auto`, `low`, `medium`, `high`, `xhigh`, or `max`. |
| `size` | Both | `auto` or supported `WIDTHxHEIGHT` dimensions, subject to the limits above. |
| `output_format` | Both | `png`, `jpeg`, or `webp`. The API default is PNG. |
| `output_compression` | Both | Integer 0–100 for JPEG and WebP. The generation reference defaults to 100. This is not a documented lossless-WebP guarantee. |
| `stream` | Both | Request a streaming response rather than one JSON result. |
| `partial_images` | Both | Zero to three progressive previews during streaming. The server may produce fewer previews when the final image completes sooner. |
| `safety_identifier` | Both | Stable privacy-preserving end-user identifier, at most 128 characters. A nonempty value takes precedence over `user`. |
| `user` | Both | Deprecated but still accepted. Used when `safety_identifier` is omitted, null, or empty. |
| `images` | Edits | One to sixteen references represented by `image_url` or `file_id`. URLs may be fully qualified or base64 data URLs, with a documented maximum URL length of 20,971,520 characters. Multipart local-file uploads are another documented representation. |
| `mask` | Edits | Image reference using exactly one of `image_url` or `file_id`. Cannot be combined with `markup`. Consult the guide's alpha, format, and dimension requirements. |
| `markup` | Edits | Transparent PNG overlay on the first reference, matching its dimensions after orientation and containing transparent pixels. Accepts a file ID, HTTPS URL, or base64 data URL. Cannot be combined with `mask`. |
| `input_fidelity` | Edits, model-specific | The references document selectable fidelity for earlier GPT Image models, not a configurable Sunburst setting. Do not present it as a proven Sunburst control. |
| `response_format`, `style` | Legacy generation fields | Explicitly unsupported for GPT Image models. Sunburst returns base64 image data; style belongs in the prompt. Legacy `standard` and `hd` quality values and old small-size presets likewise do not establish Sunburst support. |

OpenAI documents image-generation and image-edit SSE events separately. Each has partial-image and completed events carrying image bytes and reported output settings. A complete implementation must display partials without treating them as final artifacts, then return and save the completed outputs. Each partial image adds 100 image output tokens. Streaming support is more than forwarding `stream: true`. [IMAGE] [GENSTREAM] [EDITSTREAM]

Existing local-path and recent-conversation reference selection can remain. **[INFERENCE]** The plugin can resolve their bytes and submit the documented data-URL or multipart representation. It need not make OpenAI understand a local filesystem path or an OMP conversation. Mask and markup bytes must retain the formats and dimensions those controls require. [IMAGE] [EDIT]

Request authentication and organization or project attribution are separate from image-body parameters. Neither the image-body schema nor these headers selects a promotional grant. The Help Center lets organization owners inspect credit-grant records, but an API usage-cost report is not proof that purchased credits, rather than a grant, paid for a particular request. No supported grant-only Images API request selector was found in the cited references. [AUTH] [GENERATE] [EDIT] [GUIDE] [HELP]

## WebP encoding evidence

The public API reference documents WebP output and `output_compression: 100`, but does not promise lossless WebP at that setting. Earlier observations of lossless WebP on the hosted Codex Responses route do not establish the public Sunburst Images API's encoding. [GENERATE] [IMAGE]

A fresh OMP 18.13.3 RPC probe on 2026-10-29 attempted to resolve the `openai` credential through the host registry. It returned no credential, so the probe sent no API request. Whether this account's public Sunburst output uses lossy `VP8 ` or lossless `VP8L` remains unobserved.

The existing `toLosslessWebp` function was exercised directly with a synthetic 4×3 RGBA PNG containing transparent, translucent, and opaque pixels. Its result used `VP8L`, and decoding the source and result through the same PNG encoder produced byte-identical PNGs. This proves the local PNG-to-lossless-WebP path for that fixture, not the public API's WebP format. Requesting PNG and then using that local conversion avoids relying on an undocumented server WebP guarantee.

## Account-specific limits and agreed design

Account-specific eligibility, enabled country and cohort, grant issuance, balance, expiry, linked organization, model access, and paid-credit or Auto Recharge settings remain unknown. No credit claim, organization link, or billing-setting change was made. A real Sunburst generation and edit remain verification prerequisites for implementation, not results established by this research. [HELP]

The grilling session resolved the target design:

- Add the extension setting `imageGenerationMode`, defaulting to `openai`. Its values are `openai` and `codex`. A new session applies a changed mode and exposes only that mode's arguments.
- Preserve the current Codex OAuth implementation and its four-argument contract in Codex mode. OpenAI mode uses the public Images API and OMP's `openai` credential, without automatic fallback between modes.
- Implement every documented Sunburst-supported generation and edit control. Default to `gpt-image-2.5-sunburst`, with its dated snapshot selectable. Do not expand selection to every GPT Image model or advertise legacy fields as Sunburst capabilities.
- Keep local-file and recent-conversation reference selection alongside native URL, data-URL, and file-ID sources. In OpenAI mode, use `background` instead of the old `transparent_background` boolean.
- Use normal API billing because no supported grant-only request selector was found. Promotional credits are spent first; purchased credits can pay afterward. This follows the user's explicit conditional permission, not a free-only guarantee.
- If `output_format` is omitted, request PNG and locally convert it to lossless WebP for saving and display. If it is explicit, save and return the API's requested format and compression without converting it.
- Preserve direct prompts, cancellation, and the five-minute timeout. Return every final output requested by `n`, and implement actual streamed previews rather than merely forwarding streaming fields.

The OpenAI SDK is permitted if it makes the complete API implementation simpler. No SDK was installed or selected during research. The product implementation has not changed; the full contract and verification work continue through `/skill:to-spec`. The mode and billing decision is recorded in [ADR 0002](../adr/0002-explicit-image-generation-modes.md).

## Sources

- [CL] [OpenAI API changelog, October 28 and September 8, 2026][CL]
- [GUIDE] [API credits for ChatGPT subscribers][GUIDE]
- [HELP] [API credits benefit for eligible ChatGPT subscriptions][HELP]
- [TERMS] [Service credit terms, updated January 1, 2026][TERMS]
- [MODEL] [GPT-Image-2.5 Sunburst model reference][MODEL]
- [IMAGE] [Image generation guide][IMAGE]
- [GENERATE] [Create image API reference][GENERATE]
- [EDIT] [Create image edit API reference][EDIT]
- [AUTH] [API overview and authentication][AUTH]
- [COUNTRIES] [API supported countries and territories][COUNTRIES]
- [SPEND] [API spend limits][SPEND]
- [USAGE] [Using credits for flexible usage in ChatGPT, personal plans][USAGE]

[CL]: https://developers.openai.com/api/docs/changelog
[GUIDE]: https://developers.openai.com/api/docs/guides/chatgpt-api-credits
[HELP]: https://help.openai.com/en/articles/20001626-api-credits-benefit-for-eligible-chatgpt-subscriptions
[TERMS]: https://openai.com/policies/service-credit-terms/
[MODEL]: https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst
[IMAGE]: https://developers.openai.com/api/docs/guides/image-generation
[GENERATE]: https://developers.openai.com/api/reference/resources/images/methods/generate
[EDIT]: https://developers.openai.com/api/reference/resources/images/methods/edit
[AUTH]: https://developers.openai.com/api/reference/overview
[COUNTRIES]: https://developers.openai.com/api/docs/supported-countries
[SPEND]: https://developers.openai.com/api/docs/guides/spend-limits
[USAGE]: https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-personal-plans
[GENSTREAM]: https://developers.openai.com/api/reference/resources/images/methods/generate
[EDITSTREAM]: https://developers.openai.com/api/reference/resources/images/edit-streaming-events
