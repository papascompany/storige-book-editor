# 트랙 B-(d) 설계안 — 워커 검증 경량화(qpdf 메타 + 스트리밍 검출) · 2026-06-20

> 상태: **설계 검토 대기**(사용자 승인 후 구현). (c) API/서빙 스트리밍은 master(26563ad) 배포·prod 검증 완료.
> 정본 계획: `docs/LARGE_FILE_2GB_GUARANTEE_PLAN_2026-06-19.md` §2(d), 인수인계 `RESUME_PROMPT_2026-06-20.md` §5.
> ⚠️ 인쇄품질 검증 정확성에 직접 영향 → **기능플래그 + 구↔신 패리티 테스트 + 게이트 배포** 필수.

---

## 0. 목표 / 비목표

- **목표**: 워커 **검증(validate)** 경로가 단일 2GB PDF 를 OOM 없이(상수 메모리) 처리. 검증 결과(에러/경고/메타)는 현행과 **동일**해야 함.
- **비목표(이번 (d) 범위 외, 잔여로 명시)**: 합성(pdf-synthesizer)·변환(pdf-converter)·렌더(pdf-page-renderer) 경로의 2GB 안전화. 2GB content PDF 의 합성/임포지션도 메모리를 쓰므로 **완전한 끝단 2GB 보장에는 후속 작업 필요**. (d)는 검증만.

---

## 1. 현재 OOM 동인 (코드 확인, file:line)

검증 1건의 메모리 = **다운로드 버퍼 + pdf-lib 파싱 + 5× 디코드 문자열**:

| # | 동인 | 위치 | 2GB 시 비용 |
|---|------|------|------------|
| 1 | 다운로드 전체버퍼 | `api-file-download.ts:17` `responseType:'arraybuffer'`, `pdf-validator:62` downloadFile | 2GB Buffer |
| 2 | pdf-lib 전체파싱 | `pdf-validator:84` `PDFDocument.load(pdfBytes)` | 객체그래프 +40~60% ≈ +1GB |
| 3 | **검출기 5종 전체디코드** | `detectSpotColors`/`detectTransparencyAndOverprint`/`detectFonts`/`detectImageResolutionFromPdf`(ghostscript.ts) + `detectCmykStructure`(pdf-validator:952) — 전부 `new TextDecoder('latin1').decode(pdfBytes)` 후 전역 regex | **각 ~2~4GB(UTF-16) JS 문자열**, `Promise.all`(pdf-validator:189) 로 **동시** 실행 → 최악 수 GB 동시 점유 |
| 4 | s3 임시파일 떨구기 | `pdf-validator:177` `fs.writeFile(Buffer.from(pdfBytes))` | 추가 2GB write(이미 버퍼 보유) |

> **핵심**: #3 이 가장 큰 동인. `decode(2GB)` 는 V8 에서 ~4GB UTF-16 문자열을 만들고, 5개가 동시 → pdf-lib(#2) 보다 위험. `inputPath` 인자를 넘겨도 검출기가 `fs.readFile` 전체로드 후 decode 라 동일.
> detectColorMode 의 GS inkcov(`detectCmykUsage`, ghostscript.ts:578)는 이미 **파일경로 기반**(GS 자식프로세스) → 메모리 무관, 유지.

---

## 2. 설계 — 3개 축

### 축 A. 다운로드: 스트림 → 임시파일 (버퍼 제거)
- `api-file-download.ts`: `downloadViaApi(url)` 에 **스트림 변형** 추가 — `responseType:'stream'` 으로 받아 `fs.createWriteStream(tmp)` 로 pipe. 반환=임시파일 경로(+크기). 기존 Uint8Array 반환 API 는 (구 경로 호환 위해) 유지하되 신 경로는 파일경로 사용.
- `pdf-validator.downloadFile`: 신 경로에서 **임시파일로 직결**(현 `fs.writeFile(Buffer.from(pdfBytes))` 의 이중점유 제거). 검증 종료 시 finally 정리(현 `tmpToCleanup` 패턴 확장).
- (c) 의 API `/files/:id/download/external` 는 이미 스트리밍 서빙 → 워커가 스트림으로 받기만 하면 끝단 정합.

