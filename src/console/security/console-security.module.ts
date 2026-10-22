import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConsoleWorksAuthService } from './console-works-auth.service';
import { ConsoleAuthController } from './console-auth.controller';
import { ConsolePermissionGuard } from './console-permission.guard';
import {
  CONSOLE_IDENTITY_CONTEXT_RESOLVER,
  DevelopmentConsoleIdentityContextResolver,
  SessionConsoleIdentityContextResolver,
} from './console-identity-context.resolver';

@Module({
  imports: [ConfigModule],
  controllers: [ConsoleAuthController],
  providers: [
    DevelopmentConsoleIdentityContextResolver,
    ConsoleWorksAuthService,
    SessionConsoleIdentityContextResolver,
    {
      provide: CONSOLE_IDENTITY_CONTEXT_RESOLVER,
      useExisting: SessionConsoleIdentityContextResolver,
    },
    ConsolePermissionGuard,
  ],
  exports: [CONSOLE_IDENTITY_CONTEXT_RESOLVER, ConsolePermissionGuard],
})
export class ConsoleSecurityModule {}
