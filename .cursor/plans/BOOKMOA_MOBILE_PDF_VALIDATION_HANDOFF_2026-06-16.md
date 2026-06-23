# 작업지시문 — bookmoa-mobile: PDF 검증 결과 노티 + 인쇄 미리보기 모달

> 대상: bookmoa-mobile 개발팀 · 작성: Storige 백엔드(2026-06-16) · 정본 위치: storige `.cursor/plans/`
> Storige 백엔드 작업은 완료(로컬 커밋 `ec51f2c`/`952465a`/`7bd8ab0`). **배포 후** 본 지시문대로 프론트 연동.

---

## 1. 목적 / 분담

bookmoa-mobile 주문화면(`?page=prodConfigure&arg=...`) 하단 **파일 업로드(표지/내지 PDF)** 영역에서, 첨부 PDF를 업로드하면:
1. Storige가 자동 검증한 결과를 **모달①(검증 결과 노티)** 로 표출
2. 내지 검증 통과 시 **모달②(인쇄 임포지션 미리보기)** 로 펼침면 순서 확인
3. 검증 통과(또는 경고 동의)해야 **장바구니 담기** 활성

| 영역 | 담당 |
|---|---|
| 검증 로직·경고 생성·임포지션 계산 API | ✅ Storige 백엔드(완료) |
| 모달① / 모달② **UI 구현 + 표시맵 + 워크플로우 배선** | ⬅ **bookmoa-mobile (본 지시문)** |

기존 업로드 카드(표지/내지 PDF, 상태뱃지 "대기")와 "파일 검증 결과를 확인해야 장바구니에 담을 수 있습니다" 게이트는 그대로 두고, 그 위에 모달 2종을 얹습니다.

---

## 2. 워크플로우

```
[표지/내지 PDF 업로드 버튼]
   → 업로드 → 카드뱃지: 대기 → 검증 중 → (통과 🟢 / 경고 N 🟡 / 오류 N 🔴)
   → 카드의 "검증 결과 보기" → 모달① (검증 결과 노티)
        · 오류 있음 → 장바구니 잠금 유지, [다시 업로드] / 자동수정 가능 항목은 [자동 보정]
        · 경고만   → "확인 후 진행" 체크 → 통과 처리
   → (내지, 통과 후) 카드의 "인쇄 미리보기" → 모달② (임포지션 미리보기)
        · [순서가 맞습니다] 확인
   → 모든 업로드 파일 통과/동의 → [장바구니 담기] 활성
```

---

## 3. 모달① — 검증 결과 노티

### 3.1 데이터 소스
검증 결과는 Storige `ValidationResultDto` 형태로 내려갑니다(기존 업로드 카드가 이미 받고 있는 그 결과 — 모달은 동일 데이터를 풍부하게 렌더만 하면 됨):

```jsonc
{
  "isValid": false,                 // true면 통과(에러 0)
  "errors":   [ ValidationItem... ],// 주문 차단(빨강)
  "warnings": [ ValidationItem... ],// 확인 후 진행(노랑)
  "metadata": {
    "pageCount": 12,
    "pageSize": { "width": 257, "height": 364 },  // mm
    "hasBleed": true, "bleedSize": 1,
    "colorMode": "CMYK",
    "resolution": 118,              // 최소 유효 DPI
    "imageCount": 9,
    "hasSpotColors": true, "spotColors": ["PANTONE 185 C"],
    "hasTransparency": false, "hasOverprint": false,
    "fontCount": 5, "hasUnembeddedFonts": true, "unembeddedFonts": ["Arial","MyFont"],
    "spreadInfo": { "isSpread": false, "detectedType": "single", ... }
  }
}
// ValidationItem = { code, message, details?, autoFixable, fixMethod? }
```

> 결과 전달 경로는 기존과 동일(검증 콜백 webhook / 세션·잡 상태 조회). 상세는 `docs/PDF_VALIDATION_API.md` 참조. 모달은 이미 수신 중인 결과를 그대로 사용.

### 3.2 UI (모바일 주문화면 폭 기준)
- **상단**: 파일명 + 종합 상태 칩(🔴 오류 N / 🟡 경고 N / 🟢 통과)
- **메타 스트립**: 페이지 · 작업사이즈(mm) · 컬러 · 최소 해상도(metadata에서)
- **섹션(심각도순)**: 🔴 주문 차단 → 🟡 확인 후 진행 → 🟢 통과(접힘)
- 각 항목: `message`(고객문구) + `details`(기대 vs 실제, 칩/표) + `autoFixable===true`면 **[자동 보정]** 버튼(아래 3.4)
- **푸터**:
  - 에러 ≥ 1: `[다시 업로드]`, 장바구니 잠금 유지
  - 에러 0 & 경고 ≥ 1: ☑ "위 경고를 확인했고 그대로 진행합니다" → `[확인하고 진행]`
  - 통과: `[인쇄 미리보기]`(내지) 또는 `[완료]`

