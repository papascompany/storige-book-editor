import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PartnerEnv } from '../partner-api.constants';
import { PartnerApiKey } from '../entities/partner-api-key.entity';
import {
  MaskedPartnerApiKey,
  toMaskedPartnerApiKey,
} from './partner-api-keys.dto';

/** 발급/회전 결과 — plaintextKey 는 이 응답에서만 존재(1회 노출) */
export interface IssuedPartnerApiKey {
  /** 원문 키 — 발급 응답에서 단 1회 노출. 저장·로그 금지 */
  plaintextKey: string;
  apiKey: MaskedPartnerApiKey;
}

export interface RotatedPartnerApiKey extends IssuedPartnerApiKey {
  /** 유예(grace) 상태로 전환된 구 키 */
  rotatedFrom: MaskedPartnerApiKey;
}

/** 오버랩 회전 유예 시간 — 72h (로드맵 §6 Stage 2 작업 4) */
export const PARTNER_KEY_GRACE_HOURS = 72;

/**
 * v1 파트너 키 발급/회전/검증 (설계서 §2.1·§7.2, Stage 2 작업 2·4).
 *
 * 키 보안 3종 구현부:
 *  ① 해시 저장 — DB 에는 SHA-256(hex)만. 원문은 발급/회전 반환값에서 1회 노출 후 소멸.
 *  ② 마스킹 — 목록/상세는 keyPrefix(예: 'sk_test_a1b2')만 노출.
 *  ③ 오버랩 회전 — rotate 시 신 키 발급 + 구 키 status='grace', grace_until=now+72h.
 *    유예 내 구 키는 유효(무중단 교체), 만료분은 검증 시점 차단 + 배치가 revoked 승격.
 *
 * sites.editor_auth_code/worker_auth_code(평문·즉시교체)는 **무접촉** —
 * 이 서비스는 partner_api_keys 신규 체계만 다룬다.
 */
@Injectable()
export class PartnerApiKeysService {
  private readonly logger = new Logger(PartnerApiKeysService.name);

  constructor(
    @InjectRepository(PartnerApiKey)
    private readonly keysRepository: Repository<PartnerApiKey>,
  ) {}

  /** SHA-256 hex — 검증/저장 공용 (원문 비저장 원칙의 단일 해시 경로) */
  static hashKey(plaintextKey: string): string {
    return createHash('sha256').update(plaintextKey).digest('hex');
  }

  /** 원문 생성 — `sk_{env}_{48hex}` (외부 노출 접두 체계, §2 공통) */
  private generatePlaintextKey(env: PartnerEnv): string {
    return `sk_${env}_${randomBytes(24).toString('hex')}`;
  }

  /** 표시용 접두 — 'sk_test_a1b2' 형태(고정 접두 8자 + 랜덤 앞 4자, ≤16자) */
  private buildPrefix(plaintextKey: string): string {
    return plaintextKey.slice(0, 12);
  }

  /** 발급 — 원문은 반환값에서만 1회 노출 */
  async issue(
    siteId: string,
    env: PartnerEnv,
    name?: string | null,
  ): Promise<IssuedPartnerApiKey> {
    const plaintextKey = this.generatePlaintextKey(env);
    const row = this.keysRepository.create({
      id: randomUUID(),
      siteId,
      env,
      keyPrefix: this.buildPrefix(plaintextKey),
      keyHash: PartnerApiKeysService.hashKey(plaintextKey),
      name: name ?? null,
      scopes: null,
      status: 'active' as const,
      graceUntil: null,
      revokedAt: null,
      lastUsedAt: null,
    });
    const saved = await this.keysRepository.save(row);
    this.logger.log(
      `파트너 키 발급 site=${siteId} env=${env} prefix=${saved.keyPrefix} id=${saved.id}`,
    );
    return { plaintextKey, apiKey: toMaskedPartnerApiKey(saved) };
  }

