import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SiteRoleClaim, UserRole } from '@storige/types';
import { Site } from '../sites/entities/site.entity';
import { UpdateSiteDto } from '../sites/dto/site.dto';
import { SitesService } from '../sites/sites.service';
import {
  IssuedPartnerApiKey,
  PartnerApiKeysService,
} from '../partner-api/keys/partner-api-keys.service';
import { MaskedPartnerApiKey } from '../partner-api/keys/partner-api-keys.dto';
import { isForbiddenLiteralHost } from '../common/helpers/ssrf.helper';
import { PortalIssueTestKeyDto, UpdatePortalSiteDto } from './portal.dto';

/**
 * 포털 요청 사용자 서브셋 — JwtStrategy 가 req.user 에 실는 필드 중
 * 포털 인가 판단에 쓰는 것만 (User 엔티티 전체 의존 회피).
 */
export interface PortalRequestUser {
  role?: string;
  siteRoles?: SiteRoleClaim[];
}

/**
 * SITE_ADMIN 셀프 뷰 — 시크릿 마스킹 응답.
 * editorAuthCode/workerAuthCode 원문은 어떤 포털 표면에도 노출하지 않는다
 * (원문 열람/재발급은 전역 운영자 표면 /api/sites 전용).
 */
export interface PortalSiteView {
  id: string;
  name: string;
  domain: string | null;
  returnUrlBase: string | null;
  uploadCallbackUrl: string | null;
  status: 'active' | 'suspended';
  retentionDays: number | null;
  allowedOrigins: string[] | null;
  frameAncestors: string[] | null;
  editorBundleUrl: string | null;
  editorCssUrl: string | null;
  editorVersion: string | null;
  /** 'sk-storige-a…' 형태 prefix 마스킹 — 원문 미노출 */
  editorAuthCodeMasked: string;
  workerAuthCodeMasked: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 인증코드 prefix 마스킹 — 식별 가능한 최소 prefix 만 남긴다 */
function maskAuthCode(code: string): string {
  if (!code) return '';
  if (code.length <= 12) return '****';
  return `${code.slice(0, 12)}…`;
}

/** 사이트당 활성(비revoked·비만료) test 키 기본 상한 — env PORTAL_TEST_KEY_LIMIT 로 override */
export const PORTAL_TEST_KEY_ACTIVE_LIMIT_DEFAULT = 20;

/**
 * 파트너 포털 v0 (S2-4, D-7a 보수 스코프 — 이메일 인증 가입 제외).
 *
 * SITE_ADMIN 셀프서브 표면의 도메인 로직:
 *  - 인가: TenantGuard(멤버십) 위에 **해당 site 의 per-site 역할이 SITE_ADMIN** 인지
 *    재확인한다(assertSiteAdmin). 한 계정이 site A=SITE_ADMIN, site B=SITE_MANAGER 로
 *    배정될 수 있는데 TenantGuard 는 멤버십만 보므로 여기서 역할 경계를 막는다.
 *    SUPER_ADMIN 은 전역 통과(dual-mode 승계).
 *  - PATCH: allowedOrigins/uploadCallbackUrl 화이트리스트만 SitesService.update 로
 *    위임(정책 캐시 무효화 포함). 그 외 필드 무접촉.
 *  - 키: PartnerApiKeysService 재사용, **env='test' 강제**(live 시도 403).
 *    포털 목록/폐기도 test 키로 한정 — live 키는 메타데이터조차 비노출(404).
 */
@Injectable()
export class PortalService {
  private readonly logger = new Logger(PortalService.name);

  constructor(
    private readonly sitesService: SitesService,
    private readonly partnerApiKeysService: PartnerApiKeysService,
  ) {}

