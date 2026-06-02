# 합성 E2E 테스트 계획 — 편집완료 → PDF 합성 → 관리자 확인 (2026-06-02)

> **목적**: bookmoa가 클라이언트 E2E(편집완료→합성, 모바일 실기)를 진행하는 동안, **Storige 측 백엔드**(워커 PDF 검증 / 파일 업로드 / 합성 / 관리자 확인)를 독립적으로 테스트하기 위한 절차.
> **조사 근거**: 서브에이전트 4종(워커검증·합성 / 파일업로드 / API오케스트레이션 / 관리자) 코드 매핑 결과.
> **관련**: [`RESUME_PROMPT_2026-06-02.md`](./RESUME_PROMPT_2026-06-02.md), [`HANDOFF_StorigeEditorHost_iframe_overlay_2026-05-31.md`](./HANDOFF_StorigeEditorHost_iframe_overlay_2026-05-31.md)

---

## 0. 핵심 사실 (먼저 알아야 할 것)

1. **편집완료(`PATCH /edit-sessions/:id/complete`)는 합성을 자동 트리거하지 않는다.** status를 `COMPLETE`로 바꾸고 **검증(validation) 잡만** 발행한다 ([edit-sessions.service.ts:393](../apps/api/src/edit-sessions/edit-sessions.service.ts)). SPREAD 모드는 검증도 스킵.
2. **합성(compose-mixed)은 외부(bookmoa 서버)가 `POST /worker-jobs/compose-mixed`를 명시 호출**해야 시작된다. 이 엔드포인트는 **`@Public` (인증/가드 없음)** — 테스트엔 유리하나 운영 보안 검토 대상.
3. **편집완료 PDF 생성**: 편집기가 `saveMultiPagePDFAsBlob`(300 DPI, mm, SVG→PDF 벡터) → `POST /files/upload`(PDF만, 100MB) → `fileId` → 세션 `coverFileId/contentFileId`. (게스트는 PDF 생성 안 함 → `editor.needAuth`)
4. **저장**: VPS `/app/storage`, nginx가 `/storage/*` 직접 서빙. 합성 출력은 `/storage/outputs/<jobId>/{merged|cover|content|pages}.pdf`.
5. **관리자 재합성/파일교체 UI는 Storige admin에 없음** — bookmoa `Admin.jsx`(별도 레포). Storige admin은 **조회/모니터링**(`/worker-jobs`, `/edit-sessions`, `/worker-test`)만.

### E2E 데이터 흐름
```
[편집기] 편집완료
  └ canvasData 저장 → PDF 생성(300dpi) → POST /files/upload → fileId
  └ PATCH /edit-sessions/:id/complete  → status=COMPLETE + 검증 잡 발행
        └ 워커 pdf-validation(validate-pdf) → FIXABLE/FAILED/COMPLETED → validation 콜백
[외부(bookmoa) 서버]  GET /edit-sessions/external?orderSeqno= (X-API-Key) → cover/content URL
  └ POST /worker-jobs/compose-mixed { cover/content URL, outputMode, callbackUrl }
        └ 워커 pdf-synthesis(synthesize-pdf, mode=compose-mixed)
              └ /storage/outputs/<jobId>/{separate|content-only|single|merged}
              └ synthesis.completed 콜백 (X-Storige-Signature=base64)
[관리자] admin /worker-jobs → 출력 PDF 링크/상세 result 확인
```

---

## 1. 사전 준비

| 항목 | 위치/명령 |
|---|---|
| SSH 에이전트 | `ssh-add -l` (비어있으면 `ssh-add ~/.ssh/id_ed25519`) |
| API base | `https://api.papascompany.co.kr/api` |
| `STORIGE_API_KEY` (외부 X-API-Key) | `CLAUDE.local.md §5` (로그 출력 금지) |
| admin 계정 | `CLAUDE.local.md §5` (`admin@storige.com`) — `POST /auth/login` |
| 테스트 PDF | 실제 편집완료 세션 파일 URL 사용(아래 §5), 또는 임의 PDF를 `/storage/upload-public`으로 올려 URL 확보 |
| 큐/DB 확인 | `CLAUDE.local.md §6.5/§6.7` 레시피 |

---

## 2. Phase 1 — 파일 업로드 테스트

두 업로드 시스템이 분리돼 있음:

| 시나리오 | 엔드포인트 | 인증 | 제약 | 확인 |
|---|---|---|---|---|
| 게스트 내지첨부/이미지 | `POST /storage/upload-public?category=uploads` | 없음 | jpeg/png/webp/pdf, 50MB, 그 외 415 | 응답 `url`; VPS `storage/uploads/<uuid>` 존재; **DB 미기록** |
| 편집완료 PDF(회원) | `POST /files/upload` | JWT Bearer | **PDF만**(아니면 400), 100MB | 응답 `id`(fileId)·`fileUrl`; `files` 테이블 레코드 |
| 외부 시스템 PDF | `POST /files/upload/external` | X-API-Key | PDF만, 100MB | 응답 `id`; DB·디스크 |

