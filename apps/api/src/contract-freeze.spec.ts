/**
 * 동결 표면 contract test (Phase 0 — docs/CONTRACT_FREEZE.md 집행기)
 *
 * 파트너 4종(bookmoa-mobile·Sharesnap·100p·MD2Books)이 의존하는 외부 HTTP 표면의
 * "경로·HTTP 메서드·인증 시맨틱(@Public / ApiKeyGuard)·레이트리밋 존재"를
 * Nest 데코레이터 메타데이터 리플렉션으로 단언한다.
 *
 * 왜 리플렉션인가: 앱 부트스트랩/DB 없이 수 ms 에 돌고, 라우트 경로·가드가
 * "실수로" 바뀌는 순간 red — CONTRACT_FREEZE 의 문서 동결을 CI 게이트로 승격.
 *
 * ⚠️ 이 테스트가 빨간불이면 두 가지 중 하나다:
 *   (a) 실수 — 되돌려라. 파트너 계약 표면은 Phase 6 이전 변경 금지.
 *   (b) 의도된 계약 변경 — docs/CONTRACT_FREEZE.md 갱신 + 파트너 공지 + 오너 승인
 *       후에만 이 spec 을 함께 갱신한다(동결 규약 §4: additive 는 contract test
 *       동시 갱신 조건부 허용).
 *
 * 하우스 규약: 외부(external) 라우트는 `@Public()`(전역 JwtAuthGuard 우회) +
 * `@UseGuards(ApiKeyGuard)`(X-API-Key 검증) "조합"이 정상 패턴이다 — @Public 만
 * 있으면 무인증, 조합이면 API Key 인증.
 */
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { FilesController } from './files/files.controller';
import { WorkerJobsController } from './worker-jobs/worker-jobs.controller';
import { EditSessionsController } from './edit-sessions/edit-sessions.controller';
import { IS_PUBLIC_KEY } from './auth/decorators/public.decorator';
import { ApiKeyGuard } from './auth/guards/api-key.guard';

type Ctor = new (...args: never[]) => unknown;

interface FrozenRoute {
  /** 사람이 읽는 계약 표기 (CONTRACT_FREEZE 대응) */
  contract: string;
  controller: Ctor;
  handler: string;
  method: RequestMethod;
  path: string;
  /** true = 무인증(@Public 단독) / 'api-key' = @Public + ApiKeyGuard 조합 */
  auth: 'public' | 'api-key';
  /** @Throttle 데코레이터 존재 필수 여부 */
  throttled?: boolean;
}

/** docs/CONTRACT_FREEZE.md §1(업로드)·§2(워커 잡)·§3(다운로드/조회) 동결 표면 스냅샷 */
const FROZEN_ROUTES: FrozenRoute[] = [
  // ── 업로드 표면 (§1) — 100p·bookmoa presigned 3단계 의존, 인증 강제 시 파손 ──
  { contract: 'POST /files/upload/external (X-API-Key)', controller: FilesController, handler: 'uploadFileExternal', method: RequestMethod.POST, path: 'upload/external', auth: 'api-key' },
  { contract: 'POST /files/presigned-upload-public (@Public 무인증 — 100p 의존)', controller: FilesController, handler: 'presignUploadPublic', method: RequestMethod.POST, path: 'presigned-upload-public', auth: 'public', throttled: true },
  { contract: 'POST /files/multipart/init (@Public)', controller: FilesController, handler: 'multipartInit', method: RequestMethod.POST, path: 'multipart/init', auth: 'public', throttled: true },
  { contract: 'POST /files/multipart/sign (@Public)', controller: FilesController, handler: 'multipartSign', method: RequestMethod.POST, path: 'multipart/sign', auth: 'public', throttled: true },
  { contract: 'POST /files/multipart/complete (@Public)', controller: FilesController, handler: 'multipartComplete', method: RequestMethod.POST, path: 'multipart/complete', auth: 'public', throttled: true },
  { contract: 'POST /files/multipart/abort (@Public)', controller: FilesController, handler: 'multipartAbort', method: RequestMethod.POST, path: 'multipart/abort', auth: 'public', throttled: true },
  { contract: 'POST /files/:id/complete (@Public)', controller: FilesController, handler: 'completeUpload', method: RequestMethod.POST, path: ':id/complete', auth: 'public', throttled: true },

  // ── 다운로드/서빙 표면 (§3) ──
  { contract: 'GET /files/:id/download/external (X-API-Key, 무소유검증 특성 동결)', controller: FilesController, handler: 'downloadFileExternal', method: RequestMethod.GET, path: ':id/download/external', auth: 'api-key' },
  { contract: 'GET /files/:id/raw (@Public 이미지 전용 + Throttle)', controller: FilesController, handler: 'getRawFile', method: RequestMethod.GET, path: ':id/raw', auth: 'public', throttled: true },
  { contract: 'DELETE /files/:id/external (X-API-Key, 404=성공)', controller: FilesController, handler: 'deleteFileExternal', method: RequestMethod.DELETE, path: ':id/external', auth: 'api-key' },
  { contract: 'POST /files/:id/expiry/external (X-API-Key)', controller: FilesController, handler: 'setFileExpiryExternal', method: RequestMethod.POST, path: ':id/expiry/external', auth: 'api-key' },
  // P0-3 (2026-07-03) 인증 전환 — CONTRACT_FREEZE §5 유일 MODIFY-TARGET 집행 결과
  { contract: 'GET /files/:id/thumbnail (X-API-Key + Throttle — 2026-07-03 @Public 에서 전환)', controller: FilesController, handler: 'getThumbnail', method: RequestMethod.GET, path: ':id/thumbnail', auth: 'api-key', throttled: true },

  // ── 워커 잡 표면 (§2) — 게스트 UX 의존 @Public 동결 ──
  { contract: 'POST /worker-jobs/compose-mixed (@Public 게스트 — bookmoa-mobile·Sharesnap 의존)', controller: WorkerJobsController, handler: 'createComposeMixed', method: RequestMethod.POST, path: 'compose-mixed', auth: 'public' },
  { contract: 'POST /worker-jobs/render-pages (@Public 게스트)', controller: WorkerJobsController, handler: 'createRenderPages', method: RequestMethod.POST, path: 'render-pages', auth: 'public' },
  // ADDITIVE 2026-07-13 — fix-bleed(도련 자동 삽입) 실행기. editSize 는 서버가 templateSet 에서
  // 권위 산출(body={fileId,templateSetId} 뿐 — 임의 사이즈 입력 차단). 게스트 편집기 모달 소비.
  { contract: 'POST /worker-jobs/fix-bleed (@Public 게스트 — 2026-07-13 신설)', controller: WorkerJobsController, handler: 'createBleedFixJob', method: RequestMethod.POST, path: 'fix-bleed', auth: 'public' },
  { contract: 'GET /worker-jobs/external/:id (X-API-Key — 100p 폴링 의존)', controller: WorkerJobsController, handler: 'findOneExternal', method: RequestMethod.GET, path: 'external/:id', auth: 'api-key' },

  // ── 조회 표면 (§3) ──
  { contract: 'GET /edit-sessions/external?orderSeqno= (X-API-Key)', controller: EditSessionsController, handler: 'findByOrderExternal', method: RequestMethod.GET, path: 'external', auth: 'api-key' },
];

