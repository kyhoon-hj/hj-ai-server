import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TestTableController } from './test-table.controller';
import { TestTableService } from './test-table.service';

@Module({
  imports: [PrismaModule],
  controllers: [TestTableController],
  providers: [TestTableService],
})
export class TestTableModule {}
