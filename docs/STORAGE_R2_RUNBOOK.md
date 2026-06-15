# 저장계층 객체스토리지(R2) 보강 + 보존정책 — 운영 런북

> **작성**: 2026-06-13
> **배경**: bookmoa·ShareSnap·100p_books 인쇄 백엔드 일원화. 100p_books PDF(주문당 70-200MB) 무한누적 → VPS 150GB(여유 119GB)·TTL 없음으로는 ~880주문이면 한계. 앱-프록시 파일 경로를 R2로 전환 + 보존정책 도입.
> **관련**: `.cursor/plans/HANDOFF_100pbooks_integration_2026-06-13.md`, 작업칩 task_12f7231a

---

## 0. 설계 경계 (왜 일부만 R2인가)

| 경로 | 서빙 | 외부 URL 의존 | R2 전환 |
|---|---|---|---|
| **앱-프록시** `/files/upload(/external)`·`/files/:id/download(/external)` | NestJS 앱(`getFileBuffer`) | fileId 기반(URL 무관) | ✅ **Phase 1(이번)** — 무중단 |
| **nginx 직접** `/storage/*` (라이브러리·썸네일·디자인·워커 outputs) | nginx `alias /app/storage/` | 300+ 소비처(PHP/모바일/에디터/웹훅) 가 URL 형식 의존 | ⏸ Phase 2(presigned 리다이렉트 + 클라 dual-support) |
| **워커 처리** temp/GS/pdf-lib | 로컬 fs 필수 | — | ❌ 로컬 유지(최종 outputs만 향후 R2) |

→ Phase 1 = **100p_books가 정확히 쓰는 경로**(upload/external→R2, download/external←R2)만 전환. bookmoa/에디터/워커 무영향.

---

## 1. 코드 변경 요약 (배포됨)

- `apps/api/src/storage/object-storage.service.ts` — `ObjectStorageService`(local|s3 통합, 드라이버 `STORAGE_DRIVER`). put/get/delete, 파일별 backend 라우팅(혼재 보장).
- `files.entity.ts` — `storage_backend`(default 'local')·`storage_key`·`expires_at` 컬럼.
- `files.service.ts` — `uploadFile`(active 백엔드 저장), `getFileBuffer`(backend 라우팅), `hardDelete`/`setExpiry`/`findExpired`.
- `files.controller.ts` — `DELETE /files/:id/external`(X-API-Key 하드삭제), `POST /files/:id/expiry/external`(만료 예약).
- `file-retention.service.ts` — `@Cron('17 * * * *')` 만료분 하드삭제(보수적: expires_at 명시 파일만, DRY_RUN 지원).
- `metrics.service.ts` — `storige_storage_bytes{backend}`·`storige_storage_files{backend}` Prometheus 게이지.
- 마이그레이션 `apps/api/migrations/20260613_add_files_storage_backend.sql`, 이전 스크립트 `apps/api/scripts/migrate-files-to-r2.ts`.

**기본 `STORAGE_DRIVER=local` → 배포해도 동작 불변(비파괴).** s3 는 opt-in.

---

## 2. 오너 선결작업 (R2 프로비저닝)

> ⚠️ 계정 생성·키 발급·자격증명 입력은 **운영자 직접**. (자동화 안 함)

1. Cloudflare R2 버킷 생성 (예: `storige-files`). 리전 무관(auto).
2. R2 API 토큰 발급 → Access Key ID / Secret Access Key.
3. 엔드포인트 확인: `https://<account_id>.r2.cloudflarestorage.com`
4. (선택) 버킷 lifecycle 규칙으로 미정리 객체 안전망 TTL.

---

## 3. 배포 절차 (무중단 순서 — synchronge=false 주의)

```bash
# (1) DB 마이그레이션 먼저 (컬럼/테이블 추가) — 코드 배포 전
ssh deploy@158.247.235.202
source ~/storige/.env
docker exec -i storige-mariadb mariadb -ustorige -p"$DATABASE_PASSWORD" storige \
  < ~/storige/apps/api/migrations/20260613_add_files_storage_backend.sql
docker exec -i storige-mariadb mariadb -ustorige -p"$DATABASE_PASSWORD" storige \
  < ~/storige/apps/api/migrations/20260615_add_storage_settings_and_site_retention.sql

# (2) API + admin 재배포 (admin은 Vercel 자동, API는 수동) + nginx 재시작
cd ~/storige && git pull origin master && docker compose up -d --build api && docker compose restart nginx
```