  /** 목록 — 마스킹만 (원문/해시 미노출) */
  async list(siteId: string): Promise<MaskedPartnerApiKey[]> {
    const rows = await this.keysRepository.find({
      where: { siteId },
      order: { createdAt: 'DESC' },
    });
    return rows.map(toMaskedPartnerApiKey);
  }

  /**
   * 오버랩 회전 — 신 키 발급 + 구 키 grace 전환(유예 72h).
   * active 키만 회전 가능(grace/revoked 재회전은 409 — 이중 회전 방지).
   */
  async rotate(siteId: string, keyId: string): Promise<RotatedPartnerApiKey> {
    const oldKey = await this.findOwnedKey(siteId, keyId);
    if (oldKey.status !== 'active') {
      throw new ConflictException(
        `active 상태 키만 회전할 수 있습니다 (현재: ${oldKey.status})`,
      );
    }

    const issued = await this.issue(siteId, oldKey.env, oldKey.name);

    oldKey.status = 'grace';
    oldKey.graceUntil = new Date(
      Date.now() + PARTNER_KEY_GRACE_HOURS * 60 * 60 * 1000,
    );
    const savedOld = await this.keysRepository.save(oldKey);
    this.logger.log(
      `파트너 키 회전 site=${siteId} old=${savedOld.keyPrefix}(grace~${savedOld.graceUntil?.toISOString()}) new=${issued.apiKey.keyPrefix}`,
    );

    return { ...issued, rotatedFrom: toMaskedPartnerApiKey(savedOld) };
  }

  /** 즉시 폐기 — grace 없이 차단(유출 대응 경로) */
  async revoke(siteId: string, keyId: string): Promise<MaskedPartnerApiKey> {
    const key = await this.findOwnedKey(siteId, keyId);
    if (key.status !== 'revoked') {
      key.status = 'revoked';
      key.revokedAt = new Date();
      key.graceUntil = null;
      await this.keysRepository.save(key);
      this.logger.log(`파트너 키 폐기 site=${siteId} prefix=${key.keyPrefix}`);
    }
    return toMaskedPartnerApiKey(key);
  }

  /**
   * 원문 키 검증 — v1 PartnerApiKeyGuard 폴백 전용 (§7.1: 공용 ApiKeyGuard 무접촉).
   *
   * 유효 조건: 해시 일치 AND (status='active' OR (status='grace' AND grace_until 미래)).
   * revoked / grace 만료는 null(401 처리 위임) — 만료 판정은 요청 시각 기준이라
   * 배치(sweep) 지연과 무관하게 즉시 차단된다.
   */
  async findValidByPlaintextKey(
    plaintextKey: string,
  ): Promise<PartnerApiKey | null> {
    const keyHash = PartnerApiKeysService.hashKey(plaintextKey);
    const row = await this.keysRepository.findOne({ where: { keyHash } });
    if (!row) return null;

    if (row.status === 'revoked') return null;
    if (row.status === 'grace') {
      if (!row.graceUntil || row.graceUntil.getTime() <= Date.now()) return null;
    }

    // last_used_at 갱신은 fire-and-forget — 검증 지연/실패에 비간섭
    void this.keysRepository
      .update({ id: row.id }, { lastUsedAt: new Date() })
      .catch((err: unknown) => {
        this.logger.warn(
          `last_used_at 갱신 실패 (prefix=${row.keyPrefix}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });

    return row;
  }

  /** grace 만료 배치 대상 일괄 revoked 승격 — 반환값=처리 건수 (sweeper 가 호출) */
  async expireGraceKeys(now: Date = new Date()): Promise<number> {
    const result = await this.keysRepository.update(
      { status: 'grace', graceUntil: LessThan(now) },
      { status: 'revoked', revokedAt: now },
    );
    return result.affected ?? 0;
  }

  private async findOwnedKey(
    siteId: string,
    keyId: string,
  ): Promise<PartnerApiKey> {
    const key = await this.keysRepository.findOne({
      where: { id: keyId, siteId },
    });
    if (!key) {
      throw new NotFoundException(`Partner key ${keyId} not found for site`);
    }
    return key;
  }
}
