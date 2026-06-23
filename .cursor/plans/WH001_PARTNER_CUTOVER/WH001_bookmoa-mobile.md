# WH-001 Webhook Signature Cutover — bookmoa-mobile

> **For:** bookmoa-mobile (Next.js / Vercel serverless) Storige webhook receiver
> **Site:** `bookmoa-mobile` (site id `26183a7c-…`)
> **Integration type:** Type 2 (embedded editor, iframe). Receives `compose-mixed` / synthesis callbacks at `uploadCallbackUrl`.
> **Goal:** verify the new unforgeable HMAC-SHA256 signature so Storige can drop the legacy forgeable one.
> Real `WEBHOOK_SECRET` is delivered by the Storige team over a secure channel. Placeholders only below.

---

## 0. TL;DR

Every Storige webhook currently carries TWO signature headers:

| Header | Meaning | Trust |
|---|---|---|
| `X-Storige-Signature` | Legacy `base64("<id>:<event>:<timestamp>")` — no key, **forgeable** | ❌ |
| `X-Storige-Signature-HMAC` | New `t=<unixsec>,v1=<hmac_sha256_hex>` — keyed, **unforgeable** | ✅ |

Both are sent now (non-breaking). After you confirm you verify the HMAC header, we drop the legacy one.

---

## 1. Header format

```
X-Storige-Signature-HMAC: t=<unix_seconds>,v1=<hmac_sha256_hex_64chars>
```

### Signing string (what the HMAC covers)

Storige does **NOT** sign the raw body. It signs a canonical string assembled from the header `t` plus three body fields:

```
signing_string = `${t}.${identifier}:${event}:${timestamp}`
```

- `t` — the unix-seconds value from the `t=` field of the header.
- `identifier` — `body.jobId` if present, else `body.sessionId`. (synthesis/validation → `jobId`; session callbacks → `sessionId`.)
- `event` — `body.event` (e.g. `synthesis.completed`).
- `timestamp` — `body.timestamp`, the **ISO-8601 string inside the JSON body** (distinct from `t`).

```
v1 == hmacSHA256(WEBHOOK_SECRET, signing_string).hex()
```

> ⚠️ The HMAC lives in `X-Storige-Signature-HMAC`. An older internal doc claims it's in `X-Storige-Signature` over `timestamp.raw_body` — that is **not** what production does. Follow this doc.

---

## 2. Algorithm (pseudocode)

```
1. sig = req.header("x-storige-signature-hmac"); if missing → reject (after cutover)
2. {t, v1} = parse "t=<digits>,v1=<64hex>"
3. identifier = body.jobId ?? body.sessionId; event = body.event; ts = body.timestamp
4. signing_string = `${t}.${identifier}:${event}:${ts}`
5. expected = HMAC_SHA256(WEBHOOK_SECRET, signing_string) → hex
6. if !timingSafeEqual(expected, v1) → reject 401
7. (recommended) if |nowSec - t| > 300 → reject (replay)
8. accept
```

---

## 3. Node.js code sample (Vercel serverless / Next.js API route)

> **CRITICAL for serverless:** you must verify against the body fields, which means you need the parsed JSON. Because the signing string is built from JSON fields (not the raw byte stream), you do **not** need raw-body capture for HMAC correctness here — but you should still parse defensively. (If a future scheme signs raw body, you'd disable body parsing; not needed today.)

```ts
// app/api/storige/webhook/route.ts  (Next.js App Router, Node runtime)
import { createHmac, timingSafeEqual } from 'crypto';

const WEBHOOK_SECRET = process.env.STORIGE_WEBHOOK_SECRET!; // from Storige team
const REPLAY_WINDOW_SEC = 300;                              // 0 to disable

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

  // constant-time compare
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(v1, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  if (REPLAY_WINDOW_SEC > 0 && Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > REPLAY_WINDOW_SEC) {
    return false;
  }
  return true;
}

export async function POST(req: Request) {
  const raw = await req.text();          // read once
  let body: any;
  try { body = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }

  const sig = req.headers.get('x-storige-signature-hmac');
  if (!verifyStorigeHmac(sig, body)) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_signature' }), { status: 401 });
  }

  // Verified. Treat webhook as a TRIGGER — re-fetch the authoritative result via
  // GET /api/files/:id/download/external (X-API-Key) or GET /api/worker-jobs/external/:id
  // before fulfilling. Return 200 quickly.
  // ... enqueue body ...
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
```

> Pages-router equivalent (`pages/api/...`): set `export const config = { api: { bodyParser: false } }`, read the raw stream, `JSON.parse` it, and use the same `verifyStorigeHmac`. The signing string only needs parsed fields, so either router works.

---

## 4. Test vector recipe

1. Use a throwaway secret `STORIGE_WEBHOOK_SECRET = "test-secret-key"`.
2. Sample body:
   ```json
   {"event":"synthesis.completed","jobId":"job-uuid-456","status":"completed","outputFileUrl":"/storage/outputs/merged.pdf","timestamp":"2026-06-22T00:00:00Z"}
   ```
3. `t = 1778081234`.
4. signing_string = `1778081234.job-uuid-456:synthesis.completed:2026-06-22T00:00:00Z`.
5. Node:
   ```js
   require('crypto').createHmac('sha256','test-secret-key')
     .update('1778081234.job-uuid-456:synthesis.completed:2026-06-22T00:00:00Z').digest('hex')
   ```
   Build `X-Storige-Signature-HMAC: t=1778081234,v1=<hex>`.
6. Feed body+header to `verifyStorigeHmac` → `true`. Tamper one hex char → `false`. Wrong secret → `false`.

Cross-check with OpenSSL (must match your Node hex):
```bash
printf '%s' '1778081234.job-uuid-456:synthesis.completed:2026-06-22T00:00:00Z' \
  | openssl dgst -sha256 -hmac 'test-secret-key' -r | awk '{print $1}'
```

---

## 5. Cutover handshake

- **Phase A (now):** both `X-Storige-Signature` + `X-Storige-Signature-HMAC` sent. Deploy your verifier.
- **Phase B (you confirm):** notify Storige team that bookmoa-mobile production verifies `X-Storige-Signature-HMAC`.
- **Phase C (we drop legacy):** Storige removes `X-Storige-Signature`. Only the HMAC header remains.
- **Rollback:** legacy header is a one-line re-enable on our side if anything regresses.

Do not let Phase C happen before your Phase B confirmation.

---

## 6. bookmoa-mobile specifics

- Your synthesis flow (`compose-mixed`) produces `synthesis.completed/failed` callbacks → identifier = `jobId`. The verifier handles `jobId ?? sessionId` automatically.
- Spread (펼침면) books force `outputMode='separate'` → two output files; that's orthogonal to signature verification.
- `uploadCallbackUrl` must be registered with Storige (SSRF allowlist) or callbacks are silently dropped.
- `WEBHOOK_SECRET` is **global** (shared across partners today), server-side only. Store it as a Vercel env var (`STORIGE_WEBHOOK_SECRET`), Production AND Preview environments.
