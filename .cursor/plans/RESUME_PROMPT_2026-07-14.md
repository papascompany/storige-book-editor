# RESUME PROMPT — 2026-07-14 (세션 종료 정본: 가로형 6이슈→판형 규격 체계→방향 쌍 관리)

> 이 문서가 **최신 정본**이다. 상세 이력은 `RESUME_PROMPT_2026-07-13_UX6FIX.md`(동일 트랙의 축차 기록).
> 작업 기반: **워크트리 `../storige-fix-20260713`** (브랜치 fix/landscape-template-ux-20260713 = origin/master **a0b72a3** 동기).
> ⚠️ 메인 체크아웃(storige/)은 병행 세션 소유(chore/source-exposure-gate + docs/PLATFORM_INTEGRATION_GUIDE.md 미커밋) — **무접촉**.

## 1. 완료·배포된 것 (전부 프로덕션 LIVE)

### 7/13 — 가로형 템플릿 6이슈 + 부수 (커밋 8214ca6→7f1bfce, 0b2ffdd, 7691ab6, 69f8fa5)
- **T1** 템플릿 모드 에셋 빈 패널(useLibraryPanel isCustomer 게이트→`‖editMode`) / **T2** admin 페이지네이션 14곳(defaultPageSize) / **T3** 도련 자동삽입: `POST /worker-jobs/fix-bleed`(@Public, 서버 권위 editSize)+모달 노티→변환본 첨부(적대검증 P1 3건 반영: 취소가드·grace폴링·completed게이트) / **T4** SidePanel 레이어 우선 재구성 / **T5** pageCount 표지 제외(21→20)+admin 표지/내지 개별 다운로드 / **T6** useCanvasContainerSizeSync 3뷰 배선+ControlBar 폭 정합
- **dev 초기화 레이스**(0b2ffdd): stale-abort+safeDispose+createFabricCanvas 요소 바인딩(id 도난 제거)
- **upload-public files 미등록 균열**(7691ab6): ≤50MB 첨부 경로 전체가 FILE_NOT_FOUND였던 기존 결함 — E2E로 적발·수정
- **🚨 Redis SLAVEOF 하이재킹 봉쇄**(69f8fa5): 5/3~7/13 감염(role 전환 185회, 큐 간헐 파손), redis+mariadb 루프백 바인딩·외부 스캔 실증·호스트 무침해 확인. **교훈: Docker ports는 ufw 우회.**
- **DB 교정**: 하드커버 세로/가로 판형 = 재단 규약(210×297/297×210)
- **E2E 실증**: 297×210 업로드→fix-bleed→**303.00×216.00mm/사방 3mm** 산출

