# 블리드 / 재단선 마커 / 고객업로드 임포지션 기능 (편집사이즈 carry 인쇄)

> 디지털인쇄 데이터 무결성: 편집기 디자인의 **블리드를 PDF로 carry** 하고, 재단선 마커·검증·고객 업로드 정규화를 정합되게 처리. 오너(papas) 확정 스펙 기반. 2026-06-10 착수.

## 1. 용어 / 모델 (오너 확정)

| 용어 | 정의 |
|---|---|
| **재단사이즈(trim)** | 최종 잘리는 크기. 관리자 '판형' = trim (templateSet.width/height). |
| **블리드(bleed)** | 재단선 밖 여백. **사방(per-edge) mm**, 상품별 가변(0·1·1.5·2·3 …). |
| **작업사이즈(=편집사이즈, work)** | trim + 블리드×2 (마주보는 두 변). 예: 210×297 + 사방3 → 216×303. |
| **재단선 마커(crop marks)** | PDF 코너에 찍는 재단 위치 표시. |

규칙:
- 블리드>0 & 재단선표기 ON → **작업사이즈 PDF + 코너 마커**(편집화면 점선은 PDF 제외) + TrimBox(재단)/BleedBox(작업).
- 재단선표기 OFF → 작업사이즈 출력, 마커 없음.
- 블리드=0 → **제작(재단)사이즈 그대로, 마커 없음**(재단선 수작업).
- 고객 내지 업로드: 워커가 trim·work 사이즈를 주문플로우에서 받아 **중심점 기준** — 동일(±허용오차)→패스스루, 블리드없음&큼→이너핏(비율유지 축소), 작음→중앙정렬(무축소). 가짜 블리드 자동생성 안 함.
- 허용오차: 작업사이즈 **±0.2mm 기본**, 상품별(template_sets) 설정.

## 2. ⚠️ 핵심 기하 — cutSize 의미체계 (정합 주의)

- 편집기 워크스페이스 = `size.width + cutSize`(WorkspacePlugin). cutBorder(재단선) = `workspace - mmToPxDisplay(cutSize)` = size.width(trim), 중앙정렬 → **각 변 cutSize/2 inset**.
- 즉 **현재 cutSize = 양변 합(total bleed)**, 한 변 블리드 = cutSize/2.
- 워커 `addBleedToPdf(bleed)` 는 **각 변에 bleed**(=per-edge). 검증도 `+bleed*2`.
- **정합 규약(확정)**: 신규 `bleedMm` = **사방(per-edge)**. → 편집기 `cutSize = bleedMm*2` 로 배선해야 편집기·워커가 동일 작업사이즈. (P3에서 배선; 기존 데이터 cutSize 점검 필요 — [[reference_coordinate_convention]] 참조.)

## 3. 단계별 진행

| 단계 | 내용 | 상태 |
|---|---|---|
| **P1 데이터모델+배선** | template_sets.bleed_mm/crop_mark_enabled/size_tolerance_mm + 엔티티·DTO·service·마이그레이션; edit-sessions→orderOptions(bleedMm/cropMarkEnabled/sizeToleranceMm + trimSize/workSize) 주입; worker-jobs 전역기본 머지; admin 폼; worker 인터페이스 optional 수신. **검증/출력 무변경.** | ✅ **완료·배포** (`771c3af`, 마이그레이션 적용·API/worker 재배포·admin Vercel) |
| **P2 편집기 화면 가이드** | 재단선 점선(기존) + 코너 마커(createOrUpdateCropMarks, cutSize>0, excludeFromExport) + 재단선 이탈 경고(objectOutOfTrim→useObjectOutOfTrimToast). **전부 화면전용, 출력 무변경.** | ✅ **완료·배포** (`4267482`, editor Vercel). 단품(cutSize>0) 세션 시각검증 권장 |
| **P3 편집기 PDF 출력** | ServicePlugin: 블리드>0 시 **작업사이즈 페이지+viewBox**(블리드 미클립) + 코너 마커(점선 제외) + jsPDF TrimBox/BleedBox(2.5.2 지원). cutSize=bleedMm*2 배선. **상품별 opt-in 플래그(기본 off → 기존 trim 출력 유지)**. | ⏸ **미착수(고위험·전상품)** — opt-in 게이팅 필수 + 실주문 PDF 검증(mutool/pdfinfo로 MediaBox/TrimBox 확인) |
| **P4 워커 고객업로드** | getPdfInfo 실측화(현 하드코딩 A4) + 중심 임포지션(passthrough/innerfit/center) + 작업사이즈±허용오차 검증(현 1mm 하드코딩→sizeToleranceMm). **passthrough 기본** 안전. | ⏸ **미착수(고위험)** — 스테이징 회귀(기존 통과 PDF가 0.2mm로 실패하는지) + 골든파일 검증 |

## 4. P3/P4 안전 배포 원칙
- **P3**: templateSet `crop_mark_enabled`(+ 별도 opt-in 의미)로 게이팅. 미지정 상품은 **현행 trim 출력 그대로** → 전 상품 동시변경 회피. 가장 위험한 단일 변경(ServicePlugin page/viewBox/clipPath) — 중앙원점 정합([[reference_coordinate_convention]]) 깨지지 않게.
- **P4**: 변환은 **mode 기본 passthrough**(동일사이즈→무가공=현 효과와 동일). 검증 허용오차는 **1mm→0.2mm 단계 인하**(스테이징 회귀 측정 후). getPdfInfo 실측화는 메타 정확화(판정 동작은 단계 분리).
- 배포순서: P1(완료) → P2(완료) → P4(worker, 스테이징) → P3(editor, opt-in, 실주문).

## 5. 핵심 파일
- 편집기/canvas-core: `WorkspacePlugin.ts`(워크스페이스·cutBorder·cropMarks·objectOutOfTrim), `ServicePlugin.ts`(_createMultiPagePDF ~653/668/720/852-877, P3), `useWorkSave.ts`(표지/내지 저장), `useCoverRegion.ts`(토스트).
- 워커: `pdf-converter.service.ts`(99-134), `pdf-validator.service.ts`(377-423), `ghostscript.ts`(getPdfInfo 235·addBleedToPdf 103·resizePdf 146), `config/validation.config.ts`.
- API: `template-set.entity.ts`·`dto`·`template-sets.service.ts`·`edit-sessions.service.ts`(createValidationJobs)·`worker-jobs.service.ts`(merge).
- admin: `TemplateSetForm.tsx`.
- 마이그레이션: `apps/api/migrations/20260610_add_bleed_cropmark_tolerance.sql`.
