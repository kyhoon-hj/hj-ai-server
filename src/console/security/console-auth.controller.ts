import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConsoleWorksAuthService } from './console-works-auth.service';

@Controller('console-api/v1/auth')
export class ConsoleAuthController {
  constructor(private readonly auth: ConsoleWorksAuthService) {}

  @Get('login')
  login(@Res() response: Response) {
    return this.auth.login(response);
  }

  @Get('callback')
  callback(@Req() request: Request, @Res() response: Response) {
    return this.auth.callback(request, response);
  }

  @Get('session')
  async session(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    const identity = await this.auth.resolve(request);
    if (!identity)
      throw new UnauthorizedException('Console 로그인이 필요합니다.');
    return identity;
  }

  @Post('logout')
  logout(@Req() request: Request, @Res() response: Response) {
    return this.auth.logout(request, response);
  }
}
