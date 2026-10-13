/**
 * e2e 용 SitesService 대역.
 *
 * 운영에서는 SitesModule 이 @Global 이라 ApiKeyGuard·ApiKeyStrategy 가 어느 모듈에서 만들어져도
 * SitesService 를 주입받는다. e2e spec 은 sites 테이블을 띄우지 않으므로, 같은 전역 토큰에
 * 테스트 키 하나만 사이트로 인정하는 대역을 건다. 그 밖의 키는 운영과 같이 '사이트 없음'이다.
 */
import { Global, Module } from '@nestjs/common';
import { SitesService } from '../../src/sites/sites.service';

export const E2E_SITE_API_KEY = 'test-api-key-for-testing';

export const E2E_SITE = {
  id: 'e2e-site-id',
  name: 'e2e-site',
  retentionDays: null,
} as const;

export const sitesServiceStub = {
  findByEditorAuthCode: jest.fn(async (code: string) =>
    code === E2E_SITE_API_KEY ? E2E_SITE : null,
  ),
  findByWorkerAuthCode: jest.fn(async (_code: string) => null),
};

@Global()
@Module({
  providers: [{ provide: SitesService, useValue: sitesServiceStub }],
  exports: [SitesService],
})
export class SitesServiceStubModule {}
