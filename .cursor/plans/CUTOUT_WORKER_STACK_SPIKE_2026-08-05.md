# 컷아웃 워커 스택 선정 스파이크 (S-P2A-B 샤드 1, 2026-08-05)

> D-6a=B(워커 오프로드) 확정 후속. **코드 변경 0** — 의존성 추가·라이선스 리스크는 오너 결정 사항이라 결정표(§4)로 상신한다.
> 방법: 저장소 정찰 4축 + 웹 1차 자료 조사 4축 + 결정 치명 주장 적대 검증(반증 시도). 총 16 에이전트.
> 조사 시점 2026-08-05 — 가격·버전·라이선스는 이 시점 기준이며 재확인 없이 인용하지 말 것.

## 0. 결론 요약

1. **현 워커(Alpine/musl)에는 Node ML 스택을 그대로 넣을 수 없다.** onnxruntime-node는 musl 프리빌드를 배포하지 않고, **설치는 성공한 뒤 런타임 import에서 터진다.** CI가 Docker 이미지를 빌드하지 않아 이 실패는 VPS 배포 시점에야 드러난다.
2. **BRIA(RMBG) 계열은 자체호스팅 상업 사용 불가.** 별도 상용 계약 필요. 깨끗한 대안은 U2Net(Apache-2.0)·BEN2(MIT)·BiRefNet(MIT)이며, 다수가 DIS5K 학습 데이터 약관(비상업) 회색지대를 공유한다.
3. **권고: rembg 사이드카 컨테이너 + U2Net.** 워커 베이스를 건드리지 않아 인쇄 파이프라인 회귀 위험이 0이고, 모델을 런타임에 교체할 수 있어 품질/라이선스 실험 비용이 가장 낮다.
4. 별건 발견 2건이 결정과 무관하게 조치 필요: **레포에 LICENSE 파일이 없어 AGPL 의무를 현재도 충족하지 못한다**(§6-1), **잡 폴링 라우트 게스트 401 반복 결함**(§6-2).

## 1. 결정 차단 사실 (적대 검증 통과분)

### 1-1. musl 블로커 — CONFIRMED (독립 2회 검증)
- 워커는 `docker/worker/Dockerfile` 에서 **node:24-alpine(musl)**. 런타임 apk에 ML 런타임(openblas/libgomp 등) 없음.
- onnxruntime-node는 1.24.3·**최신 1.27.0 모두 musl 프리빌드 없음**. tarball 실측: `bin/napi-v6/linux/{x64,arm64}` 뿐이고 바인딩은 glibc 링크(ELF `DT_NEEDED` libc.so.6 / `.gnu.version_r` GLIBC_2.14·GLIBCXX_3.4.21). 업스트림 이슈는 여전히 open.
- **가장 위험한 성질**: 패키지에 npm `libc` 필드가 없어 **Alpine에서 설치가 성공**한다. 실패는 첫 잡의 `import` 시점에 난다. 이 레포에는 "조용한 설치 성공 → 로드 시점 폭발"이 이미 1회 실현돼 CI 주석으로 박제돼 있다.
- "WASM 폴백"은 런타임 옵션이 아니라 **빌드타임 stub/alias 조치**다(검증자 정정).
- 참고: sharp가 Alpine에서 도는 것은 `@img/sharp-linuxmusl-x64` 프리빌드가 있기 때문이며 **다른 네이티브 의존에 일반화되지 않는다.**

→ 워커 내부 추론을 택하면 **베이스 이미지 alpine→slim/bookworm(glibc) 교체가 필수**이고, gs·qpdf·poppler·imagemagick 재검증이 딸려온다. CI는 이미지를 빌드하지 않으므로(ci.yml docker 언급 0건) 이 교체는 배포 시점 리스크다.

### 1-2. 라이선스
| 모델 | 라이선스 | 상업 사용 | 비고 |
|---|---|---|---|
| BRIA RMBG-1.4 / 2.0 | 자체(비상업) / CC BY-NC 4.0 | **불가** | 상용은 BRIA 별도 계약(가격 비공개). 게이트 폼이 비상업을 "개인·학술·비영리"로 못박음 |
| imgly 배포 ISNet | 패키지 내 ThirdPartyLicenses는 MIT 표기, 업스트림 DIS는 Apache-2.0 (**불일치**) | 회색 | 라이브러리(AGPL) 사용 시 §1-3 별건 |
| U2Net | Apache-2.0 (리포 전체, 축소 문구 없음) | **가능** | 가중치는 DUTS-TR 학습, DUTS는 명시 라이선스 없이 "all rights reserved" |
| BEN2 | MIT (GitHub·HF 일치) | **가능**(Base 한정) | 카드 원문에 DIS5K 학습 명시 → 회색지대 승계. 풀모델은 상용 별도 |
| BiRefNet | MIT | 가능(주 가중치) | DIS5K/HRSOD 등 학습, 저자는 자기 가중치엔 제한 없다고 밝힘 |
| SAM 1·2 | Apache-2.0(가중치 포함 명시) | 가능 | SAM 3는 커스텀 라이선스·승인제 |

