# E트랙 SSOT — STATUS

> 갱신: 2026-07-15 (CTO 오케스트레이션 세션 — 정본: CTO_ORCHESTRATION_MASTER_PROMPT_2026-07-14.md)

## Stage×작업 매트릭스

| Stage | 작업 | 상태 |
|---|---|---|
| E0 (Wave A0) | ① ControlBar distribute 실존 재검증 | ✅ 완료 — **실존**(ControlBar.tsx:411, 3개+ 노출 생존, offHistory 쌍 정상, 테스트 전무). §5-4="AlignPlugin 이동+공개 API화" 확정 |
| E0 (Wave A0) | ② excludeFromExport 히스토리 스냅샷 제외 증명 | ✅ 완료 — **무오염 확정**(임시 테스트 10/10 pass). HistoryPlugin은 toJSON 아닌 커스텀 화이트리스트 직렬화(history.ts:111-257), excludeFromExport 이중 차단. ⚠️신규 발견: **id 부여된 가이드는 첫 undo에서 삭제**(history.ts:601-617 — 기존 center-guideline-h/v 버그). E1 가이드는 id 미부여 방식 권고 |
| E0 (Wave A0) | ③ A2 TextEffect 실물 + C6 캔버스 롱프레스 실태 | ✅ 완료 — A2=**존재+노출**(그림자 ObjectShadow·외곽선 ObjectStroke·곡선 TextEffect 전부 배선, 부재는 텍스트 배경뿐. SpecialEffect/EffectPlugin.textCurve=죽은 코드). C6=모바일 롱프레스 **없음**(contextMenu.ts 터치 경로 전무 — E2 신규) |
| E0 (Wave A0) | ④a C7 각도 스냅·골든 기준선 | ✅ 완료 — C7 스냅 **전무**(snapAngle 미설정, 경합 0. 이벤트 방식 계획 유효. 주의: FrameInteractionPlugin에 스냅 각 전파·모바일 Shift 부재). 골든=하네스 최신·baseline은 throwaway(E1 직전/반영 커밋 2회 신규 캡처+자기일치 선확인, 픽스처에 excludeFromExport 오버레이 케이스 확장 필요) |
| E0 (Wave A0) | ④b A6/A7 콘텐츠 볼륨(SELECT) | ⏸️ 권한 게이트(BLOCKERS.md — 오너 1줄 명령. E1 비차단, E5만 영향) |
| E0 산출 | docs/EDITOR_UX_DESIGN_2026-07-14.md + E1 명세 §5 확정판(§8) | ✅ 완료 — 설계서는 E1 브랜치 커밋 2e5537d로 반입, 명세 §8 확정판 append |
| E1 (Wave A1-a) | 히스토리 가드+§5-1 SmartGuides/각도스냅+§5-2 TransformFeedback | ✅ 구현 — `feat/editor-ux-e1-controls` 0db4fba·13c252e·cab4909 (+1881/−6, 신규 테스트 46, 벤치 0.37ms<16ms, check:exposure 0건, 골든 픽스처 leak 트리거 반입). 검증 웨이브 대기 |
| E1 (Wave A1-b) | §5-3 ObjectActionBar+§5-4 분배 이관+§5-5 SafeZoneWarning | ✅ 구현 — f40463a(액션바+26테스트)·cb2b84d(분배 이관, _centerObject 프라이빗 제거)·e673038(SafeZone+토스트 브리지+16테스트). canvas-core 400/400·editor 443/443·노출 0건 |
| E1 (Wave A2) | 검증 병렬(적대 2렌즈·골든·fe-qa) | ✅ **전 검증 통과** — V3 골든 PASS(e673038 기준, 3케이스 byte-identical+leak 트리거 0px) · V4 fe-qa PASS(21/21, 3뷰포트, 제품 결함 0) · V1/V2 1차 NO-GO(P0 1+P1 2 수렴 적발) → 수정 루프 1회차 후 **양측 재검 GO** |
| E1 (수정 루프 1/2) | ①P0 바인딩 순서 ②P1 유령 참조 ③P1 embed 삭제 모달 | ✅ 완료 — 11e72d8(순서 이동+negative control 테스트)·29a7d68(_isAttached 복원)·7a4d826(ObjectDeleteConfirm 마운트, 기존 embed 휴지통 dead button도 동시 수리). 최종 canvas-core 407/407·editor 448/448·노출 0건 |
| E1 최종 | ✅ **오너 승인(2026-07-15) → master 머지·push 완료**(b5e7829, Vercel 자동 배포 진행) | ⚠️ 오너 액션: 파트너 2곳 공지(D-1d) — E1 플래그 기본 on 라이브 + "임베드 DEL키 즉시삭제→확인모달 변경" 포함 권고 |

## 다음 액션
- A0 정찰 4건 수합 → 설계서 작성 → Wave A1 진입 (worktree에서 master 분기)

## 오너 결정 상태
- D-1a~d 전부 ✅ (2026-07-14, OWNER_DECISIONS_2026-07-07.md) — E1 구현 개방. 파트너 2곳 공지는 머지 전 오너 발송.
