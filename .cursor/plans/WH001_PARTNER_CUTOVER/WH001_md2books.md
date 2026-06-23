# WH-001 Webhook Signature Cutover — MD2Books

> **For:** MD2Books (Vercel serverless, `md2books.vercel.app`) Storige webhook receiver
> **Site:** `MD2Books` (site id `921b64b9-2bbd-4e52-93fa-bad1b30c523d`)
> **Integration type:** Type 1 (self-generated PDF; validate/synthesize/order/retain offload). Server-to-server, `X-API-Key`.
> **Goal:** verify the new unforgeable HMAC-SHA256 signature so Storige can drop the legacy forgeable one.
> Real `WEBHOOK_SECRET` delivered over a secure channel. Placeholders only below.

---

## 0. TL;DR & applicability

Storige webhooks carry TWO signatures right now:

| Header | Meaning | Trust |
|---|---|---|
| `X-Storige-Signature` | Legacy `base64("<id>:<event>:<timestamp>")`, keyless → **forgeable** | ❌ |
| `X-Storige-Signature-HMAC` | New `t=<unixsec>,v1=<hmac_sha256_hex>`, keyed → **unforgeable** | ✅ |

Both sent now (non-breaking). After you confirm HMAC verification, we drop the legacy header.

> **MD2Books status note:** MD2Books is a newer Type-1 integration. As of writing it is **not confirmed to be wired for inbound webhooks** — Type-1 partners typically poll (`GET /api/worker-jobs/external/:id`) and pull results via `download/external`. **If MD2Books does not pass `callbackUrl` on its jobs, it receives no webhooks and this cutover does not apply** — confirm "polling-only, exclude from cutover gate" to the Storige team. Follow the steps below only if you adopt webhooks.

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
- `identifier` — `body.jobId ?? body.sessionId` (validation/synthesis → `jobId`).
- `event` — `body.event`.
- `timestamp` — `body.timestamp` (ISO-8601 string in JSON body; ≠ `t`).

```
v1 == hmacSHA256(WEBHOOK_SECRET, signing_string).hex()
```

> ⚠️ HMAC is in `X-Storige-Signature-HMAC`. Ignore `PLATFORM_WORKER_INTEGRATION_v1.md`'s raw-body description — it doesn't match production.

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
  // Verified → trigger only; re-fetch via download/external (X-API-Key). Return 200 fast.
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
```

---

## 4. Test vector recipe

1. Test secret `test-secret-key`.
2. Body: `{"event":"synthesis.completed","jobId":"job-uuid-456","status":"completed","outputFileUrl":"/storage/outputs/merged.pdf","timestamp":"2026-06-22T00:00:00Z"}`
3. `t = 1778081234`.
4. signing_string = `1778081234.job-uuid-456:synthesis.completed:2026-06-22T00:00:00Z`.
5. `createHmac('sha256','test-secret-key').update(signing_string).digest('hex')` → `v1`.
6. Verifier → `true`; tamper → `false`; wrong secret → `false`.

OpenSSL cross-check:
```bash
printf '%s' '1778081234.job-uuid-456:synthesis.completed:2026-06-22T00:00:00Z' \
  | openssl dgst -sha256 -hmac 'test-secret-key' -r | awk '{print $1}'
```

---

## 5. Cutover handshake

- **Phase A (now):** both headers sent.
- **Phase B:** notify Storige team that MD2Books production verifies `X-Storige-Signature-HMAC` — OR confirm "polling-only / no webhooks" to be excluded from the gate.
- **Phase C:** Storige drops legacy `X-Storige-Signature`.
- **Rollback:** one-line re-enable on our side.

---

## 6. MD2Books specifics

- Confirm first whether MD2Books actually consumes webhooks. If it is polling-only, you have no work here — just tell us.
- `WEBHOOK_SECRET` is **global** (shared), server-side only, stored as `STORIGE_WEBHOOK_SECRET` Vercel env (Production + Preview).
- If adopting webhooks, register the `callbackUrl` host in our SSRF allowlist or callbacks are silently dropped.
