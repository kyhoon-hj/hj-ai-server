import { isSwaggerEnabled, parseCorsAllowedOrigins } from './http-exposure';

describe('HTTP exposure policy', () => {
  it('CORS allowlist를 공백 제거·중복 제거해 해석한다', () => {
    expect(
      parseCorsAllowedOrigins(
        'https://app.example.com, http://127.0.0.1:3200,https://app.example.com',
      ),
    ).toEqual(['https://app.example.com', 'http://127.0.0.1:3200']);
  });

  it('allowlist가 없으면 CORS를 활성화하지 않는다', () => {
    expect(parseCorsAllowedOrigins()).toEqual([]);
    expect(parseCorsAllowedOrigins('  ')).toEqual([]);
  });

  it('Swagger는 환경과 무관하게 명시적으로 활성화해야 한다', () => {
    expect(isSwaggerEnabled()).toBe(false);
    expect(isSwaggerEnabled('false')).toBe(false);
    expect(isSwaggerEnabled('true')).toBe(true);
  });
});
