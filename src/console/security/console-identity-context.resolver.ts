import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ConsoleIdentityContext,
  ConsoleRequest,
} from './console-identity-context';
import {
  DEVELOPMENT_CONSOLE_IDENTITY,
  isDevelopmentConsoleFixtureEnabled,
} from './console-development-fixture';

export const CONSOLE_IDENTITY_CONTEXT_RESOLVER = Symbol(
  'CONSOLE_IDENTITY_CONTEXT_RESOLVER',
);

export interface ConsoleIdentityContextResolver {
  resolve(request: ConsoleRequest): Promise<ConsoleIdentityContext | null>;
}

@Injectable()
export class UnavailableConsoleIdentityContextResolver implements ConsoleIdentityContextResolver {
  resolve(): Promise<null> {
    return Promise.resolve(null);
  }
}

@Injectable()
export class DevelopmentConsoleIdentityContextResolver implements ConsoleIdentityContextResolver {
  constructor(private readonly config: ConfigService) {}

  resolve(): Promise<ConsoleIdentityContext | null> {
    return Promise.resolve(
      isDevelopmentConsoleFixtureEnabled(this.config)
        ? DEVELOPMENT_CONSOLE_IDENTITY
        : null,
    );
  }
}
