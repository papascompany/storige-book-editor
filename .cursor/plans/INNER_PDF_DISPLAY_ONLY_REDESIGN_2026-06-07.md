# 내지 PDF **표시전용 임포지션** 재설계 노트 (2026-06-07)

> 목적: RESUME_PROMPT_2026-06-07 §1 의 유일 잔여 P1(XL). 원 설계(`wj3y4f2pz`,
> inner-pdf-imposition)가 적대적검증에서 **flawed** 판정된 원인을 정리하고,
> **표시전용(display-only)** 제품결정 기준으로 구현 가능한 설계를 확정한다.
> 작성: 5-에이전트 병렬 코드베이스 정찰 + 프로덕션 DB 실측 종합. 구현 착수 전 본 노트로 정렬.

---

## 0. TL;DR (의사결정 요약)

1. **제품결정(확정)**: 첨부 내지 PDF = **표시 전용 가이드**. 사용자 캔버스 편집은 **최종 인쇄에 미반영**. 최종 내지 인쇄 = **원본 PDF 그대로**.
2. **원 설계가 flawed였던 이유**: 편집기는 `canvas.toSVG()`로 렌더 → underlay를 export에 포함하면 최종 PDF에 원본이 **이중 인쇄/유령객체**로 오염. "편집을 인쇄에 합본"한다는 전제 자체가 toSVG 파이프라인과 모순.
3. **표시전용은 이 모순을 제거**: underlay 가이드를 **`excludeFromExport:true`** 잠금배경으로만 깔면, 편집기엔 보이고 export엔 빠진다 → 모순 해소.
4. **데이터 모델**: 죽은 컬럼 `content_pdf_mode`('replace'|'underlay')를 재활용. **운영 전량 NULL(25/25)** 확인 → 마이그레이션·하위호환 리스크 0. `'underlay'`의 **의미를 "표시전용"으로 재정의**(편집허용·인쇄 미합본).
5. **래스터화 경로 결정(권장)**: **워커 GS 다중페이지 래스터 + 편집기 얇은 배치**. ⚠️ 편집기 `pdfjs-dist` 직접도입은 **/embed IIFE 번들 +500KB** 회귀라 비권장(대안으로만 문서화). → **CTO 사인오프 1건 필요**.
6. **워커 변경 여부 = 전제 검증에 종속**: 현재 compose-mixed가 내지 canvasData를 원본 content.pdf에 **합성하지 않고 원본을 그대로 content.pdf로 출력**한다면 → **워커 변경 0**, 순수 편집기 기능. (구현 Phase-0에서 반드시 확인 — §6)

---

## 1. 배경 & 제품결정

### 1.1 원 설계 (`wj3y4f2pz`)
- 첨부 내지 PDF 각 페이지를 내지 캔버스에 underlay로 깔고, 그 위 편집 → **최종 출력에서 편집 + 원본 PDF 합본**.
- 데이터: `contentPdfMode:'underlay'`가 `PDF_ATTACHED_EXCLUSIVE` 가드를 완화해 canvasData 저장 허용. 워커 compose-mixed가 원본 PDF + 캔버스 export를 오버레이 머지.

### 1.2 적대적검증 — flawed 판정 (근거: COVER_EDIT_FULL_AUDIT_2026-06-06 §1-E)
- 편집기 렌더 경로 = **`canvas.toSVG()`** (`SpreadPlugin`, EDITOR.md §19.10).
- underlay 배경을 export에 포함하면: SVG에 직렬화 → 최종 PDF에 원본이 **중복/유령**으로 박힘.
- 즉 "underlay를 보이게 하면서 동시에 인쇄에 합본"은 toSVG 파이프라인상 양립 불가.
- 같은 이슈를 영역클릭(§19.8) 구현 중 발견 → 가이드/라벨/오버레이에 `excludeFromExport:true` 적용으로 **저장오염 근원 해소**. 이 패턴이 표시전용의 토대.

### 1.3 표시전용 제품결정 (확정)
- 첨부 내지 PDF = **표시 전용(가이드)**, 편집 반영 안 함, **최종 내지 인쇄 = 원본 PDF 그대로**.
- → underlay 가이드를 **`excludeFromExport:true`** 로만 깔면 모순이 사라진다. 편집기엔 보이고 export엔 안 들어감.

---

## 2. 핵심 계약 (불변식)

