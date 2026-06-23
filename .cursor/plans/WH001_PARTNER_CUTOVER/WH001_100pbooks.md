# WH-001 Webhook Signature Cutover — 100p Books

> **For:** 100p Books (Vercel serverless) Storige webhook receiver
> **Site:** `100p Books` (site id `729ad8a7-3c92-42b7-b46c-437f12846692`)
> **Integration type:** Type 1 (self-editor; PDF validate/synthesize/retain offload). Server-to-server, `X-API-Key`.
> **Goal:** verify the new unforgeable HMAC-SHA256 signature so Storige can drop the legacy forgeable one.
> Real `WEBHOOK_SECRET` delivered over a secure channel. Placeholders only below.

---

## 0. TL;DR

Storige webhooks carry TWO signatures right now:

| Header | Meaning | Trust |
|---|---|---|
| `X-Storige-Signature` | Legacy `base64("<id>:<event>:<timestamp>")`, keyless → **forgeable** | ❌ |
| `X-Storige-Signature-HMAC` | New `t=<unixsec>,v1=<hmac_sha256_hex>`, keyed → **unforgeable** | ✅ |

Both sent now (non-breaking). After you confirm HMAC verification, we drop the legacy header.

> **100p Books status note:** your integration primarily uses **polling** (`GET /api/worker-jobs/external/:id`) per the Type-1 offload pattern, and `download/external` for results. If you do **not** pass `callbackUrl` on your `validate/external` / `synthesize/external` jobs, you receive no webhooks and signature verification is N/A — you can confirm "polling-only, exclude from cutover gate" to the Storige team. The instructions below apply only if/when you opt into webhooks (pass `callbackUrl`).

---

## 1. Header format

```
X-Storige-Signature-HMAC: t=<unix_seconds>,v1=<hmac_sha256_hex_64chars>
```

### Signing string (NOT the raw body)

```
signing_string = `${t}.${identifier}:${event}:${timestamp}`
```

- `t` — unix seconds from header `t=`.
- `identifier` — `body.jobId ?? body.sessionId`. For validation/synthesis callbacks this is `jobId`.
- `event` — `body.event` (e.g. `validation.completed`, `validation.failed`, `synthesis.completed`).
- `timestamp` — `body.timestamp` (ISO-8601 string inside JSON body; ≠ `t`).

```
v1 == hmacSHA256(WEBHOOK_SECRET, signing_string).hex()
```

> ⚠️ HMAC is in `X-Storige-Signature-HMAC`. The older `PLATFORM_WORKER_INTEGRATION_v1.md` (raw-body + `X-Storige-Signature`) does NOT match production. Use this doc.

---

## 2. Algorithm (pseudocode)

```
1. sig = header("x-storige-signature-hmac"); missing → reject (after cutover)
2. {t, v1} = parse "t=<digits>,v1=<64hex>"
3. identifier = body.jobId ?? body.sessionId; event = body.event; ts = body.timestamp
4. signing_string = `${t}.${identifier}:${event}:${ts}`
5. expected = HMAC_SHA256(WEBHOOK_SECRET, signing_string).hex
6. if !timingSafeEqual(expected, v1) → reject 401
7. (recommended) if |nowSec - t| > 300 → reject (replay)
8. accept
```

---

## 3. Node.js code sample (Vercel serverless)

```ts
import { createHmac, timingSafeEqual } from 'crypto';

const WEBHOOK_SECRET = process.env.STORIGE_WEBHOOK_SECRET!;
const REPLAY_WINDOW_SEC = 300;

export function verifyStorigeHmac(sigHeader: string | null, body: any): boolean {
  if (!sigHeader) return false;
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sigHeader);
  if (!m) return false;
  const [, t, v1] = m;

  const identifier = body?.jobId ?? body?.sessionId;
  const event = body?.event;
  const timestamp = body?.timestamp;
  if (identifier == null || event == null || timestamp == null) return false;

  const signingString = `${t}.${identifier}:${event}:${timestamp}`;
  const expected = createHmac('sha256', WEBHOOK_SECRET).update(signingString).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(v1, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  if (REPLAY_WINDOW_SEC > 0 && Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > REPLAY_WINDOW_SEC) {
    return false;
  }
  return true;
}

export async function POST(req: Request) {
  const raw = await req.text();
  let body: any;
  try { body = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }

  if (!verifyStorigeHmac(req.headers.get('x-storige-signature-hmac'), body)) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_signature' }), { status: 401 });
  }
  // Verified → trigger only. Re-fetch authoritative result via
  // GET /api/worker-jobs/external/:id (X-API-Key) or download/external. Return 200 fast.
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
```

---

## 4. Test vector recipe

Use a `validation.completed` sample since you mostly run validation jobs:

1. Test secret `test-secret-key`.
2. Body:
   ```json
   {"event":"validation.completed","jobId":"job-uuid-789","fileType":"content","status":"completed","result":{"errors":[],"warnings":[],"metadata":{}},"timestamp":"2026-06-22T00:00:00Z"}
   ```
3. `t = 1778081234`.
4. signing_string = `1778081234.job-uuid-789:validation.completed:2026-06-22T00:00:00Z`.
5. `createHmac('sha256','test-secret-key').update(signing_string).digest('hex')` → `v1`.
6. Verifier → `true`; tamper → `false`; wrong secret → `false`.

OpenSSL cross-check:
```bash
printf '%s' '1778081234.job-uuid-789:validation.completed:2026-06-22T00:00:00Z' \
  | openssl dgst -sha256 -hmac 'test-secret-key' -r | awk '{print $1}'
```

---

## 5. Cutover handshake

- **Phase A (now):** both headers sent.
- **Phase B:** notify Storige team that 100p Books production verifies `X-Storige-Signature-HMAC` — OR confirm "polling-only, no webhooks" to be excluded.
- **Phase C:** Storige drops legacy `X-Storige-Signature`.
- **Rollback:** one-line re-enable on our side.

---

## 6. 100p Books specifics

- Type-1 offload: webhooks are optional. If you only poll + `download/external`, you can opt out of webhook verification entirely (tell us).
- Your site keys are now split (editor ≠ worker) but that is unrelated to `WEBHOOK_SECRET`, which is **global** and used only to sign webhooks Storige sends you.
- If you adopt webhooks, register `callbackUrl` host in the SSRF allowlist (Storige operator), else callbacks are silently dropped.
- Store `WEBHOOK_SECRET` as `STORIGE_WEBHOOK_SECRET` Vercel env, server-side only.
