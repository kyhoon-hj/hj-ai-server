import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTestTableDto } from './dto/create-test-table.dto';
import { UpdateTestTableDto } from './dto/update-test-table.dto';

@Injectable()
export class TestTableService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateTestTableDto) {
    return this.prisma.testTable.create({
      data: dto,
    });
  }

  findAll() {
    return this.prisma.testTable.findMany({
      orderBy: { id: 'asc' },
    });
  }

  async findOne(id: number) {
    const row = await this.prisma.testTable.findUnique({
      where: { id },
    });

    if (!row) {
      throw new NotFoundException(`TestTable row ${id} not found`);
    }

    return row;
  }

  async update(id: number, dto: UpdateTestTableDto) {
    await this.findOne(id);

    return this.prisma.testTable.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: number) {
    await this.findOne(id);

    return this.prisma.testTable.delete({
      where: { id },
    });
  }
}
