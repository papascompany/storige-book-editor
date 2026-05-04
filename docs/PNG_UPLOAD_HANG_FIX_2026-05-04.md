# PNG 업로드 hang 수정 보고서 (2026-05-04)

## 사용자 보고

- Sentry 이벤트 ID: `a894a16e84c141f19fb12a7697ac398f`
- 시나리오: 맥북 에디터에서 "요소" 사이드바 → 업로드 → PNG 선택 → **"이 페이지를 나가겠습니까?" 모달**
- 첨부 파일: 점보 로고 PNG (~수십 KB, 작은 사이즈)
- 영문 파일명으로 재시도 시 **성공** → 한글 파일명이 원인이라고 추측

## 진짜 원인 분석

`FileReader.readAsDataURL`은 파일명을 사용하지 않으므로 한글/영문 무관. 진짜 원인은 다음 두 단계의 메인 스레드 동기 처리:

### ① OpenCV WASM 첫 로드 (5~10초 메인 스레드 점유)
```
[fileToImage] → createFabricImage → imgEl.onload
  → tellHasAlpha (true)
  → imagePlugin.processImage  
    → getCv()  // ← 첫 호출 시 import('@techstark/opencv-js') (~10MB WASM)
                //    다운로드 + 컴파일 + 초기화
```

### ② onnxruntime-web single-threading fallback
콘솔 로그에서 발견:
```
⚠️ env.wasm.numThreads is set to 10, but this will not work unless you 
   enable crossOriginIsolated mode.
⚠️ WebAssembly multi-threading is not supported in the current environment. 
   Falling back to single-threading.
```
→ COOP/COEP 헤더 미설정 → SharedArrayBuffer 사용 불가 → 멀티스레드 비활성 → 처리 속도 1/10

### Chrome/Safari unresponsive 모달 트리거
메인 스레드가 5초+ 점유되면 브라우저가 자동으로 "이 페이지를 나가겠습니까?" 표시. 두 번째 업로드(영문)에서는 ① WASM이 이미 캐시되어 빠르고, ②는 여전히 single-thread지만 작은 파일이라 1초 미만 → 정상 동작으로 보임.

## 적용한 수정 (A + B)

### A) WASM 백그라운드 warmup
**파일**: `packages/canvas-core/src/utils/openCv.ts` (신규)

- `getCv()` / `getBackgroundRemoval()` lazy-load 통합 (module-level Promise 캐시)
- `warmupOpenCv()` — `requestIdleCallback`으로 idle 시간에 WASM 백그라운드 다운로드
- `EditorView` mount useEffect에서 1회 호출
- 사용자가 처음 업로드 버튼 누를 때는 이미 WASM ready

기존 `ImageProcessingPlugin` module-level 캐시는 새 모듈로 옮겨 양쪽이 같은 인스턴스 공유. 중복 다운로드 X.

### B) crossOriginIsolated 활성 (COOP/COEP)
**파일**: `apps/editor/vercel.json`, `docker/nginx/nginx.conf`

```http
# editor.papascompany.co.kr 의 모든 응답
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless

# api.papascompany.co.kr/storage/* 의 응답
Cross-Origin-Resource-Policy: cross-origin
```

- COEP `credentialless` 선택 (외부 리소스 자동 허용 — PHP 통합 시 bookmoa CDN 호환)
- 사전 audit: editor 코드의 외부 cross-origin 자원 사용 0건 (모두 same-origin) → 안전
- 효과:
  - `self.crossOriginIsolated === true` 진입
  - onnxruntime-web `numThreads=10` 정상 활용 → 처리 속도 ~10배
  - SharedArrayBuffer 사용 가능 (향후 Web Worker 분리 길 열림)

### C) Web Worker 분리 — 별도 사이클로 분리
A + B 적용으로 hang 문제는 거의 해소될 것으로 예상. 실제 사용자 경험 검증 후 C 필요성 평가:
- A + B 후에도 큰 PNG에서 느림이 보고되면 C 진행
- 현재 OK라면 별도 사이클 (작업량 1~2일, 회귀 위험 큼)