| # | 계약 | 강제 지점 |
|---|---|---|
| C1 | 첨부 PDF 가이드 객체는 **항상 `excludeFromExport:true`** | `imageFromURL(..., {excludeFromExport:true})` |
| C2 | 가이드 객체는 **비선택·비이벤트·비편집** (`selectable/evented/hasControls/hasBorders=false`) | 객체 생성 시 |
| C3 | 가이드 객체는 **항상 z-0 배경** (`canvas.insertAt(img,0)`) | 페이지별 1회 |
| C4 | 최종 내지 인쇄 = **원본 content.pdf 무변형** | 워커 패스스루(**§6·§10 검증 CONFIRMED**) |
| C5 | `content_pdf_mode='underlay'` = **표시전용**(편집허용·인쇄 미합본) | entity 주석 명료화 + 워커/문서 |
| C6 | 자동 생성 페이지 수 = min(PDF 페이지수, 제본가드 상한) — **루프 내 강제** | **`loadSpreadModeEditor` 루프가 매회 `canAddMorePages()` 체크·break·toast** |
| C7 | 가이드는 **`extensionType:'overlay'` / `id:'cutline-template'` 금지**, `meta.system='innerPdfGuide'`만 | 객체 생성 시 |

> ⚠️ **C5 정정(적대적검증)**: 현 entity 주석(`edit-session.entity.ts:136`)은 underlay = "잠금배경+편집허용+canvasData 저장허용"이라 적혀 있고 **인쇄 합본을 명시하지 않음**(원 노트의 "합본이라 적혀있다"는 오기). 모순 수정이 아니라 **표시전용임을 명료화**하는 보강. 
> ⚠️ **C6 정정(적대적검증·최대 구멍)**: `canAddMorePages()`는 **UI 버튼 비활성 셀렉터 전용**(`useEditorStore.ts:335`에서만 소비). `addInnerPage`/`addPage`는 이를 **호출하지 않음** → 현재 강제지점 0. 64p 초과 PDF면 제본가드를 **조용히 넘김**(=노트가 금지한 silent truncation). 반드시 underlay 로드 루프에 명시 체크 추가.
> ⚠️ **C7 근거(적대적검증)**: `ServicePlugin.saveJSON()`(224-229)이 `extensionType==='overlay'` 또는 `id==='cutline-template'` 객체는 export 재활성화 → canvasData 누출. "overlay"는 표시레이어의 자연스러운 작명이라 실수 유발 가능 → 명시 금지.

---

## 3. 데이터 모델

- **컬럼**: `file_edit_sessions.content_pdf_mode VARCHAR(16)` (entity `edit-session.entity.ts:139`, DTO `@IsIn(['replace','underlay'])`).
- **운영 실측(2026-06-07)**: `content_pdf_mode` 분포 = **NULL 25 / 전체 25** → underlay 사용 이력 0, **죽은 컬럼 확정**. 재정의/배선에 하위호환 리스크 없음.
- **API 가드(이미 부분구현)**: `edit-sessions.service.ts:277-288` — `effectiveMode = dto ?? session ?? 'replace'`; `effectiveMode!=='underlay'` 일 때만 `PDF_ATTACHED_EXCLUSIVE`로 canvasData 차단. → **underlay면 편집 허용**. 표시전용 요구와 **이미 일치**(편집 허용해야 가이드 위에 작업 가능).
- **타입 누락 버그**: `packages/types/src/index.ts` EditSession 인터페이스에 `contentPdfMode` **누락**(API DTO엔 있음). → 배선 시 타입 추가(G8).

---

## 4. 아키텍처 결정 — PDF→이미지 래스터화

| 기준 | A. 편집기 pdfjs-dist | B. 워커 Ghostscript (권장) |
|---|---|---|
| 현 상태 | 미설치(신규 의존) | **운영중**(`utils/ghostscript.ts pdfToImage()`) |
| 번들 영향 | **/embed IIFE +~500KB** (embed는 OpenCV/bg-removal를 일부러 스트립 중) | **0** (시스템 바이너리) |
| 다중페이지 | JS 루프 | `pdfToImage()` 페이지 루프(검증·합성·프리뷰서 이미 사용) |
| 게스트 인증 | 신규 불필요(클라) | **기존 `@Public` 잡 경로 재사용** |
| 타임아웃/동시성 | 브라우저 의존(불안정) | 서버 설정(`GS_TIMEOUT 5000`, `GS_CONCURRENCY 2`, `VALIDATION_CONCURRENCY 3`) |
| 지연 | ~0(클라 CPU 점유) | 첨부 시 1회 잡+폴링(수 초) — 단발 |
| 모든 사용자 비용 | PDF 안 붙여도 +500KB 다운로드 | PDF 붙일 때만 비용 |

