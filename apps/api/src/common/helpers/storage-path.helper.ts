import * as path from 'path';

/**
 * 스토리지 경로 해석 + 경계 가드 (감사 §8 ⑦, 2026-08-01)
 *
 * outputFileUrl(스토리지 상대 URL `/storage/...`·`storage/...`, 절대경로, 또는 베어 상대경로)을
 * storage 루트 안의 파일시스템 절대경로로 해석한다. 루트 **밖**이면 null.
 *
 * 종전에는 worker-jobs.controller 와 files.service 가 같은 로직을 각자 복제하면서
 * 경계 검사를 `resolvedPath.startsWith(resolvedBase)` 로 했는데, 이는 **형제 접두사를
 * 통과시킨다** — `/app/storage-evil/x.pdf`.startsWith('/app/storage') === true.
 * 여기서는 구분자 경계(`base + path.sep`)를 강제해 그 결함을 닫는다.
 * 루트 자체(`resolvedPath === resolvedBase`)도 거부된다 — 파일을 기대하는 호출부에서
 * 디렉터리가 통과해 스트리밍이 깨지는 경로를 함께 막는다.
 */
export function resolveStoragePath(
  outputFileUrl: string,
  storageBase: string,
): string | null {
  let absolutePath: string;
  if (outputFileUrl.startsWith('/storage/')) {
    // /storage/temp/x.pdf → <base>/temp/x.pdf
    absolutePath = path.join(storageBase, outputFileUrl.replace(/^\/storage\//, ''));
  } else if (outputFileUrl.startsWith('storage/')) {
    absolutePath = path.join(storageBase, outputFileUrl.replace(/^storage\//, ''));
  } else if (path.isAbsolute(outputFileUrl)) {
    absolutePath = outputFileUrl; // 이미 절대경로 — 아래 경계 가드가 루트 밖을 거른다
  } else {
    absolutePath = path.join(storageBase, outputFileUrl);
  }

  const resolvedPath = path.resolve(absolutePath);
  const resolvedBase = path.resolve(storageBase);
  if (!resolvedPath.startsWith(resolvedBase + path.sep)) return null;
  return resolvedPath;
}
