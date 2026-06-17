import { IsEmail, IsString, MinLength, IsIn, IsNotEmpty } from 'class-validator';
import { UserRole } from '@storige/types';

/**
 * P3a 멀티테넌시 — 사이트 운영자(SITE_ADMIN/SITE_MANAGER) 관리 DTO.
 * ⚠️ role 은 사이트 역할만 허용(@IsIn) — 전역역할(ADMIN/SUPER_ADMIN) 승격을 앱레벨에서 차단.
 *    (DB CHECK chk_user_site_roles_role 이 2차 방어.)
 */
const SITE_ROLE_VALUES = [UserRole.SITE_ADMIN, UserRole.SITE_MANAGER];

export class CreateOperatorDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsIn(SITE_ROLE_VALUES)
  role: UserRole;

  @IsString()
  @IsNotEmpty()
  siteId: string;
}

export class AddAssignmentDto {
  @IsString()
  @IsNotEmpty()
  siteId: string;

  @IsIn(SITE_ROLE_VALUES)
  role: UserRole;
}

export class ResetOperatorPasswordDto {
  @IsString()
  @MinLength(8)
  newPassword: string;
}
