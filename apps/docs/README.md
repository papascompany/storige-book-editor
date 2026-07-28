# @storige/docs — 파트너 문서 포털

`docs/PLATFORM_INTEGRATION_GUIDE.md` 를 정적 사이트로 **발행**하는 파이프라인이다.

> **이 포털은 신규 정본이 아니다.**
> GUIDE 가 본문 정본이고 포털은 그 발행 채널이다. 포털이 자체 본문 정본을 가지면
> 정본이 하나 더 늘어나 유지보수 사고를 재생산한다. 그래서 GUIDE 6페이지는
> **H2 경계 슬라이스(바이트 무변형)** 만 하고, 포털이 저술하는 것은
> `content/*.md` 4종(라우팅·체크리스트·changelog·API 렌더 주석)뿐이다.
> 그 4종도 **규범 서술을 담지 않고 GUIDE 앵커로 넘긴다**.

`apps/api/src/portal/`(파트너 셀프서비스 표면 "파트너 포털 v0")과는 **다른 것**이다.
이쪽은 "문서 포털 / Docs" 다.

---

## 빌드

```bash
# 0) 스펙 생성 (gitignored 빌드타임 생성물 — 레포에 없다)
pnpm --filter @storige/types build
OPENAPI_PARTNER_OUT=$PWD/apps/docs/.generated/openapi-partner.json \
  pnpm --filter @storige/api openapi:partner   # → paths=16, operations=22, schemas=3

# 1) 빌드
pnpm --filter @storige/docs build              # strict — 매니페스트 전 항목 필수
pnpm --filter @storige/docs build -- --dev     # 누락 콘텐츠 허용(개별 작업용)
```

`postbuild` 로 `scripts/check-source-exposure.mjs site` 가 자동 실행된다(pnpm 9 확인).

### 스펙 해석

1. `$STORIGE_OPENAPI_SPEC` — 지정하면 **단독 사용**. 그 경로에 파일이 없으면 폴백 없이 실패한다(오타로 인한 조용한 폴백 금지).
2. 미지정이면 `apps/docs/.generated/openapi-partner.json` 과 `apps/api/openapi-partner.json` 중 **존재하는 것**.
   둘 다 있으면 내용을 대조해 — 같으면 무해하게 진행하고, **다르면 mtime 최신본을 쓰고 경고**한다.

셋 다 없으면 생성 명령을 안내하고 `exit 1`.

> 순서 고정이 아니라 내용 대조인 이유: `pnpm docs:spec` 을 한 번이라도 돌린 머신에는
> `.generated/` 사본이 영원히 남아, 서버 DTO 가 바뀌어도 **낡은 레퍼런스가 조용히 발행**됐다.

### 환경변수

| 이름 | 기본 | 효과 |
| --- | --- | --- |
| `STORIGE_OPENAPI_SPEC` | — | 스펙 경로 직접 지정 |
| `STORIGE_DOCS_SITE_URL` | `''` | llms.txt 절대 URL 접두. 비면 루트-상대. 값이 있으면 그 호스트가 guard R1 화이트리스트에 자동 추가된다 |
| `STORIGE_DOCS_NOINDEX` | — | `1` 이면 **빌드측 2축**을 켠다: 전 HTML 에 `noindex, nofollow` meta + `robots.txt` `Disallow: /`. 세 번째 축인 HTTP `X-Robots-Tag` 는 빌드가 아니라 `vercel.json` `headers` 소관이다(`.txt`·`.css` 산출물의 유일한 커버리지). 축별 커버리지와 한계는 `DEPLOY.md` §0-1 |

> `robots.txt` 는 **모드와 무관하게 항상** 산출된다. 파일이 없으면 "차단 모드인데 누락"과
> "공개 모드"가 산출물에서 구분되지 않기 때문이다.

---

## 구조