**권장 = B(워커 GS) + 편집기 얇은 배치.** 근거: /embed가 1차 통합 경로인데 pdfjs 500KB는 PDF 미사용자 포함 **전원 회귀**. GS는 검증/합성/프리뷰에서 이미 다중페이지 래스터 실증. 첨부 시점엔 이미 업로드+검증 잡+폴링을 `ContentPdfAttachModal`이 수행 → **동일 폴링 패턴 재사용**으로 페이지 이미지 N장 수신.
**비권장이지만 문서화(대안 A)**: 오프라인/즉시성이 절대 필요할 때만. 단 embed 번들은 별도 청크/지연로드 필수.
→ **이 1건만 CTO 확인 후 구현 착수.**

---

## 5. 구현 설계 (권장안 B 기준)

### 5.1 흐름
```
[첨부] ContentPdfAttachModal: 업로드 → (검증잡) → 'underlay' 선택 시 렌더잡
   → 워커 GS pdfToImage(전 페이지, 150dpi) → 페이지 이미지 N장 storage 저장
   → result.pageImageUrls[] 반환(폴링)
[로드] useEditorContents.loadSpreadModeEditor: session.contentPdfMode==='underlay' 면
   → 내지 페이지 N개 자동 생성(addInnerPage) → 각 캔버스 z-0에 잠금 가이드 배치
[저장] canvas.toSVG(): 가이드는 excludeFromExport 라 자동 제외 → 오염 0
[출력] 워커: 원본 content.pdf 그대로 content.pdf 로 방출(C4, §6 검증)
```

### 5.2 N페이지 자동생성 + 잠금배경 레시피 (정찰 확정)
- `appStore.addInnerPage()` × N (스프레드 모드에서 `debouncedRecalcSpine()` 자동, 300ms 디바운스+AbortController → **최종 1회만** recalc).
- 각 신규 캔버스에:
  ```ts
  const bg = await imageFromURL(pageUrl, {
    excludeFromExport: true, selectable: false, evented: false,
    hasControls: false, hasBorders: false, left: 0, top: 0,
  })
  bg.meta = { system: 'innerPdfGuide' }
  canvas.insertAt(bg, 0); canvas.requestRenderAll()
  ```
- 패턴 출처: `SpreadPlugin.ts:420-461`(가이드/라벨), `factory.ts:423-449`(imageFromURL), 직렬화 제외 `utils/canvas.ts:160-171`.

### 5.3 메모리/성능 가드 (필수)
- **페이지 상한 — 실제 강제(C6)**: underlay 로드 루프가 **매 반복 `canAddMorePages()` 호출 → false면 break + 경고 토스트**(`"내지 N페이지 중 M페이지만 가이드 표시(제본 상한)"`). ⚠️ `addInnerPage`/`addPage`는 가드를 호출 안 하므로 **루프 쪽에서 직접 강제**해야 함(적대적검증 지적). `BINDING_CONSTRAINTS`(무선 32p min / 중철 64p max·4배수) ∩ `pageCountRange`.
- **recalcSpine 호출수 — restoring 상태 주의**: 정상모드는 디바운스(300ms+Abort)로 최종 1회. **단 `restoring===true`면 `debouncedRecalcSpine`가 즉시 동기 실행**(`useAppStore.ts:1114-1140`) → 로드 루프가 restoring 중이면 N회 즉시 발화. **Phase-0에서 `loadSpreadModeEditor`의 restoring 플래그 상태 확인** 후, 필요 시 루프 후 recalc 1회만 수동 트리거하도록 설계.
- **lazy fromURL**: 콜백 기반, await 직렬(이미지 폭주 없음). 모바일(TOUCH_ENV) `toDataURL` 회피(iOS 메모리 크래시) — 썸네일 placeholder.
- **이미지 총량 상한**: 64p × 150dpi 풀해상 fabric.Image N장은 무겁다. **하드 상한(페이지수 or 총바이트) + 저dpi(가이드 목적)** 권장.
- **대용량 PDF**: 워커 `LARGE_FILE_THRESHOLD(50MB)` 초과 시 가이드 스킵 + 경고.
- **⚠️ 썸네일 누출(적대적검증)**: `useAutoSaveThumbnail.ts:51`이 **라이브 캔버스에 `toDataURL`** → `excludeFromExport`는 래스터 출력에 적용 안 됨 → **데스크톱 자동저장 썸네일에 가이드가 찍힘**(인쇄 PDF엔 무관, 마이페이지/버전 프리뷰만, TOUCH는 스킵). "오염 0"은 **인쇄 PDF/canvasData 한정** 참. 썸네일 생성 시 가이드 일시 숨김 or 별도 처리 검토.