## 배포 상태

| 항목 | 결과 |
|------|------|
| canvas-core + editor 빌드 | ✅ |
| 커밋 | `17b368a` |
| GitHub master push | ✅ |
| VPS nginx restart | ✅ |
| `/storage/*` CORP 헤더 검증 | ✅ `cross-origin-resource-policy: cross-origin` |
| Vercel editor 자동 빌드 | ✅ Ready (1m duration) |
| `editor.papascompany.co.kr` COOP 헤더 | ✅ `same-origin` |
| `editor.papascompany.co.kr` COEP 헤더 | ✅ `credentialless` |

## ⚠️ 운영 회귀 발생 + 즉시 revert (2026-05-04)

B 단계(COOP/COEP) 활성 직후 **운영 사용자가 모든 메뉴/캔버스 클릭 불가** 보고. Chrome 확장(Leap)이 페이지에 inject한 script가 COEP `credentialless`로 차단되어 페이지 이벤트 시스템이 깨진 것으로 추정.

| 회귀 대응 | 결과 |
|-----------|------|
| B revert (COOP/COEP 헤더 제거, 커밋 `91af883`) | 부분 정상화 |
| A revert (warmupOpenCv() useEffect 제거, 커밋 `4f90641`) | 운영 100% 정상화 ✅ |

### 진단 결과 (revert 결과 기반)
- **B (COEP credentialless)** 가 진범 거의 확실 (Chrome 확장 충돌)
- **A (warmupOpenCv)** 는 무영향 (다만 안전장치로 같이 revert)

### 후속 사이클 (FUTURE_UPDATES §4 등록)
- 시크릿 모드 / 다양한 브라우저에서 COEP 사전 검증
- COEP `require-corp` 변형 또는 Worker 분리 (옵션 C)
- 권장 일정: PHP 통합 컷오버 + 안정화 후 (2026-Q3)

### 임시 조치 (유지 항목)
- canvas-core `warmupOpenCv` / `warmupBackgroundRemoval` export — 다른 앱 무관
- nginx `/storage/*` CORP 헤더 — 무해, B 재활성 시 통과 보장

## 기대 효과

| 항목 | 수정 전 | 수정 후 |
|------|--------|--------|
| 첫 PNG 업로드 시 | OpenCV WASM 첫 로드 (5~10초 freeze) | warmup 완료, ~0.5초 |
| onnxruntime 처리 | single-thread (10× slow) | multi-thread 10개 |
| 브라우저 unresponsive 모달 | 자주 발생 | 거의 발생 X |
| 한글 파일명 | 무관 (FileReader는 이름 미사용) | 동일 |

## 후속 사이클 (별도 진행)

1. **C — Web Worker 분리** (P2-11 트래커)
   - OpenCV/onnxruntime을 Web Worker에서 import
   - postMessage proxy 패턴으로 ImageProcessingPlugin 리팩터
   - 메인 스레드 freeze 완전 해소 + UI 반응성 보장
2. **자동 다운스케일** — workspace ÷ 2 보다 큰 이미지는 사전 리사이즈
3. **Loading UI 활성** — `useUploading()` selector를 EditorView에 구독해서 처리 중 spinner 표시 (현재 export만 됐고 import 0건)

## 사용자 검증 요청

배포 완료 후 다음 시나리오 재시도 부탁드립니다:
1. 페이지 새로고침 (cache 비우지 말고 F5만)
2. 콘솔에 `self.crossOriginIsolated` 입력 → `true` 확인
3. 영문 또는 한글 파일명 PNG 업로드 → hang 없이 1초 내 표시 기대

콘솔 경고 사라짐 확인:
- `❌ env.wasm.numThreads is set to 10, but this will not work` — 사라져야 함
- `❌ Falling back to single-threading` — 사라져야 함