  /** per-site SITE_ADMIN 역할 강제 — TenantGuard(멤버십) 뒤의 2차 경계 */
  assertSiteAdmin(user: PortalRequestUser | undefined, siteId: string): void {
    if (user?.role === UserRole.SUPER_ADMIN) return;
    const claims = Array.isArray(user?.siteRoles) ? user.siteRoles : [];
    const isSiteAdminHere = claims.some(
      (r) => r.siteId === siteId && r.role === UserRole.SITE_ADMIN,
    );
    if (!isSiteAdminHere) {
      throw new ForbiddenException({
        code: 'PORTAL_FORBIDDEN',
        message: '이 사이트의 SITE_ADMIN 권한이 필요합니다.',
      });
    }
  }

  async getMySite(
    user: PortalRequestUser,
    siteId: string,
  ): Promise<PortalSiteView> {
    this.assertSiteAdmin(user, siteId);
    const site = await this.sitesService.findOne(siteId);
    return this.toView(site);
  }

  async updateMySite(
    user: PortalRequestUser,
    siteId: string,
    dto: UpdatePortalSiteDto,
  ): Promise<PortalSiteView> {
    this.assertSiteAdmin(user, siteId);
    await this.sitesService.findOne(siteId); // 404 선행 (권한 통과 후)

    // 화이트리스트 패치만 구성 — 명시된 키만 반영 (undefined 덮어쓰기 금지)
    const patch: Pick<UpdateSiteDto, 'allowedOrigins' | 'uploadCallbackUrl'> = {};

    if (dto.allowedOrigins !== undefined) {
      patch.allowedOrigins = dto.allowedOrigins.map((o) =>
        this.normalizeOrigin(o),
      );
    }

    if (dto.uploadCallbackUrl !== undefined) {
      if (dto.uploadCallbackUrl === null) {
        patch.uploadCallbackUrl = null;
      } else {
        this.assertSafeCallbackUrl(dto.uploadCallbackUrl);
        patch.uploadCallbackUrl = dto.uploadCallbackUrl;
      }
    }

    if (Object.keys(patch).length === 0) {
      // 변경 없음 — 현재 뷰 반환 (멱등)
      return this.toView(await this.sitesService.findOne(siteId));
    }

    const saved = await this.sitesService.update(siteId, patch);
    this.logger.log(
      `포털 셀프 설정 변경 site=${siteId} fields=${Object.keys(patch).join(',')}`,
    );
    return this.toView(saved);
  }

  // ── test 키 셀프 관리 (PartnerApiKeysService 재사용) ────────────────────

  async listTestKeys(
    user: PortalRequestUser,
    siteId: string,
  ): Promise<MaskedPartnerApiKey[]> {
    this.assertSiteAdmin(user, siteId);
    await this.sitesService.findOne(siteId);
    const all = await this.partnerApiKeysService.list(siteId);
    // live 키는 포털에 메타데이터조차 비노출 — 운영자 표면 전용
    return all.filter((k) => k.env === 'test');
  }

