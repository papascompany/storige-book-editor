import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { SitesService } from '../../sites/sites.service';

/** 검증된 사이트 키에서 복원한 테넌트 컨텍스트. `req.apiKeySite` 에만 실린다. */
export interface ApiKeySitePayload {
  siteId: string;
  siteName: string;
}

/**
 * Optional X-API-Key Site Guard.
 *
 * ── 역할 ──────────────────────────────────────────────────────────────────
 * `POST /worker-jobs/compose-mixed` 는 `@Public` 동결 라우트이고 `body.siteId` 를 무검증
 * 채택하지 않는다. 이 가드는 API 키 호출자(X-API-Key + body.siteId 미전송)의 잡을 사이트에
 * 귀속시킨다 — **헤더의 siteId 주장을 믿는 게 아니라**, 제시된 비밀 자격증명을 DB 에서
 * 조회해 **서버가 도출한** 사이트를 싣는다. 사이트가 없으면 잡은 NULL-site 로 남아
 * 산출물 다운로드의 사이트 대조를 통과하지 못한다.
 *
 * ── 불변식 (깨면 동결 계약·위조 차단이 무너진다) ──────────────────────────
 *  1. **절대 throw 하지 않는다.** 키 부재·무효·비활성 전부 `true` 로 통과한다. 401 을 던지면
 *     `@Public` 동결(`contract-freeze.spec.ts` 동결 표면 검사 = `guards.includes(ApiKeyGuard) === false`
 *     로 "X-API-Key 필수 아님"을 잠근다)을 의미상 위반하고 무인증 게스트가 파손된다.
 *  2. **`req.user` 를 건드리지 않는다.** `ApiKeyGuard` 는 `req.user.source='shop'` 을 쓰는데
 *     `OptionalShopJwtGuard` 도 같은 값을 쓴다. 여기서 `req.user` 에 쓰면 컨트롤러의
 *     `caller` 가 이 값으로 조립되고, 그러면 **자동조립 경로의 인가 게이트**
 *     (`worker-jobs.service.ts` assembleComposeInputFromSession — `caller.siteId` 일치 검사)
 *     까지 API 키로 통과된다. 자동조립은 `allowedOrderSeqnos` 주문 스코프로 같은 테넌트의
 *     타 고객 세션을 막는데 API 키에는 그 필드가 없어 호환 모드(검사 생략)로 떨어진다.
 *     주문 스코프 검사를 유지하기 위해 전용 필드에만 싣는다.
 *  3. **`status:'active'` 사이트만 권위다.** `findBy*AuthCode` 가 조건에 넣고 있다
 *     (`SitesService.findByEditorAuthCode`·`findByWorkerAuthCode`). 키 폐기 수단이
 *     `status=inactive` 이므로 이 필터가 곧 폐기 키 차단이다. 조건을 풀지 말 것.
 *  4. **내부 `WORKER_API_KEY` 는 테넌트 신원이 아니다.** Default Site 의 editor==worker 코드로
 *     매칭되므로 제외하지 않으면 파트너 잡이 Default Site 소유로 스탬프된다.
 */
@Injectable()
export class OptionalApiKeySiteGuard implements CanActivate {
  private readonly logger = new Logger(OptionalApiKeySiteGuard.name);

  constructor(private readonly sitesService: SitesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers?: Record<string, unknown>;
      apiKeySite?: ApiKeySitePayload;
    }>();

    const raw = req?.headers?.['x-api-key'];
    const apiKey = typeof raw === 'string' ? raw.trim() : '';
    if (!apiKey) return true; // 키 없음 — 무인증 게스트 흐름 그대로(NULL 스탬프)

    // 불변식 4 — 내부 워커 키는 테넌트 신원이 아니다.
    if (process.env.WORKER_API_KEY && apiKey === process.env.WORKER_API_KEY) {
      return true;
    }

    let site: { id: string; name: string } | null = null;
    try {
      site =
        (await this.sitesService.findByEditorAuthCode(apiKey)) ??
        (await this.sitesService.findByWorkerAuthCode(apiKey));
    } catch (e) {
      // 불변식 1 — 조회 실패로 잡 생성을 막지 않는다. 스탬프만 포기(fail-closed on stamp).
      this.logger.warn(`사이트 키 조회 실패 — 스탬프 없이 통과: ${(e as Error).message}`);
      return true;
    }

    if (!site) {
      // 무효·폐기(status!=='active') 키 — 401 이 아니라 "테넌트 판정 불가"(불변식 1).
      // ⚠️ 키 값 자체를 로그에 남기지 않는다.
      this.logger.debug('X-API-Key 가 활성 사이트와 매칭되지 않음 — 스탬프 없이 통과');
      return true;
    }

    req.apiKeySite = { siteId: site.id, siteName: site.name };
    return true;
  }
}
