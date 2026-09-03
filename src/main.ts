import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import {
  isSwaggerEnabled,
  parseCorsAllowedOrigins,
} from './config/http-exposure';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const configService = app.get(ConfigService);

  const corsAllowedOrigins = parseCorsAllowedOrigins(
    configService.get<string>('CORS_ALLOWED_ORIGINS'),
  );
  if (corsAllowedOrigins.length > 0) {
    app.enableCors({
      origin: corsAllowedOrigins,
      credentials: true,
      allowedHeaders: [
        'Content-Type',
        'appkey',
        'x-app-key',
        'x-appkey',
        'x-correlation-id',
        'x-admin-key',
      ],
      exposedHeaders: ['x-correlation-id'],
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const apiGlobalPrefix = configService
    .get<string>('API_GLOBAL_PREFIX')
    ?.trim();
  if (apiGlobalPrefix) {
    app.setGlobalPrefix(apiGlobalPrefix, {
      exclude: [
        { path: 'health/live', method: RequestMethod.GET },
        { path: 'health/ready', method: RequestMethod.GET },
      ],
    });
  }

  if (isSwaggerEnabled(configService.get<string>('SWAGGER_ENABLED'))) {
    const config = new DocumentBuilder()
      .setTitle('HJ AI Server')
      .setDescription('HJ AI Server API')
      .setVersion('1.0')
      .addServer(
        configService.get<string>('API_BASE_URL') ?? 'https://ai.hjshub.com',
      )
      .addApiKey(
        {
          type: 'apiKey',
          name: 'appkey',
          in: 'header',
          description: 'AppInfo에서 발급한 서버 전용 appkey',
        },
        'appkey',
      )
      .addApiKey(
        {
          type: 'apiKey',
          name: 'x-admin-key',
          in: 'header',
          description: '플랫폼 관리자 또는 지식 운영자 role credential',
        },
        'adminKey',
      )
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup(
      configService.get<string>('SWAGGER_PATH') ?? 'api-docs',
      app,
      document,
    );
  }

  const port = configService.get<string>('PORT') ?? '11000';

  await app.listen(port, '0.0.0.0');
}
void bootstrap();
