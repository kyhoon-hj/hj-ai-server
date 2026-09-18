import { ConfigService } from '@nestjs/config';
import { DEVELOPMENT_CONSOLE_IDENTITY } from './console-development-fixture';
import { DevelopmentConsoleIdentityContextResolver } from './console-identity-context.resolver';

describe('DevelopmentConsoleIdentityContextResolver', () => {
  it('returns the fixture only when explicitly enabled in development', async () => {
    const resolver = new DevelopmentConsoleIdentityContextResolver(
      new ConfigService({
        NODE_ENV: 'development',
        ENABLE_CONSOLE_DEV_IDENTITY: 'true',
      }),
    );

    await expect(resolver.resolve()).resolves.toEqual(
      DEVELOPMENT_CONSOLE_IDENTITY,
    );
  });

  it.each([
    { NODE_ENV: 'development', ENABLE_CONSOLE_DEV_IDENTITY: 'false' },
    { NODE_ENV: 'production', ENABLE_CONSOLE_DEV_IDENTITY: 'true' },
    { NODE_ENV: 'test', ENABLE_CONSOLE_DEV_IDENTITY: 'true' },
  ])('fails closed for %j', async (environment) => {
    const resolver = new DevelopmentConsoleIdentityContextResolver(
      new ConfigService(environment),
    );

    await expect(resolver.resolve()).resolves.toBeNull();
  });
});
