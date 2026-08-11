# 편집기·PDF 업계 표준 전수 감사 + 구축 로드맵 (정본 — 2026-08-09)

> 오너 지시: "edicus/Canva 급 기본 기능과 PDF 최적화는 업계 룰 — 일일이 설명 없이 완벽하게 구축".
> 9 에이전트 병렬 감사(코드 실물 5 + 외부 조사 4, 947k tokens)로 산출. 실행 기록: 세션 wf_b09caa53-f72.
> 판정 원칙: 문서 주장과 코드가 다르면 **코드를 믿는다**. 외부 조사는 공식 1차 자료 기준.

---

## 1. 결론 요약

1. **편집기 벤치 갭(F1~F7)은 사실상 완비** — 07-07 벤치 문서의 '없음' 판정 다수가 스테일.
   F1 스마트가이드·F2 수치피드백·F3 액션바·F5 텍스트프리셋·F6 곡선텍스트·F7 사용배지 전부 구현 완료.
2. **진짜 업계 갭은 워커 PDF 프리플라이트/색관리 계층** — 색변환·평탄화·PDF/X·TAC·폰트 임베드
   실행기가 전무하고, 검출 5종이 정규식 휴리스틱(ObjStm PDF 미탐 가능).
3. **Adobe API 3종 도입 불필요 판정**(근거 확보) — 자체 구축이 기능·비용·PII 전부 우위.
4. 채택 도구는 전부 무료·기보유·라이선스 청정: GS(PDF/X-3·inkcov), qpdf(--json), Poppler(pdffonts·pdfimages).
5. GWG 2022 검사 18항목의 fix/warn/block 분류표 확보 — 기존 wiredAutoFixable·C+ 게이팅과 정합.

## 2. 격차 매트릭스 (코드 실물 판정, 2026-08-09)

### 편집기 (벤치 F1~F7 + 텍스트 부속)

| # | 항목 | 판정 | 비고 |
|---|---|---|---|
| F1 | 스마트가이드+객체 간 스냅 | ✅ | SmartGuidesPlugin+snapCoordinator, 각도 스냅 포함, 설정 3종 persist |
| F2 | 변형 수치 피드백 | ✅ | TransformFeedbackPlugin — edicus 에도 없는 차별화 축 |
| F3 | 객체 액션 바 | ✅ | ObjectActionBar v1(복제·삭제), 보호객체 게이팅 |
| F4 | 재단선 침범 실시간 경고 | ✅(08-09 완결) | 감지·오버레이는 기보유. **embed 토스트 배선 누락 → 이 세션에서 수정** |
| F5 | 텍스트 스타일 프리셋 | ✅ | S-E3(08-04) — 07-07 '빈 껍데기' 기록은 스테일 |
| F6 | 곡선(패스) 텍스트 | ✅ | 표준 IText+path 방식. 잔여=실기 골든 대조·tspan rotate 테스트(§4-R9) |
| F7 | 사진 사용 횟수 배지 | ✅ | S-E4(08-04) — 필터까지 배선 |
| — | 텍스트 효과(그림자/외곽선) | ✅ | 공용 컨트롤로 제공 |
| — | 텍스트 fit(자동 맞춤) | ❌ | 전량 신규 |
| — | 세로쓰기 | ❌ | fabric 미지원 — 커스텀 렌더+PDF 벡터화 대응 필요(대형) |

### 편집기 (심화)

| # | 항목 | 판정 | 남은 것 |
|---|---|---|---|
| F8 | 컷아웃 수동 마스크 보정 | 🔶 | 서버 배경제거 완결. 브러시 추가/제거 UX 전무(마스크 캔버스·합성·undo) |
| F9 | 칼선 자동생성+검증 | 🔶 | 생성·직렬화 완결(pureContour). **워커 CutContour 별색 출력 0건**·품질검증(곡률/오프셋/자기교차) 0건·embed 는 cutline-template 미부착 |
| CV | opencv 레거시 3종 | ❌ | 여전히 동작 불능(configureOpenCv 미배선). 모양틀(setShapeAsMold)이 사용자 도달 가능 → pureContour 이식이 정도. drawCaseOutlinePrecise 는 호출부 0 = 즉시 삭제 가능 |
| F10 | 화이트/박/스팟 분판 | 🔶 | 업계 조사: **사용자 UI 는 과잉, 서버 자동처리가 표준**(edicus LINK 방식). 레거시 effects 경로는 별색 아님+UI 주석처리(휴면). 해당 상품군 추가 시 워커측만 |
| F11 | VDP | ❌ | 코드 0건. B2B 수요 발생 시 착수(§3.8 설계 기보유) |
| F12 | 임베드 SDK 보강 | 🔶 | v1 완비. D-4a/b/c 3건만 잔여 — **D-4 결정표(오너) 종속** |