확인:
```bash
# VPS 파일 존재
ssh deploy@158.247.235.202 'ls -la ~/storige/storage/uploads/ | tail'
# HTTP 서빙 (nginx 직접)
curl -I https://api.papascompany.co.kr<fileUrl>   # 200 + application/pdf
# DB (/files/* 만 기록)
ssh deploy@158.247.235.202 'source ~/storige/.env && docker exec storige-mariadb mariadb -ustorige -p"$DATABASE_PASSWORD" storige -e "SELECT id,file_name,file_type,file_size,order_seqno FROM files ORDER BY created_at DESC LIMIT 5;"'
```

---

## 3. Phase 2 — PDF 검증 테스트

`POST /worker-jobs/validate/external` (X-API-Key). 검증 항목: 페이지 크기(±1mm), 페이지 수(표지 1/2/4p, 무선 4배수, 중철 4배수≤64p), 재단여백, 책등, 색상(GS inkcov), DPI(<150 경고), 스프레드 감지.

```
POST /api/worker-jobs/validate/external
Header: X-API-Key: <STORIGE_API_KEY>
Body: {
  "fileUrl": "/storage/uploads/<...>.pdf",
  "fileType": "content",
  "orderOptions": { "size": {"width":210,"height":297}, "pages": 24, "binding": "perfect", "bleed": 3 },
  "callbackUrl": "https://papascompany.co.kr/api/storige/webhook"   // allowlist 호스트만
}
```
- **분기 검증**: 일부러 4의 배수 아닌 페이지/크기 불일치 PDF → `FIXABLE`(autoFixable 에러: addBlankPages/extendBleed/adjustSpine) vs `FAILED`(비수정 에러).
- 결과: `GET /worker-jobs/external/:id` → `result.isValid/errors/warnings/metadata`.
- ⚠️ **폰트 임베드 검증은 현재 미배선**(`detectFonts()` 정의만 존재, validate 흐름 미연결) — 테스트 기대에서 제외.

---

## 4. Phase 3 — 합성 테스트 (핵심)

`POST /worker-jobs/compose-mixed` (**인증 불필요**). outputMode별 출력 규칙:

| outputMode | 생성 파일 | 상품 | 입력 |
|---|---|---|---|
| `separate` | `cover.pdf` + `content.pdf` | 일반 책자 | coverUrl + contentPdfUrl |
| `content-only` | `content.pdf` | 레더커버 | contentPdfUrl (coverEditable:false) |
| `single` | `pages.pdf` | 낱장(카드/명함) | contentPdfUrl |
| (미지정) | `merged.pdf` | 하위호환 | cover+content |

```
POST /api/worker-jobs/compose-mixed
Body: {
  "editSessionId": "<세션UUID>",
  "coverUrl": "<표지 PDF URL>",
  "coverEditable": true,
  "contentPdfUrl": "<내지 PDF URL>",
  "frontEndpaperUrls": [null],   // null = 빈 면지 페이지
  "backEndpaperUrls": [null],
  "outputMode": "separate",
  "orderId": "TEST-001"
  // callbackUrl 생략 → 웹훅 미발송(테스트 시 bookmoa 미타격), GET으로 결과 확인
}
```
- **회귀 테스트**: 동일 입력으로 `outputMode`만 separate/content-only/single/생략(merged) 4가지 바꿔 출력 규칙 비교.
- 레더커버: `coverEditable:false` + `coverWidthMm/HeightMm` → 빈 표지 페이지 생성 확인.
- 면지: `frontEndpaperUrls`에 실제 URL + `null` 혼합 → 빈 면지 페이지 자동 생성 확인.
- **레거시 merge**: `POST /worker-jobs/synthesize/external`(X-API-Key) `outputFormat:'separate'` → cover.pdf+content.pdf+merged.pdf 동시.

확인:
```bash
# 큐 소비
ssh deploy@158.247.235.202 'docker exec storige-redis redis-cli LLEN bull:pdf-synthesis:wait'   # 0이면 소비됨
# 잡 결과
curl -s "https://api.papascompany.co.kr/api/worker-jobs/external/<jobId>" -H "X-API-Key: $KEY" | python3 -m json.tool
#  → status=COMPLETED, result.outputMode, result.outputFiles, result.totalPages
# 출력 파일
ssh deploy@158.247.235.202 'ls -la ~/storige/storage/outputs/<jobId>/'
# 워커 로그
ssh deploy@158.247.235.202 'docker logs --tail 100 storige-worker | grep -iE "compose-mixed|Synthesis"'
```

