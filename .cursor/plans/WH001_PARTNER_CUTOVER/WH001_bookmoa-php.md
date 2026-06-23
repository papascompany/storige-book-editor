# WH-001 Webhook Signature Cutover — 북모아 메인 (bookmoa PHP)

> **For:** bookmoa PHP shopping mall webhook receiver (`/synthesize/external`, `/validate/external` callbacks)
> **Site:** `북모아 메인` (site id `1391c5b4-…`)
> **Goal:** switch your webhook-receiving endpoint to verify the new unforgeable HMAC-SHA256 signature, so we can drop the legacy (forgeable) signature.
> All secret values below are placeholders (`<...>`). The real `WEBHOOK_SECRET` is delivered by the Storige team over a secure channel only.

---

## 0. Why this is happening (TL;DR)

The webhook that Storige POSTs to your `callbackUrl` currently carries **two** signature headers:

| Header | What it is | Trust |
|---|---|---|
| `X-Storige-Signature` | **Legacy.** `base64("<id>:<event>:<timestamp>")`. No secret key → **anyone can forge it.** | ❌ Do NOT trust |
| `X-Storige-Signature-HMAC` | **New (WH-001).** HMAC-SHA256 over a canonical string using a shared secret. Cannot be forged without the secret. | ✅ Trust this |

Right now **both headers are always sent** (non-breaking). Once you confirm your receiver verifies `X-Storige-Signature-HMAC`, we drop the legacy `X-Storige-Signature` header. Until you confirm, nothing on your side breaks.

---

## 1. The new header — exact format

```
X-Storige-Signature-HMAC: t=<unix_seconds>,v1=<hmac_sha256_hex>
```

- `t` = unix timestamp in **seconds** (when Storige signed the webhook).
- `v1` = lowercase **hex** HMAC-SHA256 digest (64 hex chars).
- Example: `X-Storige-Signature-HMAC: t=1778081234,v1=3a7f...e9` (64 hex digits).

> ⚠️ **The HMAC is in `X-Storige-Signature-HMAC`, NOT in `X-Storige-Signature`.** Some older Storige docs (`PLATFORM_WORKER_INTEGRATION_v1.md`) describe the HMAC as living in `X-Storige-Signature` with a `timestamp.raw_body` signing string — that doc is **aspirational and does not match production.** Follow THIS document, which matches the deployed code.

### What is signed (the signing string)

This is the part that surprises people. Storige does **NOT** sign the raw JSON body. It signs a small canonical string built from three payload fields plus the timestamp:

```
signing_string = "<t>.<identifier>:<event>:<timestamp>"
```

Where:
- `<t>` = the **same** unix-seconds value that appears in the `t=` part of the header.
- `<identifier>` = the payload's `jobId` if present, otherwise its `sessionId`.
  - For `synthesis.*` and `validation.*` callbacks → `jobId`.
  - For `session.validated` / `session.failed` callbacks → `sessionId`.
- `<event>` = the payload's `event` field (e.g. `synthesis.completed`, `validation.failed`).
- `<timestamp>` = the payload's `timestamp` field — the **ISO-8601 string inside the JSON body** (e.g. `2026-06-22T00:00:00.000Z`). This is a **different** value from `t`; do not confuse them.

So you reconstruct the signing string entirely from values you already have (the `t=` from the header + three fields parsed from the JSON body).

```
HMAC = HMAC_SHA256( key = WEBHOOK_SECRET, message = "<t>.<identifier>:<event>:<timestamp>" )  → hex
```

---

## 2. Verification algorithm (pseudocode)

```
1. header = request.header("X-Storige-Signature-HMAC")
   if header missing → (transition period) fall back to legacy, see §5. After cutover → reject.
2. parse header → t, v1     (format "t=<digits>,v1=<64 hex>")
3. body = parsed JSON of request body
   identifier = body.jobId ?? body.sessionId
   event      = body.event
   timestamp  = body.timestamp        // the ISO string in the body
4. signing_string = t + "." + identifier + ":" + event + ":" + timestamp
5. expected = HMAC_SHA256(WEBHOOK_SECRET, signing_string) as lowercase hex
6. if NOT constant_time_equals(expected, v1) → reject (401)
7. (recommended) if abs(now_unix_seconds - t) > 300 → reject (replay protection)
8. accept → enqueue/process
```

> **Constant-time compare is important.** Use `hash_equals()` in PHP, never `==` / `===` on the hex strings, to avoid timing attacks.
> **Replay window (step 7) is your choice.** Storige does NOT currently enforce one on its side and does not include a nonce, so a 5-minute `t` freshness check is the practical replay defense. See our-side runbook for the caveat that retried webhooks reuse the original `t` only within ~2s, so a 5-min window is safe.

---

## 3. PHP code sample (drop-in)

