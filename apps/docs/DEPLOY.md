# 문서 포털 배포 절차 (`storige-docs`)

> **아직 배포하지 않았다.** 이 문서는 오너가 직접 실행할 절차서다.
> 프로젝트 생성·연결·배포는 전부 오너 액션이며, 자동화하지 않았다.

빌드 설정은 `apps/docs/vercel.json` 에 있다. CI 게이트는 `.github/workflows/ci.yml`
마지막 두 스텝(포털 빌드 + 산출물 업로드)이다.

---

## 0. 배포 전 오너 결정 3건

배포 자체보다 먼저 정리돼야 하는 항목이다.

| | 항목 | 상태 |
| --- | --- | --- |
| ⓐ | GUIDE 의 무인증 합성 엔드포인트 서술 공개 | 레포가 PUBLIC 이라 새 노출은 아니나, **검색 가능한 포털은 발견성이 질적으로 다르다**. 근본 해결은 해당 엔드포인트에 인증을 부여하는 것(별도 트랙) |
| ⓑ | GUIDE 의 과거 키 노출·회전 이력 문장 | 공개 문서에 남길지 판단 필요 |
| ⓒ | 프로덕션 도메인 | `docs.papascompany.co.kr` 등. 정하기 전까지는 프리뷰 URL 로만 확인 |

ⓐⓑ 는 GUIDE §3/§4 인접이라 이 트랙에서 임의로 삭제하지 않았다.

### 0-1. 색인 차단 게이트 — 무엇을 덮고 무엇을 못 덮나

색인 차단이 기본값이다. 축은 **3개**, 스위치는 **2개**다.

| 축 | 켜는 곳 | 실제 커버리지 |
| --- | --- | --- |
| HTML `<meta name="robots" content="noindex, nofollow">` | `vercel.json` 의 `build.env.STORIGE_DOCS_NOINDEX=1` → `build.mjs` → `templates/layout.mjs` | **HTML 페이지 전부.** `llms.txt`·`llms-full.txt`·`theme.css` 는 HTML 이 아니라 `<meta>` 를 넣을 자리가 없다 |
| HTTP `X-Robots-Tag: noindex, nofollow, noarchive` | `vercel.json` 의 `headers` 전용 블록 | **Vercel 이 서빙하는 모든 응답** — `.txt` 산출물 포함. `llms*.txt` 의 유일한 커버리지다 |
| `robots.txt` `Disallow: /` | `build.mjs` 가 NOINDEX 모드에서 자동 산출(공개 모드에서는 허용본을 산출) | 크롤 자체를 차단 |

따라서 **"공개" 액션은 두 곳을 지우는 것**이다: ① `build.env.STORIGE_DOCS_NOINDEX`,
② `headers` 의 `X-Robots-Tag` 블록. ①만 지우면 헤더 때문에 계속 색인되지 않고,
②만 지우면 meta 와 `robots.txt` 가 남는다. 한쪽만 지우고 "공개했다"고 판단하지 말 것.

> **⚠️ 이 게이트는 "비공개"가 아니다.** robots meta·`X-Robots-Tag`·`robots.txt` 는 전부
> **크롤러의 자발적 준수에 기대는 규약**이다. 배포된 URL 은 인증 없이 누구나 읽을 수 있고,
> 규약을 무시하는 스크레이퍼·수집기·아카이브는 그대로 가져간다. 프리뷰 URL 도 같다
> (추측은 어려워도 공유되는 순간 끝이다).
> 게다가 `Disallow: /` 는 크롤을 막기 때문에 크롤러가 meta/헤더의 noindex 를 **읽지도 못한다** —
> 외부에서 링크가 걸리면 본문 없이 URL 만 검색 결과에 남을 수 있다. 새 사이트의 색인 유입을
> 막는 데는 이 조합이 가장 강하지만, **이미 색인된 것을 지우는 용도로는 반대로 동작한다**
> (그때는 `Disallow` 를 풀어 noindex 를 읽히게 해야 한다).

