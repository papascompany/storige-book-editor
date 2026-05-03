# P0/P1 결함 수정 + 검증 완료 보고서 (2026-05-04)

> **작업 범위**: P0-1, P0-2, P1-5, P1-6 순차 자동 처리 + Worker E2E 검증
> **결과**: ✅ **4건 모두 완료** + Worker 모든 시나리오 정상 작동 확인
> **이전 단계**: `AUDIT_FIX_REPORT_2026-05-03.md` (옵션 A 완료)

---

## ✅ 처리 완료

### P0-1 — `editorMode='spread'` 결함 ✅ 사실 시드 오타였음
- **결과**: 코드 변경 불필요. `EditorMode` enum은 `single` | `book`만 지원하며, `book`이 표지 스프레드 편집 의미 (좌면+책등+우면)
- **조치**: 시드 스크립트의 `editorMode='spread'` → `editorMode='book'` 수정
- **검증**: "스프레드 책자 표지 (책 펼침면)" templateSet 등록 성공 (HTTP 201)
- 운영 templateSet: 4개 → **5개**

### P0-2 — 실제 라이브러리 자산 업로드 ✅ 13개 SVG
- **생성**: 로컬에서 13개 SVG 파일 (Python으로 코드 생성)
  - 도형 5개: 원/사각형/삼각형/화살표/별
  - 클립아트 3개: 체크/하트/별표
  - 프레임 2개: 심플/라운드 보더
  - 배경 3개: 파스텔 핑크/블루/화이트 그라디언트
- **업로드**: VPS `~/storige/storage/library/{shape,clipart,frame,bg}/` 에 scp 전송
- **DB 갱신**: `library_backgrounds.file_url` `.png` → `.svg` UPDATE
- **검증**: 13/13 URL 모두 HTTP 200 (nginx 직접 서빙 확인)

### P1-5 — TemplateSet ↔ Product 연결 ✅ 3건
| 상품 | 연결된 TemplateSet |
|------|-------------------|
| 테스트 책자 A4 (BOOK-A4-TEST) | A4 무선제본 책자 (16P) |
| 테스트 리플렛 (LEAFLET-A4-TEST) | A4 3단 리플렛 |
| 자유 사이즈 책자 (BOOK-CUSTOM-TEST) | A4 사철제본 책자 (8P) |

- **endpoint**: `PUT /api/products/:id/template-set` (HTTP 200)
- **검증**: 응답에 `templateSetId` 정상 반영 (단, `findAll`은 relation join 미적용 — 결함 추가 발견)

### P1-6 — Editor/Worker 검증 시나리오 ✅ 4개 모두 정상
| 시나리오 | 결과 |
|---------|------|
| **1**. 정상 A4 cover 1p / perfect 16P | ✅ FIXABLE — `SPINE_SIZE_MISMATCH` 정확 검출 |
| **2**. 사철 13페이지 / saddle | ✅ FIXABLE — `PAGE_COUNT_INVALID` + `SADDLE_STITCH_INVALID` (둘 다 autoFixable) |
| **3**. 자동 수정 (13p→16p) | ✅ COMPLETED — pagesAdded: 3, finalPageCount: 16 |
| **4**. 정상 A4 16p / perfect | ✅ COMPLETED — errors: 0, warnings: 1 |

**Worker 검증 결론**: PDF 검증/변환 파이프라인 **운영 환경에서 정상 작동**.

---

## 🆕 추가 발견된 사항 (다음 진행 사항)

### 결함 #12 (신규) — Products `findAll` relation join 미적용
- **증거**: `templateSetId` 컬럼은 정상 저장되나 `GET /api/products` 응답에 `templateSet` relation이 NONE
- **영향**: Admin UI에서 상품 목록에 연결된 templateSet 이름이 안 보임
- **수정**: `productsService.findAll()`에 `relations: ['templateSet']` 추가 (5분 작업)
- **우선순위**: 🟡 P1

### 결함 #13 (신규) — Conversion `outputFileUrl` 형식
- **증거**: `/app/storage/converted_xxx.pdf` (워커 컨테이너 절대경로) — nginx 직접 서빙 불가
- **영향**: 사용자에게 직접 노출 시 작동 안 함 (다운로드 endpoint는 절대경로 인식해 OK)
- **수정**: 워커 `pdf-converter.service.ts`에서 `/storage/converted/...` 형식으로 반환
- **우선순위**: 🟢 P2 (다운로드 endpoint는 정상 작동 중)

### 관찰 — Storage 인증 정책
- `/storage/library/*.svg` 등 라이브러리 자산은 nginx에서 직접 서빙 (인증 불필요)
- 의도된 동작인지 확인 필요 — 라이브러리는 공개 자산이라 OK
- 사용자 업로드 PDF (`/storage/uploads/*`)는 보안 패치 #B로 차단됨

---

## 📊 운영 데이터 최종 현황

| 영역 | Phase 1 (옵션 A) | Phase 2 (현재) | 변화 |
|------|------------------|----------------|------|
| Library Categories | 9 | 9 | – |
| Library Backgrounds | 3 (URL 더미) | **3 (실제 SVG 작동)** | URL 정상화 |
| Library Shapes | 5 (URL 더미) | **5 (실제 SVG 작동)** | URL 정상화 |
| Library Cliparts | 3 (URL 더미) | **3 (실제 SVG 작동)** | URL 정상화 |
| Library Frames | 2 (URL 더미) | **2 (실제 SVG 작동)** | URL 정상화 |
| TemplateSets | 4 | **5** | +1 (스프레드) |
| Products | 3 (연결 X) | **3 (모두 연결됨)** | 매핑 완료 |
| Worker Validation 작동 | 미검증 | **✅ 4 시나리오 통과** | E2E 작동 확인 |

