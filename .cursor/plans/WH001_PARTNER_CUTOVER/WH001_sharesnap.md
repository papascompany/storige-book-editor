# WH-001 Webhook Signature Cutover — ShareSnap

> **For:** ShareSnap (Vercel serverless) Storige webhook receiver
> **Site:** `ShareSnap` (site id `9a5d4e0c-1508-45de-93f2-422ccbdfc1d7`)
> **Integration type:** Type 2 (embedded editor, iframe) with the `externalPhotos` photo-injection variant.
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

> **ShareSnap status note:** as of this writing ShareSnap is in dev/launch-decision. If you have **not** registered a `uploadCallbackUrl` and are using **polling** (`GET /api/worker-jobs/external/:id`) instead of webhooks, signature verification does not apply to you yet — you can skip this until you opt into webhooks. The instructions below are for when/if you receive webhooks.

---

## 1. Header format

```
X-Storige-Signature-HMAC: t=<unix_seconds>,v1=<hmac_sha256_hex_64chars>
```

### Signing string

Storige signs a canonical string (NOT the raw body):

```
signing_string = `${t}.${identifier}:${event}:${timestamp}`
```

- `t` — unix seconds from the header `t=`.
- `identifier` — `body.jobId ?? body.sessionId`.
- `event` — `body.event`.
- `timestamp` — `body.timestamp` (ISO-8601 string in the JSON body; ≠ `t`).

```
v1 == hmacSHA256(WEBHOOK_SECRET, signing_string).hex()
```

> ⚠️ HMAC is in `X-Storige-Signature-HMAC`, not `X-Storige-Signature`. Ignore the older `PLATFORM_WORKER_INTEGRATION_v1.md` description (raw-body signing in `X-Storige-Signature`) — it doesn't match production.

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

function verifyStorigeHmac(sigHeader: string | null, body: any): boolean {
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

// Next.js App Router handler
export async function POST(req: Request) {
  const raw = await req.text();
  let body: any;
  try { body = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }

  if (!verifyStorigeHmac(req.headers.get('x-storige-signature-hmac'), body)) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_signature' }), { status: 401 });
  }
  // Verified → treat as trigger, re-fetch result via download/external (X-API-Key), return 200.
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
```

---

## 4. Test vector recipe

1. Test secret `test-secret-key`.
2. Body: `{"event":"synthesis.completed","jobId":"job-uuid-456","status":"completed","outputFileUrl":"/storage/outputs/merged.pdf","timestamp":"2026-06-22T00:00:00Z"}`
3. `t = 1778081234`.
4. signing_string = `1778081234.job-uuid-456:synthesis.completed:2026-06-22T00:00:00Z`.
5. `createHmac('sha256','test-secret-key').update(signing_string).digest('hex')` → use as `v1`.
6. Verifier returns `true`; tamper → `false`; wrong secret → `false`.

OpenSSL cross-check:
```bash
printf '%s' '1778081234.job-uuid-456:synthesis.completed:2026-06-22T00:00:00Z' \
  | openssl dgst -sha256 -hmac 'test-secret-key' -r | awk '{print $1}'
```

---

## 5. Cutover handshake

- **Phase A (now):** both headers sent. Deploy verifier (when you adopt webhooks).
- **Phase B:** notify Storige team that ShareSnap production verifies `X-Storige-Signature-HMAC`.
- **Phase C:** Storige drops legacy `X-Storige-Signature`.
- **Rollback:** one-line re-enable on our side.

If ShareSnap stays on polling-only, no action needed — confirm to the Storige team that you do not consume webhooks and you can be excluded from the cutover gate.

---

## 6. ShareSnap specifics

- The `externalPhotos` photo-injection flow does not affect signing; verification is identical to other Type-2 partners.
- If you register `uploadCallbackUrl` later, also ensure it's added to the SSRF allowlist (Storige operator does `PATCH /sites/9a5d4e0c-…`), or callbacks are silently dropped.
- `WEBHOOK_SECRET` is **global** today (shared across partners), server-side only, stored as `STORIGE_WEBHOOK_SECRET` Vercel env (Production + Preview).
