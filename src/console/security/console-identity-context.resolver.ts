import { Injectable } from '@nestjs/common';
import type {
  ConsoleIdentityContext,
  ConsoleRequest,
} from './console-identity-context';

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