### 워커 PDF 파이프라인 (8축)

| 축 | 판정 | 남은 것 |
|---|---|---|
| VALIDATE | ✅ | 검출 5종이 정규식 바이너리 스캔 — ObjStm 미탐 가능. 해상도는 transform 미파싱 |
| COLOR | 🔶 | RGB→CMYK 변환·ICC·OutputIntent **전무**(-sColorConversionStrategy 0건). 오버프린트는 검출+보존만 |
| FONT | 🔶 | 임베드 실행기 전무 — 미임베드 폰트가 비차단 경고로 인쇄 통과 가능 |
| FLATTEN | ❌ | 평탄화 0건 (editor 측 f77cc10 은 별개) |
| PDF/X | ❌ | 출력·검증 양쪽 전무. GS -dPDFX 로 즉효 가능(ICC 선정만 게이트) |
| INK(TAC) | ❌ | inkcov 인프라는 흐르는 중 — c+m+y+k 합산+임계만 추가하면 저비용 |
| IMPOSE | 🔶 | 정규화 3모드+중철 2-up 은 실체. 대수 임포지션·crop mark 그리기는 하류(인쇄소) 책임 구조 — 현행 유지 |
| OPTIMIZE | ❌ | 의도적 무손실 통과 정책과 상충 — 트레이드오프 결정 필요(보류) |

## 3. 외부 조사 결론

### Adobe (3종 전부 도입 안 함 — 근거)

| 제품 | 판정 | 근거 |
|---|---|---|
| PDF Services API | ❌ reject | 100MB 캡(우리는 2GB 상수메모리 LIVE)·인쇄 preflight 부재·$0.05/tr+PII 왕복 |
| Photoshop/Firefly API | ❌ reject | 엔터프라이즈 전용(월 ~$1k 미니멈+$0.15/call) vs 자체 u2net 한계비용≈0 |
| PDF Embed API | ⏸ hold | 무료지만 현 프리뷰로 충분. 교정 코멘트 요구 생기면 재검토 |

### 오픈소스 채택/기각

- **채택**: GS pdfwrite PDF/X-3(-dPDFX+PDFX_def.ps+CMYK 전략, lcms2 내장) · GS inkcov/ink_cov ·
  qpdf --json(구조 덤프=룰엔진 입력)·overlay/underlay·repair · **Poppler utils**(pdffonts=폰트 임베드
  검사, pdfimages -list=이미지 실해상도 — apt 한 줄, GPL CLI exec 는 파생저작물 아님)
- **기각/보류**: veraPDF(PDF/A 전용 — X 미지원), pdfcpu(기능 중복), pikepdf(Python 중복), mutool(AGPL
  표면적 확대 불필요), LittleCMS 직접 링크(GS 가 내장 구동 — 소프트프루핑 요구 시 WASM 재검토),
  Polotno(오픈소스 아님 $899/월 — 참조도 불가)
- 편집기측: fabric 공식 aligning_guidelines 예제(MIT)=이미 자체 구현 완료 상태. 곡선 텍스트도 기구현.

### 업계 표준 판별 (table stakes / 차별화 / 과잉)

- **표준(우리 충족)**: 재단/안전선 가이드+능동 경고 ✅ · 서버측 규칙 검증 ✅(초과) · 배경제거 ✅ ·
  모바일 웹 완주(핀치줌·바텀시트) ✅ · 서버측 별색/칼선 자동처리 방향 ✅(부분)
- **표준(갭)**: 편집기 배치 이미지 **유효 DPI 경고 배지** 없음 · 주문 확정 전 **최종 래스터 프리뷰** 미노출 ·
  모바일 다중 업로드→자동배치 흐름(포토북 확장 시)
