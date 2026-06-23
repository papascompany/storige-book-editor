# WH-001 — Our-Side Cutover Runbook (drop the legacy base64 signature)

> **Audience:** Storige maintainers. What WE change once all partners confirm they verify `X-Storige-Signature-HMAC`.
> **Scope:** API only (`apps/api`). The worker does NOT send webhooks — the API's `WebhookService` does.
> No secret values appear here. The shared secret is the env var `WEBHOOK_SECRET` (set on the API container).

---

## 1. Where the signing happens (single source of truth)

All outbound webhooks funnel through **one** method:

- `apps/api/src/webhook/webhook.service.ts:98` — `sendCallback(callbackUrl, payload)` — the only sender. (Both first attempt and retry POST here: lines `116` and `134`.)
- Headers are built in `buildHeaders()` — **`apps/api/src/webhook/webhook.service.ts:156`**:
  - `'X-Storige-Signature'` (LEGACY base64) — set at **line 160**, value from `generateSignature()`.
  - `'X-Storige-Signature-HMAC'` (NEW HMAC) — set at **lines 162–163**, value from `generateHmacSignature()` (only when `WEBHOOK_SECRET` is set).

The legacy base64 signature is computed in:

- **`generateSignature()` — `apps/api/src/webhook/webhook.service.ts:172–179`** ← **THIS is what we remove at cutover.**
  ```
  data = `${identifier}:${payload.event}:${payload.timestamp}`   // line 177
  return Buffer.from(data).toString('base64');                    // line 178
  ```

The new HMAC is computed in:

- `generateHmacSignature()` — `apps/api/src/webhook/webhook.service.ts:187–196`:
  ```
  data = `${t}.${identifier}:${payload.event}:${payload.timestamp}`   // line 193
  v1   = createHmac('sha256', secret).update(data).digest('hex')      // line 194
  return `t=${t},v1=${v1}`                                            // line 195
  ```

All three callback builders route through `sendCallback`, so they ALL get both headers automatically:
- `sendSynthesisCallback` — `apps/api/src/worker-jobs/worker-jobs.service.ts:1458` (→ `sendCallback` at `1490`)
- `sendValidationCallback` — `worker-jobs.service.ts:1508` (→ `sendCallback` at `1540`)
- `sendWebhookCallback` (session.validated/failed) — `worker-jobs.service.ts:1649` (→ `sendCallback` at `1673`)

> Identifier rule (matches partner docs): `'jobId' in payload ? payload.jobId : payload.sessionId` (lines 176 & 191). Synthesis/validation payloads have `jobId`; session payloads have only `sessionId`.

---

## 2. Pre-cutover checklist (gate)

- [ ] `WEBHOOK_SECRET` is set on the production API container (VPS `~/storige/.env`) so `X-Storige-Signature-HMAC` is actually being sent. **Verify this first** — if it's empty, the HMAC header is silently omitted (line 189 returns `undefined`) and partners have nothing to verify. (See finding F1.)
- [ ] Each webhook-consuming partner has confirmed (Phase B) they verify `X-Storige-Signature-HMAC` in production:
  - [ ] 북모아 메인 (bookmoa PHP) — `/synthesize/external`, `/validate/external` consumer.
  - [ ] bookmoa-mobile — `compose-mixed` synthesis consumer (if using webhooks vs polling).
  - [ ] ShareSnap — confirm webhook vs polling-only (may be excluded).
  - [ ] 100p Books — confirm webhook vs polling-only (likely polling → excluded).
  - [ ] MD2Books — confirm wired for webhooks at all (likely polling → excluded).
- [ ] Confirm no internal consumer reads the legacy header (grep below).

```bash
# anyone still depending on the legacy header anywhere in repo:
grep -rn "X-Storige-Signature\b" --include=*.ts --include=*.js --include=*.php . | grep -v node_modules
```

---

## 3. The cutover change (drop legacy base64)

In `apps/api/src/webhook/webhook.service.ts`:

1. In `buildHeaders()` (line 156), **remove the legacy header line 160**:
   ```diff
   const headers: Record<string, string> = {
     'Content-Type': 'application/json',
     'X-Storige-Event': payload.event,
   - 'X-Storige-Signature': this.generateSignature(payload),
   };
   const hmac = this.generateHmacSignature(payload);
   if (hmac) headers['X-Storige-Signature-HMAC'] = hmac;
   ```
2. Delete the now-unused `generateSignature()` method (lines 172–179).
3. (Optional hardening, recommended at the same time — see findings) make `WEBHOOK_SECRET` **mandatory**: if unset, log an error / fail closed rather than silently omitting the only remaining signature. Otherwise dropping the legacy header while `WEBHOOK_SECRET` is empty would ship webhooks with **no** signature at all.
4. Update the spec `apps/api/src/webhook/webhook.service.spec.ts` (the test at lines 34–41 currently asserts the legacy header is always present — that assertion must be inverted/removed).
5. Update docs that still describe the legacy scheme as current:
   - `docs/PLATFORM_INTEGRATION_GUIDE.md` §5.2 (lines ~629–648) and §2.2 step 5b / §4.2 gap table — currently say "HMAC 아님 → 위조 가능". Replace with "HMAC via `X-Storige-Signature-HMAC` is now the signature; legacy `X-Storige-Signature` removed."
   - `docs/PLATFORM_WORKER_INTEGRATION_v1.md` §5-3 — **this doc is wrong even today**: it says the HMAC lives in `X-Storige-Signature` over `timestamp.raw_body` with env `STORIGE_WEBHOOK_SECRET`. Reality: HMAC is in `X-Storige-Signature-HMAC` over `${t}.${identifier}:${event}:${timestamp}` with env `WEBHOOK_SECRET`. Fix to match code regardless of cutover.

