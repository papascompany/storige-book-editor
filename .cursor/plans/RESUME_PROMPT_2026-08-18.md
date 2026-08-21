# RESUME PROMPT — 2026-08-18

> **이 문서가 최신 날짜 정본이다.** 동화책 템플릿 등록·내지 401 조사는 `RESUME_PROMPT_2026-08-14.md`.

## 동화책 하드커버 세트 편집기 4결함 수정 (LIVE, c5c9525)

8/14 admin 등록 동화책 무지 세트(빈 canvasData objects=[], 정사각형 210×210 → 표지 flat-spread 496×276)를 상품 연결 후 편집기 4결함 발생. 5에이전트 병렬 조사(+프로덕션 DB 실측) → 4샤드 병렬 구현 → 통합검증 → 적대리뷰(NO-GO 1 blocker 해소) → master push → Vercel LIVE 실증(신규 청크에 가드 문자열 확인).

**전부 코드 결함** — admin 등록 데이터는 무결(세트 메타·spread_config 산술 정합 확인). 빈 무지 템플릿이 미방어 경로를 드러낸 것.

| # | 증상 | 근본원인 | 수정 |
|---|---|---|---|
| 1 | 이미지 업로드 TypeError('unit') | addPage/addInnerPage 가 createFabricCanvas 에 unitOptions 미주입 + useImageStore.upload:516 만 무방어 접근 | addPage unitOptions 주입 + `?.` 가드 + fabric.d.ts optional 전환(컴파일 차단) |
| 2 | 표지 스프레드 과확대·썸네일 비율 붕괴 | WorkspacePlugin.reset() 이 기본 105×105 workspace rect 를 안 지우고 새 rect 추가 → 이중화, _getWorkspace first-match 가 옛 rect 반환 | 인자 없는 reset 에서 잔존 workspace 전부 제거(loadJSON 복원 인자 경로는 불변) + setTimeout 리사이즈 캡처 고정 + 표지 분기 여분 정리 심층방어 + 회귀테스트 2건 |
| 3 | 모양컷 업로드가 템플릿 실삭제·선택불능 | AppClipping handleSetWorkspace 가 가드 없이 canvas.clear()+clipPath 해제, clearHistory 로 undo 도 차단 | book/스프레드 컨텍스트 3중 가드(진입·render·팔레트)+ToolBar 메뉴 숨김. 판별=`allCanvas>1 ∥ spreadConfig ∥ linkedPrintTemplates.some(spread)` (length>0 은 blocker — templateSet 단품 오차단), enabledMenus 화이트리스트 명시 시 우회, product/general 로더에 신호 리셋 |
| 4 | 시드/추가 페이지 재단선·썸네일 불일치 | 시드 내지 canvasData 치수를 표지 1판(247.4×276)으로 기록 + 생성 시점 동결 뷰포트 | innerSpec 2W×H(420×210) 기록(+추가 경로와 동일 규칙) + 로드 말미 RAF 일괄 setZoomAuto + 첫 apply 재센터 스킵을 '치수 동일(1px 허용오차, setDimensions 전 캡처)'로 협소화 — iOS 3중 가드 무완화 |

**검증**: editor tsc -b 0err · vitest 55파일/673 전부 PASS · vite build PASS(유출검사 0건) · canvas-core typecheck 0err·신규 테스트 2/2 · git stash 베이스라인 대조로 신규 회귀 0 실증(canvas-core 기존 실패 6파일/8건·lint no-undef 는 베이스라인, 별도 트랙). gitleaks 클린.

**배포**: master push → storige-editor Vercel Ready + editor.papascompany.co.kr 200 + 라이브 청크(searchParams-DQs73bOd.js)에 신규 가드 문자열 실증. (직전 3d 배포가 Canceled 상태였음 — 라이브가 옛빌드였을 가능성.)

## 잔여 / 관찰 항목

- **실기 확인 필요**: bookmoa-mobile 실주문 경로에서 4결함 재현 해소 확인(특히 표지 초기 핏·모양컷 메뉴 미노출·시드/추가 썸네일 비율).
- **부수효과 2건(정상화 방향, 라이브 1회 확인 권장)**: ① 내지 사진 저해상도 경고 dpi 72→150 강화 ② px 단위 상품 추가 페이지 클라이언트 PDF 내보내기의 pxToMm 분기 첫 활성.
- **스테일 세션**: 수정 전 모양컷 사고를 겪고 저장된 세션(예: 주문 7027666248708)은 페이지 canvasData 가 템플릿 소실 상태로 영속됐을 수 있음 — 코드로 복구 안 됨, 필요 시 세션 데이터 점검. 이중 workspace 가 직렬화된 세션은 reset 경유 재로드 시 자가치유.
- **오너 확인(조사 부산물)**: 8/14 등록은 표지 화면 spec 에 싸바리 포함 편집사이즈를 직접 인코딩(coverConfig.caseBind 미설정) — D-4 계약(화면=trim, 싸바리=출력전용 caseBind)과 다른 선택. 출력 PDF/책등검증(R-44) 관점 의도 확인 필요.
- **선택적 데이터 완화**: 동화책 세트 14건 enabledMenus 화이트리스트 설정(코드 게이트가 이미 방어하므로 필수 아님).
- lint no-undef(performance 등) 베이스라인 11+4건 — eslint env 등록 별도 트랙.

---

## 2차: 저장→재진입 왕복 결함 R1~R7 (LIVE, ab4b794 + 746d182)

