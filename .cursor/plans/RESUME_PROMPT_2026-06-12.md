# [RESUME] IDML 변환기 보완 사이클 완료 (2026-06-12)

> **선행 문서**: `PROMPT_IDML_CONVERTER_2026-06-12.md` (이 사이클의 시작 프롬프트 — 백로그 정의)
> **이 문서**: 사이클 결과 스냅샷 + 다음 세션 인수인계. 정본 기술 문서는
> `docs/DESIGN_IMPORT_CONVERTER.md`(§13 유형 3종, §12.1 P1 3종) / `docs/IDML_IMPORT_FLOW.md` 갱신 완료.

## 1. 완료 — 전부 라이브 배포·검증됨

### P0: 템플릿 유형 3종 (오너 최우선 — `spreadConfig.conversionMode`)
| 모드 | 의미 | 비고 |
|---|---|---|
| `full` | 전 객체 개별 편집(기존 vector) | |
| `flat-spread` | 텍스트만 편집 + 전폭 300dpi PNG 1장 | **책등 고정**(편집기 가드) |
| `flat-spine` | 텍스트만 편집 + back/spine(3배폭)/front 3분할 PNG | 책등가변 지원 — spine 아트는 scene x≈0 무이동·무스케일, 초과폭은 z-order 은폐(**clipPath 금지** — 직렬화 유실) |

JSON 필드라 마이그레이션 불필요(레거시 미존재=full). admin import UI 3종 선택 + API 검증/보존 병합.

### 라이브 E2E가 발굴한 기존 결함 3종(P1) — 근본 수정
1. **재앵커 오염**: viewport bbox 를 content 엔진에 전달 → `SpreadPlugin.resolveRegionMetaForObject` 정식 API + history meta 보존 + repositionObjects 자가치유.
2. **재편집 spine 오염**: sessionId 단독 진입이 pageCount 무시(10→0.55mm)+무편집 자동저장 → 입력 복원 우선순위(props/URL > 복원 canvasData 배열 > orderOptions > spine 스냅샷) + `isInitializedRef` 자동저장 게이트(⚠️ `useAppStore.ready` 는 게이트로 무효).
3. **패널 마운트 레이스**: ControlBar(280px) in-flow 마운트가 캔버스를 밀어 더블클릭 드래그 오해석 → `PointerShiftGuardPlugin`(매핑 변화 보정, alt-팬 스킵, scale/skew 한계 문서화).

### A 트랙 (변환 충실도)
- **A2+A3**: per-run styles(diff-only) + charSpacing(Tracking 1:1) + lineHeight(Leading/(1.13×pt), auto=1.2em 정합) + textAlign + FontStyle→fontWeight + 세로짜기 자간 환산(오버플로 119.6%→97.4%) + **fabric stylesToArray 갭 병합 몽키패치**(canvas-core — fabric 5.5.2 잠복 데이터 오염, 업그레이드 시 제거 시점을 테스트가 알림).
- **A1**: parseGradients + fabric Gradient(inner 공간 E 합성 — 회전/플립/스케일 자동 정합) + 래스터/미리보기 공통 SVG defs. 텍스트 그라디언트는 검정 대체+경고(보류 — 실건은 LA-383 세로 텍스트 1건). 도형 적용 실표본 0건이라 합성 IDML+픽셀 샘플링으로 검증.
- **A6**: Rectangle rx/ry(요소 단위 재실측 MA 3/LA 1건, pill 비클램프) + 고아 strokeWidth 정리 + 특수 스트로크 감지 경고. dash/cap/alignment/비대칭 코너/A4 약물 회전은 **실표본 0건 — 파싱+경고만**(과잉 구현 금지 판정).
- **A5**: placed 이미지 동반 업로드(다중/패키지 zip, `extractDesignPackage`) → Links 파일명 NFC 매칭 → inner ItemTransform SSOT 크롭 베이크(JPEG 소스는 JPEG q90). admin 매칭 ✓/✗ UI. 미제공 시 플레이스홀더 바이트 동일(하위호환).

### B 트랙 (운영)
- **B4**: 인벤토리 전수(셋 11→8, 템플릿 13→9, 전부 소프트삭제). 정식 셋 `a2cc2939`('A4 기본 책자') 표지를 flat-spine 최신 변환으로 **in-place 갱신**(id 보존 — 외부 연동 불변, 백업 /tmp/b4/). LA-383 신규 등록 `4564f513-…`. 테스트 세션 7건(990611~18) softDelete. 96728f5c 등 중복은 06-10 에 이미 삭제돼 있었음.
- **B3**: admin import 화면 폰트 매칭/시딩 UI(기존 API 재사용 — /library/fonts, /storage/upload, woff2ToTtf). **신규 엔드포인트 0**.

### 검증 수치
- 테스트: indesign-import **43→139**, canvas-core **235→275**, api **93→99**, admin vitest **26**(신설). 회귀 0.
- 라이브 검증 4회(flat-spine 라운드트립+책등가변 / P1 재검증 / A2+A3 styles 왕복 / A5 admin 업로드→/embed 실픽셀).
- 커밋: `7585e38`→`e4eb328`→`a01f3f3`→`8a23f93`→`3639c8b`→`50dc6d7`→`e1fd2f2`→(B3+docs).

## 2. 오너 결정 대기 / 다음 세션 후보

1. **폰트 시딩 실행**: 라이브 폰트 라이브러리 **0건**(편집기 드롭다운 비어 있음). 7종 필요 — Adobe 명조 Std/Myriad/Minion(라이선스 확인 필요), THE명품고딕M, 페이퍼로지, 태나다체, Pretendard ExtraBold. UI 는 준비됨(admin import 화면에서 파일 등록 → 자동 매칭).
2. **신규 진입 기본 pageCount 정책**: 파라미터 없는 /embed 신규 진입은 템플릿 기본 내지수로 spine 재계산(0.55mm) — (a) 재계산 보류 vs (b) pageCountRange 최소값, 택1.
3. **bookmoa 용지코드 매핑**: 호스트가 `mojo100` 류를 넘기면 spine 계산 404 ×101회(콘솔 오염+가변 미동작) — 시드 코드(`mojo_80g` 등)와 합의 필요.
4. **텍스트 그라디언트**(LA-383 실건 1) / **B1 내지 다중페이지 IDML** / **B2 렌더엔진 fabric 통일** — 차기 사이클.
5. 잔여 칩: cross-origin taint 위험(storage 이미지 getImageData — 검증 하네스 한정 가능성, 확인 필요), EN-288 구버전 재가져오기, SpineCalculator 에러 스팸.

## 3. 함정 (코드 만지기 전 — 기존 + 이번 사이클 추가)

기존(PROMPT 문서 §1.5) 전부 유효 + 추가:
- **clipPath 절대 금지**(fabric toJSON 유실) — flat-spine 은 z-order 은폐가 정답.
- 영역 판정은 `SpreadPlugin.resolveRegionMetaForObject` 만(무인자 getBoundingRect = viewport 좌표).
- placed 배치는 inner Image ItemTransform 이 SSOT(FrameFittingOption crop 신뢰 금지).
- 그라디언트 기하는 inner pt 공간에서 합성 후 SSOT 매퍼 사상(캔버스 공간 직접 합성 금지).
- stylesToArray 몽키패치(canvas-core/utils/textStyles.ts)는 fabric 업그레이드 시 재평가(결함 재현 테스트가 핀).
- 자동저장 게이트는 isInitializedRef(useAppStore.ready 는 캔버스 등록 시 이미 true).
