-- =====================================================================
-- 20260617_c_restamp_rotated_site_sessions.sql
-- P2c S-1 선결 — rotated-site 편집세션 재스탬프.
--
-- 2026-06-15 보안회전으로 bookmoa-mobile 이 새 site row(b5aef7a9, active)로 cutover 되며
-- 구 site(26183a7c)는 status=inactive 가 됐다. 그러나 cutover 전 생성된 편집세션(현재 15건)은
-- 여전히 구 site_id(26183a7c)로 스탬프돼 있다. P2c 격리(findByOrderExternal 가 호출자 site 와
-- session.site_id 를 대조)를 배포하면, bookmoa-mobile 의 신 키(b5aef7a9)로는 이 구 세션이
-- (site_id 불일치·NULL 아님) 안 보여 **재편집이 붕괴**한다.
--
-- 이 마이그는 구 site 세션을 현 active bookmoa-mobile site 로 재스탬프해, 격리 배포 후에도
-- bookmoa-mobile 이 자기 주문 세션을 정상 조회/재편집하도록 한다.
--
-- ✅ 멱등: 이미 신 site 면 매칭 0건. ✅ additive UPDATE(컬럼/구조 변경 없음).
-- ⚠️ synchronize=false → 수동 실행. **P2c API 재배포 직전(또는 직후 즉시)** 실행해야 무중단.
-- 검증: 실행 후 SELECT site_id, COUNT(*) FROM file_edit_sessions GROUP BY site_id 에서
--       26183a7c 가 0건, b5aef7a9 가 +15건이어야 한다.
-- =====================================================================

UPDATE file_edit_sessions
   SET site_id = 'b5aef7a9-dc93-441a-b87e-5b38716ee321'   -- bookmoa-mobile (rot 06-15, active)
 WHERE site_id = '26183a7c-50fe-11f1-b3e7-4e6e38709d53';  -- bookmoa-mobile (구, inactive)
