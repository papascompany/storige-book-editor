# SESSION NOTE — 2026-07-14 오후 · bookmoa 피드백 정리 + G3 판단 자료 + 보안 후속 증거

> RESUME_PROMPT_2026-07-14.md(정본)의 우선작업 ①②를 수행한 세션 기록. 코드 변경 없음(조사·정리 전용).
> 메인 체크아웃(storige/) 무접촉 유지. 워크트리 기반(master a0b72a3 동기).

## 1. bookmoa 검증 피드백 — R-29 도착·전량 정합 (Storige 측 필수 대응 0건)

bookmoa 원장 `~/Developer/claude/bookmoa-mobile/docs/LAUNCH-QA-LEDGER-2026-06-30.md` R-29
(2026-07-14 10:29 갱신, ✅ 완료·push·배포·라이브 검증):

- ① 가로형 오리엔트: bookmoa R-13에서 기교정 — 과거 세로값 관측은 배포 전 트래픽/방향설정 0 탓.
  운영자 방향설정 후 Storige "방향 정규화" warn 로그 소멸로 상호확인 예정.
- ② 규격표 대조: 불일치 2건 bookmoa 측 정합 — **16절 182×257→190×260**(라이브 DB seedV=2 반영)
  + **책자형 기본 도련 1→3mm**(BOOKLET_BLEED_MM=6). 규격 계약 양측 정합 확정.
- ③ ORIENTATION_MISMATCH CODE_MAP 기등록 / ④ pageCount 21→20 원값 사용(자연 정합) /
  ⑤ outputFormat separate 정합. vitest 437/437.

**§5 수용 검증(가로 캔버스 왕복)은 아직 결과 회신 없음** — 단, 아래 계측상 **검증이 진행 중**으로 보임.
bookmoa 측 핸드오프 사본(docs/HANDOFF_storige_landscape_templateset_2026-07-09.md)엔 아직 회신 ID 미기입
(원장 R-19 "Storige 생성 대기" = stale — v2 회신 프롬프트가 bookmoa 세션에 아직 미처리).

## 2. 라이브 계측 (2026-07-14 오후, VPS)

- api "방향 정규화" warn: **0건/72h** · worker ORIENTATION_MISMATCH: **0건/72h**
- **오늘 05:15~05:45(DB 시각) VALIDATE FIXABLE 5건 — 전부 가로판(기대 297×210/303×216) 검증**,
  그중 3건 site=bookmoa-mobile(b5aef7a9), 2건 site NULL(백로그 §4.3 NULL-siteId 그대로).
  실파일 301×214(=사방 2mm 도련) → SIZE_MISMATCH, fixMethod=**resizeWithPadding(실행기 미배선)**.
  expected 값이 정확히 오리엔트되어 산출 = d2a925c 정합 라이브 작동 실증.
- 최근 7일 worker FIXABLE 로그 총 7건 — 확인한 5건 전부 미배선 fixMethod 케이스.

## 3. G3 게이트(WORKER_WIRED_FIXABLE_GATING=ON) — 오너 결정 자료

- 현재 VPS `~/storige/.env`에 **플래그 미설정 = OFF**(코드 기본, validation.config.ts:53).
- ON 시 효과: resizeWithPadding/adjustSpine 등 미배선 fixMethod → autoFixable=false → **오사이즈
  업로드 실거부**. 오늘의 301×214 같은 파일이 정확히 실거부 대상(현행은 FIXABLE로 통과되나
  실행기가 없어 자동수정 약속 불이행 상태 — C+ 설계 취지).
- **권고: bookmoa §5 왕복 검증 완료 회신 후 ON** — 검증 진행 중 게이트를 바꾸면 bookmoa가 관찰하는
  동작이 중간에 변해 QA 혼선. 회신 오면 즉시 ON 가능(선결조건 방향정합·fix-bleed 배선 충족 확인됨).
- 절차: `.env`에 `WORKER_WIRED_FIXABLE_GATING=true` 추가 → `docker compose up -d worker`(재생성 필요).
  롤백=플래그 제거+재생성.

## 4. 보안 후속(§2-4) 증거 수집 (읽기 전용)

- redis role=**master**(SLAVEOF 재발 없음), redis·mariadb 루프백 바인딩 유지(69f8fa5 유효).
- **api:4000·worker:4001·editor:3000 여전히 0.0.0.0 공개 + 외부 실도달 확인**(이 Mac에서 직결 HTTP 200).
- 선결 질문 "bookmoa :4000 직결?" → **아니오**: bookmoa-mobile은
  `https://api.papascompany.co.kr/api`(nginx 443)만 사용(presignedUpload.js:25, .env.example),
  vercel.json CSP connect-src도 포트 명시 없어 :4000 직결은 브라우저단에서 차단됨.
  → 3포트 루프백 바인딩(redis 때와 동일 방식) 시 bookmoa-mobile 무영향. 단 100p/MD2Books 등
  워커형 파트너의 서버간 호출이 도메인 경유인지 최종 확인 후 실행 권장(오너 게이트).

## 4b. [추기] 표지 트랙 B/C (지난 세션 마무리분 — RESUME §2-3 갱신 확인)

- **B 임시조치 완료**: A4하드커버 가로 표지(19741bdb)에 세로 표지(d765713a) 8객체 전체+clipPath를
  전체비율(rW=1.4054, rH=0.7110) 변환 주입, 오너 육안 정상확인. 함정=파란 배경은 workspace rect fill,
  clipPath까지 한 세트 이월 필수. 롤백=canvas_data `{"objects":[],"width":603.2,"height":214}`.
  한계=책등 1.2mm라 전체비율 근사가 우연히 통한 것 — 두꺼운 책등 상품엔 부정확.
- **트랙 C 신설(미착수)**: 표지 spread 방향 파생 자동화 — 설계노트
  `storige/.cursor/plans/TRACK_C_cover_orientation_derive_2026-07-14.md`(면단위 변환·책등 가변·
  derive includeCover 확장·하드커버 검증규칙과 기하 정본 공유). 착수는 책등·싸바리 규칙 실무 확정과 묶어서.
- v2 프롬프트 §4의 "표지 빈/기초 상태" 고지는 이제 부분 구식 — A4하드커버 가로 표지는 초안 아트워크
  있음(bookmoa 합격 기준엔 무영향). noriter 가로(e66588b2) 표지는 여전히 빈 상태.

## 5. 다음 세션

1. bookmoa §5 검증 회신 감시(핸드오프 사본·원장 R-19 갱신 여부) → 실패 시 정본 §2-1 대응 지점.
2. 회신 완료 → 오너 승인 하 G3 ON(§3 절차).
3. 3포트 루프백 바인딩 오너 결정(§4 증거 첨부) / 나머지 §2-4·§2-5는 정본 그대로.
