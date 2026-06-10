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

### (가)-결과: opt-in 샘플 PDF 검증 (2026-06-10 수행 — ✅ 지오메트리 합격)

대상: `sample-8x8-book-24p`(시드 샘플, 실주문 0) **crop_mark_enabled=1 활성화 유지 중**(추가 시험용). 멤버(shop-session JWT) embed 세션으로 편집완료 → 표지 PDF 실생성·업로드 후 박스/렌더 검증:

| 검증 항목 | 결과 |
|---|---|
| **MediaBox/BleedBox** | **414.1×209.2mm = 작업사이즈**(재단 408.1×203.2 + 사방 3mm) ✓ |
| **TrimBox** | **[3,3,411.1,206.2] = 408.1×203.2mm, 사방 정확히 3mm 안쪽** ✓ |
| **코너 마커** | 4코너 렌더 확인(트림 코너에서 블리드로 연장, 인쇄영역 미침범) ✓ |
| **점선/라벨 미포함** | 시스템 가이드(SpreadPlugin/cutBorder/cropMarks)는 excludeFromExport 로 PDF 미포함 ✓ (렌더에 보인 점선·치수라벨은 **시드 템플릿의 디자인 객체** — canvas_data 에 strokeDashArray/'203.2mm' 포함 43객체, 데이터 기인) |
| **블리드 carry** | 배경이 페이지 가장자리(블리드)까지 도달 ✓ (우/하 2.66mm 흰 띠는 시드 배경 rect 형상 — 데이터 기인, 시스템 박스/마커는 4변 대칭 정상) |
| **화면 가이드(P2+#2)** | 점선 트림 + 코너 마커 + 블리드 영역 화면 표시 ✓ (embed 라이브 확인) |
| **내지(단일) 케이스** | `_drawCropMarksAndBoxes` 가 **페이지 루프 내부**에서 페이지별 호출(코드 확정, 표지와 동일 함수) — 멀티페이지 보장 |
| **모양틀 케이스** | 운영 DB에 cutline 템플릿 **0건** → 라이브 불가. 코드 보호(클립 id 체크 불가침)로 확인 |

**부수 발견(별도 이슈)**: ① 24p 책 편집완료 시 **내지 content PDF 생성이 워치독(180s) 타임아웃**(`spread:content:gen FAILED`) — 게이트와 무관한 선재 성능 한계(표지는 3초). 24p 책 운영 출고 경로 점검 필요. ② embed **게스트 세션은 편집완료 시 PDF 미생성**(needAuth 설계) — 검증은 멤버 세션 필수. ③ 시드 템플릿 품질(가이드가 디자인으로 박힘).

### (가) P3 활성화 — admin 토글만으로 즉시 (간단)
- admin 템플릿셋 폼에서 대상 상품의 **재단선 마커 표기(crop_mark_enabled) ON + 블리드(사방) mm 설정** → 그 상품 편집/저장 PDF가 작업사이즈+마커+TrimBox로 출력.
- **검증**: opt-in 상품 1건 편집→저장 PDF를 `mutool info`/`pdfinfo -box`/Acrobat 인쇄제작 으로 **MediaBox=작업사이즈, TrimBox=재단** 확인 + 마커 위치 + 콘텐츠 중앙 정합. OFF 상품은 현행 trim 그대로(회귀 없음 확인).

### (나) P4 활성화 — 트리거 배선 완료(게이트), **결과 콜백 잔여** (`71ed1af` 배포)
- ✅ **convert 자체 mode 결정**: `pdf-converter.resolveMode()` — convertOptions 에 editSize 있고 mode 미지정이면 getPdfInfo 실측 vs editSize±tol 로 자동결정(동일=passthrough/큼=innerfit/작음=center). editSize 없으면 mode undefined → legacy byte-identical(편집기 PDF 무영향).
- ✅ **트리거**: `edit-sessions.complete()` → `createInnerPdfImpositionJob()` — 게이트(contentPdfFileId & !underlay & templateSet & **cropMarkEnabled===true**) 통과 시만 contentPdfFileId 에 conversion 잡 발행(editSize=작업사이즈, sizeToleranceMm). 기본 false → no-op(현행). worker-jobs 큐는 raw DTO 유지(admin 자동수정 경로 무변경).
- ✅ **결과 콜백 배선 완료**(`d046409`): 임포지션 잡에 editSessionId+`purpose='inner-imposition'` 마커 → 워커 완료(`PATCH external/:id/status` → `updateJobStatus`)가 게이트(CONVERT&&purpose&&COMPLETED&&outputFileUrl) 통과 시 `relinkImposedInnerPdf()`(best-effort) — `files.registerExternalFile`로 결과 File 등록 → `session.contentPdfFileId` **재포인팅**(마이그레이션0, 원본은 metadata.innerPdfImposition 보존). 회귀방어: 임포지션 잡을 updateEditSessionWorkerStatus·areAllSessionJobsCompleted에서 제외(스푸리어스 webhook/검증지연 방지). **레이스**: compose-mixed는 caller-driven(contentPdfUrl 직접수신)이라 차단게이트 미적용(순서·PHP 무변경 보존), 재포인팅이라 임포지션 완료 후 자동 반영.
- **검증(스테이징, 결과콜백 후)**: opt-in 세션 업로드 3종 — Match→passthrough(바이트동일)/큼→innerfit(다운스케일·중앙·확대금지)/작음→center(무스케일·중앙). underlay·cropMarkEnabled=false → 변환 잡 미발행 로그 확인. 허용오차 1mm→0.2mm 단계 인하(기존 통과 업로드 회귀 측정 후).

### (라) CTO 구조 감사 결과 (2026-06-10, 4차원 적대감사 + 종합 — 커밋 342b44d 기준)

**게이트 OFF 안전성은 코드로 입증**(배포 무해). 차단 4건 중 **#1·#2·#3·#5·#6 수정·배포 완료(2026-06-10)** — **잔여 활성화 차단 = #4(PHP 연동 시점 규약) 단 1건**. #4 합의 전까지는 PHP 자동 compose 를 쓰는 상품에 cropMarkEnabled 를 켜지 말 것(수동/비-PHP 흐름 상품은 #2 검증 절차 후 활성화 가능):

| # | 심각도 | 내용 | 처리 |
|---|---|---|---|
| 1 | critical | **검증 허용오차 0.2mm 게이트 누수**(라이브 회귀): P1 주입이 게이트 없이 전 templateSet 세션 적용 → validator `??1` 무력화(1mm→0.2mm) | ✅ **수정·배포**(`342b44d`) — 주입을 cropMarkEnabled 게이트 뒤로 + merge 무조건 주입 제거 |
| 2 | critical | **화면↔PDF 블리드 지오메트리 불일치**: 단일모드 로드 cutSize:0 하드코딩 → 화면 블리드 0 + PDF 블리드 링 **100% 백지**(canvas.clipPath=workspace 가 SVG 클립). spread 는 cutSizeMm=2 고정 | ✅ **수정·배포**(`2eeb84e`) — 로드 시 게이트(cropMarkEnabled&&bleedMm>0) ON 이면 `cutSize=bleedMm×2`(단일 cutSize 3곳+workspace px 계산 3곳, spread spec 덮어쓰기) + export 시 workspace-rect 클립만 renderSize 로 임시 확장(finally 원복, 모양틀 불가침). 화면마커=PDF마커=TrimBox inset 정합(bleedMm≤5). ⚠️ 활성화 전 단일/spread/모양틀 3케이스 샘플 PDF 검증 절차는 유지 |
| 3 | major | **세션 lost update**: relink(전체 save)↔검증콜백(전체 save) 병렬 → stale save 가 contentPdfFileId 원복(임포지션 결과 무증상 소실) | ✅ **수정·배포**(`82a64b4`) — 컬럼 한정 원자 `update()`: relink={contentPdfFileId, metadata(fresh reload 머지)}, workerStatus 갱신={workerStatus(+FAILED 시 workerError)}. 상호 클로버 제거 |
| 4 | major | **session.validated 웹훅 ≠ 임포지션 완료**: PHP 가 validated 직후 compose 하면 원본 사용 가능 | ⛔ **활성화 차단(유일 잔여)** — PHP 연동 규약 확정 필요(웹훅 페이로드에 임포지션 상태 포함 또는 compose 시 대기/조회) — 북모아 측 합의(오너) |
| 5 | minor | complete() 재진입 시 중복 임포지션 잡 | ✅ **수정·배포**(`82a64b4`) — metadata.innerPdfImposition.jobId 멱등 가드(게이트 뒤) |
| 6 | minor | centerOnPage 음수 오프셋 방어 부재 | ✅ **수정·배포**(`82a64b4`) — 오버사이즈 가드(warn+무가공 복사) + 오프셋 클램프 |
| 7~9 | minor | printSize+게이트ON 정책 미정의 / 임포지션 결과 관측성(metadata mode 미기록)·재검증 부재 / 실측 0.1mm 라운딩 vs tol 0.2 경계 요동 | 후속 |

**기각된 주장(감사 자체가 반증)**: TrimBox y축 반전(사방 균등 모델에서 항등), svg2pdf 이중 스케일(비례 구조 동일), **innerfit 좌하단 정렬(GS 10.06 실측 — `-dPDFFitPage` 는 중앙 정렬 수행)**, printMarkConfig spread/embed 미세팅(공통 경로 선행 확인), templateSet.width 의미(판형=트림으로 일관), TemplateSetForm 로드 미완(코드 반증).

### (다) cutSize 한 변/양변 정합 (구현 시 주의)
편집기 워크스페이스는 `width + cutSize`(양변 합), P3 출력은 `bleedMm`(per-edge)×2. P3 게이트 ON 상품은 **편집기 cutSize 와 templateSet bleedMm 가 정합**(cutSize ≈ bleedMm×2)하도록 운영 설정 점검 필요. (현재 P3 는 bleedMm 기준으로 작업사이즈 산출 — 워크스페이스 cutSize 와 별개로 동작하므로 화면/PDF 괴리 가능 → opt-in 검증 시 함께 확인.)

## 5. 핵심 파일
- 편집기/canvas-core: `WorkspacePlugin.ts`(워크스페이스·cutBorder·cropMarks·objectOutOfTrim), `ServicePlugin.ts`(_createMultiPagePDF ~653/668/720/852-877, P3), `useWorkSave.ts`(표지/내지 저장), `useCoverRegion.ts`(토스트).
- 워커: `pdf-converter.service.ts`(99-134), `pdf-validator.service.ts`(377-423), `ghostscript.ts`(getPdfInfo 235·addBleedToPdf 103·resizePdf 146), `config/validation.config.ts`.
- API: `template-set.entity.ts`·`dto`·`template-sets.service.ts`·`edit-sessions.service.ts`(createValidationJobs)·`worker-jobs.service.ts`(merge).
- admin: `TemplateSetForm.tsx`.
- 마이그레이션: `apps/api/migrations/20260610_add_bleed_cropmark_tolerance.sql`.
