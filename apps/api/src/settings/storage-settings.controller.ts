import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@storige/types';
import { StorageConfigService } from './storage-config.service';

/**
 * /api/admin/storage-settings — admin 전용 저장계층/보존정책 설정.
 *
 * 보안: JWT+Role(ADMIN/MANAGER) 가드. s3 시크릿은 GET 응답에서 **마스킹**(평문 미반환),
 * PUT 에서 빈 값이면 기존 시크릿 유지(마스킹된 값을 다시 보내도 덮어쓰지 않음).
 */
@ApiTags('Storage Settings')
@ApiBearerAuth()
@Controller('admin/storage-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
export class StorageSettingsController {
  constructor(private readonly storageConfig: StorageConfigService) {}

  @Get()
  @ApiOperation({ summary: '저장계층/보존정책 설정 조회 (시크릿 마스킹)' })
  async get() {
    const row = await this.storageConfig.getRow();
    return {
      success: true,
      data: {
        driver: row.driver,
        s3Endpoint: row.s3Endpoint ?? '',
        s3Region: row.s3Region ?? 'auto',
        s3Bucket: row.s3Bucket ?? '',
        s3AccessKeyId: row.s3AccessKeyId ?? '',
        // 시크릿은 평문 미반환 — 설정 여부만 노출
        s3SecretConfigured: !!row.s3SecretAccessKey,
        s3SecretMasked: row.s3SecretAccessKey ? '••••••••' : '',
        s3ForcePathStyle: row.s3ForcePathStyle ?? true,
        retentionEnabled: row.retentionEnabled ?? true,
        retentionDryRun: row.retentionDryRun ?? false,
        updatedAt: row.updatedAt ?? null,
      },
    };
  }

  @Put()
  @ApiOperation({ summary: '저장계층/보존정책 설정 저장 (즉시 반영)' })
  async update(
    @Body()
    body: {
      driver?: 'local' | 's3';
      s3Endpoint?: string;
      s3Region?: string;
      s3Bucket?: string;
      s3AccessKeyId?: string;
      s3SecretAccessKey?: string; // 빈 값이면 기존 유지
      s3ForcePathStyle?: boolean;
      retentionEnabled?: boolean;
      retentionDryRun?: boolean;
    },
  ) {
    const saved = await this.storageConfig.update({
      driver: body.driver,
      s3Endpoint: emptyToNull(body.s3Endpoint),
      s3Region: emptyToNull(body.s3Region),
      s3Bucket: emptyToNull(body.s3Bucket),
      s3AccessKeyId: emptyToNull(body.s3AccessKeyId),
      // undefined/빈문자면 update() 가 기존 시크릿 보존
      s3SecretAccessKey: body.s3SecretAccessKey,
      s3ForcePathStyle: body.s3ForcePathStyle,
      retentionEnabled: body.retentionEnabled,
      retentionDryRun: body.retentionDryRun,
    });
    return {
      success: true,
      data: { driver: saved.driver, s3SecretConfigured: !!saved.s3SecretAccessKey },
    };
  }
}

function emptyToNull(v: string | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === '' ? null : t;
}