---

## 6. 워커 영향 — ⚠️ Phase-0 전제 검증 (설계 린치핀)

**가설(C4)**: 스프레드 책 출력은 separate 2파일(cover.pdf + content.pdf)이고, 내지는 **원본 첨부 PDF가 그대로 content.pdf로 방출**된다(현재도). 이미 참(RESUME §0·§2 "최종 내지 인쇄=원본 PDF 그대로", separate 강제).

- **참이면** → 표시전용은 **순수 편집기 기능**. 워커 변경 0. 가이드는 excludeFromExport라 캔버스 저장/합성 어디에도 안 들어감.
- **거짓이면**(워커가 내지 canvasData를 원본에 오버레이/합성) → 워커가 `contentPdfMode==='underlay'`일 때 **canvasData 무시·원본 패스스루** 분기 추가 필요.

**검증 방법(구현 직전)**: `apps/worker/src/processors/synthesis.processor.ts` + `services/pdf-synthesizer.service.ts`의 compose-mixed 내지 처리에서, content.pdf 소스가 (a) 첨부 원본 그대로인지 (b) 캔버스 export 합성인지 확인. + 워커가 `content_pdf_mode`를 읽는지(정찰상 현재 **미참조**).

---

## 7. 게스트 인증 · 타임아웃 · GS측 비용 (권장안 B)
- **게스트 잡**: 기존 `@Public` 워커잡 컨트롤러(`worker-jobs.controller.ts`) + 세션 `guest_token`/`guest_expires_at` 재사용. 렌더잡도 동일 경로. 만료 검증 후 렌더.
- **⚠️ 이미지 서빙 인증(적대적검증)**: 잡 엔드포인트(`@Public`)와 **별개로, 생성된 N장 페이지 이미지의 서빙 URL도 게스트 토큰/만료를 존중**해야 함. 잡 경로 재사용만으로 끝나지 않음 — 서빙 엔드포인트 인증 별도 확인.
- **⚠️ 이미지 수명관리(적대적검증)**: 첨부당 N장(최대 64p×150dpi) storage 적재 — **생명주기/클린업 정책 미정**. 세션 만료·삭제 시 함께 정리 or TTL 필요(미정 시 storage 누적).
- **타임아웃 동적화**: 현 `GS_TIMEOUT 5000`(단일페이지용). 다중페이지 → `1000 + pages*200ms` 등 동적. **64p면 ~13.8s** — `GS_CONCURRENCY 2` 공용 풀에서 검증/합성과 경합. 초과 시 placeholder + 경고(중단 금지). **저dpi/저우선 큐로 부하 완화 권장**.
- **동시성**: `GS_CONCURRENCY 2` 유지. 렌더는 검증/합성보다 저우선 — 필요 시 우선순위 큐.

---

## 8. 구현 순서 (진행 상황)
0. ✅ **Phase-0 전제검증**(§6/§10) — 워커 패스스루 CONFIRMED → 워커 출력변경 불필요.
1. ✅ **타입/주석 정합**: types `contentPdfMode`+`ContentPdfGuide`(G8) + entity 주석 표시전용(C5). 커밋 `c1ca6c6`.
2. ✅ **워커 렌더잡**: `RENDER_PAGES` 잡 + `PdfPageRendererService`(GS pdfToImage 재사용, 110dpi, 페이지상한) + `RenderProcessor`(pdf-conversion 큐, concurrency 1) + `@Public POST /worker-jobs/render-pages`. 커밋 `c1ca6c6`.
   - **배포·검증 완료(2026-06-08)**: VPS api·worker 배포. E2E 스모크 = 108KB PDF→`page_1/2.png`@110dpi, COMPLETED ~0.5s, `result.pageImageUrls` 정상, 이미지 HTTP 200 공개서빙. ⚠️배포 시 nginx 502(옛 api IP 캐싱) 발생→nginx 재시작 복구. [[feedback_api_redeploy_nginx]]