**그래서 위 ⓐⓑ 는 이 게이트를 믿고 미룰 수 있는 항목이 아니다.** 게이트가 낮추는 것은
**검색 발견성**이고, 막지 못하는 것은 **읽힘**이다. 특히 `llms-full.txt` 는 전 페이지 원문을
한 파일에 담으므로 URL 을 아는 사람에겐 전 코퍼스가 한 번에 열린다. ⓐⓑ 는 **프리뷰 배포
전에** 정리하는 것이 안전하다.

---

## 1. 프로젝트 생성 (1회)

Vercel 대시보드에서 새 프로젝트를 만들고 이 레포를 연결한 뒤:

| 설정 | 값 | 이유 |
| --- | --- | --- |
| Project Name | `storige-docs` | admin 하위 경로가 아니라 **별도 프로젝트**(오너 결정 D-10d). admin 에 붙이면 인증 표면이 섞이고 `ignoreCommand` 침묵장애 이력과도 얽힌다 |
| **Root Directory** | **`apps/docs`** | 🔴 **가장 중요.** 아래 §2 참조 |
| Include source files outside of the Root Directory | **ON** | 빌드가 `cd ../..` 로 워크스페이스 루트에 올라간다. 꺼져 있으면 install 부터 실패한다 |
| Framework Preset | Other | `vercel.json` 의 `"framework": null` 과 일치 |
| Node.js Version | 22.x | CI(`setup-node@v4`, node 22)와 동일 |
| Build/Install/Output | **건드리지 말 것** | `apps/docs/vercel.json` 이 정본이다. 대시보드에서 덮어쓰면 레포와 갈린다 |

환경변수는 필수 항목이 없다. 선택 항목만:

| 이름 | 언제 | 효과 |
| --- | --- | --- |
| `STORIGE_DOCS_SITE_URL` | 도메인 확정 후 | `llms.txt` 의 링크를 절대 URL 로 만든다. 값이 있으면 그 호스트가 guard R1 화이트리스트에 자동 추가된다 |
| `STORIGE_DOCS_NOINDEX` | 위 §0-1 참조 | `vercel.json` 에 `1` 로 박혀 있다. HTML meta + `robots.txt` 를 담당한다. 공개 시 이 줄과 `X-Robots-Tag` 헤더 블록을 **함께** 지운다 |

---

## 2. 🔴 Root Directory 를 루트로 두지 말 것

레포 **루트의 `vercel.json`** 에는 내부 서버로 향하는 평문 HTTP `rewrites` 가 남아 있다
(2026-02 이후 미변경 레거시. admin·editor 는 각자 `vercel.json` 을 갖고 있어 영향받지 않는다).

Root Directory 를 루트로 두면 문서 사이트가 **그 rewrites 를 상속해 `/api/*` 와
`/storage/*` 를 내부 주소로 평문 프록시한다.** 문서 사이트가 API 프록시가 되는 것이고,
내부 주소가 응답 헤더·오류 페이지로 새어 나갈 수 있다.

`apps/docs/vercel.json` 에는 `rewrites` 키가 **없다**(순수 정적, 백엔드 프록시 0).
Root Directory 를 `apps/docs` 로 두는 것이 이 트랙의 유일한 방어책이다.

> 별건 오너 액션: `vercel project ls` 로 **루트를 Root Directory 로 참조하는 프로젝트가
> 없는지** 확인하고, 없으면 루트 `vercel.json` 을 제거하거나 내부 주소를 공개 도메인으로
> 치환할 것. 이 트랙에서는 소유 밖이라 손대지 않았다.

---

## 3. 배포

```bash
# 프리뷰 (오너 확인용)
vercel deploy            # apps/docs 에서, 프로젝트 연결 후

# 프로덕션 (위 §0 정리 후)
vercel deploy --prod
```

### 3-1. 배포 직후 노출 게이트 실측 (건너뛰지 말 것)

헤더는 **빌드 산출물이 아니라 배포 플랫폼이 붙인다.** 로컬 빌드로는 확인할 수 없으므로
프리뷰가 뜨자마자 실제 응답으로 확인한다. `llms-full.txt` 가 전 페이지 원문을 담은
가장 민감한 파일이라 이 파일로 확인하는 것이 요점이다(HTML 만 확인하면 meta 때문에
통과한 것처럼 보인다).

