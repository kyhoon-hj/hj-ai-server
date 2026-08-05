export const operations = [
  { id: 'health', group: '상태', label: '기본 상태 확인', method: 'GET', path: '/', auth: false, performanceSafe: true },
  { id: 'app.create', group: '앱 관리', label: 'AppInfo 생성', method: 'POST', path: '/app-info' },
  { id: 'app.list', group: '앱 관리', label: 'AppInfo 목록', method: 'GET', path: '/app-info' },
  { id: 'app.get', group: '앱 관리', label: 'AppInfo 상세', method: 'GET', path: '/app-info/:id' },
  { id: 'app.update', group: '앱 관리', label: 'AppInfo 수정', method: 'PATCH', path: '/app-info/:id' },
  { id: 'app.rotateKey', group: '앱 관리', label: 'appkey 재발급', method: 'POST', path: '/app-info/:id/appkey' },
  { id: 'app.delete', group: '앱 관리', label: 'AppInfo 삭제', method: 'DELETE', path: '/app-info/:id', destructive: true },
  { id: 'bedrock.config', group: 'Bedrock', label: 'Bedrock 설정', method: 'GET', path: '/bedrock/config' },
  { id: 'bedrock.models', group: 'Bedrock', label: '모델 목록', method: 'GET', path: '/bedrock/models' },
  { id: 'bedrock.converse', group: 'Bedrock', label: 'Converse', method: 'POST', path: '/bedrock/converse', performanceSafe: true },
  { id: 'bedrock.text', group: 'Bedrock', label: '텍스트 응답', method: 'POST', path: '/bedrock/text-response', performanceSafe: true },
  { id: 'bedrock.general', group: 'Bedrock', label: '저위험 일반 답변', method: 'POST', path: '/bedrock/general-answers', performanceSafe: true },
  { id: 'storage.upload', group: '스토리지', label: 'S3 파일 업로드', method: 'POST', path: '/storage/upload', upload: true },
  { id: 'storage.list', group: '스토리지', label: 'S3 파일 목록', method: 'GET', path: '/storage/files' },
  { id: 'storage.detail', group: '스토리지', label: 'S3 파일 상세', method: 'GET', path: '/storage/files/detail' },
  { id: 'storage.download', group: '스토리지', label: 'S3 파일 다운로드', method: 'GET', path: '/storage/download', download: true },
  { id: 'knowledge.upload', group: '지식', label: '지식 파일 업로드', method: 'POST', path: '/knowledge/files', upload: true },
  { id: 'knowledge.list', group: '지식', label: '지식 파일 목록', method: 'GET', path: '/knowledge/files' },
  { id: 'knowledge.get', group: '지식', label: '지식 파일 상세', method: 'GET', path: '/knowledge/files/:id' },
  { id: 'knowledge.policy', group: '지식', label: '지식 정책 수정', method: 'PATCH', path: '/knowledge/files/:id/policy' },
  { id: 'knowledge.archive', group: '지식', label: '지식 보관/삭제', method: 'DELETE', path: '/knowledge/files/:id', destructive: true },
  { id: 'knowledge.text', group: '지식', label: '텍스트 지식 등록', method: 'POST', path: '/knowledge/texts' },
  { id: 'knowledge.seed', group: '지식', label: '데모 지식 등록', method: 'POST', path: '/knowledge/demo/store-seed' },
  { id: 'knowledge.index', group: '지식', label: '지식 인덱싱', method: 'POST', path: '/knowledge/files/:id/index' },
  { id: 'knowledge.reindex', group: '지식', label: '지식 재인덱싱', method: 'POST', path: '/knowledge/files/:id/reindex' },
  { id: 'knowledge.search', group: '외부 소비자 후보', label: '지식 검색', method: 'POST', path: '/knowledge/search', performanceSafe: true },
  { id: 'knowledge.rag', group: '외부 소비자 후보', label: 'RAG 응답(호환)', method: 'POST', path: '/knowledge/rag-response', performanceSafe: true },
  { id: 'knowledge.answers', group: '외부 소비자 후보', label: '제품 RAG 답변', method: 'POST', path: '/knowledge/answers', performanceSafe: true },
];

export function findOperation(id) {
  return operations.find((operation) => operation.id === id);
}