3. ⏳ **편집기/admin 배선 (다음 단계)** — CTO UX 확정(§9.1):
   - admin: 편집기 세팅에 **"PDF첨부 파일 편집 가능/불가" 토글**(templateSet `contentPdfEditable`) + 엔티티/DTO.
   - 첨부 UX(`ContentPdfAttachModal`): 첨부 시 `contentPdfMode='underlay'` + 렌더잡(`/worker-jobs/render-pages`) 폴링 → `metadata.contentPdfGuide` 저장(metadata 머지 주의).
   - 로드 배치: inner 캔버스에 가이드 잠금배경 오버레이(`imageFromURL`+`resolveStorageUrl`, C1/C2/C3/C7) — **fabric 좌표/스케일 실세션 시각검증 필수**.
   - '편집 불가' 세팅: 내지 편집 차단 + **첫 페이지 레이블**. '편집 가능': 편집 허용(풋건 안내).
4. ⏳ **빌드/테스트**: types build 선행 → 편집기/admin 빌드.
5. ⏳ **배포**: editor/admin 자동(master push) / 필요시 api·worker(**nginx 재시작 동반**).
6. ⏳ **라이브검증**: /embed QA(§3)로 첨부→가이드 표시→편집완료 export 오염0 확인.
7. ⏳ **문서**: EDITOR §19, 통합문서, 본 노트 갱신.

---

## 9. 미해결 / 사인오프 필요
- **[CTO] 래스터 경로**: 권장 B(워커 GS) 승인? (vs A pdfjs). ⚠️ 적대적검증: embed는 `formats:['iife']`+`inlineDynamicImports:true`(`vite.embed.config.ts:119,124`)라 **코드스플릿 불가** → A의 "지연청크" 탈출구 **없음**(전원 +500KB 무조건 번들). B 근거 더 강함.
- **[검증] §6 워커 패스스루**: **§10에서 CONFIRMED** — 워커는 canvasData/toSVG 미참조, content_pdf_mode 미참조, content.pdf는 첨부원본 바이트머지(`pdf-synthesizer.service.ts:752-791`). → **워커 변경 0**. (단 restoring 디바운스 §5.3은 별도 확인.)
- **가이드 해상도/수명**: 110dpi 채택(화면표시용 저dpi). + 페이지 이미지 클린업 정책 미정(§7) — 세션 만료/삭제 시 정리 or TTL.

### 9.1 편집기 UX — CTO 확정 (2026-06-08)
1. **내지 편집 가능여부 = 관리자 세팅**: templateSet(또는 site/편집기 세팅)에 **"PDF첨부 파일 편집 가능/불가"** 토글 신설. 관리자가 상품별로 선택.
   - 구현: admin 편집기 세팅 UI + templateSet 엔티티/DTO 필드(예: `contentPdfEditable: boolean`) + 편집기가 이 값을 읽어 underlay 내지 편집 허용/잠금.
2. **'편집 불가' 세팅 시**: 첨부 PDF를 잠금 가이드로 표시 + **내지 첫 페이지에 레이블 표기**("첨부 PDF — 편집 불가, 원본 그대로 인쇄" 류)로 명확화. 내지 캔버스 편집 차단.
3. **'편집 가능' 세팅 시**: 가이드 위 편집 허용(단 §10 풋건 — 편집이 인쇄에 미반영됨은 별도 안내 검토).
4. **저장/다운로드 계약**: 첨부 파일은 **변형 없이 고객 업로드 원본 그대로 다운로드**(C4 워커 패스스루 CONFIRMED와 일치 — 워커는 content.pdf를 첨부 원본 바이트머지). 원본 다운로드 경로는 기존 `GET /api/files/{id}/download/external`(STORIGE-ANSWER-E4, 완료) 활용 가능.

> 구현 순서 영향: §8에 **admin 편집기 세팅(contentPdfEditable) + 편집기 잠금/레이블 분기** 추가. 백엔드 렌더 슬라이스 배포 후 편집기+admin 단계에서 구현·시각검증.

---

## 10. 적대적 검증 결과 (2026-06-07, 코드 근거 기반)

