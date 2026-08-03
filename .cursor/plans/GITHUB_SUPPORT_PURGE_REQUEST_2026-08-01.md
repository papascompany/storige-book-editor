# GitHub Support 잔여 객체(dangling commits) 완전 제거 요청서

- 작성일: 2026-08-01 (RESUME §2 ⓗ)
- 대상 레포: `papascompany/storige-book-editor` (PUBLIC)
- 배경: 2026-07-27 히스토리 재작성(force-push)으로 VPS IP 등 민감정보를 제거 완료. 그러나 GitHub는 도달 불가능(dangling) 커밋을 서버측 GC 전까지 SHA 직접 조회로 계속 노출한다. 완전 제거는 GitHub Support의 수동 GC + 캐시 무효화가 필요하다.
- ⚠️ 이 문서에는 실제 IP·키 값을 절대 기재하지 않는다. 민감정보 유형은 "server IP addresses and since-rotated credentials"로만 서술한다.

---

## 1. 실측 결과 (2026-08-01 최초 실측 · **2026-08-02 재확인 — 표본 4건 전부 노출 지속**)

### 1-1. 노출 확인된 dangling 커밋 표본 (재작성 전 계보, full SHA)

| # | SHA | 웹 `/commit/<sha>` | API `repos/.../commits/<sha>` | 원격 refs 앵커 |
|---|-----|--------------------|-------------------------------|----------------|
| 1 | `43fc2ead27cfdb75594452f78aa0e20b7f9ffdec` | **200 (노출)** | **성공 (노출)** | 없음 (dangling) |
| 2 | `b3e77b83eab1a3f84f12430475be6d9bb5c6ddae` | **200 (노출)** | **성공 (노출)** | 없음 (dangling) |
| 3 | `566e5cfaf461c1def4c4d6fbe348c0875bb35150` | **200 (노출)** | **성공 (노출)** | 없음 (dangling) |
| 4 | `2fa7f1250934d27c19c2da96b57e89f8eda94954` | **200 (노출)** | **성공 (노출)** | 없음 (dangling) |
| 5 | `ec8b95c9bff40b5cdc1b55b596267ee010d7dbd2` | 404 | 422 No commit found | (원격 미푸시 로컬 커밋 — 표본 제외) |

- 표본 출처: 로컬 `backup/*-pre-rebase-20260727-*` 브랜치 3개 (SHA만 수집, 내용 미열람).
- 4건 모두 `git merge-base --is-ancestor` 검사로 **현 origin/master·원격 브랜치 10개·PR refs 11개 어디에서도 도달 불가** 확인 → 순수 dangling. 레포 오너가 지울 수 있는 ref는 더 없다 → Support 개입만 남음.

### 1-2. 원격 refs 청결 상태

- `git ls-remote origin` 총 22 refs: master + 브랜치 9 + `refs/pull/1~11/head` + HEAD.
- `backup/`·`pre-rebase` 계열 ref **원격에 없음** (청결).
- 포크 0개, PUBLIC, default branch=master → 포크 네트워크 오염 없음.

---

## 2. 제출 방법 (한국어 안내)

1. https://support.github.com/ 접속 → 로그인 (레포 오너 권한 계정 = papascompany 조직 권한 보유 계정).
2. **"Contact us"** → 제품 **"Repositories"** (또는 검색에서 "Remove sensitive data" 문서 하단의 Contact Support 경로).
   - 참고 문서: "Removing sensitive data from a repository" — 문서 자체가 "재작성 후 캐시 뷰·dangling 커밋 제거는 Support에 요청하라"고 안내함.
   - 제3자 정보 신고용 **Private Information Removal 폼**(support.github.com/contact/private-information)은 타인 레포 신고용이므로, **본인 소유 레포는 일반 Support 티켓**이 정석. 티켓 카테고리가 애매하면 "Repositories → Other"를 선택.
3. 폼 입력 항목:
   - **Subject**: `Purge dangling commits and cached views after sensitive-data history rewrite (papascompany/storige-book-editor)`
   - **Repository**: `papascompany/storige-book-editor`
   - **Body**: 아래 §3 영문 본문 복붙.
