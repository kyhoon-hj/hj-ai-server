import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/health/live (GET)', () => {
    return request(app.getHttpServer())
      .get('/health/live')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ status: 'ok' });
      });
  });

  it('/health/ready (GET)', () => {
    return request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          status: 'ready',
          checks: {
            database: { status: 'up' },
            storage: { status: 'configured' },
            bedrock: { status: 'configured' },
          },
        });
      });
  });

  it.each([
    ['관리자 credential 없음', undefined],
    ['잘못된 관리자 credential', 'invalid-admin-credential'],
  ])('/app-info (GET)는 %s 요청을 거절한다', (_name, adminKey) => {
    const testRequest = request(app.getHttpServer()).get('/app-info');
    if (adminKey) testRequest.set('x-admin-key', adminKey);
    return testRequest.expect(401);
  });

  it('/app-info (GET)는 유효한 관리자 credential을 허용한다', () => {
    return request(app.getHttpServer())
      .get('/app-info')
      .set('x-admin-key', process.env.ADMIN_API_KEY!)
      .expect(200)
      .expect(({ body }) => expect(Array.isArray(body)).toBe(true));
  });

  afterEach(async () => {
    await app.close();
  });
});