| # | 항목 | 판정 | 근거 / 비고 |
|---|---|---|---|
| 1 | **C4 워커 패스스루(린치핀)** | ✅ **CONFIRMED** | 워커는 content.pdf를 첨부 원본 바이트 머지로만 생성. `pdf-synthesizer.service.ts:752-791`(spread `copyPages`), `synthesis.processor.ts:178-183`(compose-mixed). `canvasData/toSVG/raster` 0건, `content_pdf_mode` 0건. → **워커 변경 불필요**. |
| 2 | **excludeFromExport 인쇄/저장 제외** | ⚠️ **부분반증** | 인쇄(`toSVG` ServicePlugin:869)·canvasData(`toJSON` useWorkSave:124/embed) 제외 **참**. **단** (a) `useAutoSaveThumbnail.ts:51` `toDataURL`→데스크톱 썸네일에 가이드 찍힘, (b) `saveJSON()` 224-229가 `extensionType:'overlay'`/`id:'cutline-template'` export 재활성 → 누출 위험. → **C7 신설·§5.3 반영**. |
| 3 | **메모리/레이스 가드** | ⚠️ **부분반증** | (a) **C6 강제지점 0**: `canAddMorePages`는 UI셀렉터 전용, add 경로 미호출 → 64p초과 silent overflow. **최대 구멍**. (b) `restoring`시 디바운스 무력(즉시 N회). → **C6 루프강제·§5.3 restoring 주의 반영**. |
| 4 | **데이터모델/가드** | ⚠️ **부분반증** | API 가드(`service.ts:277-288` underlay=canvasData 허용)·타입누락(G8) **참**. **단** entity 주석은 "합본" 명시 안 함(원노트 오기) → **C5 정정**. + "저장되나 인쇄안됨" 풋건 발견 → **§9 제품결정**. |
| 5 | **아키텍처(GS vs pdfjs)** | ✅ **CONFIRMED(+강화)** | embed 사이즈 민감 실증(`vite.embed.config.ts` OpenCV/bg-removal 스텁). **IIFE+inlineDynamicImports → A 지연청크 불가**(B 근거 강화). 단 GS측 미계상 비용(이미지 수명·서빙인증·64p 지연) → **§7 반영**. |

**반영 완료**: 위 지적 전부 C5/C6/C7·§5.3·§7·§9에 패치함. 구현 전 잔여 확인 1건 = §5.3 restoring 플래그(Phase-0).

---

## 11. 핵심 파일 참조 (정찰 확정)
- 첨부 모달: `apps/editor/src/components/editor/ContentPdfAttachModal.tsx`(업로드/검증/폴링, 현 replace 배타), `EditorWorkflowControls.tsx`(onAttached).
- 로드: `apps/editor/src/hooks/useEditorContents.ts`(`loadSpreadModeEditor`, 내지페이지 루프 ~1527-1597), `stores/useAppStore.ts`(`addInnerPage` 765-775, `debouncedRecalcSpine` 1108-1172).
- 페이지/가드: `stores/useEditorStore.ts`(`canAddMorePages`/`canDeletePage` 283-315), `PagePanel/SpreadPagePanel.tsx`.
- 잠금배경 패턴: `packages/canvas-core/src/plugins/SpreadPlugin.ts:420-461`, `utils/factory.ts:423-449`(imageFromURL), `utils/canvas.ts:160-171`(export 제외).
- 스파인: `stores/useSettingsStore.ts:745-763`(updateSpreadSpineWidth+computeSpreadDimensions).
- 데이터모델: `apps/api/src/edit-sessions/entities/edit-session.entity.ts:139`, `dto/update-edit-session.dto.ts:52`, `dto/edit-session-response.dto.ts:84`, `service.ts:277-288`(가드), `packages/types/src/index.ts`(EditSession — contentPdfMode 누락).
- 워커 래스터: `apps/worker/src/utils/ghostscript.ts`(`pdfToImage` 146-174, `runGhostscriptWithTimeout` 258-299), `config/validation.config.ts`(GS_TIMEOUT/CONCURRENCY), `processors/synthesis.processor.ts`·`services/pdf-synthesizer.service.ts`(compose-mixed 내지 처리 — §6 검증 대상).
- 게스트잡: `apps/api/src/worker-jobs/worker-jobs.controller.ts`(`@Public`), `edit-sessions.service.ts`(guestToken 발급).
