import { Module } from '@nestjs/common';
import { ConsolePermissionGuard } from './console-permission.guard';
import {
  CONSOLE_IDENTITY_CONTEXT_RESOLVER,
  UnavailableConsoleIdentityContextResolver,
} from './console-identity-context.resolver';

@Module({
  providers: [
    UnavailableConsoleIdentityContextResolver,
    {
      provide: CONSOLE_IDENTITY_CONTEXT_RESOLVER,
      useExisting: UnavailableConsoleIdentityContextResolver,
    },
    ConsolePermissionGuard,
  ],
  exports: [CONSOLE_IDENTITY_CONTEXT_RESOLVER, ConsolePermissionGuard],
})
export class ConsoleSecurityModule {}