```php
<?php
// storige_webhook_receiver.php
// Verifies the WH-001 HMAC-SHA256 signature on inbound Storige webhooks.

const STORIGE_WEBHOOK_SECRET = '<WEBHOOK_SECRET>';   // from Storige team, secure channel. Store in env/secret store, NOT in code.
const STORIGE_REPLAY_WINDOW  = 300;                  // seconds; 0 to disable

function storige_verify_webhook(string $rawBody, ?string $sigHeader): bool {
    if ($sigHeader === null || $sigHeader === '') {
        return false; // after cutover, no header = reject
    }
    // Parse "t=<digits>,v1=<hex>"
    if (!preg_match('/^t=(\d+),v1=([0-9a-f]{64})$/', $sigHeader, $m)) {
        return false;
    }
    [$_, $t, $v1] = $m;

    $body = json_decode($rawBody, true);
    if (!is_array($body)) return false;

    $identifier = $body['jobId'] ?? $body['sessionId'] ?? null;
    $event      = $body['event'] ?? null;
    $timestamp  = $body['timestamp'] ?? null;   // ISO string from body
    if ($identifier === null || $event === null || $timestamp === null) {
        return false;
    }

    $signingString = $t . '.' . $identifier . ':' . $event . ':' . $timestamp;
    $expected = hash_hmac('sha256', $signingString, STORIGE_WEBHOOK_SECRET); // lowercase hex

    if (!hash_equals($expected, $v1)) {
        return false; // forged / wrong secret
    }

    // Replay protection (recommended)
    if (STORIGE_REPLAY_WINDOW > 0 && abs(time() - (int)$t) > STORIGE_REPLAY_WINDOW) {
        return false;
    }
    return true;
}

// --- usage in your webhook endpoint ---
$rawBody   = file_get_contents('php://input');
$sigHeader = $_SERVER['HTTP_X_STORIGE_SIGNATURE_HMAC'] ?? null; // PHP maps X-Storige-Signature-HMAC → HTTP_X_STORIGE_SIGNATURE_HMAC

if (!storige_verify_webhook($rawBody, $sigHeader)) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'invalid_signature']);
    exit;
}

// Signature OK — process the event. Treat the webhook as a *trigger*:
// re-fetch the authoritative result via GET /api/files/:id/download/external (X-API-Key)
// or GET /api/worker-jobs/external/:id before fulfilling the order.
$payload = json_decode($rawBody, true);
// ... enqueue $payload, return 200 quickly ...
http_response_code(200);
echo json_encode(['ok' => true]);
```

> Note the header name mapping: PHP/Apache exposes `X-Storige-Signature-HMAC` as `$_SERVER['HTTP_X_STORIGE_SIGNATURE_HMAC']` (dashes→underscores, uppercased, `HTTP_` prefix). If you are behind nginx+fpm confirm the header is forwarded (it is a standard custom header, no special config needed in typical setups).

---

## 4. Test vector recipe (verify your implementation offline)

Ask the Storige team for the real secret, OR self-test with a throwaway secret to confirm your code path is correct:

1. Pick a test secret, e.g. `WEBHOOK_SECRET = "test-secret-key"`.
2. Take this sample body (a `synthesis.completed` callback):
   ```json
   {"event":"synthesis.completed","jobId":"job-uuid-456","status":"completed","outputFileUrl":"/storage/outputs/merged.pdf","timestamp":"2026-06-22T00:00:00Z"}
   ```
3. Pick a `t`, e.g. `t = 1778081234`.
4. signing_string = `1778081234.job-uuid-456:synthesis.completed:2026-06-22T00:00:00Z`
5. Compute `hash_hmac('sha256', signing_string, 'test-secret-key')`. Build header:
   `X-Storige-Signature-HMAC: t=1778081234,v1=<that hex>`
6. Feed body + header into your verifier → must return **true**. Flip one char of the hex → must return **false**. Use the wrong secret → must return **false**.

> You can reproduce the exact same digest with this one-liner (any machine):
> ```bash
> printf '%s' '1778081234.job-uuid-456:synthesis.completed:2026-06-22T00:00:00Z' \
>   | openssl dgst -sha256 -hmac 'test-secret-key' -r | awk '{print $1}'
> ```
> Your PHP `hash_hmac` output must equal this. Once it does with the *test* secret, swap in the real `WEBHOOK_SECRET` and you are done. When ready for a live test against the real secret, ask the Storige team to fire a test webhook at your endpoint.

---

## 5. Cutover handshake

**Phase A — now (non-breaking, both headers sent):**
- We send `X-Storige-Signature` (legacy base64) **and** `X-Storige-Signature-HMAC` (new HMAC) on every webhook.
- You deploy the verifier above. During this phase, if `X-Storige-Signature-HMAC` is missing you may fall back to your old behavior — but it should always be present once `WEBHOOK_SECRET` is provisioned on our side.

**Phase B — you confirm:**
- You email/notify the Storige team: *"bookmoa PHP receiver now verifies `X-Storige-Signature-HMAC` in production; please proceed with cutover."*
- Ideally include a successful test-webhook timestamp.

**Phase C — we drop the legacy header:**
- Storige removes the `X-Storige-Signature` (base64) header (our-side runbook step). After this, only `X-Storige-Signature-HMAC` is sent.
- ⚠️ After Phase C, any receiver still reading only `X-Storige-Signature` will see it disappear. So **do not gate Phase C until you have confirmed Phase B.**

**Rollback:** if anything breaks after Phase C, we can re-enable the legacy header immediately (it is a one-line revert). Tell us and we will.

---

## 6. Notes specific to bookmoa PHP

- Your integration uses both **synthesis** callbacks (`synthesis.completed/failed`, identifier = `jobId`) and potentially **session/validation** callbacks. The verifier above handles all of them because it picks `jobId ?? sessionId` automatically.
- Reminder (unchanged): a missing/blocked `callbackUrl` host is silently dropped on our side (SSRF allowlist). Make sure your `uploadCallbackUrl` is registered with us.
- The `WEBHOOK_SECRET` is **global** (one secret across all partners today), not per-site. Keep it server-side only.