---

## 5. Phase 4 — 편집완료 데이터로 합성 (실데이터 E2E)

실제 편집완료 세션의 파일로 합성을 돌리는 절차(bookmoa 협업 지점):

1. **완료 세션 + 파일 URL 조회**:
   - 외부: `GET /api/edit-sessions/external?orderSeqno=<주문번호>` (X-API-Key) → `data[].files.{cover,content,merged}` URL.
   - 또는 DB: `SELECT id, mode, cover_file_id, content_file_id, content_pdf_file_id, status FROM file_edit_sessions WHERE status='complete' ORDER BY completed_at DESC LIMIT 5;`
   - fileId → URL: `SELECT id, file_url FROM files WHERE id IN (...);`
2. **합성 트리거**: §4의 compose-mixed에 그 cover/content URL + editSessionId 채워 호출.
3. **결과 검증**: 출력 PDF 페이지 수 = (표지 1 + 앞면지 N + 내지 M + 뒷면지 K)인지, 파일이 정상 열리는지.

---

## 6. Phase 5 — 관리자 확인

| 확인 | 화면 / API |
|---|---|
| admin 로그인 | `admin.papascompany.co.kr/login` / `POST /auth/login` |
| 합성 잡 모니터링 | `/worker-jobs` (작업유형=합성, 5초 자동갱신) / `GET /worker-jobs?jobType=SYNTHESIZE` (Bearer) |
| **결과 PDF 확인** | `/worker-jobs` 행의 "출력 파일" 링크 / 상세 모달 `result` JSON / `GET /worker-jobs/:id` |
| 결과 PDF 다운로드 | `GET /worker-jobs/:id/output` (Bearer, blob) |
| 입력물(표지/내지) 썸네일 | `/edit-sessions` (orderSeqno 검색) |
| 수동 잡 생성 도구 | `/worker-test` (admin) — 검증/합성 직접 트리거 |

> 재합성/편집열기/파일교체는 bookmoa `Admin.jsx`에서 (Storige admin엔 없음). 대체: `POST /worker-jobs/*synthesize*` API 직접 호출.

---

## 7. 확인 포인트 종합 (어디서 무엇을)

| 레이어 | 확인 명령/위치 | 정상 신호 |
|---|---|---|
| Redis 큐 | `redis-cli LLEN bull:pdf-synthesis:wait` / `:completed` / `:failed` | wait→0(소비), completed 증가 |
| DB worker_jobs | `SELECT id,job_type,status,output_file_url FROM worker_jobs ORDER BY created_at DESC LIMIT 5;` | status=COMPLETED |
| DB 세션 | `file_edit_sessions.status / worker_status` | complete / VALIDATED |
| Storage 출력 | `ls ~/storige/storage/outputs/<jobId>/` | 기대 파일명 + 페이지수 |
| 웹훅 | API/워커 로그 `Synthesis callback sent` / `[Webhook] Blocked` | allowlist면 전송 |
| 워커 로그 | `docker logs storige-worker \| grep -iE "validation\|compose-mixed\|Synthesis"` | PASS/completed |

---

## 8. 발견된 갭 / 리스크 (E2E 시 인지)

1. **`compose-mixed` 무인증(`@Public`)** — 다른 external 합성은 ApiKeyGuard. 운영 보안 검토 대상(향후 X-Guest-Token/ApiKey 분기).
2. **웹훅 서명이 HMAC 아님** — `base64(jobId:event:timestamp)`. 수신측(bookmoa) 서명 신뢰 금지(위변조 방어 약함).
3. **폰트 임베드 검증 미배선** — `detectFonts()` 정의만 존재, validate 미연결.
4. **웹훅 payload에 capability/totalPages 없음** — `outputFileUrl/outputFiles/outputFormat`만. 그 값은 `job.result`에 있어 `GET /worker-jobs/external/:id`로 조회 필요.
5. **`/storage/upload-public`은 files 테이블 미기록** — 검증·세션연결은 `contentPdfFileId`(varchar)로 별도 추적.

---

## 9. 권장 테스트 순서

1. (스모크) compose-mixed 무인증 호출 1건 → 파이프라인 동작 확인 (§4)
2. outputMode 4종 회귀 (§4)
3. 검증 FIXABLE/FAILED 분기 (§3)
4. 파일 업로드 3경로 (§2)
5. 실데이터 편집완료 세션으로 합성 (§5) ← bookmoa E2E와 맞물리는 지점
6. 관리자 화면 결과 확인 (§6)
