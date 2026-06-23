# RESUME PROMPT — 2026-06-20 · 트랙 B-(c) API/서빙 스트리밍 + R2 브라우저 서빙(권장안 A)

> 새 세션이 이 파일을 읽고 **트랙 B-(c)** 를 권장안 A로 즉시 착수하기 위한 자기완결 인수인계.
> CLAUDE.md / CLAUDE.local.md / MEMORY.md 는 세션 시작 시 자동 로드됨(운영정보·시크릿위치·메모리 인덱스). 그 위에 이 파일이 "지금 할 일".

---

## 0. 지금 즉시 할 일 (한 줄)

**(c) "전체버퍼 → 스트림" 전환**: ① API 파일 서빙을 `stream.pipe(res)` 로(2GB 다운로드에 API heap 2GB 안 먹게) ② **R2 파일을 브라우저가 불러올 공개 스트리밍 엔드포인트(권장안 A: fileId UUID 기반)** 신설 — 이게 있어야 트랙 B-(a)의 **>50MB 편집기 이미지가 표시(display)** 된다. (a)+(c) 를 **함께** master 머지·배포.

오케스트레이션(Workflow)로 진행(ultracode on). 적대검증(정확성+보안) 필수. dryRun/게이트 배포 규약 준수.

---

## 1. 큰 그림 — 지금까지(이번 대규모 세션 결과, 전부 라이브 또는 브랜치)

**대용량 PDF 업로드 = R2 presigned 직결**을 깔고, 그 위에 파일 생명주기 안전 + 2GB 확장 작업 중.

| 항목 | 상태 | 정본 |
|---|---|---|
| R2 프로비저닝(driver=s3)·CORS(editor·bookmoa.com/.net·mybookmake.com·*.vercel.app) | ✅ 라이브 | admin 저장소설정 |
| 편집기 presigned 업로드(내지 PDF >50MB→R2, single/multipart, IDOR uploadToken) | ✅ 라이브(master) | `apps/editor/src/api/presigned-upload.ts`, `apps/api/src/files/presigned-upload.service.ts` |
| 워커 검증 한도 100MB→**1GB** (+NODE_OPTIONS 3072) | ✅ 라이브 | docker-compose.yml:93 |
| bookmoa-mobile 주문화면 drop-in 지시문 | ✅ 전달됨 | `docs/BOOKMOA_MOBILE_PRESIGNED_UPLOAD_DROPIN_2026-06-19.md` |
| **P0** 보존삭제 softDelete 2단계(48h 복구창)+restore+purge | ✅ 라이브 **dryRun=ON(관찰)** | `apps/api/src/files/file-retention.service.ts`, `docs/FILE_LIFECYCLE_INTEGRITY_DESIGN_2026-06-19.md` |
| **P1** 고아 정리 cron(미참조+grace→softDelete)+pending TTL+per-product 보존 | ✅ 라이브 **dryRun=ON** | `apps/api/src/files/file-orphan.service.ts` |
| init.sql/마이그레이션 현행화(deleted_at·presigned·site_id) | ✅ master | `docker/mysql/init.sql`, `apps/api/migrations/20260619_*.sql` |
| **트랙 B-(a)** 편집기 내부 업로드 2GB(presigned contentType 화이트리스트) | 🔶 **브랜치 `feat/2gb-editor-internal` (미머지)** | commit 8866150 |

**트랙 B 2GB 로드맵 정본**: `docs/LARGE_FILE_2GB_GUARANTEE_PLAN_2026-06-19.md` — 반드시 먼저 읽을 것.
- (a) 편집기 내부 2GB = ✅ 브랜치 보관(미배포)
- **(c) API/서빙 스트리밍 = ← 지금 할 일**
- (d) 워커 qpdf 경량검증(pdf-lib 전체파싱 제거, Dockerfile에 qpdf) = 다음(최대 작업)
- (e) VPS 2GB 활성(mem_limit·WORKER_MAX_FILE_SIZE=2GB·동시성1·heap) = (d) 후

---

