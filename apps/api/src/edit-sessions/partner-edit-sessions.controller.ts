import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Injectable,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  InjectThrottlerStorage,
  Throttle,
  ThrottlerException,
  ThrottlerStorage,
} from '@nestjs/throttler';
import type { Response } from 'express';
import { createHash } from 'crypto';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentSite, CurrentSitePayload } from '../auth/decorators/current-site.decorator';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import {
  PartnerSessionOwnerDto,
  PartnerSessionOwnersRequestDto,
} from './dto/partner-session-owners.dto';
import { PartnerEditSessionOwnersService } from './partner-edit-session-owners.service';

/**
 * 사이트 키 단위 한도의 throttler 이름. 전역 ThrottlerGuard(per-IP, 'default')는 이 이름의
 * 설정을 읽지 않으므로 전역 per-IP 한도(300/min)는 그대로 병존하고, 이 한도는
 * PartnerSiteKeyThrottleGuard 만 집행한다.
 */
export const PARTNER_SITE_KEY_THROTTLER = 'partner-site-key';

/** owners 라우트 한도 — 사이트 키당 분당 120회 */
export const PARTNER_OWNERS_RATE = { limit: 120, ttl: 60_000 } as const;

/** @nestjs/throttler 의 라우트 메타데이터 키(THROTTLER:LIMIT / THROTTLER:TTL + 이름) */
const THROTTLER_LIMIT_KEY = `THROTTLER:LIMIT${PARTNER_SITE_KEY_THROTTLER}`;
const THROTTLER_TTL_KEY = `THROTTLER:TTL${PARTNER_SITE_KEY_THROTTLER}`;

interface SiteKeyRequest {
  user?: { siteId?: unknown; apiKey?: unknown } | null;
  ip?: string;
}

/**
 * 사이트 키 단위 레이트리밋 가드. ApiKeyGuard 뒤에 둔다(req.user 필요).
 * 추적 키 = siteId + 키 지문(sha256 앞 16자, 원문 미저장). 선례: partner-rate-limit.guard.ts.
 * 한도는 라우트의 @Throttle({ 'partner-site-key': { limit, ttl } }) 메타데이터에서 읽는다.
 * 초과 시 429(ThrottlerException) + Retry-After(초).
 */
@Injectable()
export class PartnerSiteKeyThrottleGuard implements CanActivate {
  constructor(
    @InjectThrottlerStorage() private readonly storage: ThrottlerStorage,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const limit =
      this.reflector.getAllAndOverride<number | undefined>(THROTTLER_LIMIT_KEY, targets) ??
      PARTNER_OWNERS_RATE.limit;
    const ttl =
      this.reflector.getAllAndOverride<number | undefined>(THROTTLER_TTL_KEY, targets) ??
      PARTNER_OWNERS_RATE.ttl;

    const http = context.switchToHttp();
    const req = http.getRequest<SiteKeyRequest>();
    const key = `${PARTNER_SITE_KEY_THROTTLER}:${context.getClass().name}.${context.getHandler().name}:${this.tracker(req)}`;

    const record = await this.storage.increment(key, ttl, limit, ttl, PARTNER_SITE_KEY_THROTTLER);
    if (record.isBlocked) {
      const res = http.getResponse<Response>();
      const retryAfter = Math.max(1, Math.ceil(record.timeToBlockExpire));
      if (res && typeof res.setHeader === 'function') {
        res.setHeader('Retry-After', String(retryAfter));
      }
      throw new ThrottlerException();
    }
    return true;
  }

  private tracker(req: SiteKeyRequest): string {
    const siteId = req.user?.siteId;
    const apiKey = req.user?.apiKey;
    if (typeof siteId === 'string' && siteId && typeof apiKey === 'string' && apiKey) {
      const fingerprint = createHash('sha256').update(apiKey, 'utf8').digest('hex').slice(0, 16);
      return `${siteId}:${fingerprint}`;
    }
    // 방어적 폴백 — ApiKeyGuard 뒤라 정상 경로에서는 도달하지 않는다.
    return `ip:${req.ip ?? 'unknown'}`;
  }
}

/**
 * 호출자 조건: 사이트 편집기 키(role 'editor')만. 내부 워커 키·사이트 없는 호출은 403.
 * 조건은 운영자 권한 라우트(assertPartnerOperatorSiteCaller)와 같다 — spec 이 동등성을 잠근다.
 */
export function assertOwnersSiteCaller(
  site: CurrentSitePayload | undefined | null,
): asserts site is CurrentSitePayload {
  if (!site?.siteId || site.role !== 'editor') {
    throw new ForbiddenException({
      code: 'PARTNER_SITE_KEY_REQUIRED',
      message: '사이트 편집기 키로만 조회할 수 있습니다.',
    });
  }
}

@ApiTags('Partner Edit Sessions')
@Controller('partner/edit-sessions')
export class PartnerEditSessionsController {
  constructor(private readonly owners: PartnerEditSessionOwnersService) {}

  @Post('owners')
  @Public()
  @UseGuards(ApiKeyGuard, PartnerSiteKeyThrottleGuard)
  @Throttle({ [PARTNER_SITE_KEY_THROTTLER]: { limit: PARTNER_OWNERS_RATE.limit, ttl: PARTNER_OWNERS_RATE.ttl } })
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: '편집 세션 소유자 배치 조회 (서버 간, 사이트 키)',
    description:
      '호출 사이트 소속 세션의 소유자(회원 번호·게스트 여부)·주문 번호·상태를 입력 순서대로 반환한다. ' +
      '다른 사이트·무소속·삭제·없는 세션은 같은 found:false 결과. 사이트 키당 분당 120회.',
  })
  @ApiResponse({ status: 200, type: [PartnerSessionOwnerDto] })
  @ApiResponse({ status: 400, description: '형식 오류(1~50개, 소문자 UUID만, 추가 필드 불가)' })
  @ApiResponse({ status: 401, description: 'API Key 없음·무효·비활성 사이트' })
  @ApiResponse({ status: 403, description: 'PARTNER_SITE_KEY_REQUIRED — 사이트 편집기 키가 아님' })
  @ApiResponse({ status: 429, description: '한도 초과(Retry-After 헤더)' })
  async lookupOwners(
    @Body() dto: PartnerSessionOwnersRequestDto,
    @CurrentSite() site?: CurrentSitePayload,
  ): Promise<PartnerSessionOwnerDto[]> {
    assertOwnersSiteCaller(site);
    return this.owners.lookup(site.siteId, dto.sessionIds);
  }
}
