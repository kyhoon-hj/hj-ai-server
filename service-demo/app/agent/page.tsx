'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, CircleAlert, Headphones, Inbox, LoaderCircle, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiFailure, apiRequest } from '@/lib/api-client';

type AgentStatus = { active: true; role: 'agent'; capabilities: string[]; requestId: string };
type ViewState = { status: 'loading' } | { status: 'ready'; data: AgentStatus } | { status: 'error'; error: ApiFailure };

export default function AgentPage() {
  const [view, setView] = useState<ViewState>({ status: 'loading' });
  const loadStatus = useCallback(async () => {
    setView({ status: 'loading' });
    try {
      await apiRequest('/api/agent-session', { method: 'POST', timeoutMs: 5_000 }).catch(() => null);
      setView({ status: 'ready', data: await apiRequest<AgentStatus>('/api/agent/status', { timeoutMs: 5_000 }) });
    } catch (error) {
      setView({ status: 'error', error: error instanceof ApiFailure ? error : new ApiFailure('unexpected', null, 'UNKNOWN', '상담원 권한을 확인하지 못했습니다.', 'unknown', false) });
    }
  }, []);
  useEffect(() => {
    const initialLoad = setTimeout(() => void loadStatus(), 0);
    return () => clearTimeout(initialLoad);
  }, [loadStatus]);

  return (
    <main className="min-h-screen bg-canvas text-stone-900">
      <header className="bg-forest-950 text-white"><div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><Link href="/" aria-label="업무 공간으로 돌아가기" className="grid size-9 place-items-center rounded-xl bg-white/10 hover:bg-white/15"><ArrowLeft className="size-4" /></Link><div><p className="font-semibold">상담원 검토함</p><p className="text-[11px] text-stone-400">SEC-SVC-03 · 상담원 전용 경계</p></div></div><Badge className="border border-sky-300/30 bg-sky-300/15 text-sky-100"><Headphones /> 상담원</Badge></div></header>
      <div className="mx-auto grid max-w-5xl gap-5 px-5 py-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="border-stone-200 bg-white ring-0"><CardHeader><Inbox className="mb-2 size-7 text-sky-700" /><CardTitle className="font-display text-2xl">검토 대기 문의</CardTitle><CardDescription>고객이 답변을 받지 못한 문의를 상담원이 검토하는 전용 화면입니다.</CardDescription></CardHeader><CardContent>
          {view.status === 'loading' && <div className="flex items-center gap-2 rounded-xl bg-stone-50 p-4 text-sm text-stone-600"><LoaderCircle className="size-4 animate-spin" /> 상담원 권한 확인 중</div>}
          {view.status === 'error' && <Alert className="border-rose-200 bg-rose-50"><CircleAlert /><AlertTitle>상담원 권한이 필요합니다</AlertTitle><AlertDescription>{view.error.message}<span className="mt-1 block font-mono text-[11px]">ID {view.error.correlationId}</span><Button size="sm" variant="outline" className="mt-3" onClick={() => void loadStatus()}>다시 확인</Button></AlertDescription></Alert>}
          {view.status === 'ready' && <Alert className="border-sky-200 bg-sky-50"><CheckCircle2 /><AlertTitle>상담원 전용 접근 확인</AlertTitle><AlertDescription>고객·관리자 화면과 분리된 서버 권한 경계가 활성화됐습니다. 영구 검토 요청 저장과 답변·피드백 처리는 다음 S2 작업에서 연결합니다.</AlertDescription></Alert>}
        </CardContent></Card>
        <aside className="space-y-4"><Card className="border-0 bg-forest-950 text-white ring-0"><CardHeader><ShieldCheck className="mb-2 size-6 text-lime-300" /><CardTitle>역할 분리 원칙</CardTitle><CardDescription className="text-stone-400">화면 숨김이 아닌 서버 판정으로 접근을 제한합니다.</CardDescription></CardHeader><CardContent className="space-y-2 text-xs text-stone-300"><p>1. 고객: 공개 답변 요청</p><p>2. 상담원: 검토함 접근</p><p>3. 관리자: 지식 문서 관리</p></CardContent></Card><div className="rounded-xl border border-dashed border-stone-300 p-4 text-xs leading-5 text-stone-500">응답에는 상담원 이메일이나 인증 토큰을 포함하지 않습니다.</div></aside>
      </div>
    </main>
  );
}
