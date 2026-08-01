# 소스맵 공개 차단 런북 (source-exposure)

> 최초 작성 2026-07-27. 대상: `apps/editor`(editor.papascompany.co.kr) · `apps/admin`(admin.papascompany.co.kr) ·
> 임베드 번들(`dist-embed`) · VPS editor 컨테이너.
> ⚠️ 이 문서에는 토큰·키·호스트 실값을 적지 않는다. 실값은 `CLAUDE.local.md`(gitignored) 소관.

> ## ✅ 상태: 오너 액션 전량 완료 — hidden + 업로드 + 삭제 LIVE (2026-07-30)
>
> - **07-28**: `SOURCEMAP_STRIP=1` Production 등록 + CLI 배포 → 노출 차단 선행 적용.
> - **07-30**: `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` 3종을 editor·admin
>   **Production + Preview** 에 등록 → **심볼리케이션 복구**(빌드 로그 `sentryUpload=on` ·
>   `Uploaded files to Sentry` · editor 맵 24건/admin 6건 제거 실증). "노출 차단 = 심볼리케이션
>   포기" 트레이드오프는 소멸했다. `SOURCEMAP_STRIP=1` 은 이중 안전판으로 유지.
> - 따라서 §2(오너 액션)·§4(STRIP 단독 모드)·§5 표는 **이행 이력**이다. 현재 유효한 절차는
>   §3(배포 후 검증)과 §6(롤백) — 새 프론트 앱을 추가할 때만 §2 를 재실행한다.

## 0. 한 줄 요약

빌드가 **토큰 3종(`SENTRY_ORG`·`SENTRY_PROJECT`·`SENTRY_AUTH_TOKEN`)이 모두 있을 때만** 소스맵을
`hidden` 으로 만들고 Sentry 에 업로드한 뒤 배포 산출물에서 지운다. 셋 중 하나라도 없으면 **아무것도 바뀌지 않는다**
(현행 유지 = 맵 공개, 심볼리케이션 유지). 업로드 없이 노출만 즉시 끊고 싶으면 `SOURCEMAP_STRIP=1`.

## 1. 배경 (왜 이런 구조인가)

- 프로덕션 `dist/*.map` 이 `sourcesContent` 를 포함한 채 공개 서빙됐다(2026-07-27 실측: editor 24청크 25.5MB,
  admin 단일 8.26MB). 원본 TS 전문이 그대로 열람 가능했다.
- 그런데 **현재 Sentry 심볼리케이션의 유일한 경로가 그 공개 맵**이다(업로드된 아티팩트도, debug ID 도 0건).
  맵만 지우면 스택트레이스가 전부 minified 로 떨어진다.
- 그래서 "업로드 배선"과 "맵 제거"를 한 스위치로 묶었다. 둘 중 하나만 켜지는 상태를 만들 수 없다.

## 2. 오너 액션 (이것만 하면 전환된다)

### 2-1. Sentry Organization Auth Token 발급

1. Sentry → **Settings → Auth Tokens** (조직 설정. 구 UI 는 Developer Settings → Organization Tokens).
   - 직접 링크: `https://sentry.io/orgredirect/organizations/:orgslug/settings/auth-tokens/`
2. **Organization Auth Token** 으로 생성한다(접두사 `sntrys_`). CI 용도로 Sentry 가 권장하는 종류이고
   소스맵 업로드 권한이 기본 포함이라 스코프를 따로 고를 필요가 없다.
   - Personal Token 을 쓸 거면 `Project: Read & Write` + `Release: Admin` 을 직접 체크해야 한다.
3. **생성 직후 1회만 표시된다.** 그 자리에서 복사해 둘 것.

### 2-2. 프로젝트 slug 확인

Sentry → Projects 목록에서 대상 프로젝트를 열고 URL 의 `.../projects/<slug>/` 부분이 slug 다.
editor 와 admin 은 **서로 다른 프로젝트**이므로 slug 도 다르다. (DSN 에는 숫자 id 만 있어 slug 를 유추할 수 없다.)