- **과잉(안 함)**: 텍스트→이미지 생성형 AI(해상도·권리 리스크) · 자동 리사이즈(templateSet 판형 결정
  구조와 충돌) · 사용자 대상 별색/화이트 UI · ICC 소프트프루핑 · 네이티브 앱
- **관찰**: edicus 의 실질 우위는 KAYAK 조판 엔진(장평·커닝·탭스톱)과 주문→생산 무인 루프 —
  상장류/포토북 확대 시 조판 격차 부상 가능
- 국내 인쇄 관행: **입고 표준은 여전히 PDF/X-1a 스타일**(평탄화+CMYK+폰트 전량). 국제(GWG 2022)는
  X-4 단일화 → 검증은 X-4 수용, 산출은 X-1a 스타일이 하이브리드 정답.

### GWG 2022 검사 18항목 → fix/warn/block 분류 (워커 적용안)

- **fix(자동수정)**: 화이트 오버프린트 제거 · K소형텍스트 OP 주입 · 주석/폼 제거 · CropBox/Rotate/
  UserUnit 정규화 · TrimBox 주입 · RGB→CMYK(프로파일 고정+고지) · OutputIntent 주입 · 별색→CMYK
  (상품별 — 2GB 무손실 트랙과 정책 분기 필요) · 투명도/레이어 평탄화 · 배경 블리드 생성(미러링)
- **warn(검출만)**: 해상도 149~224ppi · 1-bit<800ppi · 소형 다색/흰색 텍스트·세선 · 리치블랙 ·
  별색 명명 · Courier · 빈 페이지(책은 정상) · TAC 경미 초과(시트지 320%·잡지 305%·신문 245%)
- **block(차단)**: 미임베드 폰트(대체 불가 시) · 판형 불일치 · 암호화 · 파싱 불능 · <149ppi(정책 선택)
- 통합 지점: fixMethod 는 **wiredAutoFixable 경유 불변식 유지**, C+ 게이팅(FIXABLE)에 단계 편입,
  TAC 는 지종 74종 테이블에 한계 열 추가로 연동.

## 4. 구축 로드맵 (우선순위 확정 — R 시퀀스)

| R | 내용 | 규모 | 게이트 |
|---|---|---|---|
| R1 | F4 embed 토스트 배선 | ✅ **완료(08-09)** | — |
| R2 | 프리플라이트 정밀화: Poppler(pdffonts·pdfimages -list) 승격 — 정규식 휴리스틱 폴백화(ObjStm 미탐 해소·실배치 DPI) | ✅ **완료(08-10 LIVE)** | — |
| R3 | TAC 잉크총량 warn: GS ink_cov 페이지 평균+한계 주입 자리 | ✅ **완료(08-11 LIVE)** | R3b 잔여=API 가 지종별 tacLimitPercent 주입(지종표+injectServerSpine 패턴 — API 트랙) |
| R4 | fix 실행기 1차 | ✅ **R4a 완료(08-11 LIVE)**: 주석/폼 검출(qpdf --json, Link/Popup 제외)+ANNOTATIONS_DETECTED warn+재증류 4경로 -dPreserveAnnots=false 자동 제거(왕복 스모크 1→0 실증). ⚠️ R4b 백로그=화이트 오버프린트 제거(콘텐츠 스트림 수술 필요)·pass-through 경로 잔존 | — |
| R5 | 최종 산출 정규화: 평탄화+CMYK 변환+OutputIntent(X-1a 스타일) | 대 | ✅ **ICC 결정(08-10 오너)**: Japan Color 2001 Coated(국내 매엽 오프셋 관행). ⚠️ Adobe 배포 ICC 는 재배포 제한 — **PUBLIC 레포 커밋 금지**, 컨테이너 빌드 시 취득 또는 VPS 배치+env 경로 주입. 자유배포 폴백=ECI ISO Coated v2 |
| R6 | 칼선 제품화: 워커 CutContour Separation 출력+곡률/오프셋/자기교차 검증+embed cutline 부착 | 중 | 스티커 상품 로드맵 |
| R7 | CV-LEGACY 정리 | ✅ **완료(08-11 LIVE, a6008ea 머지)** — 3종 pureContour 이식(preciseOutline.ts 신설)·모양틀/목업 외곽선 **최초 실동작**·래스터 캡 안전판. 잔여=실기 육안 1회(모양틀 칼선 형상) | — |
| R8 | 편집기 유효 DPI 경고 | ✅ **완료(08-11 LIVE, b678982 머지)** — ImageDpiWarningPlugin(전이 1회·150DPI)+토스트 양 뷰 배선 | — |
| R9 | 곡선 텍스트 마감 | ✅ **완료(08-11 LIVE, 23daa43 머지)** — **중대 적발**: 벡터화가 도입 이래 실행 불능(fabric 다중 루트 SVG 파스 에러→래스터 폴백). +14줄 수정으로 최초 개통+21테스트 잠금. ⚠️ 잔여=실기 골든 1회(곡선 텍스트 PDF 벡터 산출 육안 — 래스터→벡터 전환 확인) | — |
| R10 | F8 마스크 보정 브러시 UX | 대 | 없음 |

