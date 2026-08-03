# HANDOFF → Storige 팀 · 가로형(방향) 편집 templateSet 생성 요청 (bookmoa R-13, 2026-07-09 · §3 판정 확정 2026-07-14)

> 보내는 쪽: bookmoa(쇼핑몰). 받는 쪽: Storige(편집기·PDF 검증/합성 워커).
> **요약 결론**: bookmoa는 책자상품 **가로형(landscape) 선택**을 이미 구현·배포했습니다(가격 무변경, 치수 W↔H 스왑). **편집기형 상품**에서 고객이 가로형을 고르면 편집기가 **가로 방향 캔버스**로 열려야 하는데, 이를 위해 Storige Admin에 **가로 방향 templateSet 생성**이 필요합니다.
> **[2026-07-14 갱신] §3 갈림길은 (A)로 판정 확정**(Storige 소스 직접 조사 — 아래 §3 근거). 남은 것은 **§4 가로 templateSet 생성 + templateSetId 회신**뿐입니다.

---

## 1. 배경 — 가로형은 "가격"이 아니라 "치수·캔버스 방향" 문제

- bookmoa 책자 가격의 사이즈 의존은 **절수(면적 기반)** 로 귀결 → **회전 불변**. 즉 **A4 세로 210×297 = A4 가로 297×210, 가격 동일**. (가격엔진·서버 재계산 전부 무변경, vitest로 세로=가로 동일가 고정)
- 방향이 실제로 영향을 주는 곳은 셋뿐: **① 편집기 캔버스 방향 ② 업로드 PDF 검증 기대방향 ③ 화면/작업지시서 표기**.
- **②③ 및 업로드형(비편집) 상품은 bookmoa 단독으로 완결**됩니다(치수 스왑만으로 PDF 검증 통과·주문 사양 라벨 기록). → **Storige 작업 불필요**.
- **①(편집기 캔버스)만** Storige 협조가 필요합니다. 현재 가로 선택 시 bookmoa가 가로 치수(width/height 스왑)를 embed로 넘기지만, 세로 templateSet으로 폴백되면 **캔버스는 세로로 열립니다**. 완전한 가로 편집엔 가로 방향 templateSet이 필요하다는 것이 우리 진단입니다(§3에서 확인 요청).

## 2. bookmoa 측 이미 구현·배포된 계약 (참고 — Storige 변경 불필요 부분)

고객이 가로형을 선택하면 bookmoa는 편집기 embed에 아래를 전달합니다:

- **templateSetId** — 가로 선택 시 상품의 `storigeTemplateSetIdLandscape`가 있으면 그것을, 없으면 세로 `storigeTemplateSetId`로 폴백.
  - 코드: `src/pages/ProdConfigure.jsx:668`
    ```js
    templateSetId: (selOrientation === 'landscape' && prod?.storigeTemplateSetIdLandscape) || prod?.storigeTemplateSetId || ''
    ```
- **width / height** — 가로 선택 시 **W↔H를 스왑**한 재단 치수(mm)를 전달.
  - 코드: `src/components/StorigeEditorHost.jsx:277`(templateSetId), `:292-293`(width/height) → `/embed?templateSetId=…&width=…&height=…`
- 운영자는 상품편집기 **'🔄 가로 templateSetId'** 입력란(`ProductEditor.jsx:638`, 저장 필드 `product.storigeTemplateSetIdLandscape`)에 Storige가 회신한 ID를 붙여 넣기만 하면 연결 완료.

즉 **bookmoa는 가로 templateSetId를 소비할 준비가 끝나 있습니다.** Storige는 "가로 방향 templateSet을 만들고 그 ID를 주는 것"만 하면 됩니다.

## 3. ~~먼저 확인해 주세요~~ → **판정 확정: (A)** (2026-07-14, Storige 소스 직접 조사)

편집기 캔버스의 방향은 **templateSet의 width/height가 유일 소스**입니다. embed의 `width`/`height` 쿼리 파라미터는 캔버스 크기·방향을 바꾸지 못합니다.

**근거 (Storige 레포 실측)**:
- `apps/editor/src/views/EmbedView.tsx:82-84,131` — width/height는 `options.size`로만 전달.
- `apps/editor/src/embed.tsx:884-891` — 캔버스 로드(`loadTemplateSetEditor`)에 size 미전달. `options.size`의 소비처는 ① 세션 메타 감사 스냅샷(`:660,678`) ② **방향 불일치 진단**(`:1031-1057` `detectOrientationMismatch` — 비차단 경고·Sentry·`editor.ready` payload) 뿐. 주석(`:211-215`)이 "규격의 권위는 상품 옵션, embed는 규격 변경 차단(S1), 이 값은 감사/검증용"을 명시.
- `apps/editor/src/hooks/useEditorContents.ts:1057-1064,1084-1085` — 워크스페이스 크기 = `templateSet.width/height`. spread(book) 모드도 동일(`:988-994`).
- `apps/api/src/templates/entities/template-set.entity.ts:91-98` — width(기본 210)/height(기본 297) 컬럼만 있고 orientation 전용 필드 없음 → **방향 = width>height 여부**.
- `apps/editor/src/utils/orientationGuard.ts:6-10` — "가로 선택인데 가로 templateSet 미배선 → 세로 폴백" 상황을 **감지만** 하는 가드가 이미 존재(= Storige도 이 구조를 인지).
- 세션 재편집(sessionId)도 세션이 참조하는 templateSet 규격에 고정(`EmbedView.tsx:98-104`, `embed.tsx:707,959-982`).

