# v1 인쇄 워크플로우 — Pilot 운영 검증(GA) 체크리스트

> **기준일**: 2026-05-20  
> **전제**: Phase 1~8 코드·문서·운영 배포 완료 (`c48e21e` HEAD).  
> **목적**: 운영 환경에서 수동 검증 후 Pilot 오픈 여부 판정.

---

## 0. 자동 스모크 (선택, 터미널)

```bash
curl -s https://api.papascompany.co.kr/api/health | python3 -m json.tool
# 기대: "status": "ok"

curl -s -o /dev/null -w "%{http_code}\n" https://editor.papascompany.co.kr/
curl -s -o /dev/null -w "%{http_code}\n" https://admin.papascompany.co.kr/template-sets
curl -s -o /dev/null -w "%{http_code}\n" https://bookmoa-mobile.vercel.app/
# 기대: 모두 200
```

**2026-05-20 확인**: API ok, Editor/Admin/bookmoa-mobile 모두 200.

---

## 1. 사전 준비 (필수, ~30분)

### 1-A. Storige Admin — 템플릿·매핑

| # | 작업 | URL |
|---|---|---|
| 1 | 로그인 | https://admin.papascompany.co.kr |
| 2 | 템플릿셋 확인/생성 | `/template-sets` — 예: `sample-8x8-book-24p` |
| 3 | 면지/표지 설정 (Phase 3) | 템플릿셋 편집 → 면지 개수, 표지 편집가능, (선택) 레더커버 미리보기 |
| 4 | 상품-템플릿셋 매핑 | `/product-template-sets` — **sortcode**, **stanSeqno** 기록 |

**기록할 값** (bookmoa에 입력):

```
sortcode: _______________
stanSeqno: _______________
templateSetId: _______________
templateSetName: _______________
```

### 1-B. bookmoa-mobile Admin — 상품 연결

| # | 작업 | URL |
|---|---|---|
| 1 | 로그인 | https://bookmoa-mobile.vercel.app → Admin (`admin@bookmoa.com`) |
| 2 | 커스텀 상품 편집 | Storige 편집기 사용 ON |
| 3 | 1-A 값 입력 | sortcode, stanSeqno, 템플릿셋 조회 → 저장 |
| 4 | (선택) coverEditable OFF + 미리보기 이미지 | F 시나리오용 |

### 1-C. Vercel env (bookmoa-mobile)

Production에 등록 여부 확인:

- `STORIGE_API_BASE`
- `STORIGE_API_KEY`
- `STORIGE_EDITOR_URL`
- `STORIGE_WEBHOOK_URL`
- `STORIGE_WEBHOOK_VERIFY_HEADER`
- `SUPABASE_SERVICE_ROLE_KEY`

---

## 2. Track A — Storige Admin (Phase 3)

| # | 시나리오 | 기대 | 결과 |
|---|---|---|---|
| A1 | 템플릿셋 저장 후 reload | 면지/표지/레더 설정 유지 | ☐ |
| A2 | Template type `endpaper` 선택 | 라벨·저장 정상 | ☐ |
| A3 | ProductTemplateSetList | 면지 요약·레더커버 배지 표시 | ☐ |

---

## 3. Track B — Storige Editor (Phase 4~6)

| # | 시나리오 | URL/동작 | 기대 | 결과 |
|---|---|---|---|---|
| B1 | 샘플 진입 | https://editor.papascompany.co.kr/ | 로드·캔버스 정상 | ☐ |
| B2 | 게스트 세션 | 비로그인 진입 | guestToken 발급(네트워크/DB) | ☐ |
| B3 | PDF 내지 첨부 | 책자 모드 → 첨부 버튼 | 업로드→검증→passed/failed UI | ☐ |
| B4 | 레더 커버 | coverEditable=false 템플릿셋 | 미리보기만, 편집 차단 | ☐ |
| B5 | 내 작업 | `/my-works` | 목록 또는 빈 상태(로그인 시 목록) | ☐ |
| B6 | SPA 라우트 | `/template?templateId=...` 직접 URL | 404 없음 | ☐ |

---

## 4. Track C — bookmoa-mobile (통합 E2E)

상세: [`bookmoa-mobile/docs2/storige_phase3_ui_체크리스트.md`](../../Documents/claude/bookmoa-mobile/docs2/storige_phase3_ui_체크리스트.md)  
확장: [`bookmoa-mobile/docs2/storige_phase3_4_smoke_checklist.md`](../../Documents/claude/bookmoa-mobile/docs2/storige_phase3_4_smoke_checklist.md)