```bash
U=<프리뷰-URL>
curl -sI "$U/llms-full.txt" | grep -i x-robots-tag   # → x-robots-tag: noindex, nofollow, noarchive
curl -s  "$U/robots.txt"                             # → User-agent: * / Disallow: /
curl -s  "$U/" | grep -i 'name="robots"'             # → <meta name="robots" content="noindex, nofollow">
```

세 줄이 전부 나와야 §0-1 의 표가 사실이 된다. **`x-robots-tag` 가 비어 있으면**
`vercel.json` 의 헤더 블록 2개(보안 헤더 + `X-Robots-Tag`)가 같은 `source` 라서 뒤 블록이
누락된 것이다 — 그때는 두 블록을 하나로 합쳐 다시 배포한다(Vercel 은 매칭되는 헤더 항목을
모두 적용하지만, 이 확인 없이 적용됐다고 단정하지 않는다).

git 연동을 켜면 `master` push 마다 프로덕션이 갱신된다. `ignoreCommand` 가
아래 경로 중 변경이 있을 때만 빌드한다:

| 감시 경로 | 왜 |
| --- | --- |
| `./` | 포털 소스·콘텐츠·이 설정 |
| `../../docs` | **GUIDE 본문** — 포털이 발행하는 실체 |
| `../../apps/api/src` | OpenAPI 스펙이 컨트롤러/DTO 에서 생성된다 |
| `../../packages/types` | 스펙 생성이 `@storige/types` dist 를 소비한다 |
| `../../scripts` | `check-source-exposure.mjs`(postbuild 게이트) |
| `../../pnpm-lock.yaml` | `marked` 버전 |

`VERCEL_GIT_PREVIOUS_SHA` 가 비었거나 **그 SHA 가 이 클론에 없으면**(force-push·shallow
clone 후 흔히 발생) `git cat-file -e` 폴백이 `exit 1` 로 떨어져 **무조건 빌드한다.**
이 폴백이 없으면 `git diff` 가 bad-object 로 죽고 배포가 통째로 ERROR 가 되면서
라이브가 옛 빌드에 고착된다 — 2026-07 에 admin 에서 실제로 겪은 사고다.

---

## 4. 빌드가 하는 일

`vercel.json` 의 `buildCommand` 는 순서 의존이 있다.

```
cd ../..
  → pnpm --filter @storige/types build      # ① @storige/types 는 dist 를 소비당한다.
  → pnpm --filter @storige/api openapi:partner   # ② 스펙 생성(gitignored 라 레포에 없다)
  → pnpm --filter @storige/docs build       # ③ 슬라이스→렌더→guard→linkcheck→postbuild
```

- ① 을 빼면 **Vercel 에서만** 실패한다(로컬엔 dist 가 이미 있어서 안 보인다).
- ② 산출물은 `apps/api/openapi-partner.json` 에 떨어지고 `build.mjs` 가 그 경로를 찾는다.
  별도 env 가 필요 없다. 로컬에는 `pnpm docs:spec` 이 만드는 `apps/docs/.generated/` 사본이
  추가로 있을 수 있는데, **둘 다 있고 내용이 다르면 mtime 최신본을 쓰고 경고를 찍는다**
  (예전엔 `.generated/` 를 무조건 우선해서 낡은 레퍼런스가 조용히 렌더됐다. Vercel 에는
  `.generated/` 가 없으므로 이 분기는 로컬 전용이다).
- ③ 의 `postbuild` 가 `check-source-exposure.mjs site` 를 돌린다.
- ③ 은 `robots.txt` 도 산출한다(§0-1). `STORIGE_DOCS_NOINDEX` 값에 따라 차단본/허용본이
  갈리며, 모드와 무관하게 파일은 **항상** 나온다 — 파일이 없으면 "차단 모드인데 누락"과
  "공개 모드"를 산출물에서 구분할 수 없기 때문이다.