### 3.3 코드 표시맵 (★ 반드시 추가)
모달은 아래 `code` → (심각도·라벨)로 렌더. **★ 표시는 이번에 신규 추가된 코드** — bookmoa 표시맵에 없으면 노출이 안 되니 꼭 추가:

| code | 종류 | 라벨(예시) | details 렌더 |
|---|---|---|---|
| `SIZE_MISMATCH` | 🔴 에러 | 페이지 크기 불일치 | expected.withBleed/withoutBleed vs actual (mm) |
| `SPINE_SIZE_MISMATCH` | 🔴 에러 | 책등 크기 불일치 | expected.totalWidth/spine vs actual |
| `PAGE_COUNT_INVALID` | 🔴 에러 | 페이지 수 규격 오류 | expected(4배수 등) vs actual |
| `PAGE_COUNT_EXCEEDED` | 🔴 에러 | 페이지 수 초과 | expected max vs actual |
| `SADDLE_STITCH_INVALID` | 🔴 에러 | 사철 4배수 위반 | suggestion |
| `POST_PROCESS_CMYK` | 🔴 에러 | 후가공 CMYK 사용 | signatures |
| `FILE_TOO_LARGE` / `FILE_CORRUPTED` / `UNSUPPORTED_FORMAT` | 🔴 에러 | 파일 오류 | — |
| `PAGE_COUNT_MISMATCH` | 🟡 경고 | 주문 페이지수와 다름 | expected vs actual |
| `BLEED_MISSING` | 🟡 경고 | 재단 여백 없음 | expected mm |
| `RESOLUTION_LOW` | 🟡 경고 | 저해상도 이미지 | minAcceptableDpi(150)·recommendedDpi(300)·lowResImages[] |
| `CMYK_STRUCTURE_DETECTED` | 🟡 경고 | CMYK 확인 필요 | signatures |
| `TRANSPARENCY_DETECTED` / `OVERPRINT_DETECTED` | 🟡 경고 | 투명도/오버프린트 | pages |
| `MIXED_PDF` | 🟡 경고 | 표지/내지 혼합 규격 | — |
| `CENTER_OBJECT_CHECK` | 🟡 경고 | 사철 중앙부 확인 | — |
| ★ `FONT_NOT_EMBEDDED` | 🟡 경고 | 미임베딩 폰트 | `unembeddedFonts: string[]`(칩), `fontCount` |
| ★ `SPOT_COLOR_DETECTED` | 🟡 경고 | 별색 사용 | `spotColorNames: string[]`(칩), `count` |
| ★ `MIXED_PAGE_ORIENTATION` | 🟡 경고 | 세로/가로 혼재 | `portraitCount`,`landscapeCount`,`minorityPages: number[]` |
| ★ `ORIENTATION_MISMATCH` | 🟡 경고 | 주문 방향과 불일치 | `expected`,`mismatchPages: number[]`,`total` |
| ★ `ODD_PAGE_COUNT` | 🟡 경고 | 홀수 페이지(짝수책 권장) | `actualPages`,`suggestion` |

> 미등록 `code`는 회색 일반 경고로 graceful 폴백 권장(향후 코드 추가 대비).

### 3.4 자동 보정 (`autoFixable===true`)
일부 에러는 `fixMethod`(`resizeWithPadding`/`extendBleed`/`addBlankPages`/`adjustSpine`)를 가집니다. `[자동 보정]` → Storige 자동수정 잡 호출(해당 플로우 별도, 본 지시문 범위는 버튼 노출까지). 신규 경고 3종(폰트·별색·방향·홀수)은 모두 `autoFixable:false`(원본 파일 수정 필요).

---

## 4. 모달② — 인쇄 임포지션 미리보기 (내지)

### 4.1 API 계약 (Storige 신규)
```
GET https://api.papascompany.co.kr/api/edit-sessions/{sessionId}/imposition-preview
      ?startSide=right        # 선택: 'right'(우수, 기본) | 'left'(좌수). 그 외 값은 'right'로 정규화
      &binding=saddle         # 선택: 제본 override. 미지정 시 세션 metadata.binding(없으면 'perfect')
헤더:  X-API-Key: <bookmoa-mobile editor 키>   # 위치: storige CLAUDE.local.md §5 (값 비공개)
```
- `{sessionId}`: UUID. 형식위반 400 · 미존재 404 · 키오류 401.
- 부수효과 없는 GET → 폴링 안전.