  async issueTestKey(
    user: PortalRequestUser,
    siteId: string,
    dto: PortalIssueTestKeyDto,
  ): Promise<IssuedPartnerApiKey> {
    this.assertSiteAdmin(user, siteId);
    if (dto.env !== undefined && dto.env !== 'test') {
      // live 발급은 운영자 승인 큐(전역 admin 표면) 전용 — 코드로 강제
      throw new ForbiddenException({
        code: 'PORTAL_LIVE_KEY_FORBIDDEN',
        message:
          'live 키는 포털에서 발급할 수 없습니다. 운영자 승인 절차를 이용하세요.',
      });
    }
    await this.sitesService.findOne(siteId); // 사이트 존재 검증 (404)

    // 사이트당 활성 test 키 상한 — 셀프서브 무제한 발급(키 인벤토리 팽창·정리 부담) 차단.
    // 활성 = status==='active'(포털은 발급/폐기만 노출 → grace 미발생). revoked 는 제외.
    const activeTestKeys = (
      await this.partnerApiKeysService.list(siteId)
    ).filter((k) => k.env === 'test' && k.status === 'active');
    const limit = this.getTestKeyActiveLimit();
    if (activeTestKeys.length >= limit) {
      throw new HttpException(
        {
          code: 'PORTAL_TEST_KEY_LIMIT',
          message: `사이트당 활성 test 키 상한(${limit})에 도달했습니다. 기존 키를 폐기한 뒤 다시 발급하세요.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return this.partnerApiKeysService.issue(siteId, 'test', dto.name ?? null);
  }

  /** 활성 test 키 상한(런타임 env override 허용 — 테스트/운영 튜닝) */
  private getTestKeyActiveLimit(): number {
    const raw = process.env.PORTAL_TEST_KEY_LIMIT;
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isInteger(parsed) && parsed > 0
      ? parsed
      : PORTAL_TEST_KEY_ACTIVE_LIMIT_DEFAULT;
  }

  async revokeTestKey(
    user: PortalRequestUser,
    siteId: string,
    keyId: string,
  ): Promise<MaskedPartnerApiKey> {
    this.assertSiteAdmin(user, siteId);
    const testKeys = await this.listTestKeys(user, siteId);
    const target = testKeys.find((k) => k.id === keyId);
    if (!target) {
      // 타 site 키·live 키·미존재 전부 동일 404 — live 키 존재 여부 오라클 차단
      throw new NotFoundException(`Test key ${keyId} not found for site`);
    }
    return this.partnerApiKeysService.revoke(siteId, keyId);
  }

  // ── 내부 ────────────────────────────────────────────────────────────────

  private toView(site: Site): PortalSiteView {
    return {
      id: site.id,
      name: site.name,
      domain: site.domain,
      returnUrlBase: site.returnUrlBase,
      uploadCallbackUrl: site.uploadCallbackUrl,
      status: site.status,
      retentionDays: site.retentionDays,
      allowedOrigins: site.allowedOrigins,
      frameAncestors: site.frameAncestors,
      editorBundleUrl: site.editorBundleUrl,
      editorCssUrl: site.editorCssUrl,
      editorVersion: site.editorVersion,
      editorAuthCodeMasked: maskAuthCode(site.editorAuthCode),
      workerAuthCodeMasked: maskAuthCode(site.workerAuthCode),
      createdAt: site.createdAt,
      updatedAt: site.updatedAt,
    };
  }

  /** origin 정규화 — http(s) + origin 형식(path 금지)만 수용, 트레일링 슬래시는 정규화 */
  private normalizeOrigin(raw: string): string {
    const trimmed = raw.trim();
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new BadRequestException(
        `allowedOrigins 항목이 유효한 URL 이 아닙니다: ${trimmed}`,
      );
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BadRequestException(
        `allowedOrigins 는 http(s) origin 만 허용합니다: ${trimmed}`,
      );
    }
    if (trimmed !== url.origin && trimmed.replace(/\/+$/, '') !== url.origin) {
      throw new BadRequestException(
        `allowedOrigins 는 origin 형식이어야 합니다(path/쿼리 금지): ${trimmed}`,
      );
    }
    return url.origin;
  }

  /**
   * 셀프서브 콜백 URL 사전 차단 — 내부/사설 리터럴 거부.
   * (발신 시점 SSRF 가드가 정본 방어선 — 이 검사는 write-time 조기 거부막.
   *  운영자 표면 PUT /api/sites 는 무접촉 — 기존 값/운영자 재량 불변.)
   */
  private assertSafeCallbackUrl(rawUrl: string): void {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BadRequestException('uploadCallbackUrl 이 유효한 URL 이 아닙니다.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BadRequestException('uploadCallbackUrl 은 http(s)만 허용합니다.');
    }
    // 리터럴 내부/사설 호스트 조기 거부(IPv4·IPv6·IPv4-mapped 16진·정수 IP 정규화 포함).
    // 정본 SSRF 방어선은 발신 시점(webhook.service isRemoteUrlPublic) — DNS 리바인딩 완화.
    if (isForbiddenLiteralHost(url.hostname)) {
      throw new BadRequestException(
        'uploadCallbackUrl 에 내부/사설 주소는 등록할 수 없습니다.',
      );
    }
  }
}