**공통 잔여 리스크**: DIS5K 데이터셋 약관은 비상업 한정인데, 그 제약이 학습된 **가중치**까지 전이되는지는 원문에 언급이 없는 법적 미해결 영역이다. 텍스트상 얽힘이 가장 적은 것은 **U2Net(Apache-2.0)**.

**적대 검증 정정**: "RMBG-1.4는 평가·검토 목적만 허용"이라는 1차 조사 주장은 **REFUTED** — 인용된 LICENSE 파일은 생성 당일 삭제됐고 정본 링크는 404다. 현행 유효 조건은 "비상업 사용 허용"이며, **유료 인쇄 판매에는 상용 계약이 필요하다는 결론만 유효**하다.

### 1-3. 메모리·운영 제약 (VPS 8GB 공유)
- worker `mem_limit` 4g, `NODE_OPTIONS=--max-old-space-size=3072`. **ONNX/BLAS 아레나는 V8 힙 밖**이라 힙 상한이 추론 메모리를 통제하지 못하고 cgroup OOM으로 직행한다.
- worker에 CPU 제한이 없고 이미 `GS_CONCURRENCY=2`·`VALIDATION_CONCURRENCY=3`으로 프로세스를 스폰한다. ORT intra-op 스레드 기본값은 코어 수 → 오버서브스크립션.
- **단일 워커 컨테이너 공유가 최대 위험**: 배경제거 피크가 PDF 합성과 겹치면 **인쇄 파이프라인이 동반 실패**한다.
- 모델 캐시용 볼륨이 없다(`./storage:/app/storage` 단일 마운트).

## 2. 옵션 비교

| # | 스택 | 상업 라이선스 | 워커 Alpine | VPS 메모리 | 도입 난이도 | 판정 |
|---|---|---|---|---|---|---|
| A | 워커 내 transformers.js(Apache-2.0) + BEN2/U2Net | 가능 | **베이스 교체 필요** | 피크 1.5~2.5GB(BiRefNet)/~400MB(경량) | 중 | 차선 |
| B | 워커 내 @imgly/background-removal-node | AGPL + 2.5년 정체(npm 1.4.5, 2024-02) | 베이스 교체 필요 | 캡 적용 시 완화 | 하 | **배제** |
| **C** | **rembg 사이드카 컨테이너 + U2Net** | **가능(MIT 코드 + Apache 가중치)** | **무변경** | 상주 0.7~1.5GB(별도 컨테이너) | 중 | **권고** |
| D | transparent-background(InSPyReNet) 사이드카 | 가능(MIT) | 무변경 | CPU 4코어에 과중 | 상(서버 래퍼 자작) | 배제 |
| E | Playwright로 웹 SDK 재사용 | AGPL 미해결 | 무변경(별도 컨테이너) | 최악(Chromium+모델) | 중 | 배제 |
| F | SaaS — BRIA API $0.018/장 · Photoroom $0.02/장 | 포함(면책 포함) | 무관 | ~0 | **하** | 조건부(§4 D-12c) |
| G | SaaS — remove.bg ~$0.20/장 | 포함 | 무관 | ~0 | 하 | 단가 배제 |
| H | Cloudinary 애드온 | — | — | — | — | **배제**(애드온 폐기 예고, 신규 구독 차단) |

## 3. 권고 — C안(rembg 사이드카 + U2Net)

