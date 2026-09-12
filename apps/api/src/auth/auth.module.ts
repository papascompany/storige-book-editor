import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { OperatorsController } from './operators.controller';
import { OperatorsService } from './operators.service';
import { User } from './entities/user.entity';
import { UserSiteRole } from './entities/user-site-role.entity';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { ApiKeyStrategy } from './strategies/api-key.strategy';
import { JwtCookieStrategy } from './strategies/jwt-cookie.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { ApiKeyGuard } from './guards/api-key.guard';
// D6-ⓐ(2026-09-12) — @Public compose-mixed 의 선택적 사이트 키 복원. SitesModule 이 여기서
// 이미 import 돼 있어 ApiKeyGuard 와 동일한 해석 경로를 쓴다(route-scoped 가드는 컨테이너
// 전역 metatype 탐색으로 찾히므로, WorkerJobsModule 에 SitesModule 을 끌어오지 않는다).
import { OptionalApiKeySiteGuard } from './guards/optional-api-key-site.guard';
import { JwtCookieGuard } from './guards/jwt-cookie.guard';
import { APP_GUARD } from '@nestjs/core';
import { SitesModule } from '../sites/sites.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserSiteRole]),
    PassportModule,
    SitesModule, // ApiKeyStrategy가 SitesService 사용 (Phase A)
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN', '7d'),
        },
      }),
    }),
  ],
  controllers: [AuthController, OperatorsController],
  providers: [
    AuthService,
    OperatorsService,
    JwtStrategy,
    LocalStrategy,
    ApiKeyStrategy,
    JwtCookieStrategy,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    RolesGuard,
    ApiKeyGuard,
    OptionalApiKeySiteGuard,
    JwtCookieGuard,
  ],
  exports: [AuthService, JwtCookieGuard, ApiKeyGuard, OptionalApiKeySiteGuard],
})
export class AuthModule {}
