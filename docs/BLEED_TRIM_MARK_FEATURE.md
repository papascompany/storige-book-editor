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
| **P3 편집기 PDF 출력** | ServicePlugin: 게이트 `useEditSize=cropMarkEnabled&&bleedMm>0&&!envelope` ON시 **작업사이즈 page/viewBox**(중앙원점 유지·블리드 미클립) + 코너 마커(`_drawCropMarksAndBoxes`, svg2pdf 후 try/catch) + pageContext.trimBox/bleedBox/mediaBox(jsPDF 2.5.2). editor 배선: useSettingsStore.printMarkConfig←loadTemplateSetEditor(templateSet.bleedMm/cropMarkEnabled)→useWorkSave/embed 5곳. **OFF(기본)=byte-identical 현행.** | ✅ **완료·배포** (`1e118a2`, editor Vercel). crop_mark_enabled 기본 false → opt-in 전 전 상품 무변경 |
| **P4 워커 고객업로드** | getPdfInfo 실측화(pdf-lib getSize, A4폴백) + centerOnPage 헬퍼 + convert() mode 분기(**미지정=현행100%**, passthrough/innerfit(다운스케일,확대금지)/center) + validatePageSize tolerance=sizeToleranceMm??1(1mm유지)+workSize케이스. | ✅ **완료·배포(dormant)** (`b235bf8`). mode 보내는 호출부 없어 동작 무변경 |

## 4. 상태: P1~P4 전부 배포 완료 — 활성화·검증은 오너 통제 단계

4단계 모두 **게이팅으로 전 상품 무변경 상태로 배포**됨. 실제 활성화 + 실주문 검증이 남음:

### (가) P3 활성화 — admin 토글만으로 즉시 (간단)
- admin 템플릿셋 폼에서 대상 상품의 **재단선 마커 표기(crop_mark_enabled) ON + 블리드(사방) mm 설정** → 그 상품 편집/저장 PDF가 작업사이즈+마커+TrimBox로 출력.
- **검증**: opt-in 상품 1건 편집→저장 PDF를 `mutool info`/`pdfinfo -box`/Acrobat 인쇄제작 으로 **MediaBox=작업사이즈, TrimBox=재단** 확인 + 마커 위치 + 콘텐츠 중앙 정합. OFF 상품은 현행 trim 그대로(회귀 없음 확인).

### (나) P4 활성화 — 트리거 배선 완료(게이트), **결과 콜백 잔여** (`71ed1af` 배포)
- ✅ **convert 자체 mode 결정**: `pdf-converter.resolveMode()` — convertOptions 에 editSize 있고 mode 미지정이면 getPdfInfo 실측 vs editSize±tol 로 자동결정(동일=passthrough/큼=innerfit/작음=center). editSize 없으면 mode undefined → legacy byte-identical(편집기 PDF 무영향).
- ✅ **트리거**: `edit-sessions.complete()` → `createInnerPdfImpositionJob()` — 게이트(contentPdfFileId & !underlay & templateSet & **cropMarkEnabled===true**) 통과 시만 contentPdfFileId 에 conversion 잡 발행(editSize=작업사이즈, sizeToleranceMm). 기본 false → no-op(현행). worker-jobs 큐는 raw DTO 유지(admin 자동수정 경로 무변경).
- ✅ **결과 콜백 배선 완료**(`d046409`): 임포지션 잡에 editSessionId+`purpose='inner-imposition'` 마커 → 워커 완료(`PATCH external/:id/status` → `updateJobStatus`)가 게이트(CONVERT&&purpose&&COMPLETED&&outputFileUrl) 통과 시 `relinkImposedInnerPdf()`(best-effort) — `files.registerExternalFile`로 결과 File 등록 → `session.contentPdfFileId` **재포인팅**(마이그레이션0, 원본은 metadata.innerPdfImposition 보존). 회귀방어: 임포지션 잡을 updateEditSessionWorkerStatus·areAllSessionJobsCompleted에서 제외(스푸리어스 webhook/검증지연 방지). **레이스**: compose-mixed는 caller-driven(contentPdfUrl 직접수신)이라 차단게이트 미적용(순서·PHP 무변경 보존), 재포인팅이라 임포지션 완료 후 자동 반영.
- **검증(스테이징, 결과콜백 후)**: opt-in 세션 업로드 3종 — Match→passthrough(바이트동일)/큼→innerfit(다운스케일·중앙·확대금지)/작음→center(무스케일·중앙). underlay·cropMarkEnabled=false → 변환 잡 미발행 로그 확인. 허용오차 1mm→0.2mm 단계 인하(기존 통과 업로드 회귀 측정 후).

### (다) cutSize 한 변/양변 정합 (구현 시 주의)
편집기 워크스페이스는 `width + cutSize`(양변 합), P3 출력은 `bleedMm`(per-edge)×2. P3 게이트 ON 상품은 **편집기 cutSize 와 templateSet bleedMm 가 정합**(cutSize ≈ bleedMm×2)하도록 운영 설정 점검 필요. (현재 P3 는 bleedMm 기준으로 작업사이즈 산출 — 워크스페이스 cutSize 와 별개로 동작하므로 화면/PDF 괴리 가능 → opt-in 검증 시 함께 확인.)

## 5. 핵심 파일
- 편집기/canvas-core: `WorkspacePlugin.ts`(워크스페이스·cutBorder·cropMarks·objectOutOfTrim), `ServicePlugin.ts`(_createMultiPagePDF ~653/668/720/852-877, P3), `useWorkSave.ts`(표지/내지 저장), `useCoverRegion.ts`(토스트).
- 워커: `pdf-converter.service.ts`(99-134), `pdf-validator.service.ts`(377-423), `ghostscript.ts`(getPdfInfo 235·addBleedToPdf 103·resizePdf 146), `config/validation.config.ts`.
- API: `template-set.entity.ts`·`dto`·`template-sets.service.ts`·`edit-sessions.service.ts`(createValidationJobs)·`worker-jobs.service.ts`(merge).
- admin: `TemplateSetForm.tsx`.
- 마이그레이션: `apps/api/migrations/20260610_add_bleed_cropmark_tolerance.sql`.