**근거 순서대로**
1. **인쇄 파이프라인 회귀 위험 0.** 워커 베이스·apk·네이티브 의존을 하나도 건드리지 않는다. CI가 이미지를 빌드하지 않는 현 구조에서 이 성질의 가치가 가장 크다.
2. **라이선스 통제가 명시적이다.** 코드 MIT + 가중치를 U2Net(Apache-2.0)으로 고정. rembg의 MIT가 가중치를 세탁해주지 않는다는 점을 코드·문서에 못박고, 모델명을 하드코딩·기록한다.
3. **품질 실험 비용이 최저.** 16종 백엔드를 런타임 파라미터로 교체 → U2Net→BEN2→BiRefNet 비교를 배포 없이 수행.
4. **GPU 이전 경로가 코드 변경 0.** 나중에 실사용이 늘면 GPU 인스턴스로 컨테이너만 옮긴다.
5. 데이터가 밖으로 나가지 않아 개인정보 국외이전 이슈가 없다(D-6a=B의 취지 유지).

**수용해야 할 비용**: 컨테이너 5→6개, Python 스택 1개 추가, 이미지 ~1GB, 상주 RAM 0.7~1.5GB. **CVE-2026-40086**(HTTP 서버 경로 순회, 2.0.75에서 수정) → **2.0.75+ 고정 · 내부 네트워크 전용 바인딩 · `*_custom` 세션 차단** 필수.

**대안 선택 시 유의**: A안이면 베이스 교체와 함께 **CI에 워커 이미지 빌드 스텝 추가**가 사실상 필수다(현재는 배포 시점에야 실패가 드러남). F안(SaaS)이면 엔지니어링이 가장 싸지만 §4 D-12c(국외이전)가 선행이다.

## 4. 오너 결정표 (D-12) — 착수 게이트

| # | 질문 | 권고 | 결정 |
|---|---|---|---|
| D-12a | 추론 스택: C(rembg 사이드카) / A(워커 내장+베이스 glibc 교체) / F(SaaS) | **C** — 인쇄 파이프라인 무접촉이 최대 이점 | ☐ |
| D-12b | 기본 모델·라이선스 리스크: U2Net(Apache, 얽힘 최소) / BEN2(MIT, 품질 우위 가능·DIS5K 회색) | **U2Net 기본 + BEN2는 실측 비교 후 재상신** | ☐ |
| D-12c | F(SaaS) 선택 시에만: 고객 사진 국외이전(개인정보보호법 §28-8) 동의·DPA 설계 승인 | 자체호스팅(C·A)이면 해당 없음 | ☐ |
| D-12d | 별건: 레포 LICENSE 부재 + AGPL 미충족(§6-1) 해소 방향 — imgly 제거 / 상용 라이선스 구매 / LICENSE 정비 | **C안 채택 시 imgly 의존 제거가 자연 해소 경로** | ☐ |

보수적 기본값: 오너 기입 시까지 **코드 변경 0** — 샤드 2는 착수하지 않는다.

## 5. 샤드 2 구현 계약 (스택 선택과 무관한 공통분)

정찰로 확정된 지점만 적는다. 각 항목은 선례 파일을 그대로 따른다.