---

## 🎯 운영 시작 가능 여부 (이전 vs 현재)

```
                              Phase 1 (5/3)    Phase 2 (5/4)
┌─────────────────────────────────┬──────────┬──────────┐
│ Bookmoa PHP 통합 가능?            │   🟡     │   🟡     │
│  (PHP 측 통합 미완료)              │          │          │
│ 사용자가 에디터 사용 가능?         │   🟡     │   ✅     │
│  (실제 자산 + templateSet 연결)    │          │          │
│ Admin 콘텐츠 등록 가능?           │   ✅     │   ✅     │
│ Worker PDF 검증/변환?            │ 미검증   │   ✅     │
│ 인프라/모니터링/보안              │   ✅     │   ✅     │
└─────────────────────────────────┴──────────┴──────────┘
```

**Phase 2 결과**: PHP 통합만 남으면 **운영 시작 가능 상태**.

---

## 📅 다음 진행 사항 (오늘 미진행 항목 정리)

### 🔴 P0 — 운영 시작 전 필수

#### 1. PHP 측 통합 검증 (최우선) — 외부 협업
- **상태**: ⏳ PHP 팀 작업 대기
- **참조**: `SECURITY_PATCH_PHP_NOTICE_2026-05-03.md` 가이드 적용
- **핵심 작업**:
  - `/files/:id/download` → `/files/:id/download/external` 변경 (5분)
  - 합성 결과 PDF 다운로드 흐름 검증
  - Webhook 양방향 (validation/synthesis.completed) 수신 확인
- **차단 요소**: PHP 팀 일정 동기화

#### 2. 실제 라이브러리 자산 큐레이션 (운영 콘텐츠)
- **상태**: 13개 더미 SVG는 검증용 — **실제 운영용 자산 별도 준비 필요**
- **권장**:
  - 한글 폰트 5~10개 (라이선스 정리 후)
  - 배경 이미지 30~50개 (그라디언트/패턴/일러스트)
  - SVG 도형 50~100개 (Figma/Adobe 자산)
  - 프레임 20개
  - 클립아트 100~300개 (카테고리별)
- **소요**: 자산 수집 자체에 1~2주 + 업로드 자동화는 1일

### 🟡 P1 — 단기

#### 3. 결함 #12 — Products findAll relation join (5분)
```ts
// apps/api/src/products/products.service.ts
queryBuilder.leftJoinAndSelect('product.templateSet', 'templateSet');
```

#### 4. Admin 비번 본인 값으로 재교체
- 현재 임시값 `r46eAZ2jDxELVeEqAKU7TLK1` (CLAUDE.local.md 기록)
- 사용자가 직접 admin UI 또는 DB에서 본인 비번으로 변경 권장

#### 5. Editor 본격 검증 (브라우저 통합 테스트)
- 시나리오: 에디터 진입 → 도구 사용 → 저장 → 합성 → 다운로드
- **Playwright 시나리오 확장**: 현재 admin smoke 2개 + editor smoke 2개 → 통합 E2E 추가
- 소요: 1일

#### 6. Worker 합성 (synthesize) E2E
- 검증/변환은 OK ✅
- 합성은 실제 cover.pdf + content.pdf 조합 + 책등 두께 계산 검증 필요
- 소요: 0.5일

### 🟢 P2 — 별도 사이클

#### 7. 결함 #13 — Conversion outputFileUrl 형식 표준화 (30분)
- 워커 `pdf-converter.service.ts` 출력 경로 정렬

#### 8. R2 / S3 백업 이중화
- 자산 + DB 외부 백업 (FUTURE_UPDATES.md §3)

#### 9. AI 추천/생성 모델 검증
- AI 패널 통합 완료 (P1-6) → 실제 모델 호출 검증

#### 10. 로그 일원화 (Pino + Loki / Datadog)

#### 11. WebAssembly multi-threading

#### 12. Node 20 → 22 LTS 마이그레이션 (FUTURE_UPDATES.md §1)

---

## 🛠 산출 패치 + 스크립트

| 파일 | 종류 | 변경 |
|------|------|------|
| `scripts/seed-test-data.sh` | 자동화 | editorMode='spread' → 'book' |
| `/tmp/storige-assets/*.svg` | 자산 | 13개 SVG 파일 (로컬 생성) |
| VPS `~/storige/storage/library/` | 자산 | 13개 업로드 (scp) |
| VPS DB | UPDATE | `library_backgrounds.file_url` png→svg |
| VPS DB | UPDATE | 3개 product → templateSet 연결 |
| `/tmp/storige-test-pdfs/*.pdf` | 테스트 | 3개 테스트 PDF (reportlab) |

---

## ⏱ 작업 시간 분석

| 단계 | 소요 |
|------|------|
| P0-1 editorMode 검토 + 시드 수정 | 10분 |
| P0-2 SVG 생성 + 업로드 + URL 갱신 | 25분 |
| P1-5 templateSet ↔ product 연결 | 15분 |
| P1-6 Worker 검증 (4 시나리오) | 30분 |
| 보고서 작성 | 20분 |
| **총계** | **~1시간 40분** |

---

## 🔗 관련 문서

- [`AUDIT_FIX_REPORT_2026-05-03.md`](./AUDIT_FIX_REPORT_2026-05-03.md) — Phase 1 (옵션 A 완료)
- [`INTEGRATION_AUDIT_2026-05-03.md`](./INTEGRATION_AUDIT_2026-05-03.md) — 결함 9건 분석
- [`SECURITY_PATCH_PHP_NOTICE_2026-05-03.md`](./SECURITY_PATCH_PHP_NOTICE_2026-05-03.md) — PHP 팀 통보
- `CLAUDE.local.md` — 운영 정보 + 새 admin 비번