1차 배포 후 사용자 실기에서 4증상 추가 보고(표지 여전히 정사각·재진입 시 재단선/16→8페이지 유실·복원배너 무한·PDF 첨부 0p). 5에이전트 조사(+DB 세션 실측) → 4샤드 구현 → 적대리뷰 major 3 해소 → 배포 → **크롬 직접 제어 라이브 검증**.

| # | 근본원인 | 수정 |
|---|---|---|
| R1 | initWorkspace stale closure(embed deps=[] null 캡처)로 빈 표지에서 무실행 → workspace 105×105 잔존(DB 실측 620.08px 정확 일치, 콘솔 로그 부재로 런타임 확증). 1차 reset 수정은 이 경로에 reset 자체가 미호출이라 미도달 | getState() 경화 + 빈 표지 심층방어 |
| R2 | 재진입 시 캔버스 수(16)를 물리 페이지로 오전달→펼침면 반감(8)→복원 min() 절단→자동저장이 절단본 서버 영구 덮어씀(cd_len 17→9 실측) | restoredInnerCanvasCount 전달·소비(반감/클램프 미적용·상한 200)+복원 루프 addInnerPage 증설+다운그레이드 저장 표면화 가드 |
| R3 | 가이드는 excludeFromExport라 직렬화 안 되는데 복원 후 재생성 미호출 | loadFromJSON 후 restoreGuideElements |
| R4 | 편집완료가 markClean/백업삭제 안 함→백업이 늘 신선→배너 상시. 복원은 min()이라 no-op | finish 성공 직후 markClean+백업삭제(회원/게스트)+restoreFromLocal 교정(전량 성공 시만 삭제·복원본 userEditedRef 보호·setPage(0))+무편집 언마운트 백업 억제+시그니처 동일 시 offer 억제 |
| R5 | 산출물 content.pdf를 고객 첨부 오인(0p)+재진입마다 자기 산출물 underlay 재승격(명함 중복 원인) | 배지·resolveUnderlaySource에 spreadContentPageCount 마커 배제(W1 계약 무접촉) |
| R6 | 시스템 객체(Times New Roman 라벨) 글리프 검증 노이즈 | excludeFromExport/meta.system 제외 |
| R7 | computeInnerContentSizeMm regionScope==='inner' 게이트로 결합 세션 null→표지 패널 247.4×276 폴백→내지 PDF VALIDATE 전건 SIZE_MISMATCH(실측 4회) | innerSpec 존재 게이트로 완화(표지 cover.pdf 무접촉) |
| +α | addPage 직후 첫 표시 빈 화면(치수 0/스테일+리사이즈 미발화, 라이브 재현) | 표시 직후 wrapper 실측 setDimensions+setZoomAuto (746d182) |

**검증**: tsc 0err·editor 700/700·build PASS·적대리뷰 major 3건 수습·**라이브 확증**(표지 496×276 가로형 렌더+247.4|1.2|247.4 라벨, + 추가 즉시 정상 표시, dirty 시 beforeunload 가드 작동).

**잔여**:
- 사용자 실기: 북모아 이어서편집 왕복(16p 유지·배너 소멸·배지) — 반드시 **새 세션**으로(기존 세션 891c8c2d는 8p 절단본으로 영구 저장됨, 16p canvasData 서버 원본 부재로 복구 불가. 고아 16p content PDF 2건만 물리 잔존)
- 리뷰 minor 잔여 1건: R5 마커 배제의 정밀화(완료 이력 세션에 향후 정당한 contentFileId 재첨부 흐름이 생기면 editorOutputContentFileId 기록 방식으로 좁힐 것) + 배지/승격 판별식 일원화
- edit_session_versions/edit_histories 프로덕션 0행 — 서버측 버전 이력 부재(로컬 백업이 유일 복구원). 별도 개선 후보
- 8/14 등록 caseBind 미설정(D-4 계약과 상이) 오너 확인, cover VALIDATE 경고(SPINE_PARAMS_UNRESOLVED·base14 폰트) 관찰

---

## 2026-08-21 크롬 직접 제어 라이브 재검증 (실주문 경로)

프로덕션 alias=nk9ufggbp(746d182 빌드) 확인 후, 북모아 관리자 로그인 크롬으로 실플로우 검증:
- **셀프편집 진입**(동화책 하드커버 210x210, arg=msy60x89oetj → 표지 파일→디자인 요청→셀프편집 체크) → 새 세션 7284848768894 생성, 편집기 오버레이 로드
- ✅ 표지 flat-spread **496×276 정상**(247.4|1.2|247.4 라벨·재단선·책등선), 상태 "저장됨", 모양컷 메뉴 부재
- ✅ **닫기→편집기 열기 재진입**: 동일 세션 복원, 표지 비율·가이드 정상, **복원 배너 미노출**, 시드 페이지 정상 (DB 실측: 세션 draft·canvas_data NULL=무편집 자동저장 미발화 — 설계 정합)
- ✅ 게스트 /embed(207c458f): 표지 정상, 내지 페이지1 정상 렌더+텍스트 추가 동작(에러 0), 텍스트 썸네일 즉시 반영, + 추가 즉시 표시, dirty 시 beforeunload 가드
- ⚠️ 제약: 크롬 확장이 **cross-origin iframe 내부 클릭 불가** → 편집완료·16p 추가·업로드(네이티브 파일피커)는 실기 미검증(코드·테스트 근거로만). 재진입 로드가 ~30s+ 소요(9캔버스 시드) — 성능 관찰 항목
- 잔여 정리: bookmoa 장바구니 #1 "그림책·동화책 하드커버(A4)"는 검증 중 생성된 테스트 항목 — 오너 삭제 권장. draft 세션 7284848768894 무해