**응답 200 (썸네일 준비됨, 우수 8p 예시):**
```jsonc
{
  "ready": true,
  "pageImageUrls": ["/storage/render-pages/<jobId>/page-1.png", "...(총 8개)"],
  "resolution": 150,
  "layout": {
    "startSide": "right",
    "seamlessFold": false,         // 사철이면 true
    "totalPages": 8,
    "spreads": [
      { "index": 0, "left": null, "right": 1 },   // 1p 단독 우측
      { "index": 1, "left": 2, "right": 3 },
      { "index": 2, "left": 4, "right": 5 },
      { "index": 3, "left": 6, "right": 7 },
      { "index": 4, "left": 8, "right": null }     // 마지막 빈면
    ]
  },
  "bindingType": "perfect"
}
```
**응답 200 (썸네일 미생성, 좌수+사철 예시):** `ready:false`, `pageImageUrls:[]`, `resolution:null`, `layout`은 그대로 채워짐(페이지수 알면), `reason:"썸네일 미생성: 업로드/렌더 대기"`.

### 4.2 렌더링 규칙
- 펼침면 = `layout.spreads[]` 순회. 각 `spread`의 `left`/`right`는 **1-기반 페이지 번호** → 이미지 = `pageImageUrls[번호 - 1]`. **`null` 칸은 빈면**(이미지 없이 placeholder).
- URL은 상대(`/storage/...`) → origin(`https://api.papascompany.co.kr`) prefix 후 로드.
- `startSide` 토글(우수/좌수) 제공 → 다시 호출하거나 클라이언트 재계산. 기본 우수.
- **`seamlessFold===true`(사철)**: 좌/우 면 사이 거터(여백) 없이 **연속**으로 이어붙여 렌더.
- `ready:false`면 레이아웃 칸/placeholder만 그리고, 잠시 후 재조회(썸네일은 업로드 시 RENDER_PAGES 잡이 생성하면 `ready:true`로 전환).

### 4.3 UI
- 안내 배너: "1페이지는 오른쪽 단독, 이후 좌·우 펼침면으로 인쇄됩니다." (사철은 "펼침면이 매끄럽게 연결됩니다.")
- 우수/좌수 세그먼트 토글(자동 감지값 기본)
- 펼침면 그리드(빈면|1 / 2|3 / 4|5 …)
- 푸터: `[닫기]` · `[순서가 맞습니다]`

---

## 5. ⚠️ 사전 고지 (Tier 2 — 별도 협의 후)

다음은 아직 **미적용/이연** 항목. 적용 시점은 bookmoa와 협의:
1. **검증 엄격화(큐 병합 버그 수정)**: 현재 외부 검증 잡이 사이트/상품 기본값 일부를 누락해 **느슨하게** 통과합니다. 이를 정상화하면 검증이 의도대로 엄격해져 **기존에 통과하던 일부 PDF가 새로 경고/오류**가 날 수 있습니다 → 배포 타이밍 사전 합의 필요.
2. **방향 검사 활성화**: 검증 잡 `orderOptions.expectedOrientation`(`'portrait'|'landscape'`)를 bookmoa가 보내면 `ORIENTATION_MISMATCH`가 활성화됩니다(미전송 시 `auto`=혼재만 경고). 상품의 의도 방향을 보낼지 결정 필요.

---

## 6. 배포 의존성

- 본 지시문의 신규 엔드포인트(`/imposition-preview`)·경고 코드 5종은 **Storige API+Worker 배포 후** 사용 가능. 현재 로컬 커밋만 되어 있고 **배포는 오너 승인 대기**.
- 배포 완료 통지 후 bookmoa 연동 착수 권장(그 전엔 코드 작성·목업까지).
- 인증 키: bookmoa-mobile editor 키(이미 발급, storige `CLAUDE.local.md §5`). 신/구 키 cutover 상태 확인.

---

## 7. 체크리스트 (bookmoa-mobile)
- [ ] 검증 결과 모달① — 코드 표시맵(§3.3, 신규 5종 포함) + 심각도 분기 + autoFixable 버튼
- [ ] 경고-동의 → 통과 처리 → 장바구니 게이트 해제 배선
- [ ] 임포지션 모달② — `GET /imposition-preview` 연동 + 펼침면 렌더(§4.2 규칙) + 우수/좌수 토글 + 사철 연속
- [ ] `ready:false` 폴링 + placeholder
- [ ] 미등록 code graceful 폴백
- [ ] (협의 후) `expectedOrientation` 전송 여부 결정
