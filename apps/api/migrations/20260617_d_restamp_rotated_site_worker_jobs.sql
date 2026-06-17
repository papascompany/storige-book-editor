-- =====================================================================
-- 20260617_d_restamp_rotated_site_worker_jobs.sql
-- P2c S-3 선결 — rotated-site 워커잡 재스탬프 (20260617_c 세션 재스탬프의 worker_jobs 판).
--
-- 2026-06-15 보안회전으로 bookmoa-mobile 이 새 site row(b5aef7a9, active)로 cutover 됐고
-- 구 site(26183a7c)는 inactive. cutover 전 생성된 worker_jobs(현재 5건)는 여전히 구 site_id
-- (26183a7c)로 스탬프돼 있다. P2c S-3 격리(findOne external 가 editor 호출자의 site 와
-- job.site_id 를 대조)를 배포하면, bookmoa-mobile 신 키(b5aef7a9, editor 역할)로는 이 구 잡이
-- (site_id 불일치·NULL 아님) 안 보여 **잡 상태 조회가 붕괴**한다.
--   ※ 워커 콜백(PATCH external/status)은 worker 역할이라 바이패스되어 무관하지만,
--     bookmoa-mobile 이 editor 키로 잡 상태를 폴링하는 경로가 깨진다.
--
-- ✅ 멱등: 이미 신 site 면 0건. ✅ additive UPDATE(구조 변경 없음).
-- ⚠️ synchronize=false → 수동 실행. **P2c S-3 API 재배포 직전** 실행해야 무중단.
-- 검증: 실행 후 SELECT site_id, COUNT(*) FROM worker_jobs GROUP BY site_id 에서
--       26183a7c 가 0건, b5aef7a9 가 +5건이어야 한다.
-- =====================================================================

UPDATE worker_jobs
   SET site_id = 'b5aef7a9-dc93-441a-b87e-5b38716ee321'   -- bookmoa-mobile (rot 06-15, active)
 WHERE site_id = '26183a7c-50fe-11f1-b3e7-4e6e38709d53';  -- bookmoa-mobile (구, inactive)
