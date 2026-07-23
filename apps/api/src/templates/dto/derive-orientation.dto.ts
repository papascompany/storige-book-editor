import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 트랙 C (2026-07-23): 방향 파생 옵션 — includeCover 명시 시에만 표지(spread)
 * 면 단위 자동 변환 이월. 기본 off = 현행(표지 미이월)과 동일 거동.
 * 바디 없는 기존 호출(admin 구버전·spec)과 호환 — 빈 바디 허용.
 */
export class DeriveOrientationDto {
  @ApiPropertyOptional({
    example: true,
    description:
      '표지(스프레드) 면 단위 자동 변환 이월(실험적). flat-*/inner/spec 없음은 자동 제외(meta.coverSkipped 안내)',
  })
  @IsOptional()
  @IsBoolean()
  includeCover?: boolean;
}