> ⚠️ 마이그레이션 → API 재배포 순서 지킬 것(신규 코드가 컬럼/테이블 존재 전제). [[feedback_schema_change_deploy]]

### 3.1 R2 활성화 — **admin UI 에서 (권장, 재배포 불필요)**
배포 후, admin **[저장소 설정]** 페이지에서:
1. "파일 저장 위치" → **객체스토리지 (R2 / S3)** 선택
2. 엔드포인트(`https://<acct>.r2.cloudflarestorage.com`)·버킷·Access Key ID·Secret 입력
3. 저장 → **즉시 반영**(다음 업로드부터 R2). 기존 로컬 파일은 그대로 읽힘(혼재 보장).

> env(`STORAGE_DRIVER=s3`, `S3_*`)로도 설정 가능하지만, **DB(admin) 값이 env 보다 우선**. admin 미설정 시 env fallback.

### 3.2 스모크
- `POST /files/upload/external`(X-API-Key) → 응답 `storageBackend='s3'` 확인
- `GET /files/:id/download/external` → 바이트 정상

---

## 4. 기존 파일 이전 (선택, 점진)

```bash
# dry-run 먼저 (대상 건수/크기 확인)
cd ~/storige && source .env
DRY_RUN=1 STORAGE_PATH=/app/storage npx ts-node apps/api/scripts/migrate-files-to-r2.ts
# 확인 후 실제 이전 (DRY_RUN 제거). 원본 디스크 파일은 보존 → 검증 후 별도 정리.
```
대상: `storage_backend='local' AND file_url LIKE '/storage/uploads/%'` (앱-프록시 업로드만). 멱등.

---

## 5. 보존정책 (관리자 설정 + 테넌트 API)

**관리자(admin UI)**:
- **[기본설정] 각 사이트 → "파일 보존 기간(일)"**: 그 사이트가 업로드한 파일을 N일 후 자동삭제. 비움/0=영구보관(bookmoa 등). 100p Books 사이트에 예: `14`.
  - 업로드 시점에 자동으로 `expires_at = now + N일` 설정됨(테넌트가 별도 호출 안 해도 됨).
- **[저장소 설정] → "파일 보존정책"**: 자동삭제 작업(cron) 전체 on/off + 관찰 모드(실삭제 전 로그만). 첫 도입 시 관찰 모드로 확인 후 끄기.

**테넌트 API(선택, 세밀제어)**:
- **만료 예약 덮어쓰기**: `POST /files/:id/expiry/external` `{ "expiresAt": "2026-07-01T00:00:00Z" | null }`.
- **즉시 삭제**: `DELETE /files/:id/external` (X-API-Key).

cron(`매시 17분`)이 만료분 하드삭제(객체+DB). 재인쇄/CS는 원본(PageDoc 등)에서 재생성→재업로드. **PDF 장기보관 안 함이 핵심.**

---

## 6. 모니터링 (Grafana)

- 메트릭: `storige_storage_bytes{backend="s3"}`, `storige_storage_files{backend}` (30초 갱신).
- 패널: 백엔드별 누적 바이트(시계열) + 일 증가율 → 비용/용량 추세. R2 비용(스토리지 GB·Class A/B ops)과 대조.
- 알람: VPS 로컬(`backend="local"`) 디스크 fill 경고는 기존 node-exporter `disk` 와 병행.

---

## 7. Phase 2 (후속, 별도)

- nginx 직접서빙 `/storage/*` → R2 presigned 리다이렉트 + 에디터/admin `resolveStorageUrl` dual-support + 외부 소비처 조율(웹훅 outputFileUrl 형식 포함). **외부 호환 깨질 위험 커서 별도 사이클.**
- 워커 최종 outputs R2 업로드(temp는 로컬 유지).
- Storige 자체 보존 cron 확장(orphan upload TTL 등).
