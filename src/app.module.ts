import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BedrockModule } from './bedrock/bedrock.module';
import { TestTableModule } from './test-table/test-table.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BedrockModule,
    TestTableModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