`installCommand` 는 `--filter @storige/docs... --filter @storige/api...` 로 좁혔다.
스펙 생성이 API 의존 트리를 필요로 하기 때문에 API 를 뺄 수 없다 — 즉 **문서 배포가
API 의 설치 건강도에 결합돼 있다.** `--ignore-scripts` 로 네이티브 빌드 스크립트를
건너뛰어 완화했지만(sharp 0.33 은 플랫폼별 optional 패키지라 스크립트가 필요 없다),
API 의존성이 설치 불가 상태가 되면 문서 배포도 함께 죽는다. 수용된 트레이드오프다.

`--frozen-lockfile` 을 쓴다 — **admin·editor(`--no-frozen-lockfile`)와 여기서만 다르다.**
문서 포털은 파트너가 읽는 공개 발행물이라 **CI 가 검증한 트리와 배포가 빌드한 트리가
갈리면 안 된다.** CI(`.github/workflows/ci.yml`)가 `pnpm install --frozen-lockfile` 로 도는데
배포만 `--no-frozen-lockfile` 이면, 락파일이 드리프트했을 때 CI 는 빨갛게 죽고 배포는
**다른 트리로 조용히 성공한다** — 무엇이 발행됐는지 CI 로 설명할 수 없게 된다.

대가는 락파일이 드리프트하면 배포가 **즉시 실패**한다는 것이다(의도된 실패다). 복구는
`pnpm install` 로 락파일을 갱신해 커밋하는 것이고, 그 커밋이 CI 도 함께 초록으로 만든다.

---

## 5. 로컬에서 같은 것 돌리기

```bash
pnpm docs:build     # 스펙 생성 + 포털 strict 빌드 (= Vercel 과 같은 순서)
pnpm check:exposure # 소스측 게이트 (apps · packages · examples · docs)
```

`pnpm build`(루트 turbo)는 **문서 포털을 제외한다** — 스펙 선행 생성이 필요해서
스펙 없이 돌면 루트 전체 빌드가 깨지기 때문이다. 포털은 `pnpm docs:build` 와
CI 스텝, 그리고 Vercel 이 각각 돌린다.

---

## 6. 롤백

```bash
vercel ls storige-docs           # 배포 목록
vercel promote <이전-배포-URL>    # 직전 Ready 배포로 되돌린다
```

포털은 순수 정적 산출물이라 롤백에 부작용이 없다(DB·큐·외부 상태 0).

---

## 7. 주의

- **`headers` 의 CSP 는 `default-src 'none'` 이다.** 현재 산출물은 JS 0줄·인라인 스타일
  0건·외부 요청 0건이라 통과한다. `content/*.md` 에 `<script>` 나 인라인 `<style>`,
  외부 이미지·폰트를 넣으면 **브라우저에서 조용히 차단된다**(빌드는 통과한다).
  그런 게 필요하면 CSP 를 함께 고쳐야 한다.
- `theme.css` 는 콘텐츠 해시가 붙지 않는 고정 이름이라 `Cache-Control` 을
  `max-age=0, must-revalidate` 로 뒀다. 배포 후 옛 CSS 가 남는 것을 막는다.
  `immutable` 로 바꾸지 말 것.
- **`X-Robots-Tag` 는 `headers` 배열의 독립 블록이다.** 보안 헤더 블록과 일부러 분리했다 —
  공개할 때 블록째 지우면 되고, 그 과정에서 CSP·`X-Frame-Options` 를 같이 날릴 위험이 없다.
- **`robots.txt` 는 빌드 산출물이다.** `site/` 에 손으로 파일을 두지 말 것 — 빌드가 `site/` 를
  통째로 지우고 다시 만든다. 내용을 바꾸려면 `build.mjs` 의 `renderRobots()` 를 고친다.
- `trailingSlash` 를 **설정하지 않았다.** 포털 내부 링크는 전부 `/guide/` 형태이고
  Vercel 기본 동작으로 해석된다. 켜면 `/llms.txt` 같은 확장자 경로의 동작을 다시
  검증해야 한다(E-4 산출물이라 깨지면 곧바로 손해다).
- `apps/api/src/portal/` 은 이것과 **다른 것**이다(파트너 셀프서비스 표면 "파트너 포털 v0").
  이쪽은 "문서 포털 / Docs" 다.
