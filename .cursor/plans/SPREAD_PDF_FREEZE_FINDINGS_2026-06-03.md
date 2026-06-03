# 스프레드 책 편집완료 표지/PDF '예외(Mt)' — 진단 결과 · 패치 · 설계 (2026-06-03)

> 핸드오프 `RESUME_PROMPT_2026-06-03.md` §0 추적 결과. CTO 지시: 모든 경우의 수 점검 + 패치.

## 1. 결론 요약

- **표지 cover PDF 생성 로직 자체는 정상.** 실제 실패 세션(both 모드)의 표지 canvasData + 실제 스프레드 오버레이(SpreadPlugin/WorkspacePlugin) + 실제 Noto Sans KR 웹폰트로 **로컬 dev 충실 재현 → cover PDF 0.4초 정상 생성**(≈587KB). 이미지/특수객체/폰트→벡터/429mm 판형/clipPath/CJK 텍스트 전부 원인 배제.
- **'Mt'의 실제 정체 = 프로덕션 editor 렌더러 하드 프리즈.** 프로덕션 `editor.papascompany.co.kr/embed`에서 스프레드 책 편집완료를 실제 트리거 시 렌더러가 5분+ 완전 프리즈(CDP eval 타임아웃, 세션 `status='editing'` 고정, cover/content fileId 미생성). 핸드오프의 "무거운 editor로 반복 크래시"가 이것. 모든 both 모드 세션 `cover_file_id` NULL 이유.
- 경량 컨텍스트(canvas-core only)에선 재현 불가가 일관 → **환경/스케일 요인**(opencv 10MB + onnx 882KB + 11개 라이브 fabric 캔버스 + PDF 래스터 동시 점유). 정확한 핫스팟 라인은 프로덕션에서만 발현, 렌더러가 출력 전 프리즈해 콘솔로 직독 불가.

## 2. 부수 발견(별개 실버그)

- **`/api/woff2ToTtf` 라우트 부재(404).** `FontPlugin.getTtfBuffer`가 이 경로를 호출 → 항상 404 → 텍스트 벡터(아웃라인)화 실패(catch). 단, **선행 차단은 `library_fonts` 테이블 0행**(프로덕션). 즉 라이브러리 폰트가 아예 없어 벡터화할 폰트도 없음. → 2단계 과제: ① 폰트 시딩(제품/데이터 결정: 어떤 폰트 제공할지 + woff2 업로드) ② woff2 디코더 의존성(`wawoff2` 등) + `/api/woff2ToTtf` 라우트 구현 + API 수동 재배포. 인쇄 폰트 임베딩/아웃라인에 영향하나 PDF 생성 자체는 막지 않음(하위 우선순위).
- `spine/calculate` 는 프로덕션 정상(201). (로컬 하니스의 500은 합성 데이터 아티팩트 — 프리즈 무관.)

## 3. 적용한 패치

### B. handleFinish 하드닝 + 계측 (`apps/editor/src/embed.tsx`) — 적용·빌드검증 완료
- `finishMark(phase)`: 각 단계 진입 직전 `Sentry.captureMessage` + `await Sentry.flush(1500)` + 타임스탬프 콘솔. **프리즈에도 "마지막 통과 단계"가 Sentry에 즉시 전달** → 다음 프로덕션 실패에서 핫스팟 자동 특정.
  - 단계: `canvasData:save:{start,done}` / `spread:cover:gen:{start,done,FAILED}` / `spread:content:gen:{start,done,FAILED}` / `single:gen:{start,done}` / `complete:{start,done}`.
- `withWatchdog(p, ms, label)`: cover 120s / content 180s / single 120s 비동기 워치독(동기 블록은 못 잡지만 비동기 행/네트워크 stall 대비 + 영구 무한로딩 방지).
- cover/content/outer catch에 `Sentry.captureException(..., {tags:{finishPhase}})` → 실제 'Mt' 예외를 컨텍스트와 함께 Sentry 보고.
- 회귀 위험 낮음(가산적). complete()는 기존대로 항상 실행.

### dev 보조(저위험, env-gated)
- `apps/editor/vite.config.ts`: 프록시 대상에 `VITE_DEV_PROXY_TARGET` 폴백 추가(미설정 시 `localhost:4000` — 기존 동작 보존). 로컬에서 프로덕션 API 충실 재현용.

## 4. 다음 단계 (B 배포 후 데이터 확정 → 타깃 수정)

> ⚠️ 프리즈 정확 원인이 **메모리(GC/OOM)** 인지 **CPU 폭주(루프)** 인지에 따라 올바른 수정이 다름.
> B의 Sentry 계측이 다음 프로덕션 실패에서 마지막 통과 단계를 알려주면 아래 중 정답을 선택.

### C. 클라이언트 풋프린트 축소 — **B 데이터 확정 후 권장**
- 분석: "격리 경량 컨텍스트 생성"만으로는 **피크 메모리가 줄지 않음**(라이브 11캔버스 + 격리 N캔버스 동시 존재 → 오히려 증가). 메모리 요인이면 **라이브 캔버스 dispose / opencv·onnx 언로드를 finish 직전 수행**해야 효과 — 단 사용자 취소 시 복구 문제로 위험. 로컬 재현 불가로 효과 검증 불가.
- CPU 폭주 요인이면 C는 무효 — `_createMultiPagePDF`/svg2pdf의 루프 핫스팟 코드 수정이 정답.
- → **B 계측으로 단계/유형 확정 후** 둘 중 맞는 수정 적용.

### D. 서버사이드(워커) PDF 생성 이전 — 근본·장기
- 현재: 표지/내지 PDF를 **클라이언트(브라우저)** 가 svg2pdf로 생성 → 무거운 editor 환경에서 프리즈.
- 제안: 편집완료 시 클라이언트는 canvasData만 업로드(이미 함). **워커가 서버사이드로 cover/content PDF 렌더** → 브라우저 메모리 천장 제거(근본 해결).
- 구현 옵션:
  - **(D1) Puppeteer 헤드리스** — 워커가 헤드리스 크롬에서 editor의 동일 생성 코드(`ServicePlugin.saveMultiPagePDFAsBlob`)를 격리·리소스 보장 환경에서 실행. 렌더 충실도 최고(코드 재사용). 워커에 chromium 의존 추가. compose-mixed 와 동일 파이프라인에 합류.
  - **(D2) node-canvas + fabric(node) + svg2pdf** — 순수 Node 렌더. chromium 불필요하나 fabric/svg2pdf 의 node 호환·폰트 처리 재현 부담 큼. 충실도 검증 비용 큼.
- 권장: **D1(Puppeteer)** — 코드 재사용으로 출력 동등성 보장, 워커는 이미 PDF 합성(pdf-lib) 보유. 트리거: `editor.complete` 수신 후 워커가 canvasData→PDF 렌더→`files` 업로드→세션 fileId 갱신→compose-mixed. (bookmoa 핸드오프의 compose-mixed 트리거와 합류.)
- 회귀 주의: 기존 클라이언트 생성 경로는 폴백으로 유지하거나 플래그 전환.

## 5. 재현 자산 (dev-only, 미커밋 — 작업 종료 시 제거)
`apps/editor/repro.html`, `apps/editor/src/repro-cover.tsx`, `apps/editor/src/__repro_cover.json`, `apps/editor/.env.local`(prod 프록시).
shop-session 토큰: `X-API-Key: STORIGE_API_KEY` → `POST /api/auth/shop-session`. 충실 재현: vite proxy를 prod로(`VITE_DEV_PROXY_TARGET`).
