# 대용량(1GB+) 고객 PDF 업로드 — bookmoa-mobile 연동 지시문 / 핸드오프

> **작성**: 2026-06-18 · **대상 독자**: bookmoa-mobile(임베드 호스트) 작업 세션 + Storige 작업자
> **자기완결 문서**: 이 문서만 읽어도 맥락이 서도록 작성. bookmoa-mobile 세션은 §1·§6·§7·§9만 봐도 착수 가능.
> **상태**: 설계 확정 + 오너 게이트 대기(§10). 제안 인터페이스(§7)는 **아직 미구현(net-new)**.

---

## 0. 한 줄 요약

고객 주문 PDF가 **1GB+** 인 경우가 있는데, 현재 스택은 **최대 50MB(편집기 가드)/100MB(서버)** 까지만 받고 그 이상은 nginx·multer·워커 메모리에서 전부 막힌다. 정공법은 **브라우저 → Cloudflare R2 presigned 직결 업로드(>100MB는 S3 멀티파트 청크)** 로, 파일 바이트가 **nginx·API·워커를 통과하지 않게** 하는 것이다. bookmoa-mobile은 **업로드 바이트를 자사 Vercel 함수로 절대 프록시하지 말고**, R2 CORS·주문 연결·진행률 UI를 담당한다.

---

## 1. 배경 / 증상 (자기완결)

- **증상**: 임베드(bookmoa-mobile) 편집기에서 ~6MB 내지 PDF 업로드 시
  `Unexpected token 'R', "Request En"... is not valid JSON`.
- **근본원인(2겹, 코드·실측 확인)**:
  1. 임베드 시 편집기는 호스트가 넘긴 `apiBaseUrl` 로 **모든 API 호출(업로드 포함)** 을 보낸다(`apps/editor/src/embed.tsx`의 `apiClient.setBaseUrl`). bookmoa-mobile은 **Vercel** 호스팅 → 서버리스 요청 본문 한도 **약 4.5MB** → 6MB가 초과되어 Vercel이 평문 `Request Entity Too Large`(413) 반환.
  2. 편집기 axios가 그 **평문 413을 JSON.parse** 하다 첫 글자 `R`에서 SyntaxError → 그 메시지가 그대로 노출.
- **실측**: Storige API 직결(`https://api.papascompany.co.kr/api/storage/upload-public`)은 **8.5MB도 201 성공**. 즉 우리 nginx(100M)·multer(50MB)는 6MB를 막지 않는다 → 413의 출처는 **호스트(Vercel) 프록시**.

---

## 2. 이미 적용된 Storige 조치 (commit `1e6d9cc`, master)

| 변경 | 효과 |
|---|---|
| 편집기/admin axios 안전 `transformResponse` | 비-JSON 413/HTML 응답에도 `Unexpected token` 크래시 없이 친화 메시지 |
| `parseApiError` 413 분기 + `toUserMessage()` | "업로드 용량이 서버 한도를 초과했습니다…" 한국어 안내 |
| `apiClient.getDirectBaseUrl()` + 모든 멀티파트 업로드 **직결** | 업로드가 호스트 프록시(Vercel 4.5MB)를 우회해 Storige API 직결 |

**이 조치의 상한 = 50MB** (편집기 가드) / 100MB (서버 multer). **1GB는 여전히 불가** — 아래가 그 해결책이다.

---

## 3. 현재 스택이 1GB를 막는 지점 (코드 확인)

| 레이어 | 위치 | 값 | 1GB 결과 |
|---|---|---|---|
| nginx body 한도 | `docker/nginx/nginx.conf:56` | `client_max_body_size 100M` | **413 (첫 벽)** |
| NestJS body-parser | `apps/api/src/main.ts:57-59` | `MAX_BODY_SIZE 100mb` | 413 |
| multer (storage) | `apps/api/src/storage/storage.controller.ts:30` | **memoryStorage** + 50MB | **OOM 위험** / 413 |
| multer (files PDF) | `apps/api/src/files/files.controller.ts:72` | **memoryStorage** + 100MB | **OOM 위험** / 413 |
| 편집기 가드 | `apps/editor/src/components/editor/ContentPdfAttachModal.tsx:94` | 50MB 하드 | 클라이언트 거부 |
| axios 타임아웃 | `apps/editor/src/api/client.ts:113` | 30s | ECONNABORTED |
| 워커 한도 | `apps/worker/src/config/validation.config.ts:16` | `MAX_FILE_SIZE 100MB` | reject |
| 워커 메모리 로드 | `apps/worker/src/services/pdf-validator.service.ts:57,79` | `downloadFile()` → 전체 Uint8Array → `PDFDocument.load(전체)` | **OOM** |