### 2-3. Vercel 환경변수 등록

`storige-editor`, `storige-admin` **각각** 에 3개씩. 환경은 **Production + Preview** 둘 다 권장
(Preview 도 공개 URL 이라 같은 노출 위험이 있다).

| 변수 | storige-editor | storige-admin |
|---|---|---|
| `SENTRY_ORG` | 조직 slug (동일) | 조직 slug (동일) |
| `SENTRY_PROJECT` | editor 프로젝트 slug | **admin** 프로젝트 slug |
| `SENTRY_AUTH_TOKEN` | 2-1 토큰 (동일 값 재사용 가능) | 동일 |

⚠️ **CLI 로 등록하지 말고 대시보드에 붙여넣기를 권장한다.** 이 레포의 기존 등록 스크립트
(`scripts/activate-sentry.sh`)가 `echo "$V" | vercel env add` 를 써서 값 끝에 **개행이 저장된 전례**가 있다
(실측: 프로덕션 번들의 `environment` 가 `"production\n"`). 굳이 CLI 를 쓴다면 `printf '%s'` 를 쓸 것.
빌드 쪽은 값을 `trim()` 하도록 방어해 뒀지만, 오염된 값은 다른 곳에서 또 문제를 만든다.

### 2-4. 재배포

`storige-editor`/`storige-admin` 을 각각 Redeploy(또는 아무 커밋 push). 빌드 로그에서 확인:

```
[vite.config] sourcemap=hidden(+strip) sentryUpload=on release=storige-editor@<sha7> ...
[strip-sourcemaps] ✓ .map N건 제거 (~MB) — 배포 산출물에 소스맵 없음
```

`sentryUpload=off` 로 찍히면 3종 중 하나가 비었거나 오타다.

## 3. 검증 (배포 후)

### 3-1. editor — 맵 404

```bash
f=$(curl -s https://editor.papascompany.co.kr/ | grep -o 'assets/index-[A-Za-z0-9._-]*\.js' | head -1)
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" "https://editor.papascompany.co.kr/$f.map"   # 404 기대
curl -s -o /dev/null -w "%{http_code}\n" https://editor.papascompany.co.kr/stats.html                  # 404 기대
```

### 3-2. admin — 상태코드로 판정하면 **오판한다**

`apps/admin/vercel.json` 의 catch-all rewrite(`/(.*)` → `/`) 때문에 없는 파일도 **200 + index.html** 을 준다.
반드시 content-type/길이로 판정할 것.

```bash
f=$(curl -s https://admin.papascompany.co.kr/ | grep -o 'assets/index-[A-Za-z0-9._-]*\.js' | head -1)
curl -s -o /dev/null -w "%{http_code} %{content_type} %{size_download}\n" "https://admin.papascompany.co.kr/$f.map"
# 기대: 200 text/html <1KB  (= SPA 폴백 = 맵 없음)
# 실패: 200 application/json 수 MB (= 맵이 아직 있음)
```

### 3-3. Sentry 심볼리케이션 (업로드까지 켠 경우)

배포 후 발생한 **새 이슈** 1건을 열어 스택 프레임이 `src/...tsx:줄` 로 보이는지 확인한다.
`vendor-xxxx.js:1:284119` 형태면 업로드가 안 붙은 것이다(빌드 로그의 업로드 실패 경고를 확인).

## 4. 지금 당장 노출만 끊고 싶을 때 (Sentry 없이)

Vercel 환경변수에 `SOURCEMAP_STRIP=1` 하나만 추가하고 재배포.
- 맵은 즉시 사라진다.
- 대신 그 시점부터 Sentry 스택트레이스가 minified 로 남는다(업로드가 없으므로).
- 나중에 토큰 3종을 채우면 자동으로 업로드까지 켜진다(`SOURCEMAP_STRIP` 은 남겨둬도 무해).

## 5. 이 변경이 **당장** 바꾸는 것 / **오너 액션 후** 바뀌는 것

