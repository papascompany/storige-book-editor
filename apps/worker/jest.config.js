module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '(src|test)/.*\\.(spec|e2e-spec)\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    // R-44 수정: 종전 '<rootDir>/../packages/...' 는 apps/packages(부재)를 가리키는
    // 오경로 — 워커 spec 이 @storige/types 를 실제 import 하기 전까진 잠복해 있었다.
    // api jest.config.js 와 동일하게 모노레포 루트 기준으로 정렬.
    '^@storige/types$': '<rootDir>/../../packages/types/src/index.ts',
  },
};