## 2. (c) 왜 필요한가 — 현재 병목(코드 확인분, file:line)

> 업로드는 R2로 2GB 가능하나, **API 서빙·워커가 파일을 통째로 메모리에 올려** 1GB 부근 OOM. 그리고 **>50MB 편집기 이미지가 R2에 있는데 nginx /storage/* 는 로컬만 서빙 → display 404**.

- API 다운로드 전체버퍼: `apps/api/src/files/files.controller.ts:454,483` `res.send(buffer)`
- S3 전체버퍼: `apps/api/src/storage/object-storage.service.ts:124` `Buffer.concat(chunks)` / `get()` 라인 111
- `getFileBuffer` 전체로드: `apps/api/src/files/files.service.ts:327`
- nginx /storage/* 는 `alias /app/storage/`(로컬)만 — R2 키는 404: `docker/nginx/nginx.conf:95`
- 편집기가 R2 이미지 url 로 쓰는 값: `apps/editor/src/api/storage.ts:29-31` `toUploadedFileResponse` 가 `/storage/<key>` 절대화 → R2 키는 nginx 로컬에서 404

---

## 3. (c) 구현 명세 — 권장안 A

### A-1. API 스트리밍 서빙(전체버퍼 제거)
- `object-storage.service.ts`: `getStream(backend, key): Promise<Readable>` 신규 — s3는 `GetObjectCommand` 의 `res.Body`(Node SDK v3 스트림) 그대로 반환(Buffer.concat 금지), local은 `fs.createReadStream`. 기존 `get():Buffer` 는 호환 위해 유지(또는 getStream 위에 얇게).
- `files.service.ts`: `getFileStream(id, caller?): { stream: Readable; file: FileEntity }` 신규(assertSiteAccess 동일 적용). `getFileBuffer` 는 남기되 download 라우트는 stream 사용.
- `files.controller.ts`: `downloadFile`(JWT)·`downloadFileExternal`(ApiKeyGuard) 를 `stream.pipe(res)` 로. `stream.on('error', …)`(헤더 전송 후 에러 주의 — `res.headersSent` 가드). Content-Type=file.mimeType, Content-Disposition 유지, Content-Length 는 생략(chunked) 또는 HeadObject 로 취득.

### A-2. R2 브라우저 공개 스트리밍 엔드포인트 ⭐(권장안 A)
- `GET /files/:id/raw` (또는 `/inline`) — **@Public()**, fileId(UUID=비추측, 레거시 `/storage/*` 경로공개 모델과 동일 보안) 로 R2/local 스트림 pipe. **inline 표시용**:
  - `Content-Type: file.mimeType`, **`X-Content-Type-Options: nosniff` 필수**(SVG/HTML sniff XSS 차단 — (a)에서 SVG 화이트리스트 제거했지만 방어 유지), `Content-Disposition: inline`, `Cache-Control: public, max-age=...`(이미지 캐시), CORP cross-origin(fabric 로드용).
  - soft-deleted(deleted_at) 파일은 `findById` 가 자동 제외 → 404(P0 일관).
  - ⚠️ 보안 리뷰 포인트: 인라인 서빙이므로 image/* 만 허용할지(비이미지 inline 차단) 검토. PDF inline 도 허용 여부 결정.
- 편집기 `storage.ts` `toUploadedFileResponse`: **R2(presigned) 경로의 url 을 `/storage/<key>` 대신 이 엔드포인트(`${origin}/api/files/${fileId}/raw`)로** 빌드 → >50MB 이미지가 표시됨. ≤50MB(로컬 /storage) 는 기존 유지. (단일 출처로: presigned 완료 응답에서 fileId 로 구성.)

### A-3. nginx
- `/api/` location 에 `proxy_buffering off; proxy_request_buffering off;` 추가(대용량 스트림 통과, 현재 미설정 `docker/nginx/nginx.conf:64`). (a)에서 추가한 `/storage/` `nosniff` 는 유지.

### A-4. 워커 영향(이번 (c) 범위 아님, 확인만)
- 워커 `api://` 다운로드(`apps/worker/src/services/api-file-download.ts`)는 여전히 `responseType:'arraybuffer'`(워커가 버퍼링) → (c) 로 API는 스트림이지만 워커는 (d)에서 stream 전환. (c)는 **API heap만** 해결.

---

## 4. 진행 방식(이 프로젝트 규약)

1. 브랜치: `feat/2gb-editor-internal`(=(a) 보관) 위에서 (c) 작업 **또는** 새 브랜치 분기 후 (a) 머지. 최종 **(a)+(c) 함께 master 머지**(editor Vercel 자동배포 → 이미지 표시 동작).
2. **Workflow 오케스트레이션**(ultracode on): 설계→구현(api·editor 분리)→적대검증(정확성+보안: 공개엔드포인트 IDOR/inline XSS/스트림 에러). 적대검증 지적은 직접 수정.
3. 검증: api/editor tsc 0. **실 R2 스트리밍 검증**(대용량 다운로드 시 API heap 상수 — `docker stats` 또는 동작), 편집기 이미지가 `/files/:id/raw` 로 로드되는지, 워커 api:// 무영향.
4. **배포 게이트**: VPS `deploy@158.247.235.202`(키 로드 `ssh-add -l`), `cd ~/storige && git pull origin master`. API 코드 변경이라 `docker compose up -d --build api` + `docker compose restart nginx`(IP캐시 502 방지). nginx.conf 변경 반영 위해 nginx 재시작 필수. 마이그레이션 없음(이번엔 스키마 변경 없을 듯).
5. 시크릿 평문 출력 금지(PUBLIC 레포). 한국어 응답.

## 5. (c) 검증 후 다음
- **(d) 워커 qpdf 경량검증**: 워커 Dockerfile 에 qpdf/pikepdf 추가 + `pdf-validator.service.ts` 의 `PDFDocument.load(전체)` → qpdf 메타(페이지수·치수) + 다운로드 `responseType:'stream'`→임시파일. detector 5종 파일/스트림화. → 그 후 (e).
- **(e) VPS 2GB 활성**: docker-compose worker `mem_limit: 4g` + `WORKER_MAX_FILE_SIZE=2147483648` + `VALIDATION_CONCURRENCY=1`(`validation.processor.ts:75`) + `GS_CONCURRENCY=1` + heap. **(d) 완료 전 WORKER_MAX_FILE_SIZE=2GB 올리지 말 것(OOM)**.

## 6. 오너 결정 대기(미해결, 새 세션이 물어볼 것)
- P0/P1 **관찰모드(dryRun) OFF 활성화 시점**(현재 retention_dry_run=1, FILE_ORPHAN_DRY_RUN=1 — dry-run 로그 검토 후 오너가 OFF).
- 실제 2GB 빈도, "2GB"=단일파일/세션누적, VPS 8GB 유지+스트리밍 vs 16GB 증설, qpdf 도입 가부 — `docs/LARGE_FILE_2GB_GUARANTEE_PLAN_2026-06-19.md` §6.
- bookmoa 외부키 cutover(구키 active), PUBLIC 레포 히스토리 정화 — `CLAUDE.local.md` §보안회전.

---

### 새 세션 첫 메시지(이대로 붙여넣어 시작):
> CLAUDE.md·CLAUDE.local.md·MEMORY.md 로드 후 `.cursor/plans/RESUME_PROMPT_2026-06-20.md` 와 `docs/LARGE_FILE_2GB_GUARANTEE_PLAN_2026-06-19.md` 를 읽고, **트랙 B-(c)** 를 **권장안 A**(API 스트리밍 서빙 + R2 브라우저 공개 스트리밍 엔드포인트 `/files/:id/raw`)로 오케스트레이션 진행해줘. (a) 브랜치 `feat/2gb-editor-internal` 와 함께 master 머지·배포해 >50MB 편집기 이미지가 표시되게. 적대검증(보안: 공개엔드포인트 IDOR·inline XSS) + dryRun/게이트 규약 준수. 끝나면 (d) 워커 qpdf → (e) VPS 2GB 활성 순서.
