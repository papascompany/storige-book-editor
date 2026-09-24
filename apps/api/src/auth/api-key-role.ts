/**
 * W1 (2026-09-25) — X-API-Key 역할(role) 판정의 단일 원천.
 *
 * `role === 'worker'` 는 테넌트 스코프를 통째로 건너뛰는 **신뢰 내부 워커** 표지다.
 * 소비처(전부 바이패스): files.service `assertSiteAccess` · worker-jobs.service 2곳 ·
 * edit-sessions.service 3곳 · presigned-upload.service 2곳(사이트 대조·스탬프).
 * 따라서 이 역할은 **내부 `WORKER_API_KEY` 에만** 부여한다.
 *
 * 🔴 종전 결함: ApiKeyGuard·ApiKeyStrategy 가 editor 코드 조회에 실패하면 worker 코드로 찾고
 *    `role='worker'` 를 줬다. editor≠worker 코드를 가진 **파트너 사이트의 worker 키**가
 *    테넌시를 전부 우회해 타사 파일 다운로드·하드삭제·만료, 타사 잡·세션 접근이 가능했다
 *    (2026-09-24 운영 실측: 해당 활성 사이트 3곳). 파트너 worker 코드는 **그 사이트에 귀속된
 *    일반 사이트 키**로 취급한다 — 자기 사이트·NULL-site 자원 접근은 종전과 동일하다.
 *
 * ⚠️ 이 함수를 거치지 않고 `role='worker'` 를 부여하는 코드를 추가하지 마라(api-key-role.spec.ts 가 잠근다).
 */
export type ApiKeyRole = 'editor' | 'worker';

export function resolveApiKeyRole(
  apiKey: string,
  internalWorkerKey: string | undefined,
): ApiKeyRole {
  return !!internalWorkerKey && apiKey === internalWorkerKey ? 'worker' : 'editor';
}