→ 따라서 **§4 가로 templateSet 생성이 필수**입니다. 생성 경로: Admin UI `apps/admin/src/pages/TemplateSets/TemplateSetForm.tsx`(width/height 입력 `:694,702`) 또는 API `apps/api/src/templates/template-sets.controller.ts:40-48 POST`.

## 4. 가로 templateSet 생성 요청 (§3 (A) 확정으로 필수)

현재 bookmoa에서 **편집기형(booklet + Storige templateSet 연결)** 상품은 아래 2건입니다. 이 중 **운영자가 가로형을 제공하기로 한 상품**에 대해, 기존 **세로 templateSet의 재단 규격을 W↔H 스왑한 가로 방향 templateSet**을 생성하고 그 `templateSetId`를 회신해 주세요. (제본·용지·페이지 제약 등 나머지 스펙은 세로판과 동일, 캔버스만 회전)

| bookmoa 상품 | 상품 id | 세로(현행) templateSetId | 가로 캔버스(요청) | 회신할 가로 templateSetId |
|---|---|---|---|---|
| A4 하드커버 책자 | `mpkte2zbqo5w` | `f0335fda-bf48-47f2-a908-2b2e70e78de8` | A4 가로 **297×210mm** | ✅ `83e6ec80-482b-4cee-a22b-ce1b08af33e0` |
| 교재 및 부교재 | `noriter-14-교재-및-부교재` | `a2cc2939-b76d-41a2-bd41-2d9fba091a24` | 세로판 규격의 **W↔H 스왑** | ✅ `e66588b2-490b-4fea-ac03-44b76b3fb137` |

> 주: 최종 대상 상품 목록은 운영자 결정에 따라 달라질 수 있습니다(위 2건은 현재 templateSet이 연결된 편집기형 전량). 신규 편집기형 상품이 추가되면 동일 방식으로 요청드립니다.
> 주: "캔버스만 회전"이라 해도 **세로 기준으로 디자인된 템플릿 페이지 에셋은 가로 캔버스에 그대로 맞지 않을 수 있습니다** — 에셋을 가로 레이아웃으로 재배치할지, 빈 캔버스(에셋 최소) 가로판으로 시작할지는 Storige 판단에 맡깁니다(bookmoa는 templateSetId만 소비).
> 주: **업로드형(uploadType=general/sheet) 상품은 이 요청 대상이 아닙니다** — 편집기를 타지 않아 치수 스왑만으로 검증이 완결됩니다.

## 5. 수용 기준 (회신 후 bookmoa 검증)

1. 운영자가 상품편집기 '가로 templateSetId'에 회신 ID 입력 → 저장.
2. 고객 화면에서 해당 상품 **가로형 토글 선택** → "셀프편집하기" → 편집기가 **가로 방향 캔버스**로 열림(세로로 열리면 실패).
3. 가로 편집 완료 → 표지/내지 PDF 합성 → 주문 항목에 정상 박제(기존 세로 플로우와 동일).
4. 업로드 PDF 검증(가로형)도 가로 기대방향으로 통과(이미 bookmoa 단독 구현·검증됨).

## 6. 참조

- bookmoa 코드: `src/pages/ProdConfigure.jsx:668`(templateSetId 해석) · `src/components/StorigeEditorHost.jsx:277,292`(embed 파라미터) · `src/admin/ProductEditor.jsx:61,493,638`(가로 templateSetId 입력·저장) · `src/lib/size-dims.js`(`orientDims` W↔H 스왑)
- 설계 문서: `docs/launch/R-13-가로형-방향.md` · 원장 `docs/LAUNCH-QA-LEDGER-2026-06-30.md`(R-13)
- 관련 계약: `docs/HANDOFF_storige_bleed_size_2026-06-15.md`(치수·bleed), `docs/STORIGE_UX_HANDOFF_2026-06-11.md`(embed 파라미터 계약)

---

## 7. [Storige 회신 — 2026-07-14]

§4 요청 세트 2건은 **기존 생성분(2026-07-09)이 그대로 사용 가능**하며, 오늘 판형 규약 정합까지 완료된 상태다:

| bookmoa 상품 | 가로 templateSetId (회신) | 상태 |
|---|---|---|
| A4 하드커버 책자 (`mpkte2zbqo5w`) | `83e6ec80-482b-4cee-a22b-ce1b08af33e0` — "A4하드커버 책자 (가로)" | active, 판형 297×210(2026-07-13 교정), bleed 3 |
| 교재 및 부교재 (`noriter-14`) | `e66588b2-490b-4fea-ac03-44b76b3fb137` — "A4 기본 책자 (가로)" | active, 판형 297×210, bleed 3, crop_mark on |

부가 정합(오늘 배포 d2a925c): 세션 검증 기준값이 templateSet 판형과 정확 W↔H 스왑이면 서버가
정규화하므로, bookmoa가 스왑 치수를 보내는 현행 계약(§2)과 어긋날 일 없음. 방향 오류 PDF는
ORIENTATION_MISMATCH 비차단 경고로 안내됨.

주의(§4 주석 관련): 두 가로 세트는 '빈 표지 + 가로 내지' 구성으로 시작한다 — 표지 아트워크의
가로 레이아웃 저작은 Storige 측 잔여 작업(오너 결정 대기)이며, 하드커버 표지(책등+싸바리) 검증
규칙은 별도 후속 트랙(docs/HARDCOVER_COVER_VALIDATION_NOTES.md).

수용 기준(§5) 검증 순서 권장: 운영자 '가로 templateSetId' 입력 → 가로형 토글 → 셀프편집 →
가로 캔버스 확인 → 완료·합성까지 1회 왕복.
