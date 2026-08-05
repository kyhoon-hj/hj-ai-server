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

  it('지식 운영자는 AppInfo 플랫폼 관리 API를 사용할 수 없다', () => {
    return request(app.getHttpServer())
      .get('/app-info')
      .set('x-admin-key', process.env.KNOWLEDGE_OPERATOR_API_KEY!)
      .expect(403);
  });

  it('지식 운영자는 지식 관리 API에 진입할 수 있다', () => {
    return request(app.getHttpServer())
      .get(
        '/admin/v1/knowledge/apps/00000000-0000-4000-8000-000000000000/files',
      )
      .set('x-admin-key', process.env.KNOWLEDGE_OPERATOR_API_KEY!)
      .expect(404);
  });

  it('외부 appkey는 지식 관리 API에 진입할 수 없다', () => {
    return request(app.getHttpServer())
      .get(
        '/admin/v1/knowledge/apps/00000000-0000-4000-8000-000000000000/files',
      )
      .set('appkey', 'external-appkey')
      .expect(401);
  });

  it('플랫폼 관리자는 Bedrock 운영 설정을 조회할 수 있다', () => {
    return request(app.getHttpServer())
      .get('/admin/v1/bedrock/config')
      .set('x-admin-key', process.env.ADMIN_API_KEY!)
      .expect(200)
      .expect((response) => {
        expect(typeof (response.body as { region?: unknown }).region).toBe(
          'string',
        );
      });
  });

  it('지식 운영자는 Bedrock 운영 설정을 조회할 수 없다', () => {
    return request(app.getHttpServer())
      .get('/admin/v1/bedrock/config')
      .set('x-admin-key', process.env.KNOWLEDGE_OPERATOR_API_KEY!)
      .expect(403);
  });

  it('test-tables는 명시적 활성화가 없으면 플랫폼 관리자에게도 404다', () => {
    return request(app.getHttpServer())
      .get('/test-tables')
      .set('x-admin-key', process.env.ADMIN_API_KEY!)
      .expect(404);
  });

  it('플랫폼 관리자는 보안 감사 이벤트를 조회할 수 있다', () => {
    return request(app.getHttpServer())
      .get('/admin/v1/security/audit-events?limit=10')
      .set('x-admin-key', process.env.ADMIN_API_KEY!)
      .expect(200)
      .expect((response) => {
        expect(Array.isArray(response.body)).toBe(true);
      });
  });

  it('지식 운영자는 보안 감사 이벤트를 조회할 수 없다', () => {
    return request(app.getHttpServer())
      .get('/admin/v1/security/audit-events')
      .set('x-admin-key', process.env.KNOWLEDGE_OPERATOR_API_KEY!)
      .expect(403);
  });

  afterEach(async () => {
    await app.close();
  });
});