4. 제출 후 회신은 보통 수 일 내 (영업일 기준). 회신에서 추가 SHA 목록을 요구하면 §1-1 표의 4건을 그대로 제공.

---

## 3. 영문 요청 본문 (복붙용)

```text
Subject: Purge dangling commits and cached views after sensitive-data history rewrite (papascompany/storige-book-editor)

Hello GitHub Support,

I am the owner of the public repository papascompany/storige-book-editor.

On 2026-07-27 we completed a full history rewrite (force-push) of this
repository to remove sensitive data that had been committed in the past —
specifically server IP addresses and credentials that have since been
rotated. All refs on the remote now point exclusively to the rewritten
history, and we have verified there are no remaining branches, tags, or
backup refs referencing the old commits.

However, the pre-rewrite commits are still directly accessible on
github.com and via the REST API when addressed by SHA, because they remain
as unreachable (dangling) objects pending garbage collection. We have
verified (as of 2026-08-02) that the following sample commits from the old
history are still served, even though they are not reachable from any
branch, tag, or pull request ref:

  - 43fc2ead27cfdb75594452f78aa0e20b7f9ffdec
  - b3e77b83eab1a3f84f12430475be6d9bb5c6ddae
  - 566e5cfaf461c1def4c4d6fbe348c0875bb35150
  - 2fa7f1250934d27c19c2da96b57e89f8eda94954

(These are samples — please purge ALL unreachable objects from the
repository, not only the SHAs listed above.)

Could you please:

  1. Run garbage collection on the repository to permanently remove all
     unreachable (dangling) objects from the old, pre-rewrite history;
  2. Invalidate any cached views of the old commits and file contents
     (commit pages, diff views, raw/API responses, and any cached pull
     request views that may still reference the old objects);
  3. Confirm once the purge is complete, so we can re-verify that direct
     SHA lookups of the old commits return 404.

Additional context:
  - The exposed data (server IP addresses and credentials) has already
    been rotated/decommissioned on our side; this request is to complete
    the cleanup of the repository itself.
  - The repository has no forks (fork count 0), so no fork-network
    propagation is involved.

Thank you very much for your help.

papascompany (repository owner)
```

---

## 4. 오너 체크리스트

- [ ] **제출**: §2 경로로 Support 티켓 생성, §3 본문 복붙 제출.
- [ ] **회신 대기**: Support가 GC·캐시 무효화 완료를 회신할 때까지 대기. 추가 정보 요구 시 §1-1 표 참조(값이 아닌 SHA만 제공).
- [ ] **완료 검증** (회신 후 아래 4개 SHA 재확인 — 전부 404/422여야 완료):
  ```bash
  for s in 43fc2ead27cfdb75594452f78aa0e20b7f9ffdec \
           b3e77b83eab1a3f84f12430475be6d9bb5c6ddae \
           566e5cfaf461c1def4c4d6fbe348c0875bb35150 \
           2fa7f1250934d27c19c2da96b57e89f8eda94954; do
    echo "$s web=$(curl -s -o /dev/null -w '%{http_code}' \
      "https://github.com/papascompany/storige-book-editor/commit/$s")"
    gh api "repos/papascompany/storige-book-editor/commits/$s" --jq .sha 2>&1 | head -1
  done
  # 기대값: web=404, API "No commit found ... (HTTP 422)"
  ```
- [ ] **기록**: 완료 시 RESUME/HANDOFF에 ⓗ 종결 기록 (project_history_rewrite_2026-07-27 메모리 갱신 대상).
- [ ] (선택) 로컬 `backup/*-pre-rebase-*` 브랜치 3개는 Support 완료 검증이 끝날 때까지 보존 — 완료 후 삭제 여부는 오너 결정.

## 5. 이번 조사에서 확인된 부수 사실

- `ec8b95c9…`(e2-distribute 백업 선두)는 GitHub에 처음부터 없음(404/422) → 해당 브랜치 선두는 원격에 푸시된 적 없는 로컬 커밋. Support 요청 표본에서 제외했다.
- 원격 `refs/pull/1~11/head`는 전부 존재하지만, 노출 표본 4건을 앵커링하지 않음을 실측으로 확인했다(§1-1). PR refs가 옛 계보를 잡고 있는 상황이 아니므로 별도 PR ref 삭제 요청은 불필요.