> ⚠️ 핵심: 4·5·8의 **memoryStorage / 전체-메모리 파싱** 구조는 **한도만 올리면 더 위험**(OOM)해진다. 그래서 "한도 상향"이 아니라 "바이트가 안 지나가게" 하는 presigned가 정답.

---

## 4. 목표 아키텍처 — presigned 직결 (바이트가 API/nginx/워커를 통과하지 않음)

### 단일 PUT (≤ ~100MB)
```
[브라우저]                         [Storige API]                [R2/S3]
  1. POST /files/presigned-upload  ───▶  storageKey 생성 + getSignedUrl
                                   ◀───  {fileId(pending), uploadUrl, storageKey}
  2. PUT uploadUrl  (바이트 직결, API 우회) ──────────────────────────▶ R2  ──▶ ETag
  3. POST /files/:id/complete {storageKey,eTag} ─▶ HeadObject 검증 + status=ready
  4. POST /worker-jobs/validate {fileId} ─▶ 워커가 R2에서 직접 read
```

### 멀티파트 청크 (>100MB ~ 1GB+)
```
1. POST /files/multipart/init      → CreateMultipartUpload → {fileId, uploadId, storageKey}
2. POST /files/multipart/sign {uploadId, partNumber} → UploadPart presigned URL
   (브라우저가 8~16MB 청크로 N회; 병렬/재시도 가능)
3. 각 파트 PUT → R2 직결, ETag 수집
4. POST /files/multipart/complete {uploadId, parts[{partNumber,eTag}]} → status=ready
   (중단 시 POST /files/multipart/abort → AbortMultipartUpload)
```

### 재사용 가능 자산 (이미 구현됨) vs net-new (확인 완료)
| 구분 | 항목 | 위치 |
|---|---|---|
| ✅ 재사용 | 스토리지 추상화 `local\|s3` | `apps/api/src/storage/object-storage.service.ts` |
| ✅ 재사용 | DB 기반 드라이버 설정(`STORAGE_DRIVER`) | `apps/api/src/settings/storage-config.service.ts` |
| ✅ 재사용 | 키 저장 스키마 | `file.entity.ts:44-49` `storageBackend`/`storageKey` |
| ✅ 재사용 | 외부 파일 메타 등록 패턴 | `files.service.ts` `registerExternalFile()` |
| ✅ 재사용 | 외부 인증 | `ApiKeyGuard`, site 스코프 |
| ✅ 재사용 | R2 이관 스크립트 패턴 | `apps/api/scripts/migrate-files-to-r2.ts` |
| ❌ net-new | `@aws-sdk/s3-request-presigner` 의존성 | `apps/api/package.json` (현재 `client-s3`만 설치) |
| ❌ net-new | presigned 단일/멀티파트 엔드포인트 | `files.controller.ts` |
| ❌ net-new | `files.status`(pending/ready) + multipart 메타 | entity/migration |
| ❌ net-new | 워커 R2 스트리밍 read | `downloadFile()` 4곳 |

---

## 5. 책임 분담 (Storige vs bookmoa-mobile)

| 영역 | Storige(우리 레포) | bookmoa-mobile(별도 레포) |
|---|---|---|
| presigned 엔드포인트 | ✅ 구현 | — (호출만) |
| R2 버킷/키 | ✅ admin 설정·드라이버 전환 | — |
| **R2 CORS** | 정책 정의 | ✅ **자사 origin 등록 확인**(Cloudflare는 Storige 오너가 설정하나, 허용 origin 목록은 bookmoa-mobile 도메인 필요) |
| 업로드 바이트 전송 | — | ✅ **브라우저→R2 직결**(자사 함수 프록시 금지) |
| 진행률 UI(%) | 편집기 모달 측 가능 | ✅ 또는 편집기와 협의 |
| 주문-파일 연결 | 완료 콜백 제공 | ✅ payload 수신→주문 매핑 |
| 게스트/세션 토큰 | ✅ 발급/검증 | ✅ 임베드 파라미터 전달 |

---

## 6. ★ bookmoa-mobile 측 지시 (DO / DON'T)

### 🚫 DON'T
- **업로드 바이트(PDF)를 자사 Vercel 서버리스 함수/Next.js API route로 프록시하지 말 것.**
  Vercel 서버리스 요청 본문 한도(**약 4.5MB, 하드 캡**)에 막혀 6MB조차 413이 난다. 1GB는 말할 것도 없다.
  → 파일은 **편집기 코드가 R2 presigned URL로 직결 PUT** 한다. 호스트는 바이트를 만지지 않는다.
