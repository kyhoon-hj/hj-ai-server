import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AwsMetricsInterceptor } from './common/http/aws-metrics.interceptor';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppInfoModule } from './app-info/app-info.module';
import { BedrockModule } from './bedrock/bedrock.module';
import { ConversationModule } from './conversation/conversation.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { StorageModule } from './storage/storage.module';
import { TestTableModule } from './test-table/test-table.module';
import { CorrelationIdMiddleware } from './common/http/correlation-id.middleware';
import { StructuredHttpExceptionFilter } from './common/http/structured-http-exception.filter';
import { validateEnvironment } from './config/environment';
import { HealthModule } from './health/health.module';
import { SecurityModule } from './security/security.module';
import { AwsRequestShutdownService } from './common/aws/aws-request-control';
import { RequestAbortMiddleware } from './common/http/request-abort.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    HealthModule,
    SecurityModule,
    AppInfoModule,
    BedrockModule,
    ConversationModule,
    KnowledgeModule,
    StorageModule,
    TestTableModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    AwsRequestShutdownService,
    { provide: APP_INTERCEPTOR, useClass: AwsMetricsInterceptor },
    {
      provide: APP_FILTER,
      useClass: StructuredHttpExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestAbortMiddleware, CorrelationIdMiddleware)
      .forRoutes('*');
  }
}
