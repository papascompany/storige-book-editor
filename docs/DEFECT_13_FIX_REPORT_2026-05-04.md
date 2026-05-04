# 결함 #13 수정 검증 보고서 (2026-05-04)

## 요약

Worker conversion 잡의 `outputFileUrl`이 컨테이너 절대경로(`/app/storage/converted_xxx.pdf`)로 노출되던 결함을 수정. 운영 환경에서 신규 conversion 잡 1건 실행하여 ✅ 모든 검증 통과.

## 문제 정의

### 기존 동작 (수정 전)

| 위치 | 값 | 문제 |
|------|---|------|
| `worker_jobs.outputFileUrl` (DB 컬럼, top-level) | `/storage/temp/converted_xxx.pdf` | ❌ 운영 STORAGE_PATH=`/app/storage` 라 실제 위치(`/app/storage/converted_xxx.pdf`)와 불일치 → nginx 404 |
| `worker_jobs.result.outputFileUrl` (JSON 필드) | `/app/storage/converted_xxx.pdf` | ❌ 컨테이너 절대경로 노출, Admin UI `resolveStorageUrl()`이 `/storage/` 프리픽스만 처리해서 링크 깨짐 |
| `worker_jobs.result.previewUrl` | `/app/storage/converted_xxx_preview.png` | ❌ 동일 문제 |

> 다운로드 endpoint(`GET /worker-jobs/:id/output`)는 `path.isAbsolute` 폴백 덕분에 우연히 작동하고 있었음.

### 영향 범위

- **Admin Before/After 미리보기**: `PdfBeforeAfterPreview.tsx` — 수정된 PDF 링크가 `/app/storage/...` 로 렌더되어 브라우저 404
- **Admin 워커 잡 목록**: `outputFileUrl` 컬럼 링크가 `/storage/temp/...` (잘못된 prefix)로 nginx 404
- **PHP 연동**: 영향 없음 — PHP 팀은 synthesis만 사용 (`/storage/outputs/...` 형식, 별도 코드 경로)

## 수정 내용

### apps/worker/src/services/pdf-converter.service.ts
- `STORAGE_PATH` 기본값을 `/app/storage`로 정렬 (운영 환경과 일치, 기존 `/app/storage/temp`)
- `toStorageUrl()` 헬퍼 추가: 절대경로(`/app/storage/x.pdf`) → 상대 URL(`/storage/x.pdf`) 변환
- 반환 결과의 `outputFileUrl` / `previewUrl` 모두 상대 URL로 정규화

### apps/worker/src/processors/conversion.processor.ts
- 출력 디렉토리를 `STORAGE_PATH/converted/` 서브디렉토리로 분리 (synthesis의 `/outputs/` 패턴과 정렬)
- 디렉토리 자동 생성 (`fs.mkdir({ recursive: true })`)
- top-level `outputFileUrl`을 service 결과(`/storage/converted/...`)로 통일 — 기존 분리되어 있던 두 URL 일관성 확보

### 변경 안 됨 (하위호환)
- 다운로드 endpoint(`apps/api/src/worker-jobs/worker-jobs.controller.ts`): 이미 4가지 형식 모두 지원 (`/storage/...`, `storage/...`, 절대경로, 그 외) → 기존 잡도 계속 작동

## E2E 검증 결과

### 테스트 시나리오
- 13페이지 A4 PDF 업로드
- conversion 잡 생성 (`addPages: 13→16`, `applyBleed: 3mm`)
- 잡 ID: `49b50daf-4dba-4ef3-9862-0cc9e3ffc0c9`

### 결과 (HTTP `GET /api/worker-jobs/49b50daf...`)

```json
{
  "status": "COMPLETED",
  "outputFileUrl": "/storage/converted/converted_182ba1e4-...-79bf5e819eac.pdf",
  "result": {
    "success": true,
    "outputFileUrl": "/storage/converted/converted_182ba1e4-...-79bf5e819eac.pdf",
    "pagesAdded": 3,
    "bleedApplied": true,
    "previewUrl": "/storage/converted/converted_182ba1e4-..._preview.png",
    "finalPageCount": 16
  }
}
```

✅ top-level과 inner `outputFileUrl` **완전 일치** (`/storage/converted/...`)
✅ `previewUrl`도 동일 형식
✅ 컨테이너 절대경로 노출 없음

### 검증 포인트 체크리스트

| 항목 | 결과 |
|------|------|
| `/app/storage/converted/` 서브디렉토리 자동 생성 | ✅ `drwxr-xr-x` 확인 |
| 변환된 PDF 디스크 저장 (7972 bytes) | ✅ 확인 |
| 미리보기 PNG 디스크 저장 (178 bytes) | ✅ 확인 |
| nginx 직접 서빙 (PDF) `HTTP 200` | ✅ |
| nginx 직접 서빙 (PNG) `HTTP 200` | ✅ |
| 다운로드 endpoint (JWT) `HTTP 200 application/pdf` | ✅ content-length 7972 일치 |
| top-level outputFileUrl == inner result.outputFileUrl | ✅ |
| 컨테이너 절대경로 노출 | ✅ 없음 |

## 운영 반영

| 항목 | 상태 |
|------|------|
| 코드 커밋 | ✅ `c791cd9` |
| GitHub master push | ✅ |
| VPS git pull + worker rebuild | ✅ |
| Docker `storige-worker` 정상 기동 | ✅ |
| 실 데이터 검증 (1 시나리오) | ✅ COMPLETED |

## PHP 연동 문서 영향

**없음**. `PHP_INTEGRATION_FINAL_v3.md` / `.html` 무수정.

이유:
- PHP 팀은 conversion endpoint(`POST /worker-jobs/convert`)를 사용하지 않음
- PHP 측 사용 endpoint는 synthesize 계열(`/synthesize/external`, `/external/{id}`, `/{id}/output`)
- synthesis의 `outputFileUrl` 형식(`/storage/outputs/{jobId}/merged.pdf`)은 변경 없음

## 결론

결함 #13 ✅ 완전 해소. 신규 conversion 잡은 일관된 `/storage/converted/...` 형식으로 outputFileUrl을 반환하며, 기존 잡은 다운로드 endpoint의 절대경로 폴백으로 계속 작동.