| # | 시나리오 | 기대 | 결과 |
|---|---|---|---|
| C-A | 템플릿셋 조회 | 드롭다운·저장 | ☐ |
| C-B/C | 400 / 빈 결과 | toast·400 | ☐ |
| C-D | 보안 | API Key 노출 없음 | ☐ |
| C-E | 저장 영속성 | 새로고침 후 유지 | ☐ |
| C-F | 레더 커버 placeholder | ProdConfigure | ☐ |
| C-G | Cart/Orders 검증 UI | failed/fixable 일관 | ☐ |
| C-H | 24h 배너 | EditorHost 상단 안내 | ☐ |
| C-I | 내 디자인 | `/myDesigns` — **로그인 후 세션 목록** (Phase 7 연동) | ☐ |
| C-J | 편집기 열기 | iframe 로드, complete 시 fileId | ☐ |
| C-K | PDF 업로드·검증 | passed/fixable → 장바구니 가능 | ☐ |
| C-L | editor.needAuth | 게스트 완료 → 로그인 유도 → migrate | ☐ |
| C-M | 주문·결제 후 | orderSeqno 반영, webhook 상태 | ☐ |
| C-N | compose-mixed 완료 | Orders에 PDF 링크 (워커 완료 후) | ☐ |

### C-J~K 파일 업로드 (핵심 Pilot)

1. ProdConfigure 또는 Configure에서 표지/내지 PDF 선택  
2. Network: `/api/storige/files/upload` → 201  
3. `/api/storige/validate` → jobId  
4. `/api/storige/job-status` polling → passed 또는 fixable  
5. 장바구니 담기 성공  

---

## 5. Track D — PHP 레거시 회귀 (선택, 코드 변경 없음)

기존 PHP 쇼핑몰은 **당장 수정 불필요**. 운영 중 PHP 주문 1건으로 아래만 확인:

참고: [`docs/PHP_NOTICE_2026-05-19_pdf_attach_endpapers.md`](../docs/PHP_NOTICE_2026-05-19_pdf_attach_endpapers.md) §9

| # | 확인 | 결과 |
|---|---|---|
| D1 | shop-session → 200 | ☐ |
| D2 | validate/external → 201 | ☐ |
| D3 | synthesize/external → 201 | ☐ |
| D4 | webhook synthesis.completed | ☐ |
| D5 | PHP .env 변경 없음 | ☐ |

---

## 6. Pilot 판정 기준

### GO (Pilot 오픈)

- Track A: A1~A3 전부 PASS  
- Track B: B1, B3, B5 PASS (B2/B4는 설정에 따라 스킵 가능)  
- Track C: C-A, C-D, C-E, C-J, C-K PASS  
- 치명적 보안 이슈 없음 (API Key 클라이언트 노출 등)  
- Track D: 기존 PHP 1건 이상 정상 (PHP 사용 중인 경우)

### NO-GO (핫픽스 후 재검증)

- 편집기 iframe 미로드  
- PDF 검증 후 장바구니 게이트 오동작  
- webhook 미수신으로 주문 상태 영구 pending  
- Admin 템플릿셋 저장 실패  

---

## 7. 실패 시 보고 (에이전트 전달용)

```
Pilot GA 실패 보고
- 시나리오 ID: (예: C-K)
- URL:
- 재현 순서:
- Network: (요청 URL, status, response 일부)
- Console:
- 스크린샷:
- sortcode/stanSeqno/templateSetId:
```

**Claude** (storige API/Worker/Editor) vs **Codex** (bookmoa-mobile) 구분해서 전달.

---

## 8. GA 완료 후 다음 단계

| 결과 | 액션 |
|---|---|
| GO | v2 범위 선택 (JumboCard / card imposition / Group B polish) |
| NO-GO | 실패 시나리오만 핫픽스 → 부분 재검증 |
| PHP만 이슈 | bookmoa와 분리, PHP_NOTICE §9 기준 점검 |

---

## 9. 실행 기록 (사용자填写)

| Track | 완료일 | PASS | FAIL | 메모 |
|---|---|---|---|---|
| 사전 준비 1-A/B | | | | |
| A Admin | | | | |
| B Editor | | | | |
| C bookmoa | | | | |
| D PHP 회귀 | | | | |
| **판정** | | GO / NO-GO | | |

---

## 10. 참고 문서

| 문서 | 용도 |
|---|---|
| [RESUME_PROMPT_2026-05-20.md](../.cursor/plans/RESUME_PROMPT_2026-05-20.md) | v1 완료 스냅샷 |
| [PHP_NOTICE_2026-05-19](../docs/PHP_NOTICE_2026-05-19_pdf_attach_endpapers.md) | API·webhook·needAuth 명세 |
| [storige_phase3_ui_체크리스트](../../Documents/claude/bookmoa-mobile/docs2/storige_phase3_ui_체크리스트.md) | bookmoa A~E |
| [templateset_page_workflow.md](../docs/templateset_page_workflow.md) | v1 전체 Phase 정의 |
