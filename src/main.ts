import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.enableCors({
    origin: configService.get<string>('CORS_ORIGIN') ?? true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'appkey', 'x-app-key', 'x-appkey'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.setGlobalPrefix('ai');

  const config = new DocumentBuilder()
    .setTitle('HJ AI Server')
    .setDescription('HJ AI Server API')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('ai/docs', app, document);

  const port = configService.get<string>('PORT') ?? '3000';

  await app.listen(port, '0.0.0.0');
}
bootstrap();
