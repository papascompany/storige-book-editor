/**
 * presigned complete 사이트 귀속 근거 해석(v1.9) — 컨트롤러가 presigned 서비스에 넘기는 caller.
 *
 *  - 우선순위: 검증된 shop-session·운영자 토큰 사이트 → 검증된 활성 사이트 키 사이트.
 *  - 두 근거가 서로 다른 사이트면 caller 없음(귀속 없음) + 경고 로그 1줄(사이트 id 는 축약).
 *  - admin JWT·siteId 없는 토큰은 토큰 근거가 아니다(사이트 키가 있으면 키 근거).
 *  - 서비스 호출 인자 개수는 종전과 같다(complete 3, multipart 4).
 */
import { Logger } from '@nestjs/common';
import { FilesController } from './files.controller';
import type { FilesService } from './files.service';
import type { PresignedUploadService } from './presigned-upload.service';
import type { ApiKeySitePayload } from '../auth/guards/optional-api-key-site.guard';

const FILE_ID = '33333333-3333-4333-8333-333333333333';
const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOKEN = 'upload-token-1';

const shopA = { userId: '777', source: 'shop', role: 'customer', siteId: SITE_A };
const operatorA = { source: 'partner_operator', role: 'partner_operator', siteId: SITE_A };
const adminWithSiteA = { id: 'admin-1', role: 'ADMIN', siteId: SITE_A };
const shopNoSite = { userId: '777', source: 'shop', role: 'customer' };
const keyA: ApiKeySitePayload = { siteId: SITE_A, siteName: 'A' };
const keyB: ApiKeySitePayload = { siteId: SITE_B, siteName: 'B' };

type Route = 'completeUpload' | 'multipartComplete';

describe('FilesController — presigned complete 귀속 근거 해석(v1.9)', () => {
  let presigned: { completeSingle: jest.Mock; completeMultipart: jest.Mock };
  let controller: FilesController;

  beforeEach(() => {
    presigned = {
      completeSingle: jest.fn(async () => ({ id: FILE_ID })),
      completeMultipart: jest.fn(async () => ({ id: FILE_ID })),
    };
    controller = new FilesController(
      { toResponseDto: (f: { id: string }) => ({ id: f.id }) } as unknown as FilesService,
      presigned as unknown as PresignedUploadService,
    );
  });

  const callRoute = (route: Route, user: unknown, apiKeySite?: ApiKeySitePayload) =>
    route === 'completeUpload'
      ? controller.completeUpload(FILE_ID, { uploadToken: TOKEN }, user, apiKeySite)
      : controller.multipartComplete(
          { fileId: FILE_ID, uploadToken: TOKEN, parts: [{ partNumber: 1, etag: 'e1' }] },
          user,
          apiKeySite,
        );

  /** 서비스에 넘어간 caller 인자와 인자 개수 */
  const serviceCall = (route: Route): { caller: unknown; argc: number } => {
    const calls =
      route === 'completeUpload' ? presigned.completeSingle.mock.calls : presigned.completeMultipart.mock.calls;
    expect(calls).toHaveLength(1);
    const args = calls[0] as unknown[];
    return { caller: route === 'completeUpload' ? args[2] : args[3], argc: args.length };
  };

  describe.each<Route>(['completeUpload', 'multipartComplete'])('%s', (route) => {
    const expectedArgc = route === 'completeUpload' ? 3 : 4;

    it.each<[string, unknown, ApiKeySitePayload | undefined, unknown]>([
      ['토큰·키 없음', undefined, undefined, undefined],
      ['shop-session(A)', shopA, undefined, { siteId: SITE_A, role: 'shop' }],
      ['운영자 토큰(A)', operatorA, undefined, { siteId: SITE_A, role: 'shop' }],
      ['사이트 키(A)만', undefined, keyA, { siteId: SITE_A, role: 'site-key' }],
      ['shop-session(A) + 키(A)', shopA, keyA, { siteId: SITE_A, role: 'shop' }],
      ['admin JWT(siteId A) + 키(B)', adminWithSiteA, keyB, { siteId: SITE_B, role: 'site-key' }],
      ['siteId 없는 shop 토큰 + 키(A)', shopNoSite, keyA, { siteId: SITE_A, role: 'site-key' }],
    ])('%s → 서비스 caller 인자', async (_l, user, apiKeySite, expected) => {
      await callRoute(route, user, apiKeySite);
      const { caller, argc } = serviceCall(route);
      expect(caller).toEqual(expected);
      expect(argc).toBe(expectedArgc);
    });

    it.each<[string, unknown]>([
      ['shop-session(A)', shopA],
      ['운영자 토큰(A)', operatorA],
    ])('%s + 키(B) → caller 없음, 경고 로그 1줄(사이트 id 는 축약)', async (_l, user) => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        await callRoute(route, user, keyB);
        const { caller, argc } = serviceCall(route);
        expect(caller).toBeUndefined();
        expect(argc).toBe(expectedArgc);
        const lines = warn.mock.calls
          .map((c: unknown[]) => String(c[0]))
          .filter((m: string) => m.startsWith('[presigned-stamp]'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(route === 'completeUpload' ? 'route=single' : 'route=multipart');
        expect(lines[0]).not.toContain(SITE_A);
        expect(lines[0]).not.toContain(SITE_B);
      } finally {
        warn.mockRestore();
      }
    });
  });
});