/** 컨트롤러 prefix 동결 — 경로 조립의 앞부분이 바뀌면 전 라우트가 이동한다 */
const FROZEN_CONTROLLER_PREFIX: Array<[Ctor, string]> = [
  [FilesController, 'files'],
  [WorkerJobsController, 'worker-jobs'],
  [EditSessionsController, 'edit-sessions'],
];

function handlerOf(route: FrozenRoute): ((...args: unknown[]) => unknown) | undefined {
  const proto = (route.controller as { prototype: Record<string, unknown> }).prototype;
  return proto[route.handler] as ((...args: unknown[]) => unknown) | undefined;
}

describe('CONTRACT_FREEZE — 파트너 동결 표면 (경로·메서드·인증·리밋)', () => {
  describe.each(FROZEN_CONTROLLER_PREFIX)('%p prefix', (ctor, prefix) => {
    it(`@Controller('${prefix}') 유지`, () => {
      expect(Reflect.getMetadata(PATH_METADATA, ctor)).toBe(prefix);
    });
  });

  describe.each(FROZEN_ROUTES.map((r) => [r.contract, r] as const))('%s', (_label, route) => {
    it('핸들러가 존재한다 (rename 은 계약 변경)', () => {
      expect(typeof handlerOf(route)).toBe('function');
    });

    it('경로·HTTP 메서드가 동결값과 일치한다', () => {
      const h = handlerOf(route)!;
      expect(Reflect.getMetadata(PATH_METADATA, h)).toBe(route.path);
      expect(Reflect.getMetadata(METHOD_METADATA, h)).toBe(route.method);
    });

    it(`인증 시맨틱 = ${route.auth}`, () => {
      const h = handlerOf(route)!;
      // 모든 동결 라우트는 @Public 로 전역 JwtAuthGuard 를 우회한다(하우스 규약)
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, h)).toBe(true);

      const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, h) ?? [];
      const hasApiKey = guards.includes(ApiKeyGuard);
      if (route.auth === 'api-key') {
        expect(hasApiKey).toBe(true); // X-API-Key 필수 — 제거 시 무인증 개방(보안 회귀)
      } else {
        expect(hasApiKey).toBe(false); // 무인증 동결 — 추가 시 파트너 파손(무중단 위반)
      }
    });

    if (route.throttled) {
      it('@Throttle 레이트리밋이 존재한다', () => {
        const h = handlerOf(route)!;
        // throttler 버전별 메타 키 차이에 견고하도록 prefix 존재만 단언
        const keys = (Reflect.getMetadataKeys(h) ?? []).map(String);
        expect(keys.some((k) => k.toUpperCase().includes('THROTTLER'))).toBe(true);
      });
    }
  });
});