1. **큐**: `image-cutout` 신설 — `apps/worker/src/app.module.ts:90` + `apps/api/src/worker-jobs/worker-jobs.module.ts:21` 양쪽 등록. (기존 `pdf-conversion` 공유도 선례가 있으나(render-pdf-pages) **메모리 격리가 필요하므로 별도 큐**.) 관측 3곳 필수 등록: `health.controller.ts` · `metrics.service.ts` · `queue-monitor.service.ts`.
2. **잡 타입**: `WorkerJobType.CUTOUT` 추가. `worker_jobs.job_type`은 varchar(30)·ENUM/CHECK 없음 → **DB 마이그레이션 불필요**(새 컬럼 추가 시에만 필요).
3. **잡 생성**: `createBleedFixJob` 을 템플릿으로 — 서버 권위 파라미터(클라 입력 불신) · `filesService.findById` + MIME 검증 · siteId는 원본 file에서 승계 · `options.kind='cutout'` 마커 · **editSessionId 미주입**(세션 상태기계 오염 회피).
4. **결과 등록**: `updateJobStatus` 의 kind 마커 분기 옆에 `registerCutoutOutput` 추가(멱등 — outputFileId 존재 시 return, best-effort, throw 금지). ⚠️ `registerExternalFile` 기본 mimeType이 `application/pdf` → **PNG는 mimeType 명시 필수**(누락 시 `GET /files/:id/raw` 가 404).
5. **결과 파일 위치**: 반드시 files 테이블 경유 UUID. nginx가 `/storage/` 를 **무인증·ACAO `*`·1년 immutable** 로 직접 서빙하므로 예측 가능한 경로에 두면 고객 사진 파생물이 즉시 공개된다.
6. **도달성**: 잡 생성은 `@Public` 이어도 **폴링 `GET /worker-jobs/:id` 에는 `@Public` 이 없어 게스트 401**이다(fix-bleed·render-pages·compose-mixed에서 반복된 결함). cutout 전용 조회 라우트를 `@Public` + `OptionalShopJwtGuard` 로 신설하고, 무인증 컴퓨트 남용 방어로 라우트 `@Throttle` 을 좁힌다(선례: upload-public 20/min).
7. **재시도·상한**: attempts 미설정 유지(현 파이프라인이 비멱등). lockDuration 10분 초과 시 stalled 재실행이 살아 있으므로 **멱등 가드 필수**. 고아 잡 스위퍼(2시간, `JOB_TIMEOUT_SWEPT`)는 자동 상속. 동시성 1.
8. **픽셀 캡 공유**: `inferenceCap`(장변 2560)은 현재 canvas-core 배럴로만 노출되고 exports 맵이 `.` 하나뿐이라 딥임포트가 막혀 있다. 워커가 canvas-core를 의존하면 브라우저 스택(fabric·opencv·imgly)이 딸려오므로 **금지** → `@storige/types` 또는 신규 순수 패키지로 이관.
9. **사이트 게이팅**: `sites` 에 `allow_*` 계열이 없다. 패턴은 엔티티 컬럼 + CreateSiteDto + 수기 SQL(`ADD COLUMN IF NOT EXISTS`), 병합은 `mergeSiteWorkerDefaults` 인접. 대안으로 `template_sets.enabled_menus` 에 이미 `CLIPPING` 키가 있다 — **택일 결정 필요**.
10. **클라 교체면**: `useImageStore.segmentImage(image, canvas, imagePlugin, loadingBar) → Promise<FabricImage>` **시그니처를 유지**하면 AppClipping 호출부 무변경으로 내부만 잡 요청/폴링으로 바꿀 수 있다. canvasData는 base64 인라인 대신 fileId/URL 참조로 전환(**=D-6b③ 통합 지점**) → `ensureImageCrossOrigin` 경로 확인, 신규 prop은 `extendFabricOption` 등재 판단(화면 전용이면 미등재).
11. **동시 해소**: 08-05 발견한 **모양컷 진입 도달 불가**(`currentImage` 로컬 state가 `hideSidePanel()` 언마운트로 소실) — 진입점을 재작성하는 이 샤드에서 함께 고친다.
12. **테스트**: processor spec 기존 패턴. `JobStatusService` 는 DI가 아니라 `new` 로 생성(기존 spec 생성자 고정 규약).

## 6. 별건 발견 (결정과 무관하게 조치 필요)

### 6-1. AGPL — 레포에 LICENSE 파일이 없다 ★
`@imgly/background-removal`(canvas-core 의존)은 **AGPL-3.0**이다. 적대 검증이 1차 조사의 "서버 오프로드가 노출을 확장한다"는 주장을 **REFUTED** 하고 더 중요한 사실을 밝혔다:
- 임베드(IIFE) 빌드는 이미 이 패키지를 **가상 스텁으로 치환**(removeBackground 즉시 throw)해 파트너 배포물에는 AGPL 코드가 없다.
- 브라우저 번들 배포는 이미 §6 conveying이므로 서버 오프로드는 노출의 **수평 이동**이지 확장이 아니다.
- **그러나 storige 레포에는 LICENSE 파일이 아예 없어, PUBLIC이어도 AGPL 의무를 현재 충족하지 못한다.**
→ D-12d. C안(rembg) 채택 시 imgly 의존 제거로 자연 해소되는 것이 가장 깔끔하다. ⚠️ SPA `/embed` 라우트는 스텁 치환이 적용되지 않아 imgly·OpenCV가 그대로 들어간다.

### 6-2. 잡 폴링 라우트 게스트 401 (반복 결함)
§5-6과 동일 원인. cutout 이전에 fix-bleed·render-pages·compose-mixed에서 이미 3회 반복됐다. 공통 수정 여부를 별도로 판단할 것.

### 6-3. 워커 이미지 비대 (기회)
워커 prod 설치가 `--filter` 없이 워크스페이스 루트에서 실행되고 `COPY packages` 로 전 패키지가 들어가 **canvas-core의 브라우저 의존(imgly·opencv-js·fabric)이 이미 워커 이미지에 실려 있다.** `sharp ^0.33.5` 도 워커에 선언만 되고 사용처 0건. 슬림화 여지.