### 축 B. 메타데이터: pdf-lib.load → qpdf (파싱 제거)
- `PDFDocument.load` 가 제공하던 것 = **페이지수 + 페이지별 치수(MediaBox)** 뿐(pdf-validator:98~100,128 orientation, 139 spread, 722/848). 이를 qpdf 로 대체:
  - 페이지수 + 페이지별 MediaBox: `qpdf --json=2 <file>`(각 페이지 `/MediaBox`) **또는** `pdfinfo`(poppler, `-f/-l` 로 per-page). → 신규 `extractPdfMetadata(path): { pageCount, pageBoxes: {w,h,rotation}[] }` 유틸.
  - 손상 검증(현 `PDFDocument.load` catch → FILE_CORRUPTED): `qpdf --check <file>` 종료코드/출력으로 대체.
- ⚠️ **정확성 주의**: pdf-lib `getSize()` 는 회전/CropBox 반영 가능 → qpdf MediaBox 와 미세 차이 가능. 페이지크기/재단/책등 검증이 영향받음 → **패리티 테스트로 회귀검출**(§4). rotation 반영 로직 명시 필요.

### 축 C. 검출기: 전체디코드 → 공유 청크 스트리밍 스캐너 (상수 메모리)
- 신규 유틸 `streamScanPdf(path, handlers)`: 파일을 **청크(예 8MB)** 로 읽어 latin1 디코드, 각 청크에 검출기 regex 적용, **오버랩 윈도(예 256KB)** 유지로 청크경계 분할매치 방지. 매치 누적.
- 5개 검출기를 이 스캐너 위로 이식(동일 regex, 동일 결과):
  - `detectSpotColors`: `/Separation /Name`, `/DeviceN [...]` — 매치 누적(셋 dedupe).
  - `detectTransparencyAndOverprint`: `/ca /CA /SMask /OP /op /BM` 플래그.
  - `detectFonts`: FontDescriptor/FontFile 패턴 — **DeviceN/FontDescriptor 딕셔너리가 오버랩(256KB) 보다 길면 미스 가능** → 오버랩 크기가 곧 정확성 한계(§4 리스크).
  - `detectImageResolutionFromPdf`: MediaBox(qpdf 메타 재사용으로 대체) + 이미지 `/Width /Height` 누적 최소 DPI.
  - `detectCmykStructure`(validator): DeviceCMYK/ICC/Separation/DeviceN 시그니처 존재여부(불리언만 → 스트리밍에 가장 쉬움).
- 단일 패스로 5개 regex 를 **한 번의 스트리밍 스캔**에 합치면 파일 I/O 1회(현 5× 디코드 → 1× 스캔). 성능·메모리 동시 이득.

### 축 D. Dockerfile / 런타임
- `docker/worker/Dockerfile` build+prod 스테이지에 `qpdf`(+필요시 `poppler-utils`) 추가(alpine `apk add qpdf poppler-utils`). 현재 ghostscript/imagemagick 만 있음.
- **기능플래그 `WORKER_LIGHTWEIGHT_VALIDATION`(기본 OFF)**: OFF=현행 전체버퍼 경로(불변·안전), ON=신 스트리밍 경로. 다크쉽 + 환경별 점진 롤아웃 + 즉시 롤백.

---

## 3. 배포 게이트 순서

