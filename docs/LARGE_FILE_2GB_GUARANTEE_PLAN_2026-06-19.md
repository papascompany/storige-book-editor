# 끝단 2GB 파일 보장 — 병목 분석 + 달성 방법 (P2 계획)

> **작성**: 2026-06-19 · 코드 감사(워커·API서빙·편집기·VPS자원 4영역) 근거. file:line 확인분=단정, 추론="추정".
> **목표**: 편집기 업로드 → R2 → 워커 검증/처리까지 **단일 파일 2GB 를 OOM/한도 없이** 보장.

---

## 0. 한 줄 결론

**현재 끝단 실질 상한 ≈ 1GB.** 업로드는 R2 presigned 멀티파트로 2GB까지 뚫려 있으나, **① 워커가 `WORKER_MAX_FILE_SIZE=1GB`로 명시 거부**하고, 풀어도 **② API 서빙·③ 워커 다운로드·④ pdf-lib 파싱이 파일을 통째로 메모리에 적재**(3GB heap에서 2GB는 OOM)한다. 근본 해결 = **파일을 JS heap에 통째로 안 올리는 스트리밍/경량검증**. 추가로 **편집기 내부 사진/에셋 경로는 presigned 미적용으로 50MB 캡**.

---

## 1. 단계별 현재 상한 (어디서 먼저 막히나)

| # | 단계 | 상한 | 막는 지점 | 판정 |
|---|------|------|----------|------|
| 1 | 편집기→R2 (내지 PDF) | **2GB** ✅ | `ContentPdfAttachModal.tsx:98`(2GB 가드), `presigned-upload.ts:16`(80MB↑ 멀티파트) | 통과 |
| 2 | 편집기→API (내부 사진/에셋) | **50MB** ❌ | multer 50MB `storage.controller.ts`, presigned 우회 `storage.ts:48,17,75` | 막힘 |
| 3 | R2 멀티파트 | **2GB** ✅ | `MAX_EXPECTED_SIZE=2GB` `presigned-upload.service.ts:21`, 2GB=128파트(≤10000) | 통과 |
| 4 | API 파일 서빙 | **~1GB 위험** ❌ | `res.send(buffer)` `files.controller.ts:454,483`, `Buffer.concat` `object-storage.service.ts:124` | 전체버퍼 |
| 5 | 워커 다운로드 수신 | **~1GB 위험** ❌ | axios `arraybuffer` `pdf-validator.service.ts:663`, `api-file-download.ts:17` | 전체버퍼 |
| 6 | 워커 검증(파싱) | **1GB 캡** ❌ | `WORKER_MAX_FILE_SIZE=1GB` `docker-compose.yml:93`, `PDFDocument.load` 전체파싱 `:84` | 1GB 거부 |
| 7 | VPS heap / mem_limit | 3GB / **미설정** | `NODE_OPTIONS=...3072` `docker-compose.yml:95`, mem_limit 없음 | 무한경쟁 |

> **메모리 모델(정정)**: 검증 1건 = `2GB(원본) + pdf-lib 파싱 +40~60%` ≈ **2.8~3.2GB**. (5개 detector는 같은 pdfBytes 1개 공유 — 복제 아님.) 3GB heap 1건이면 OOM 경계, **2건 동시면 확정 OOM**.

---

## 2. 2GB 보장 — 단계별 조치표

### (c) API 파일 서빙 → 스트리밍 (임팩트 최대, P1)
| 파일 | 변경 |
|------|------|
| `object-storage.service.ts:111,124` | `get():Buffer` → `getStream():Readable`(S3 Body 직접/로컬 createReadStream) — `Buffer.concat` 제거 |
| `files.service.ts:327` | `getFileStream` 신규 |
| `files.controller.ts:446,475` | `res.send(buffer)` → `stream.pipe(res)` + `stream.on('error')` |
| `nginx.conf` | `proxy_buffering off`(현 미설정) |
→ API heap 2GB→상수(~64KB). **이게 빠지면 mem_limit 줘도 API가 OOM.**

### (d) 워커 검증 메모리 → 경량화 (본질, P1/P2)
| 항목 | 현재 | 조치 |
|------|------|------|
| 다운로드 | arraybuffer 전체 `:663` | `responseType:'stream'`→임시파일 직결 |
| 파싱 | `PDFDocument.load` 전체 `:84` | **qpdf/pikepdf 메타검증**(페이지수·치수)로 pdf-lib.load 스킵 |
| GS inkcov | 일부만 파일기반 `:172` | 전 경로 파일기반(메모리경유 제거) |
| MAX_FILE_SIZE | 1GB | 경량검증 전환 후 **2GB** |
→ 파일을 통째로 heap에 안 올리면 2GB도 5GB도 상수 메모리. **qpdf/pikepdf는 워커 컨테이너 미설치 가능성→Dockerfile 추가 필요(추정).**