| 항목 | 지금(머지 즉시) | 토큰 3종 등록 후 |
|---|---|---|
| Vercel editor/admin `.map` | 그대로 공개(현행 유지) | 제거 |
| `/stats.html`(모듈 트리 2,866건) | **즉시 제거**(`ANALYZE=1` 일 때만 생성) | 동일 |
| 임베드 번들 `dist-embed/*.map` | **즉시 제거**(postbuild:embed) | 동일 |
| VPS editor 컨테이너(:3000) | 재빌드 시 **제거**(Dockerfile `SOURCEMAP_STRIP=1`) + nginx `.map` 404 | 동일 |
| Sentry 심볼리케이션 | 현행 유지(공개 맵 스크래핑) | 업로드 아티팩트 + debug ID |

## 6. 롤백

1. **1순위**: `vercel promote <직전 Ready 배포 URL>` — 코드 무변경 즉시 복구.
2. 2순위: Vercel 에서 `SENTRY_AUTH_TOKEN`(또는 3종 중 하나)만 지우고 재배포 → 자동으로 현행 유지 모드로 돌아간다.
3. 3순위: 커밋 revert(`pnpm-lock.yaml` 까지 되돌아가므로 가장 무겁다).

## 7. 구조 메모 (유지보수자용)

- 정책 단일 소스 = `apps/{editor,admin}/vite.config.ts` 상단의 `canUploadSourcemaps` / `stripSourcemaps`.
  같은 계산을 `scripts/strip-sourcemaps.mjs` 의 `expectHiddenFromEnv()` 가 복제한다(산출물에서 추론하지 않는다).
- 삭제 시점은 **postbuild 체인의 유출 검사 뒤**다. `.map` 의 `sourcesContent` 가 `check-source-exposure --dist` 의
  가장 민감한 탐지 채널이라 순서를 바꾸면 커버리지를 잃는다.
- 플러그인 내장 `filesToDeleteAfterUpload` 는 **쓰지 않는다** — 업로드 실패/스킵과 무관하게 `finally` 에서 지워
  '맵 삭제 O · 업로드 X' 무증상 조합을 만든다.
- 업로드 실패 시: 빌드는 통과(fail-open, Sentry 장애가 배포를 막으면 안 된다) + 맵은 예정대로 삭제 + 로그에 경고.
  `hidden` 은 참조 주석이 없어 맵을 남겨도 Sentry 가 발견하지 못하므로 보존은 순손해다.
- 교차 확인은 '**실재하는 .map 을 가리키는** 말미 참조'만 위반으로 센다. 벤더 산출물
  (onnxruntime `ort.bundle.min-*.mjs`)은 없는 맵을 가리키는 dangling 참조를 갖고 있어 오탐 대상이다.
- 회귀 가드: `node scripts/strip-sourcemaps.mjs --self-test` (CI 등록됨). CI 는 editor/admin 을 빌드하지 않으므로
  이 self-test 가 판정 로직의 유일한 자동 가드다.
- turbo 경로(`pnpm build`)는 `turbo.json` 의 `build.env` 에 5종을 선언해야 env 가 태스크로 전달된다(strict 모드).

## 8. 잔여 (오너 결정 대기)

- **VPS editor 컨테이너 포트**: `docker-compose.yml` 의 `editor` 서비스가 `3000:80` 으로 **공개** 바인딩돼 있다
  (Docker 포트 매핑은 ufw 를 우회한다). 이 컨테이너는 Vercel editor 와 중복이므로 `127.0.0.1:3000:80` 으로 제한하거나
  서비스 자체를 내리는 편이 낫다 — 용도 확인 후 결정.
- **루트 `vercel.json`** 의 rewrite destination 에 IP 가 평문으로 남아 있다. editor/admin 은 각자
  `apps/*/vercel.json` 을 쓰므로 dead config 로 보이나, 사용하는 프로젝트가 없는지 확인 후 정리.
