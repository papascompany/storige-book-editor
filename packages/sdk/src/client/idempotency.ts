/**
 * 멱등 키 정책 — v1 서버 멱등 인터셉터의 실제 동작에 맞춘 안전 규칙.
 *
 * ============================================================================
 * 🚨 핵심: 멀티파트 업로드에는 Idempotency-Key 를 자동 부여하지 않는다
 * ============================================================================
 *
 * ## 서버 동작(실측)
 * 서버 멱등 스코프는 `siteId + env + method + path + key` 이고, 같은 스코프의
 * 재호출은 **request_hash 대조**로 재전달/거부를 가른다:
 *
 *   apps/api/src/partner-api/idempotency/partner-idempotency.interceptor.ts
 *     const requestHash = canonicalBodyHash(req.body);
 *
 *   - 같은 키 + 같은 hash → 최초 응답 스냅샷 **재전달**(요청 본문 무시)
 *   - 같은 키 + 다른 hash → 422 ERR_IDEMPOTENCY_KEY_MISMATCH
 *
 * ## 왜 멀티파트에서 위험한가
 * `canonicalBodyHash` 는 **req.body 만** 해시한다. 그런데 multer 는 업로드 파일을
 * `req.file` 에 담고 `req.body` 에는 **파일 바이트를 절대 넣지 않는다**. 자산
 * 라우트의 body DTO 는 `fileId` 하나뿐이고 멀티파트 경로에서는 그 필드가 없다
 * → req.body 는 사실상 빈 값 → request_hash 가 **파일 내용과 무관한 상수**가 된다:
 *
 *     sha256(canonicalJson({}))   = 44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a
 *     sha256(canonicalJson(null)) = 74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b
 *
 * (인터셉터 바인딩 순서 — 컨트롤러 레벨 멱등 vs 메서드 레벨 multer — 와도 무관하다.
 *  multer 가 먼저 돌든 나중에 돌든 파일 바이트는 req.body 에 들어가지 않는다.)
 *
 * ## 귀결: 조용한 파일 유실
 * 같은 Idempotency-Key 로 **다른 파일**을 올리면 hash 가 같으므로 서버는 이를
 * "동일 요청"으로 판정하고 최초 응답을 재전달한다 — 두 번째 파일은 저장되지 않고
 * 호출측은 **200/201 성공 응답을 받는다**. 실패가 아니라 조용한 유실이다.
 *
 * ## SDK 정책
 *  ① 멀티파트 업로드는 Idempotency-Key 를 **자동 부여하지 않는다**.
 *  ② 사용자가 명시 제공하면 파일 내용 해시를 합성해 키를 **내용 주소화**한다:
 *       `${key}:${sha256(bytes)}`
 *     → 다른 파일 = 다른 키 = 다른 스코프 → 재전달 충돌 자체가 성립하지 않는다.
 *     → 같은 파일 + 같은 키 = 같은 합성 키 → 정상 재전달(원하는 멱등 동작).
 *  ③ fileId 참조(JSON) 경로는 body 에 실값이 있어 hash 가 정상 작동한다
 *     → 자동 부여 안전. **권장 경로**다.
 *
 * @see composeMultipartIdempotencyKey
 */

import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  StorigeUsageError,
} from '../index';

/** 요청 본문 종류 — 멱등 자동 부여 가부를 가르는 축 */
export type BodyKind = 'json' | 'multipart' | 'none';

/**
 * 자동 부여 가능 여부.
 *
 * POST + JSON(또는 본문 없음) 만 자동 부여한다. 멀티파트는 위 사유로 제외 —
 * 자동 부여했다간 SDK 가 스스로 파일 유실 함정을 만드는 꼴이 된다.
 */
export function canAutoAssignIdempotencyKey(method: string, bodyKind: BodyKind): boolean {
  if (method.toUpperCase() !== 'POST') return false; // 서버 인터셉터가 POST 만 처리
  return bodyKind !== 'multipart';
}

/** 자동 멱등 키 생성 — 표준 randomUUID(런타임 의존성 0) */
export function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** hex 인코딩(표준 API 만 사용) */
function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += (bytes[i] as number).toString(16).padStart(2, '0');
  }
  return out;
}

/** SHA-256 — Web Crypto 표준(Node 18+ / 브라우저 공통) */
async function sha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

/**
 * 멀티파트 업로드용 멱등 키 합성 — `${key}:${sha256(bytes)}`.
 *
 * 서버 request_hash 가 파일 내용을 반영하지 못하므로(모듈 상단 참조) 키 자체를
 * 내용 주소화해 그 구멍을 메운다.
 *
 * 합성 결과가 서버 상한(128자)을 넘으면 전체를 한 번 더 해시해 64자로 접는다 —
 * 두 분기 모두 (key, bytes) 의 결정적 함수이므로 내용 주소성은 보존된다.
 * (사용자 키를 잘라내면 서로 다른 키가 충돌할 수 있어 truncate 는 쓰지 않는다.)
 *
 * @param key   사용자가 제공한 멱등 키
 * @param bytes 업로드할 파일 바이트
 */
export async function composeMultipartIdempotencyKey(
  key: string,
  bytes: BufferSource,
): Promise<string> {
  if (key.length === 0) {
    throw new StorigeUsageError('Idempotency-Key 는 빈 문자열일 수 없습니다');
  }
  const fileHash = await sha256Hex(bytes);
  const composed = `${key}:${fileHash}`;
  if (composed.length <= IDEMPOTENCY_KEY_MAX_LENGTH) {
    return composed;
  }
  // 상한 초과 — 합성값을 다시 해시(64자). 결정적이므로 멱등성 유지.
  return sha256Hex(new TextEncoder().encode(composed));
}

/** 서버 상한(1~128자) 사전 검증 — 400 왕복 대신 즉시 실패 */
export function assertValidIdempotencyKey(key: string): void {
  if (key.length === 0 || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new StorigeUsageError(
      `Idempotency-Key 는 1~${IDEMPOTENCY_KEY_MAX_LENGTH}자여야 합니다 (현재 ${key.length}자)`,
    );
  }
}