- 작은 파일이라고 예외적으로 프록시 경유시키지 말 것(현재 6MB 장애의 직접 원인).

### ✅ DO
1. **임베드 파라미터 유지** — `apps/editor/src/views/EmbedView.tsx`가 받는 파라미터(`apiBaseUrl`, shop-session `token`, `sessionId`/`orderSeqno`, `templateSetId`, `guestToken` 등) 스펙 그대로 전달.
   - presigned는 **편집기 내부 흐름**이라 신규 임베드 파라미터는 (현 설계상) **불필요**(추정 — §7 계약 확정 시 재확인).
   - ⚠️ `apiBaseUrl`을 자사 프록시로 지정하면 presigned **발급 API 호출**까지 프록시를 타니, **`apiBaseUrl`은 Storige API 원본**(`https://api.papascompany.co.kr/api`)을 가리키게 할 것. (편집기는 업로드 PUT은 R2로, API 호출은 이 base로 보낸다.)
2. **R2 CORS에 자사 origin 등록 요청** — 운영 도메인 + `*.vercel.app`(프리뷰)을 Storige 오너에게 전달해 R2 버킷 CORS `AllowedOrigins`에 반영. (`PUT`,`POST` 메서드 + `ETag` 응답 헤더 expose 필수 — 없으면 멀티파트 complete가 ETag를 못 읽어 실패.)
3. **주문-파일 연결** — 편집기 완료 콜백 payload(`{coverFileId, contentFileId, ...}`)를 수신해 주문에 매핑(기존 `editor.complete` 흐름 유지).
4. **진행률 UI** — 1GB 업로드는 % 표시가 사실상 필수. 편집기 모달에 추가하거나(우리 측), 호스트 셸에서 표시할지 협의. presigned PUT은 `XMLHttpRequest.upload.onprogress`로 진행률 취득 가능.
5. **게스트 흐름 유지** — `/edit-sessions/guest` + `guestToken`(24h) 그대로. presigned-public 경로도 동일 게스트 가드.
6. **재개(resumable)** — 멀티파트는 파트 단위 재시도가 기본. 브라우저 새로고침 후 완전 재개는 `uploadId`+업로드된 파트 목록을 localStorage 보관해야 함 → **선택/후속**.

---

## 7. 인터페이스 계약 (제안 — Storige가 구현, bookmoa-mobile은 정렬)

> ⚠️ 아래 엔드포인트는 **아직 미구현(net-new)**. Storige가 구현하며, 최종 시그니처는 구현 시 확정. bookmoa-mobile은 "편집기가 이 흐름을 수행한다"는 전제만 알면 됨(대부분 편집기 내부 처리).

**단일 PUT**
- `POST /files/presigned-upload` → `{ fileId, uploadUrl, storageKey, expiresIn }`
  - body: `{ type, fileName, contentType, size, orderSeqno?, memberSeqno? }`
  - 게스트용 `POST /files/presigned-upload-public`(@Public + IP throttle).
- `PUT <uploadUrl>` (R2 직결) → `ETag`
- `POST /files/:id/complete` body `{ storageKey, eTag }` → HeadObject 검증 + `status=ready`

**멀티파트(>100MB)**
- `POST /files/multipart/init` → `{ fileId, uploadId, storageKey }`
- `POST /files/multipart/sign` body `{ uploadId, partNumber }` → `{ url }`
- `POST /files/multipart/complete` body `{ uploadId, parts:[{partNumber,eTag}] }` → `status=ready`
- `POST /files/multipart/abort` body `{ uploadId }`

**완료 후(공통)**: `POST /worker-jobs/validate { fileId }` → 워커가 R2에서 직접 read.

**임계 분기(제안)**: 편집기에서 `file.size > 80MB` → presigned(멀티파트), 이하 → **기존 `/storage/upload-public`(50MB) 그대로**. 두 경로 모두 결과로 `fileId` 반환 통일. (임계치 = 오너 결정 §10 O-3.)

---

## 8. Storige 측 작업항목 (우리 레포 — 참고용, bookmoa-mobile 무관)

- **P0**: R2 버킷 프로비저닝(오너) · `@aws-sdk/s3-request-presigner` 추가 · R2 CORS 정책.
- **P1**: presigned 엔드포인트 4종 · `files.status`/multipart 메타 마이그레이션 · complete HeadObject 검증 · orphan(미완료 멀티파트) 정리 잡.
- **P2**: 워커 `downloadFile()` R2 스트리밍 read(4곳) · `MAX_FILE_SIZE` 단계 상향 · 워커 `--max-old-space-size`/동시성 튜닝 · 대용량 검증 깊이 재설계(pdf-lib 풀파싱 → 메타/GS 기반 일부 대체 검토).
- **P3**: 편집기 50MB 가드를 presigned 경로에서 상향·진행률 UI · API 호출 타임아웃은 짧게 유지하되 **PUT은 타임아웃 없는 별도 fetch** · nginx 100M·body-parser는 **불변**(바이트 미통과 — 이게 이점).

