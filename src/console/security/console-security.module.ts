import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConsolePermissionGuard } from './console-permission.guard';
import {
  CONSOLE_IDENTITY_CONTEXT_RESOLVER,
  DevelopmentConsoleIdentityContextResolver,
} from './console-identity-context.resolver';

@Module({
  imports: [ConfigModule],
  providers: [
    DevelopmentConsoleIdentityContextResolver,
    {
      provide: CONSOLE_IDENTITY_CONTEXT_RESOLVER,
      useExisting: DevelopmentConsoleIdentityContextResolver,
    },
    ConsolePermissionGuard,
  ],
  exports: [CONSOLE_IDENTITY_CONTEXT_RESOLVER, ConsolePermissionGuard],
})
export class ConsoleSecurityModule {}
