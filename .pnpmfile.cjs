// pnpm 설치 훅 — 의존 그래프 보정(설치 시점에 실행되는 코드이므로 최소로 유지한다).
//
// typeorm 은 sqlite3·better-sqlite3·ts-node 를 optional peer 로 선언한다. pnpm 9 는 워크스페이스
// 그래프 어디에든 같은 이름의 패키지가 있으면 optional peer 를 연결하고 그 결과를 typeorm 스냅샷의
// optionalDependencies 로 lockfile 에 기록한다. 그래서 api 테스트 전용 sqlite 드라이버와 ts-node 가
// api·worker 운영 이미지의 `pnpm install --prod` 에도 설치된다(worker 는 해당 패키지를 선언조차 하지 않음).
// 운영 코드는 mysql2 만 쓴다. 테스트는 DataSource 의 `driver` 옵션으로 드라이버를 직접 넘긴다.
const TYPEORM_DETACHED_PEERS = ['sqlite3', 'better-sqlite3', 'ts-node'];

module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === 'typeorm') {
        for (const name of TYPEORM_DETACHED_PEERS) {
          if (pkg.peerDependencies) delete pkg.peerDependencies[name];
          if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta[name];
        }
      }
      return pkg;
    },
  },
};