### (e) VPS 자원 (즉시, P1)
| 항목 | 현재 | 조치 |
|------|------|------|
| `mem_limit` | **미설정** | worker `mem_limit: 4g`(OOM 시 워커만 죽고 API/DB 보호) |
| `VALIDATION_CONCURRENCY` | 3 `validation.processor.ts:75` | **1**(전체파싱 유지 시 필수) |
| `GS_CONCURRENCY` | 2 | **1** |
| temp 디스크 정리 | synthesis만, validation/conversion 누수 | cleanup + 크론 |

### (a) 편집기 내부 사진/에셋 → presigned 확대 (P1)
`storage.ts`의 `uploadFile`(사진)·`uploadDesign`을 >50MB 시 `uploadViaPresigned`로 폴백 + presigned 모듈 contentType 자동감지(image/jpeg·png·webp). (모바일 4MB 가드는 크래시 방지용 유지.)

### (b) R2 멀티파트
**이미 2GB 완비**(128파트). 단 느린 회선 128파트가 presign 만료(900초) 초과 가능 → 파트 실패 시 **개별 재서명/재시도** 점검(P2).

---

## 3. "전체 공간 2GB"의 두 해석 (먼저 확정 필요)

| 해석 | 내용 | 조치 트랙 |
|------|------|----------|
| **① 단일 파일 2GB** | 한 PDF가 2GB | 위 (a)~(e) — 특히 (c)(d)(e) |
| **② 세션 누적 2GB** | 사진 200~300장 합계 | **별개 트랙**: API multer memoryStorage→presigned/diskStorage, 클라 업로드 동시성풀(3~4)+큐, 세션/사이트별 누적 쿼터 |

> ①과 ②는 완전히 다른 작업. 하나를 풀어도 다른 건 안 풀림.

---

## 4. 동시성·자원 산정 (8GB VPS)

```
전체파싱 유지: 2GB 검증 1건 ≈ 3.0GB.  가용 ≈ 8 - OS/DB/Redis/API/nginx(≈3) = 5GB
 → 동시 1건 ✅ (heap 3GB 경계, mem_limit 4g 권장) / 동시 2건 ❌ 6GB OOM
경량검증(qpdf/스트림): 파일 heap 미적재 → 상수 메모리 → 동시 2~3건 가능(추정)
```

---

## 5. 로드맵

### 트랙 A — 최소변경 1GB→2GB("당장, 동시 1건 한정")
1. worker `mem_limit:4g` + `VALIDATION_CONCURRENCY=1` + `GS_CONCURRENCY=1` [低]
2. `WORKER_MAX_FILE_SIZE=2147483648`, heap 3584~4096 [低]
3. **(c) API 다운로드 스트리밍** [中, 필수 — 안 하면 API OOM]
4. **(d일부) 워커 다운로드 `responseType:'stream'`** [中]
→ 코드 재설계 없이 단일파일 2GB(동시 1건) 통과.

### 트랙 B — 완전 스트리밍 재설계(P2, "5GB까지·동시 다건")
1. 워커 qpdf/pikepdf 메타 경량검증(pdf-lib.load 제거) [高]
2. 모든 detector 파일/스트림 기반 [高]
3. 편집기 내부 사진/에셋 presigned 전면 [中]
4. 세션 누적 쿼터(②) [中]

---

## 6. 미결정 (오너)

| # | 결정 | 시사점 |
|---|------|--------|
| 1 | 실제 2GB 빈도(드묾/상시) | 드물면 트랙 A로 충분, 상시면 트랙 B |
| 2 | "2GB"=①단일/②누적/둘다 | 트랙이 완전히 다름 |
| 3 | VPS 8GB+스트리밍 vs 16GB 증설+현행 | 증설하면 동시 2~3건 |
| 4 | 동시성 1(안전)/2(빠름·위험) | 트랙 A는 1 강제 |
| 5 | qpdf/pikepdf 도입 가부 | 워커 Dockerfile·검증로직 재작성 |
| 6 | 세션 누적 쿼터 | R2비용·악용 방지 |

> **권장**: 트랙 A로 단기 2GB(동시 1건) 확보 → 실제 빈도 확인 후 트랙 B로 확장. 트랙 A에서도 **(c) API 스트리밍은 필수**.