1. **(d) 코드** (축 A~D) — 플래그 기본 OFF 로 워커 배포. **행동 무변화**(OFF). qpdf 설치만 추가.
2. **패리티 검증**(§4) — 구(OFF)↔신(ON) 결과 동일 확인(샘플 코퍼스 + 실주문 PDF). 불일치 0 이어야 ON.
3. **플래그 ON**(env) → 워커 재시작 → 실주문 모니터(검증 에러율·경고분포 변화 감시).
4. **(e) VPS 2GB 활성** — (d) ON·안정 확인 후에만: worker `mem_limit:4g` + `WORKER_MAX_FILE_SIZE=2147483648`(현 1GB, docker-compose:93) + `VALIDATION_CONCURRENCY=1`(validation.processor.ts:75) + `GS_CONCURRENCY=1` + heap(NODE_OPTIONS). **(d) ON 전 2GB 금지(OOM)**.

---

## 4. 패리티 테스트 (정확성 게이트 — 인쇄품질 안전)

- 코퍼스: 기존 워커 테스트 PDF(`*.spec.ts` 픽스처) + 실주문 표본(CMYK/별색/투명도/비임베드폰트/저해상도/스프레드/대용량 각 1+).
- 각 PDF 에 대해 **OFF 결과 vs ON 결과**의 {colorMode, hasSpotColors+names, hasTransparency, hasOverprint, hasUnembeddedFonts+names, minDpi/저해상도판정, pageCount, pageSize, spreadInfo, orientation, 에러/경고 코드셋} 완전일치 단언.
- 불일치=롤아웃 차단. 특히 **오버랩 윈도 경계 미스**(긴 딕셔너리)·**qpdf vs pdf-lib 치수차(회전/CropBox)** 를 표적.
- 대용량(1.5~2GB) 1건으로 `docker stats` 상수 메모리(상한<4g) 확인.

---

## 5. 리스크 / 롤백

| 리스크 | 완화 |
|--------|------|
| 스트리밍 regex 경계 미스(딕셔너리>오버랩) | 오버랩 256KB+(최대 현실 딕셔너리>이 값일 확률 극저) + 패리티 테스트로 검출. 미스 시 오버랩 상향. |
| qpdf MediaBox ≠ pdf-lib getSize(회전/CropBox) | 회전 반영 로직 + 패리티 테스트. 차이 시 qpdf --json CropBox/Rotate 병합. |
| qpdf 미설치/버전차 | Dockerfile 고정 + `qpdf --version` 헬스. |
| 검출 회귀(인쇄사고) | **기능플래그 OFF 즉시 롤백**(현행 경로 무손상 보존). |
| 손상 PDF 판정 차이(qpdf --check vs pdf-lib) | 패리티에 손상 표본 포함. |

---

## 6. 작업 분해(승인 시) + 오케스트레이션 제안

- W1 축 A 스트림 다운로드(api-file-download + downloadFile) + finally 정리.
- W2 축 B `extractPdfMetadata`(qpdf) + load 대체 + 손상검증 대체.
- W3 축 C `streamScanPdf` + 5 검출기 이식(단일 패스 통합).
- W4 축 D Dockerfile qpdf + 플래그 배선.
- W5 패리티 테스트 하니스(구↔신 비교) + 코퍼스.
- **오케스트레이션**: 구현(W1~W4 병렬 가능 일부) → 적대검증(정확성: 검출 패리티·경계미스·qpdf치수 / 메모리: 상수성) → 패리티 게이트 → 배포.

---

## 7. 오너 결정 대기

1. **메타 추출기**: qpdf `--json` vs poppler `pdfinfo` (qpdf 는 손상검증도 겸함 → qpdf 단일 선호. poppler 추가설치 회피).
2. **오버랩 윈도 크기**(정확성↔메모리): 256KB 제안.
3. **플래그 기본값/롤아웃**: 기본 OFF→패리티 후 ON. 환경별(스테이징 먼저)?
4. **합성/변환 2GB(범위 외)**: (d) 후 별도 트랙으로 다룰지(2GB content PDF 임포지션도 메모리 사용).
5. **(e) 동시성**: 2GB 검증 1건≈상수(신경로)면 동시 2~3건 허용 검토 vs 안전 1건 고정.