```
build.mjs            오케스트레이터 (슬라이스 → 렌더 → llms → guard → linkcheck)
site.config.mjs      페이지 매니페스트 · 호스트 화이트리스트 · 절번호→앵커 매핑 · OpenAPI 렌더 정책
src/slice.mjs        GUIDE H2 슬라이서 (펜스 인식, 바이트 무변형)
src/render-md.mjs    마크다운 → HTML (marked) · 앵커 id 정책
src/render-openapi.mjs  생성 스펙 → 마크다운 (렌더 허용/금지를 코드로 강제)
src/guard.mjs        R1 호스트 화이트리스트 · R2 bare IPv4 · R3 내부 포인터 blocklist
src/linkcheck.mjs    R4 내부 링크·앵커·자산 전수 해석
src/emit-llms.mjs    ← shard ③ 소유 (없으면 --dev 는 경고, strict 는 실패)
templates/layout.mjs 셸 (JS 0줄 · CDN 0건)
theme.css            단일 스타일시트 (라이트/다크)
content/*.md         ←② index·go-live·changelog·api-intro / ←③ llms-intro
site/                산출물 (gitignored) — html · theme.css · llms.txt · llms-full.txt · robots.txt
```

`robots.txt` 는 **빌드 산출물**이다. `site/` 에 손으로 두지 말 것(빌드가 `site/` 를 통째로 지우고 다시 만든다).

### 의존성

**`marked` 1개뿐**(전이 의존 0). 번들러·프레임워크·정적사이트빌더·CDN 전부 도입하지 않는다.
무의존 자작 렌더러를 쓰지 않는 이유는 스파이크에서 GUIDE 실물의 escaped pipe(테이블 셀 +
inline code 동시 파손)와 task list `- [ ]` 34건이 실제로 깨졌기 때문이다 — go-live
체크리스트가 핵심 산출물이라 정면 충돌한다.

---

## 게이트

빌드가 다음 순서로 죽는다. 하나라도 걸리면 산출물이 나가지 않는다.

| | 검사 | 실패 조건 |
| --- | --- | --- |
| R1 | 절대 URL 호스트 화이트리스트 | 화이트리스트 밖 호스트 (IP-in-URL 은 여기서 전부 걸린다) |
| R2 | bare IPv4 리터럴 | 루프백(`127.0.0.1`·`0.0.0.0`) 외 IPv4 |
| R3 | 내부 포인터 blocklist | 내부 설계서명·`.cursor`·`CLAUDE.local`·내부 스프린트 표기·시크릿 형태 |
| R4 | linkcheck | 내부 링크/앵커/자산 미해석 |
| R5 | 매니페스트 완전성 | strict 에서 소스 파일 누락 |
| — | 오버라이드 드리프트 | `expectedSource` 불일치 · 고아 오버라이드 · 스펙에 없는 `enumNotes` 값 |
| — | check-source-exposure | 금지 외부 식별자 · IPv4 리터럴 (postbuild, `site/` 재스캔) |

게이트 리포트는 적발한 **IPv4·시크릿 실값을 마스킹**해 출력한다(위치 `file:line` + 규칙명만
공개). 이 게이트들은 PUBLIC 레포의 CI 에서 돌고 공개 Actions 로그는 누구나 읽으므로,
적발값을 평문으로 찍으면 게이트 자신이 유출 경로가 된다.

R1~R3 은 **산출물 전수 스캔**이라 입력이 어디서 왔든(GUIDE·content·생성 스펙) 동일하게 걸린다.
HTML 엔티티를 되돌린 뒤 스캔하므로 `&quot;`·`&lt;` 로 우회되지 않는다.

`--dev` 는 **누락된 타 shard 산출물을 가리키는 전방 참조만** 경고로 낮춘다
(`site.config.mjs` 의 `PENDING_ANCHORS` + 매니페스트에서 건너뛴 라우트).
오타나 잘못된 앵커는 `--dev` 에서도 그대로 죽는다.

---

## OpenAPI 렌더 — 무엇을 싣지 않는가

서버에 `@ApiResponse({ type })` 가 **0건**이고 성공 봉투는 런타임 인터셉터 소관이라
**스펙에 응답 스키마가 존재하지 않는다.** 따라서:

- **응답 예시·응답 타입 슬롯을 템플릿에 두지 않는다.** 없는 것을 지어내면 허위 문서화다.
  상태코드는 `선언된 응답` 라벨로만 노출하고, 2xx 미선언 오퍼레이션에는 그 사실을 명시한다.
