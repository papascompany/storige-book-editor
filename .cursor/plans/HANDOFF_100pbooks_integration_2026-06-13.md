# HANDOFF — 100p_books × Storige 인쇄 백엔드 일원화 (PDF 저장+검증 오프로드)

> **작성**: 2026-06-13 (storige 세션)
> **대상**: 100p_books 작업 세션 (다른 레포 — /Users/yohan/Documents/claude/100p_books)
> **결정 근거**: bookmoa·ShareSnap·100p_books를 단일 Storige 인쇄 백엔드로 일원화. CTO가 "전략적 통합" 방향 확정(2026-06-13).
> **짝 트랙(우리 측)**: Storige 저장계층 R2/S3 보강 + 보존정책 (작업 칩 `task_12f7231a`) — **이 모델이 스케일하려면 선결**.

---

## 0. 배경 — 가능여부 판단 결과

100p_books(Next.js14 + Supabase + Fabric.js 6, **자체 PDF 렌더러** `@napi-rs/canvas`+`pdf-lib`)는 주문당 **표지+내지 70-200MB PDF**(300dpi 100p)를 Supabase `pdfs` 버킷에 **보존정책 없이 무한 누적** → 용량 한계. 사진(`photo-originals` ~515MB/프로젝트)은 조연, **PDF가 주범**.

3스트림 병렬 감사 결론(2026-06-13):
- **Storige 3솔루션(편집기연동·PDF생성·Worker) 모두 X-API-Key로 외부 독립 소비 가능** 확정.
- 100p_books는 **에디터·렌더러를 이미 보유** → ShareSnap(에디터 없음)과 달리 편집기 연동 불필요. **저장·검증·이행만 오프로드**가 적합.
- ⚠️ **정직한 한계**: Storige VPS도 150GB(여유 119GB)·TTL 없음·객체스토리지 아님 → 그냥 옮기면 ~880주문이면 같은 벽. **실제 해결 = 보존정책(§4.4) + Storige R2 보강(별도 트랙)**. PDF는 PageDoc JSON(DB)에서 재생성 가능한 파생물이라 장기보관 대상 아님.

---

## 1. 통합 모델

```
100p_books (유지: Fabric6 에디터 + @napi-rs 렌더러)
   주문 결제 confirm → PDF 빌드(기존 그대로)
        │  변경: Supabase pdfs 업로드 → Storige
        ▼
   POST /files/upload/external (X-API-Key) ×2(cover/content) → fileId
   POST /worker-jobs/validate/external → CMYK/재단선/해상도 검증
        ▼
   orders.storige_*_file_id 저장 (Supabase pdfs 쓰기 중단)
        ▼
   이행: GET /files/:id/download/external (인쇄소/관리자, X-API-Key 일원화)
        ▼
   보존정책: 배송완료 +N일 → fileId 정리 (재인쇄는 PageDoc에서 온디맨드 재생성)
```

- **유지(불변)**: Fabric6 에디터, 자동편집, 표지편집, 자체 PDF 렌더러. PDF는 지금처럼 생성.
- **변경**: 저장처 Supabase→Storige, 인쇄 검증 추가, 이행 다운로드 일원화.
- **비-목적**: Storige 편집기 채택 안 함. 사진 버킷 이전은 Phase 2.

---

## 2. 우리 측(Storige 운영) 상태

| # | 작업 | 상태 |
|---|------|------|
| S1 | Sites 에 "100p Books" 등록 → 키 발급 | ✅ **완료(2026-06-13)** — site id `729ad8a7-3c92-42b7-b46c-437f12846692`, 키 59자, 스모크 통과. 키는 `CLAUDE.local.md §5`. |
| S2 | 발급 키를 100p_books 팀에 **안전 채널 전달** | ⏳ **오너 작업** (자동 전송 안 함) |
| S3 | **저장계층 R2/S3 보강(추상화) + 보존정책 cron** | ✅ **Phase 1 완료(2026-06-13, 커밋 37776d5)** — `STORAGE_DRIVER=s3` opt-in. 오너 R2 프로비저닝+배포는 런북 `docs/STORAGE_R2_RUNBOOK.md`. nginx `/storage/*`·워커는 Phase 2. |
| S4 | Storige 파일 삭제 API + 만료 예약 + retention cron | ✅ **완료** — `DELETE /files/:id/external`, `POST /files/:id/expiry/external`, `@Cron` 정리 |