## 7. 검증 방법과 한계
- 저장소 사실은 전부 file:line 근거로 수집. 외부 사실은 1차 자료(npm 레지스트리·GitHub API·HF 모델 카드·LICENSE 원문)로 확인하고, 결정 치명 주장은 **반증 시도** 프롬프트로 재검증했다(기본값 UNCERTAIN).
- 반증으로 뒤집힌 주장 2건은 본문에 정정 반영(§1-2 BRIA, §6-1 AGPL). UNCERTAIN 2건은 결론에 영향 없는 범위(imgly 저장소 활동 이력 세부).
- **실측하지 않은 것**: 각 모델의 실제 컷아웃 품질·처리시간·피크 메모리. 표의 수치는 공개 자료 기반 추정이다. D-12a 결정 후 **동일 샘플 20장으로 U2Net/BEN2/현행 imgly 3자 비교**를 샤드 2 착수 전에 1회 수행할 것을 권고한다.

---

## [부록 2026-08-06] 프로덕션 실기 결과 — 문서 §7 "실측하지 않은 것" 의 해소분

샤드2 배포 후 VPS 에서 사이드카를 실제로 띄워 확인한 사실. **결정에 직접 영향**이 있으므로 본문보다 이 부록이 우선한다.

### A. rembg `model` 은 쿼리가 아니라 multipart **바디 필드**다 (코드 결함 → 수정 `3f6fd20`)
`POST /api/remove` 의 쿼리 파라미터는 `bgc`·`extras` 뿐이고 `model` 은 폼 필드다(컨테이너 OpenAPI 실측).
쿼리로 보내면 **에러 없이 무시되고 기본 모델(u2net)로 추론**된다 — HTTP 200 + 정상 PNG 가 나오므로
자동 검증은 전부 통과하고, `CutoutJobResult.model` 만 거짓이 되어 **라이선스 감사 추적이 통째로 틀어진다.**
모델 캐시에 `u2net.onnx` 만 받아진 것으로 발견. GET 은 쿼리를 받으므로 문서를 대충 읽으면 반드시 걸린다.

### B. BiRefNet 계열은 이 박스(rembg mem_limit 3GiB)에서 **OOM** — u2net 만 동작
| 모델 | 파일 | 결과 | 근거 |
|---|---|---|---|
| `u2net` (Apache-2.0) | 176MB | ✅ **3.6s / RSS 1.0GB** | 반복 호출에도 안정 |
| `birefnet-general` (MIT) | 973MB | ❌ **cgroup OOM** | 커널 로그 `anon-rss 3,127,968kB` 에서 kill |
| `birefnet-general-lite` (MIT) | 224MB | ❌ **cgroup OOM** | 파일 크기와 무관 — 활성화 메모리가 큼 |

→ **§3 권고의 "C안 + U2Net" 이 실측으로 재확인**됐다. D-12b 에서 오너가 고른 BEN2 는 rembg 백엔드에
존재하지 않고(있는 것은 `ben_custom` = CVE 벡터), 그 대체로 잡았던 birefnet 계열은 **하드웨어가 못 버틴다.**
compose 기본값 `REMBG_MODEL=birefnet-general` 은 첫 실사용에서 OOM 하므로 **플래그 ON 전에 반드시 변경**해야 한다.

✅ **[2026-08-06 결정 반영]** D-12b 재상신 → 오너가 **(a) `u2net` 확정**. compose·워커 코드 기본값을
`u2net` 으로 바꾸고(이 문단이 요구한 변경), 프로덕션 `.env` 에도 `REMBG_MODEL=u2net` 을 명시했다.
`birefnet-*` 는 API 화이트리스트에 남아 있으나 **지금 지정하면 그 잡은 OOM 으로 실패**한다 —
증설 또는 `REMBG_MEM_LIMIT` 상향 + `WORKER_MEM_LIMIT` 하향이 선행 조건.

### C. 운영 실측치 (참고)
- 사이드카 콜드스타트: 첫 리슨까지 **약 2분**(python + onnxruntime import). healthcheck `start_period` 를 이보다 짧게 잡으면 오탐한다.
- 모델 최초 다운로드는 요청 시점에 일어난다(기동 시 아님) — 예열을 안 하면 첫 잡이 타임아웃 위험.
- 이미지 빌드 후 디스크: 34% (빌드 전 캐시 90GB 정리 선행). 모델 3종 캐시 합계 약 1.37GB.