- **`multipart/form-data` 스키마를 렌더하지 않는다.** 스펙은 `{fileId}`(AssetInputDto)로
  오기돼 있으나 실제 컨트롤러는 `FileInterceptor('file')` 이다. 대신 경고 박스 +
  GUIDE §2.0 링크로 대체한다.
- **`info.description`·`securitySchemes` 원문을 읽지 않는다.** 전자는 내부 설계서 경로를,
  후자는 `bearerFormat:"JWT"` 라는 오도 정보를 담고 있다.
- `descriptionOverrides` / `summaryOverrides` / `enumNotes` 는 **드리프트 어서션과 한 몸**이다.
  오버라이드는 `{ text, expectedSource }` 형태만 허용하고, 렌더 시점에 스펙 원문과
  `expectedSource` 를 대조해 다르면 **빌드를 깨뜨린다**. 등재만 하고 스펙에서 대응을 찾지
  못한 키(고아 오버라이드)와, 스펙 enum 에 없는 `enumNotes` 값도 마찬가지로 깨뜨린다.
  → 서버 원문이 고쳐졌는데 오버라이드가 옛 서술을 발행하는 **스테일 치환이 불가능**하다.
  (`descriptionOverrides` 는 서버 원문만으로 부족할 때만 쓴다. 원문이 충분해지면 삭제하는 것이 낫다.)
- `TEMPLATE`·`MIX_COVER_TEMPLATE` creationType 은 **생성이 `201` DRAFT 로 통과하고 최종화가
  `422 ERR_ASSETS_INCOMPLETE`(`TEMPLATE_COVER_NOT_RENDERED`)로 거부**된다. 거부 시점을
  혼동하면 파트너가 "생성 성공 = 지원됨"으로 오독하므로 `OPENAPI.enumNotes` 로 값 옆에 못박는다.
- 스펙의 `servers` 가 `[]` 라 base URL 을 포털이 명시 보완한다.

---

## 확장 지점 (다른 shard 가 붙는 자리)

| shard | 붙는 곳 |
| --- | --- |
| ② | `content/index.md` · `go-live.md` · `changelog.md` · `api-intro.md` 를 만들면 매니페스트가 이미 등재하고 있어 자동으로 페이지가 된다. **GUIDE §2.0 이 저술돼 `PENDING_ANCHORS` 는 이미 비었다** — 비어 있는 것이 정상이고, 여기 항목이 남으면 진짜 깨진 링크가 경고로 강등된다 |
| ③ | `src/emit-llms.mjs` 에 아래 시그니처를 구현. `content/llms-intro.md` 저술 |
| ④ | `apps/docs/vercel.json`. Root Directory 는 **반드시 `apps/docs`** — 루트로 두면 루트 `vercel.json` 의 rewrites 를 상속한다 |

```js
// src/emit-llms.mjs — shard ③ 소유
export function emitLlms({ pages, siteUrl, introMd }) {
  // pages = [{ route, title, summary, sourceMd }]  (렌더 직전 상태)
  return { 'llms.txt': '...', 'llms-full.txt': '...' };
}
```

반환 맵의 키가 그대로 `site/` 하위 파일명이 된다. 반환한 텍스트도 guard R1~R3 과
linkcheck(마크다운 링크 전수)를 거친다.

**②③④ 는 `site.config.mjs` 를 수정하지 않는다** — 콘텐츠 경로가 이미 전부 등재돼 있다.

---

## 주의

- GUIDE 는 **읽기 전용 입력**이다. 빌드가 원본에 쓰지 않고, 앵커도 심지 않는다
  (절번호→앵커 매핑은 `site.config.mjs` 에 둔다).
- 출력 디렉터리를 `dist/`·`build/` 로 바꾸지 말 것 — `check-source-exposure.mjs` 의
  `SKIP_DIRS` 가 그 이름을 건너뛰어 유출 게이트가 조용히 no-op 이 된다.
- `pnpm format`(루트)은 `**/*.md` 를 잡아 GUIDE 전체를 재포맷한다. 이 트랙에서 실행 금지.
- 빌드는 결정적이다(타임스탬프·난수·네트워크 0). 같은 입력이면 산출물 해시가 같다.
