# HJ AI Console Web

HJ-Works 조직의 AI 애플리케이션을 관리하는 Console Web/BFF입니다. 검증용 `demo/`와
최종 사용자 흐름을 보여주는 `service-demo/`와 분리된 관리 포털입니다.

## 실행

AI Server를 `11000` 포트에서 실행한 뒤 별도 터미널에서 실행합니다.

```powershell
npm run start:console-web
```

브라우저에서 `http://127.0.0.1:11003/console/apps`를 엽니다. 다른 AI Server를 사용하려면
`AI_SERVER_ORIGIN`을 정확한 HTTP(S) origin으로 설정합니다. 로그인 통합 전까지 Console API는
서버 측 fixture identity adapter가 활성화된 명시적 로컬 개발 환경에서만 사용할 수 있습니다.

## 경계

- 브라우저는 same-origin `/console-api/*`만 호출합니다.
- BFF는 관리자 credential이나 appkey를 브라우저에 전달하지 않습니다.
- 앱 목록·생성·상세·수정과 API Key 발급·회전·폐기 화면은 실제 Console API 계약을 사용합니다.
- API Key 원문은 발급 응답 직후 확인 dialog에만 보관하고 dialog를 닫을 때 제거합니다.
- HJ-Works 로그인과 Console session은 계획된 마지막 기능 단계에서 연결합니다.

## 검증

```powershell
npm run test:console-web
```