### 7/14 — 판형 규격 체계 (d2a925c, 3a74674, 22df006, 8ce4f54, a0b72a3)
- **판형 규격표 8종**(오너 확정): A4 210×297/A5 148×210/B5 182×257/46배판 188×257/16절 190×260/B6 128×182/정사각 210×210/비규격=입력값(+사방3mm). 워커 무수정(무스왑 계약 포함 **48케이스 CI 잠금**), api 세션검증 **W↔H 스왑 정규화+expectedOrientation**, editor 단일모드 PDF 정합, 오차허용 체계 무접촉
- **판형 프리셋 관리**(22df006): format_presets 테이블+시드 7종(마이그레이션 20260714_add_format_presets.sql), admin '판형 관리' 화면(삭제=비활성 토글만), FormatPresetSelect 픽커(템플릿 모달·스프레드 모달·템플릿셋 폼)
- **치수 정합 가드**(8ce4f54): checkTemplateDimAlignment(재단∨작업, 방향 포함 ±0.01mm) 배지/Alert, '템플릿 추가' 필터 재단∨작업 이중 허용, 템플릿 방향 컬럼+필터
- **하드커버 내지 정리**(데이터): 정합 내지 재연결, 구 성책값 내지 2건 비활성
- **방향 쌍 관리**(a0b72a3): paired_template_set_id+is_orientation_default(마이그레이션 20260714_add_orientation_pair.sql), pair/unpair/orientation-default/**derive-orientation**(초안 파생 — page류만 자동 재배치 이월: 크기·회전·스타일·잠금·z순서 보존+위치만 축별 비율, 실픽스처 왕복<0.01px spec, spread류 미이월), admin 쌍 UI+파생 confirm. **기존 4세트 페어링 완료**(기본책자·하드커버, 세로=★기본)

### bookmoa 연동 상태
- 가로 templateSetId 회신 완료: `mpkte2zbqo5w`→83e6ec80, `noriter-14`→e66588b2 (HANDOFF_bookmoa_landscape_templateset_2026-07-14.md §7)
- 전달 문서: NOTICE_bookmoa_inner_pdf_size_spec_2026-07-14.md(규격표+부록: pageCount 21→20, outputFormat separate) + PROMPT_bookmoa_landscape_reply_2026-07-14.md(v2) — **오너가 bookmoa 세션에 전달 완료, 검증 피드백 대기 중**

## 2. 다음 세션이 이어받을 것 (우선순위순)

1. **bookmoa 검증 피드백 대응**: 핸드오프 파일 또는 `~/Developer/claude/bookmoa-mobile/docs/`에 기록되면 확인·대응. 실패 유형별 대응 지점: 스왑 정규화 warn 로그(계측), ORIENTATION_MISMATCH, fix-bleed, 세트 페어링 — 전부 배포돼 있음
2. **G3 게이트**: bookmoa 회신 정리 후 `WORKER_WIRED_FIXABLE_GATING=ON`(VPS .env) — 오사이즈 업로드가 실거부로 전환. 선결조건(방향 정합·fix-bleed 배선) 충족 상태
3. **표지 트랙 C**: 표지(spread) 방향 파생 자동화 — 설계 노트 `TRACK_C_cover_orientation_derive_2026-07-14.md`(미착수). [2026-07-14 B 임시조치] A4하드커버 가로 표지(19741bdb)에 제목/저자명 변환 주입 완료(초안, 롤백=objects:[]). + 하드커버 표지(책등+싸바리) 검증 규칙 `docs/HARDCOVER_COVER_VALIDATION_NOTES.md`. 페브릭/래더·누드제본은 실무 검증 후
4. **보안 후속(오너 결정)**: api 4000·worker 4001·editor 3000 공인 포트 결정(bookmoa :4000 직결 여부 확인 후 루프백) / redis requirepass / auth.log 5/3 포렌식 / monitor.sh redis role 감시 / 5~7월 READONLY 창 실패 잡 영향 조회
5. **백로그**: validate 게스트 401 비대칭 / 검증 잡 큐 site-default 머지 미적용 의심 / heavy @Public 3라우트 @Throttle / /output NULL-siteId(§4.3) / registerBleedFixOutput 원자화 / admin 대용량 blob 다운로드 / 파생 세트 라이브러리 카테고리 미복사(전역 폴백) / init.sql 기존 드리프트 / TemplateEditorView 구법 정리
6. **오너 라이브 확인 잔여**: 6이슈 화면 체크리스트 일부(③ 모달 배너 UI, ⑦ 모바일 키보드 줌 스모크)

## 3. 환경·함정 (새 세션 필독)

- **레포**: 메인 storige/(병행 세션 무접촉) + 워크트리 storige-fix-20260713(작업 기반, master 동기 — 필요 시 그대로 사용)
- **배포**: admin·editor=master push 웹훅(**editor 웹훅 이제 정상** — "미발화" 옛 메모 폐기, api-only 커밋은 ignoreCommand가 올바르게 스킵) / api·worker=VPS 수동(`docker compose build+up`) + **nginx 재시작 필수** / 스키마 변경 시 **마이그레이션 SQL 선실행→api 재배포**(부트 시드가 테이블 요구)
- **QA 함정**: 브라우저 패널 hidden이면 RAF 동결→캔버스 렌더 안 보이고 합성 클릭 무반응(코드 결함 아님) — 패널을 화면에 띄운 상태로만 신뢰 / admin·validate는 로그인 필요(자격증명 입력 금지 원칙 — 오너 확인으로 대체)
- **불변 계약**: 워커 validatePageSize 무스왑(스펙 잠금) / 프리셋 하드삭제 금지(시드 부활) / templateSet presetId 무스키마 / /external 동결 16라우트 / editor.complete payload 구조 FROZEN
- PUBLIC 레포 — push 전 gitleaks(protect --staged) 관행 유지