**보류(오너 결정 대기)**: F10 분판(상품군 추가 시 서버측만) · F11 VDP(B2B 수요) · F12 D-4 결정표 ·
TEXT-VERT/FIT(수요 확인) · PDF-OPTIMIZE(무손실 정책 상충) · 주문 전 최종 래스터 프리뷰(UX 결정) ·
Adobe 전 제품 미도입(재론 불필요 — 근거 §3).

## 5. 세션 기록

- 08-09: R1 완결(embed.tsx 배선+tsc 0err+editor 48/596 green). 게스트 401 수정(f2f66cb)은 별건 선행.
- 08-10: **R2 완결·프로덕션 LIVE**(cf13b55). poppler-preflight.ts 신설(pdffonts/pdfimages -list,
  실패=null→정규식 폴백, applyDetectionWarnings 무접촉) + OFF/ON 양 경로 배선.
  poppler-utils 는 컨테이너 기설치(B-(d))라 Dockerfile 무변경. 검증: worker 523(511+12) ·
  실바이너리 e2e(로컬 26.04: 미임베드 Helvetica+실배치 14DPI 검출) · **프로덕션 컨테이너
  (25.12) dist 스모크 동일 결과** · 롤백 태그 `pre-r2-poppler` · health ok/큐 failed 0.
- 08-10: R5 게이트 해소 — ICC=Japan Color 2001 Coated 오너 결정(위 표 참조).
- 08-11: **R3 완결·프로덕션 LIVE**(965b41d+7fbd908). detectInkTac(-sDEVICE=ink_cov,
  inkcov 와 병렬·같은 GS 게이트·실패 null 흡수) + applyInkTacWarning(변경금지 계약과
  분리) + INK_TAC_EXCEEDED 비차단 경고 + metadata 상시 스탬프 + WorkerPdfMetadata
  미러 additive 2필드(S-1 계약 spec 이 강제). 한계: order 주입→env→320%(GWG SheetCMYK).
  ⚠️ **함정 확정: ink_cov 는 % 스케일**(inkcov=0~1 분율과 다름) — 컨테이너 실측으로
  ×100 중복 적발·수정. 스모크: 전면 리치블랙 349.8%/라이트 1% 정확, worker 530 ·
  api 930 green · 롤백 태그 `pre-r3-tac`. 판정 기준=페이지 평균(국소 최대의 하한,
  오탐 없음·국소 미탐 가능 — details.basis 명시). 정밀(국소) TAC 는 백로그.
- 08-11 (Wave 1 오케스트레이션): **R4a+R7+R8+R9 완결·LIVE**. 본선(R4a=69bfdac)+워크트리
  에이전트 3기 병렬(R7/R8/R9) → 순차 머지(f8b2a84·fbeda61·690ff2f) → editor 자동배포+
  worker 수동배포(롤백 태그 pre-r4a). 게이트: canvas-core **52스위트 615**(canvas.node
  네이티브 재빌드로 구 기준선 4스위트 해소 — `pnpm rebuild canvas` 후 node-pre-gyp
  install --fallback-to-build, 로컬 한정)·editor 596·worker 538·api 930 전부 green.
  R4a 왕복 스모크: FreeText 주석 1 검출→재증류→0.
- 실기 확인 잔여(오너/fe-qa): ①곡선 텍스트 골든 1회(래스터→벡터 전환) ②모양틀 칼선
  형상 1회 ③DPI 경고 토스트 발화 1회.
- 다음 = Wave 2: R5(산출 정규화 — ICC 결정 완료)·R6(칼선 별색)·R10(마스크 브러시)·R3b(API 주입).
