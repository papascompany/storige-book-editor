import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUrl, Length } from 'class-validator';

export class CreateSiteDto {
  @ApiProperty({ example: '북모아 메인', description: '사이트명' })
  @IsString()
  @Length(1, 100)
  name: string;

  @ApiPropertyOptional({ example: 'https://www.bookmoa.co.kr' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  domain?: string;

  @ApiPropertyOptional({ example: 'https://www.bookmoa.co.kr/mypage' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  returnUrlBase?: string;

  @ApiPropertyOptional({ example: 'https://www.bookmoa.co.kr/storige/proc/synthesis_callback.php' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  uploadCallbackUrl?: string;

  @ApiPropertyOptional({
    description:
      '편집기 인증코드 (X-API-Key). 미입력 시 자동 생성 (sk-storige-{32hex})',
  })
  @IsOptional()
  @IsString()
  @Length(20, 200)
  editorAuthCode?: string;

  @ApiPropertyOptional({
    description: '워커 인증코드. 미입력 시 editorAuthCode와 동일 값 사용',
  })
  @IsOptional()
  @IsString()
  @Length(20, 200)
  workerAuthCode?: string;

  @ApiPropertyOptional({ example: 'active', enum: ['active', 'suspended'] })
  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended';
}

export class UpdateSiteDto extends PartialType(CreateSiteDto) {}