---

## 9. 테스트 / 검증 체크리스트

- [ ] R2 CORS: bookmoa-mobile origin에서 presigned `PUT` 성공(브라우저 콘솔 CORS 오류 0) + `ETag` 응답 노출 확인
- [ ] 6MB PDF: presigned 또는 기존 경로로 업로드 성공(현재 장애 해소 회귀 테스트)
- [ ] 100MB / 500MB / 1GB PDF: 멀티파트 업로드 → complete → `status=ready` → 워커 검증 통과
- [ ] 업로드 중단/재시도: 파트 재시도 정상, abort 시 R2 orphan 정리
- [ ] 게스트 흐름: guestToken로 presigned-public 업로드 → 주문 연결
- [ ] **프록시 미경유 확인**: Network 탭에서 PUT 요청 호스트가 **R2 도메인**(자사/Vercel 아님), `Server` 헤더가 Cloudflare R2
- [ ] 진행률 UI: 1GB 업로드 중 % 갱신
- [ ] 워커: 1GB read 시 OOM 없음(스트리밍), 임시 디스크 정리

---

## 10. 오너 결정 게이트 (선결 필요)

| # | 결정 | 선택지 |
|---|---|---|
| O-1 | **R2 프로비저닝 여부/시점** | 전체 작업의 전제. 미정이면 P1까지 코드만 머지하고 비활성 대기 |
| O-2 | **실제 최대 크기** | 100MB/300MB/1GB/무제한 — 워커 메모리·검증 깊이가 종속 |
| O-3 | presigned 임계치 | 50/80/100MB (이하 기존 흐름) |
| O-4 | **대용량 PDF 검증 깊이** | 풀파싱 vs 메타/페이지수만(인쇄 적합성 일부 포기 trade-off) |
| O-5 | 재개(resumable) 범위 | 파트 재시도만 vs 새로고침 후 완전 재개 |
| O-6 | 보존정책 | R2 lifecycle vs `expires_at` 잡(1GB 보관비용) |
| O-7 | 검증 타임아웃/동시성 | 1GB GS inkcov는 분 단위 → 폴링 30s 상향 또는 비동기 알림 전환 |

---

## 11. 진행 순서 / 의존성

```
O-1(R2 프로비저닝) ─┬─▶ P0(presigner·CORS) ─▶ P1(API 엔드포인트) ─▶ 편집기 presigned 연동
                   │                                              └─▶ bookmoa-mobile: CORS origin·진행률·주문연결
                   └─▶ P2(워커 R2 read·메모리) ── 1GB 실파일 E2E
```
- **하위호환**: 기존 50MB 흐름은 **그대로 둔다**. `storage_backend` 혼재 이미 지원 → local/s3 공존 OK.
- **비파괴 배포**: `STORAGE_DRIVER=local`(기본)이면 presigned 엔드포인트는 비활성/503 → 프론트는 기존 흐름 폴백. 오너가 R2 키 입력 + driver=s3 전환 시 비로소 활성.

---

## 12. 참조 (file:line)

- 임베드 base override: `apps/editor/src/embed.tsx`(setBaseUrl), `apps/editor/src/views/EmbedView.tsx`(파라미터)
- 직결 헬퍼(적용됨): `apps/editor/src/api/client.ts` `getDirectBaseUrl()`
- 한도: `docker/nginx/nginx.conf:56`, `apps/api/src/main.ts:57-59`, `apps/api/src/storage/storage.controller.ts:30`, `apps/api/src/files/files.controller.ts:72`, `apps/editor/src/components/editor/ContentPdfAttachModal.tsx:94`, `apps/worker/src/config/validation.config.ts:16`
- 재사용 자산: `apps/api/src/storage/object-storage.service.ts`, `apps/api/src/settings/storage-config.service.ts`, `apps/api/src/files/entities/file.entity.ts:44-49`, `apps/api/src/files/files.service.ts`(registerExternalFile), `apps/api/scripts/migrate-files-to-r2.ts`
- 워커 read: `apps/worker/src/services/pdf-validator.service.ts:57,79,633`(+synthesizer/converter/page-renderer)

> 시크릿(사이트 API 키·R2 자격증명)은 이 PUBLIC 문서에 절대 기재 금지 — 위치만: `CLAUDE.local.md` / VPS `~/storige/.env`.