> **Deploy:** API is manual on the VPS (`cd ~/storige && git pull && docker compose up -d --build api`). Per ops memory, restart nginx too if the API container IP changes (502 cache). The worker is unaffected.

---

## 4. Rollback

Re-add line 160 (`'X-Storige-Signature': this.generateSignature(payload)`) and restore `generateSignature()`. One-commit revert. Redeploy API. Because the change is purely additive-removal of a header, rollback is instant and safe.

---

## 5. Verification after deploy

```bash
# Fire a real callback (e.g. complete a small validate/external job with a callbackUrl you control)
# and confirm only the HMAC header is present:
#   X-Storige-Event: validation.completed
#   X-Storige-Signature-HMAC: t=...,v1=...
#   (X-Storige-Signature absent)
```

Use a request-bin / your own logging endpoint registered in the SSRF allowlist (`WEBHOOK_ALLOWED_HOSTS` or a site `uploadCallbackUrl`).

---

## 6. Our-side robustness findings (prioritized)

> File:line citations are in `apps/api/src/webhook/webhook.service.ts` and `apps/api/src/worker-jobs/worker-jobs.service.ts` unless noted.

### P0 — must verify before any cutover

- **F1 — HMAC header is conditional on `WEBHOOK_SECRET`; if unset, NO unforgeable signature is sent at all.**
  `generateHmacSignature()` returns `undefined` when `process.env.WEBHOOK_SECRET` is empty (webhook.service.ts:188–189), so `buildHeaders` omits `X-Storige-Signature-HMAC` (line 163). The repo's `.env.example` / `.env.development.example` ship `WEBHOOK_SECRET=` (empty). **If production also has it empty, partners are being told to verify a header that never arrives, and after cutover webhooks would be unsigned.** Action: confirm `WEBHOOK_SECRET` is set in prod `.env`; make it mandatory (fail-closed) as part of cutover. (Ops memory even says "WEBHOOK_SECRET: 코드 미사용(no-op)" — that note predates d441802 and is now stale; the secret IS used.)

### P1 — security correctness

- **F2 — No replay protection on our side and `t` is signed but receivers aren't forced to check it.** `generateHmacSignature` embeds `t` (line 192–193) and signs it, which is good, but Storige sends no nonce and does not itself bound delivery time. Replay defense depends entirely on each receiver checking `|now - t| <= window`. We've documented the 5-min check to partners; consider stating an official recommended window in the canonical guide so receivers don't pick `0`.
- **F3 — Signed material is a 3-field projection, not the body.** The HMAC covers only `${t}.${identifier}:${event}:${timestamp}` (line 193), NOT the full payload. So fields like `outputFileUrl`, `result`, `errorMessage`, `status`, `orderSeqno`, `outputFiles` are **not** integrity-protected — an attacker who can MITM (no TLS) or a buggy proxy could alter them without breaking the signature. Mitigation already baked into partner docs: "treat webhook as a trigger, re-fetch authoritative result via `download/external`/`external/:id`." Longer-term, prefer signing the raw body (would require a coordinated v2 across all partners). Track as a follow-up; the trigger-then-refetch pattern makes this acceptable for now.

### P2 — robustness / consistency

- **F4 — Retry path was historically missing the signature; now fixed but verify in prod.** `sendCallback` retry (webhook.service.ts:132–145) now spreads `...this.buildHeaders(payload)` and adds `X-Storige-Retry: 1` (line 137). Note the retry **re-signs** with a fresh `t` only if `buildHeaders` recomputes — it does (each call recomputes `t = Date.now()`), so the retry's `t` is ~2s later than the original. That's fine and stays well within a 5-min replay window. No action; just be aware retries carry a *different* `t`/`v1` than the first attempt.
- **F5 — Only ONE retry, no exponential backoff, despite docs.** `PLATFORM_WORKER_INTEGRATION_v1.md` §5-2 promises "지수 백오프 최대 3회". Actual code does a single 2s-delay retry (webhook.service.ts:133–138). Doc/impl mismatch — either fix the doc or the code. Not a signature issue but will confuse partners debugging missed callbacks.
- **F6 — `WEBHOOK_SECRET` is global, not per-site.** One secret signs webhooks for ALL partners (line 188). If it leaks from any one partner, every partner's webhooks become forgeable, and rotation forces all partners to update simultaneously. Consider per-site webhook secrets (store on the `sites` row, look up by `callbackUrl`→site) for blast-radius isolation. Larger change; capture as future work.
- **F7 — Header-name divergence from the public doc is a live trap.** Code uses `X-Storige-Signature-HMAC` + env `WEBHOOK_SECRET`; the partner-facing `PLATFORM_WORKER_INTEGRATION_v1.md` says `X-Storige-Signature` + env `STORIGE_WEBHOOK_SECRET`. Any partner who implemented from that doc verified the wrong header over the wrong string and likely failed silently (or skipped verification). Fix the doc now (independent of cutover) — this is the single most likely cause of a botched partner rollout.

### Non-issues (confirmed OK)

- All three callback builders route through `sendCallback`, so the HMAC header is applied uniformly to **synthesis.completed/failed, validation.completed/fixable/failed, and session.validated/failed** — including failed-synthesis callbacks. No event path bypasses signing.
- SSRF allowlist (webhook.service.ts:62–93) is enforced before sending; unchanged by cutover.