> 100p_books는 dev에서 **발급 키만으로 즉시 착수 가능**(서버 간 X-API-Key, CORS/iframe 무관). 도메인/iframe 설정 불필요(편집기 임베드 안 함).

---

## 3. Storige API 계약 (검증된 엔드포인트)

### 3.1 PDF 업로드 → fileId
```
POST {API}/files/upload/external   (X-API-Key, multipart)
  file: <PDF, application/pdf, ≤100MB>, type: "cover"|"content", orderSeqno?: int
  → 201 { id: fileId, fileName, fileUrl, fileSize }
```

### 3.2 인쇄 검증 (100p에 현재 없음)
```
POST {API}/worker-jobs/validate/external   (X-API-Key)
  { fileId, fileType:"content"|"cover", orderOptions:{ size:{width,height}, pages, binding:"perfect", bleed:2 } }
  → 201 { id: jobId }
폴링 GET {API}/worker-jobs/{jobId} → COMPLETED|FIXABLE|FAILED + result.issues/warnings
```

### 3.3 다운로드 (이행)
```
GET {API}/files/{fileId}/download/external   (X-API-Key) → PDF 바이너리
```

### 3.4 (선택) 병합 `POST /worker-jobs/synthesize/external`. 포토북은 표지/내지 분리 2파일 기본.

---

## 4. 100p_books 구현 작업

### 4.1 저장처 전환 — `lib/pdf/build-job.ts` / `app/api/payments/confirm/route.ts`
PDF 버퍼 생성(기존) 후 Supabase 업로드 대신 `upload/external` ×2 → `coverFileId`/`interiorFileId`. (권장) 각각 `validate/external`. `orders`에 fileId 저장. Supabase `pdfs` 쓰기 중단.

### 4.2 이행 — `app/api/admin/orders/[id]/...`
관리자/인쇄소 다운로드를 `download/external`(서버 프록시)로 전환. Supabase signedUrl 의존 제거.

### 4.3 마이그레이션
일회성: 기존 Supabase `pdfs` → 다운로드 → `upload/external` → fileId 저장 → 버킷 정리. 또는 미배송분만 PageDoc 재빌드.

### 4.4 보존정책 (필수 — 용량 문제의 실제 해결) ✅ Storige API 준비됨(2026-06-13)
배송완료 시 **만료 예약** `POST /files/:id/expiry/external` `{ "expiresAt": "<배송완료+14일 ISO>" }` (X-API-Key) → Storige retention cron(매시)이 만료분 하드삭제(객체+DB). 또는 즉시 `DELETE /files/:id/external`. 재인쇄/CS는 **PageDoc에서 온디맨드 재생성→재업로드**. PDF 장기보관 안 함. (커밋 37776d5, 런북 `docs/STORAGE_R2_RUNBOOK.md`)

### 4.5 (선택) Vercel 생성부하
100p PDF 생성 `maxDuration=300s` 근접 시 큐 분리/페이지 청크 — 100p 자체 과제(Storige worker는 Fabric6 렌더 안 함).

## 5. DB (마이그레이션 0024)
```sql
alter table public.orders
  add column storige_cover_file_id    text,
  add column storige_interior_file_id text,
  add column storige_validation       jsonb;
-- cover_pdf_key/interior_pdf_key 는 전환 후 제거
```

## 6. 수용 기준
① confirm→빌드→upload×2→fileId 저장 ② validate COMPLETED+리포트 ③ download/external 정상 ④ Supabase pdfs 신규쓰기 0 ⑤ 배송완료+N일 cron 정리.

## 7. 보안
키 서버 env 전용·커밋 금지 · 모든 호출 서버 경유 · 다운로드 서버 프록시 · 보존 cron dry-run 검증.

---

## 8. 미해결/오너 결정
- ~~Storige 파일 삭제 API 부재~~ → ✅ 해결(S4 완료: DELETE/expiry/external + cron).
- **오너 R2 프로비저닝**: Cloudflare R2 버킷 생성 + 키 발급 + `.env` STORAGE_DRIVER=s3 설정 + 배포(런북 §2~3). 이게 있어야 s3 저장 활성.
- 월 주문량(런웨이) — R2 전환 전 로컬 단계는 119GB ÷ 평균 135MB ≈ 880주문 한도. R2 전환 후 사실상 무한(보존정책으로 비용 관리).
- 사진 버킷(`photo-originals`) 오프로드 여부(Phase 2).
- nginx `/storage/*` 직접서빙 자산의 R2 이전(Phase 2 — 외부 URL 호환 조율 필요).
