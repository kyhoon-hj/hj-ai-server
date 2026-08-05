import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @ApiOkResponse({ description: '프로세스가 요청을 처리할 수 있습니다.' })
  getLiveness() {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  @ApiOkResponse({ description: '필수 설정과 DB 연결이 준비됐습니다.' })
  @ApiServiceUnavailableResponse({
    description: 'DB 또는 필수 dependency 설정이 준비되지 않았습니다.',
  })
  async getReadiness(@Res({ passthrough: true }) response: Response) {
    const readiness = await this.healthService.getReadiness();
    if (readiness.status !== 'ready') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return readiness;
  }
}
