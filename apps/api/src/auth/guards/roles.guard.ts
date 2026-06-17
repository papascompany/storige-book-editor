import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@storige/types';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    // P1 멀티테넌시 (2026-06-17): SUPER_ADMIN 은 최상위 전역 권한 — 모든 @Roles 요구를 통과.
    // (기존 admin@storige.com 은 role=ADMIN 으로 @Roles(ADMIN) 에 그대로 매칭되어 무영향.)
    if (user?.role === UserRole.SUPER_ADMIN) {
      return true;
    }

    return requiredRoles.some((role) => user.role === role);
  }
}
