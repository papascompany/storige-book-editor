# E트랙 BLOCKERS

## [OWNER-DECISION 아님 — 권한 게이트] A6/A7 콘텐츠 볼륨 실측 보류 (2026-07-15)

- Wave A0 ④b(라이브러리 도형/사진틀/배경 카테고리별 개수 SELECT)가 자동 모드 권한 분류기에서 2회 거부됨(프로덕션 SSH DB 읽기 — 비대화형 세션이라 승인 프롬프트 불가).
- 공개 API로는 fonts만 무인증 200, shapes/frames/backgrounds/cliparts는 401 — 키 동원 우회는 거부 취지 위반이라 중단.
- **영향**: E1(컨트롤 구현)에는 무영향. E5(콘텐츠 볼륨) 판정 근거만 지연.
- **해소 방법** (둘 중 하나):
  1. 오너가 대화형 세션에서 아래 1줄 실행 후 결과를 전달:
     `ssh deploy@<VPS_HOST> 'source ~/storige/.env && docker exec storige-mariadb mariadb -ustorige -p"$DATABASE_PASSWORD" storige -e "SELECT '\''shapes'\'' t,is_active,COUNT(*) c FROM library_shapes GROUP BY is_active; SELECT '\''frames'\'',is_active,COUNT(*) FROM library_frames GROUP BY is_active; SELECT '\''backgrounds'\'',is_active,COUNT(*) FROM library_backgrounds GROUP BY is_active; SELECT '\''cliparts'\'',is_active,COUNT(*) FROM library_cliparts GROUP BY is_active; SELECT '\''fonts'\'',is_active,COUNT(*) FROM library_fonts GROUP BY is_active;"'`
  2. 또는 permissions에 읽기 전용 SSH 규칙 추가 후 재요청.
