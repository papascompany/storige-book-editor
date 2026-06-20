# 트랙 B (끝단 2GB) — (c)(d)(e) 완료 핸드오프 · 2026-06-20

> 정본 계획 `docs/LARGE_FILE_2GB_GUARANTEE_PLAN_2026-06-19.md`, (d) 설계 `TRACK_D_WORKER_QPDF_DESIGN_2026-06-20.md`.
> 이전 RESUME `RESUME_PROMPT_2026-06-20.md`((c) 착수용).

## 완료(프로덕션 라이브)

| 단계 | 커밋 | 상태 |
|---|---|---|
| (a) 편집기 내부 2GB presigned | 8866150 | ✅ |
| (c) API 스트리밍 서빙 + `GET /files/:id/raw`(이미지전용) + nginx proxy_buffering off | 26563ad | ✅ API 배포·검증 |
| (d) 워커 검증 경량화(qpdf 메타 + 청크 스트리밍 검출) | bb9db0a | ✅ **프로덕션 ON** |
| (e) VPS 2GB 활성(mem_limit 4g·MAX_FILE_SIZE 2GB·동시성1) | 7587c82, a599602 | ✅ |
| (f) 변환·합성·렌더 2GB(qpdf 파일기반 머지) | 25ee9ef, 879bad3 | ✅ **프로덕션 ON** — 끝단 2GB 완주 |
| editor /raw url 배포(git 웹훅 미발화 → CLI 원격빌드+promote) | (master 7de2d33 빌드, dpl_4Fqafd) | ✅ |

### (f) 완료 메모 (2026-06-20)
- 끝단 2GB 완주: 업로드→검증(d)→임포지션(변환)→합성→다운로드 전 구간 상수메모리.
- 신규 `utils/pdf-merge-qpdf.ts`(qpdf `--empty --pages`=객체 무재해석→별색/오버프린트/치수 무손실) + `getPdfInfoQpdf`. 변환=다운로드/메타 (d)모듈화(임포지션 GS 코어 불변), 합성=pdf-lib copyPages→qpdf, 소형산출(saddle/duplex/빈페이지)은 pdf-lib 유지. OFF 무손상(플래그).
- 게이트 통과: 로컬 골든파리티(OFF vs ON 전모드) + **컨테이너 골든파리티(GS pdfwrite vs qpdf 머지 — 별색 PANTONE/CutContour·오버프린트·투명도·치수·페이지 5/5 동일)** + 적대검증 3렌즈 ship + tsc/스펙 329/329.
- 프로덕션 .env: `WORKER_LIGHTWEIGHT_SYNTHESIS=true`(+ (d) VALIDATION=true, (e) MAX_FILE_SIZE=2GB·동시성1·mem_limit4g).
- (f) 롤백: `WORKER_LIGHTWEIGHT_SYNTHESIS=false`(+2GB 유지 시 OFF 합성이 전체버퍼라 `WORKER_MAX_FILE_SIZE=1073741824`도 함께) → `docker compose up -d worker`.

검증: (d) 로컬 파리티 119/119(57픽스처×2 + 이미지검출5) + 컨테이너 7/7(gs 존재) + ON 진입점 스모크. OFF 스펙 40/40 회귀0. 워커 restarts0·에러0.

## 현재 프로덕션 상태(워커)
- `WORKER_LIGHTWEIGHT_VALIDATION=true` (ON, 검증=스트리밍 경로)
- `WORKER_MAX_FILE_SIZE=2147483648` (2GB)
- `VALIDATION_CONCURRENCY=1`, `GS_CONCURRENCY=1`, `mem_limit=4g`, `NODE_OPTIONS=--max-old-space-size=3072`
- 검증 경로만 2GB 상수메모리. qpdf 12.3.2·poppler·gs 10.07.1 설치됨.

## ⚠️ 잔여 / 주의

### 1. 합성·변환 2GB = 미해결(별도 트랙 — CTO 결정으로 분리)
- `pdf-synthesizer.service.ts`·`pdf-converter.service.ts` 는 여전히 `PDFDocument.load(전체버퍼)` + arraybuffer 다운로드.
- → **>1GB content PDF 는 (d) 검증은 통과하나, 주문 합성 단계에서 OOM 가능**(mem_limit 로 워커만 죽고 박스 보호, 잡은 실패). 즉 **(d)(e)=검증 2GB만**. 진짜 '2GB 주문 완주'는 합성/변환 트랙 필요.
- 임포지션 규칙(작음→중앙 무스케일+블리드무조작 / 큼→중앙+이너핏 / 동일→무가공)은 `pdf-converter.service.ts resolveMode/applyImpositionMode` 에 그대로(불변). 합성 트랙은 이 규칙 보존하며 다운로드/파싱만 스트림/qpdf 화.
- **다음 트랙 권장**: (d) 와 동일 패턴 — 합성/변환 다운로드를 `downloadToTempFile`(이미 존재)로 + pdf-lib merge 를 qpdf(`qpdf --pages`/`--collate`/`--overlay`) 또는 GS 스트림으로 대체. 적대검증+파리티 게이트.

### 2. 롤백 절차(ON 이상 시)
VPS `~/storige/.env` 에서 **둘 다** 되돌린 뒤 `docker compose up -d worker`:
```
WORKER_LIGHTWEIGHT_VALIDATION=false
WORKER_MAX_FILE_SIZE=1073741824
```
⚠️ flag 만 OFF 하고 2GB 유지하면 OFF(전체버퍼) 경로가 2GB 에서 OOM. 반드시 한도도 1GB 로.

### 3. editor Vercel 자동배포 웹훅 미발화((c) 잔여)
- master 26563ad·6826e41 가 storige-editor Vercel 에 배포 안 됨(웹훅 미발화, CLI 인증만료). 대시보드 → storige-editor → Deployments → Redeploy 필요.
- 미배포여도 회귀無(>50MB 이미지 표시 기능만 미활성). API `/files/:id/raw` 는 라이브.

### 4. 모니터링(2GB 첫 실주문)
- 첫 >1GB 실파일 검증/합성 시 `docker stats storige-worker`(검증 상수메모리 확인) + 워커 로그(qpdf/스트림). 합성 OOM 시 위 잔여1 트랙 우선순위 상승.
- dryRun: P0/P1 보존·고아 cron 은 여전히 dryRun=ON(관찰) — 트랙 B 와 무관, 오너 OFF 대기.
