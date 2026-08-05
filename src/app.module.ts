import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppInfoModule } from './app-info/app-info.module';
import { BedrockModule } from './bedrock/bedrock.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { StorageModule } from './storage/storage.module';
import { TestTableModule } from './test-table/test-table.module';
import { CorrelationIdMiddleware } from './common/http/correlation-id.middleware';
import { StructuredHttpExceptionFilter } from './common/http/structured-http-exception.filter';
import { validateEnvironment } from './config/environment';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    HealthModule,
    AppInfoModule,
    BedrockModule,
    KnowledgeModule,
    StorageModule,
    TestTableModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: StructuredHttpExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
