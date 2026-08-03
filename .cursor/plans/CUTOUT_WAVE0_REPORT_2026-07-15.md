# 트랙 C Wave0 — 배경제거 실태 실측 보고서 (D-3b 재상신용, 2026-07-15)

> 코드 변경 0. CTO 오케스트레이션 세션 산출(정찰 에이전트 실측). 오너 재상신 근거 문서.

## 0. 전제 정정
"OpenCV 기반 배경제거"는 부정확 — 실체는 `@imgly/background-removal` 1.7.0의 **ONNX ML 모델(ISNet fp16, 1024px 고정 추론)**. OpenCV(WASM)는 후처리(크롭)·칼선(윤곽 패스) 전담.

## 1. 구현 실태
- 게이팅: `VITE_ENABLE_IMAGE_PROCESSING` — `.env.production:14`=true. `createCanvas.ts:245`에서 ImageProcessingPlugin 생성.
- 진입 UX: ToolBar '모양컷'(CLIPPING) → AppClipping '효과' remove_bg 썸네일 1곳뿐(`AppClipping.tsx:408-423`→`useImageStore.segmentImage:1008-1060`). 모양컷 자체가 "테스트 악세사리" placeholder 수준의 미완 플로우.
- 파이프라인: imgly removeBackground(로컬 추론) → OpenCV threshold/findContours 크롭 → **원본 해상도 base64 dataURL을 src로 갖는 새 fabric.Image** → canvasData JSON에 통째 인라인(재업로드 없음, 12MP≈15~40MB 급증).
- IIFE 임베드 빌드(dist-embed)만 플래그 false 강제(`vite.embed.config.ts:102`). **SPA `/embed` 라우트는 true 상속 → bookmoa-mobile iframe 세션에도 플러그인 생성.**

## 2. ⚠️ 핵심 발견 — eager preload
`ImageProcessingPlugin.ts:39` 생성자가 `startService()` 즉시 실행 → **배경제거를 안 눌러도 모든 에디터/embed 세션이 최초 방문 시 ~111MB(모델 88.2MB+ort wasm 23MB)를 staticimgly.com CDN에서 다운로드하고 ONNX 세션 상주**. (EditorView.tsx:334-335에 과거 warmup REVERT 기록 있으나 생성자 preload 잔존.)

## 3. 성능·메모리·품질 한계
- 리사이즈 캡 없음(imgly 내부 1024 고정 추론+원본 해상도 마스크 업스케일). 모바일 4MB 가드는 바이트 기준이라 12MP JPEG 통과, 모양컷 업로드 경로엔 가드 자체가 없음.
- 12MP 처리 피크 메모리 500~800MB 추정 → iOS Safari 크래시 현실 위험.
- 품질: saliency 단일클래스+4× 업스케일 → 머리카락/반투명 구조적 불가. 수동 보정 UX 전무(결과 불만족 시 재시도 차단 — tellHasAlpha alert).
- 노출: prod 소스맵 200 OK(vite sourcemap:true)이나 레포 PUBLIC이라 신규 유출 아님, 로직도 오픈소스 조합. 외부 CDN 런타임 의존(장애 시 기능 불능).
- 실측 한계: opencv.js 노드 로드는 비정상 스핀으로 중단(정적 분석 대체). CLIPPING 노출 templateSet 수 DB 조회는 권한 정책 거부로 미확인.

## 4. D-3b 재상신 권고
**A(클라 유지) + 필수 경량화 3건. B(worker cutout 오프로드)는 조건부 보류.**
- 근거: ①수요 부재(진입점 1곳·미완 플로우) ②품질은 위치 아닌 모델 문제(같은 모델이면 워커도 동일) ③B 비용: 잡당 피크 0.5–1GB로 기존 합성 잡과 경합(concurrency 1 필요)+2~4일 배선.
- A 유지 시 필수 조치(오너 승인 대상):
  1. **eager preload 제거** — 최초 클릭 시 lazy (전 세션 ~111MB 다운로드+상주 제거, 최대 즉효)
  2. **픽셀 캡** — 장변 2048~2560 사전 다운스케일(품질 손실 미미, 모바일 크래시 해소)+모양컷 업로드 가드 배선
  3. **결과 dataURL → storage 업로드 치환** — canvasData 비대·재편집 리스크 제거
- B 재상신 트리거: 배경제거가 일반 메뉴/POD/포토북 자동편집으로 승격돼 실사용 발생+머리카락급 품질 요구 확인 시(그때는 worker 잡+상위 모델이 우위).

---

## [부록 2026-07-15] D-6b① 구현 완료 (오너 지시)
- 브랜치 `fix/image-processing-lazy-preload` 커밋 `a09cf8a` — 생성자 eager preload 제거, ensureReady(모델)/ensureCvReady(cv) 분리 lazy, 진입점 8곳 배선, 첫 클릭 '준비 중' UX+재클릭 가드.
- 검증: canvas-core 335/335·editor 417/417·노출 0건·생성자 무초기화 정적 증명. **적대 리뷰 GO**(변이 2종 red, 미초기화 도달 경로 0, 번들 startService 0건).
- P2 기록: openCv.ts 캐시 리셋 무테스트 / 지속 실패 시 클릭당 재시도(브라우저 캐시로 실피해 제한) / modelReady 인스턴스-전역 불일치(멀티 페이지 cosmetic).
- 범위 외 관찰: canvas.ts:290 unawaited Promise(별도 칩 task_bf42ef52), segmentImage offHistory finally 부재 — 후속 트랙.
- D-6b ②픽셀 캡 ③dataURL→storage 치환은 여전히 오너 미결.
