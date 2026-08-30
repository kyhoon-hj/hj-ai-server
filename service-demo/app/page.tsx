'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpenCheck, Bot, CircleAlert, Clock3, DatabaseZap, ExternalLink, Headphones, RefreshCw, Search, ShieldCheck, ShoppingBasket, Sparkles, Store, UserRound } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiFailure, apiRequest } from '@/lib/api-client';
import { journeys, personas, storeFixture, type Journey, type PersonaId } from '@/lib/fixtures';

type HealthData = { state: 'ready' | 'degraded' | 'offline'; checkedAt: string; correlationId: string };
type HealthView = { status: 'loading' } | { status: 'ready'; data: HealthData } | { status: 'error'; error: ApiFailure };
const personaIcons = { customer: UserRound, agent: Headphones, manager: ShieldCheck };

function HealthBadge({ health, onRetry }: { health: HealthView; onRetry: () => void }) {
  if (health.status === 'loading') return <Skeleton className="h-7 w-28 rounded-full bg-white/15" />;
  if (health.status === 'error') {
    return <Button variant="ghost" size="sm" onClick={onRetry} className="text-amber-100 hover:bg-white/10 hover:text-white"><CircleAlert /> 연결 확인</Button>;
  }
  return <Badge className="h-7 border border-lime-300/30 bg-lime-300/15 px-3 text-lime-100"><span className="size-1.5 rounded-full bg-lime-300 shadow-[0_0_0_4px_rgb(190_242_100/12%)]" />AI Server 준비됨</Badge>;
}

function JourneyCard({ journey, selected, onSelect }: { journey: Journey; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" aria-label={`${journey.title} 여정 선택`} onClick={onSelect} className="group text-left focus-visible:outline-none">
      <Card className={selected ? 'border-forest-700 bg-forest-950 text-white ring-0' : 'border-stone-200/80 bg-white/75 ring-0 hover:border-forest-300 hover:bg-white'}>
        <CardHeader>
          <div className="mb-3 flex items-center gap-2"><Badge variant={selected ? 'secondary' : 'outline'}>{journey.category}</Badge><span className={selected ? 'text-xs text-stone-300' : 'text-xs text-stone-500'}>{journey.eta}</span></div>
          <CardTitle className="text-[15px]">{journey.title}</CardTitle>
          <CardDescription className={selected ? 'text-stone-300' : undefined}>{journey.description}</CardDescription>
          <CardAction><ArrowRight className="size-4 transition-transform group-hover:translate-x-1" /></CardAction>
        </CardHeader>
      </Card>
    </button>
  );
}

export default function Home() {
  const [personaId, setPersonaId] = useState<PersonaId>('customer');
  const [selectedJourneyId, setSelectedJourneyId] = useState(journeys[0].id);
  const [health, setHealth] = useState<HealthView>({ status: 'loading' });
  const activePersona = personas.find((persona) => persona.id === personaId) ?? personas[0];
  const visibleJourneys = useMemo(() => journeys.filter((journey) => journey.personaId === personaId), [personaId]);
  const selectedJourney = journeys.find((journey) => journey.id === selectedJourneyId) ?? visibleJourneys[0];

  const checkHealth = useCallback(async () => {
    setHealth({ status: 'loading' });
    try {
      setHealth({ status: 'ready', data: await apiRequest<HealthData>('/api/health', { timeoutMs: 5000 }) });
    } catch (error) {
      setHealth({ status: 'error', error: error instanceof ApiFailure ? error : new ApiFailure('unexpected', null, 'UNKNOWN', '상태를 확인하지 못했습니다.', 'unknown', true) });
    }
  }, []);

  useEffect(() => {
    const initialCheck = setTimeout(() => void checkHealth(), 0);
    return () => clearTimeout(initialCheck);
  }, [checkHealth]);
  function changePersona(value: string) {
    const nextId = value as PersonaId;
    setPersonaId(nextId);
    const firstJourney = journeys.find((journey) => journey.personaId === nextId);
    if (firstJourney) setSelectedJourneyId(firstJourney.id);
  }

  return (
    <main className="min-h-screen bg-canvas text-stone-900">
      <header className="bg-forest-950 text-white">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-4 lg:px-10">
          <div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-lime-300 text-forest-950"><ShoppingBasket className="size-5" /></div><div><p className="font-semibold tracking-tight">HJ Mart Assist</p><p className="text-[11px] text-stone-400">SERVICE DEMO · S0</p></div></div>
          <HealthBadge health={health} onRetry={checkHealth} />
        </div>
      </header>

      <section className="border-b border-stone-200 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-5 py-5 lg:flex-row lg:items-end lg:justify-between lg:px-10">
          <div><div className="mb-2 flex items-center gap-2 text-xs font-medium text-forest-700"><Store className="size-3.5" /> {storeFixture.id}</div><h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{storeFixture.name} AI 업무 공간</h1><p className="mt-1 text-sm text-stone-500">고객 문의, 상담 근거, 운영 지식을 하나의 흐름으로 확인합니다.</p></div>
          <Tabs value={personaId} onValueChange={changePersona}><TabsList className="h-10 bg-stone-100 p-1">{personas.map((persona) => { const Icon = personaIcons[persona.id]; return <TabsTrigger key={persona.id} value={persona.id} className="px-3"><Icon /> {persona.role}</TabsTrigger>; })}</TabsList></Tabs>
        </div>
      </section>

      <div className="mx-auto grid max-w-[1440px] gap-6 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-10">
        <div className="space-y-6">
          <section className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
            <Card className="border-0 bg-lime-200/75 ring-0"><CardHeader><Badge className="mb-3 bg-forest-950">현재 페르소나</Badge><CardTitle className="font-display text-xl">{activePersona.label}</CardTitle><CardDescription className="text-forest-900/65">{activePersona.role}</CardDescription></CardHeader><CardContent><p className="text-sm leading-6 text-forest-950">{activePersona.goal}</p></CardContent></Card>
            <div><div className="mb-3 flex items-end justify-between"><div><p className="eyebrow">대표 사용자 여정</p><h2 className="font-display text-xl font-semibold">어떤 일을 시작할까요?</h2></div><span className="text-xs text-stone-500">{visibleJourneys.length}개 시나리오</span></div><div className="grid gap-3 md:grid-cols-2">{visibleJourneys.map((journey) => <JourneyCard key={journey.id} journey={journey} selected={journey.id === selectedJourney.id} onSelect={() => setSelectedJourneyId(journey.id)} />)}</div></div>
          </section>

          <Card className="border-stone-200 bg-white ring-0">
            <CardHeader className="border-b border-stone-100 pb-4"><div className="mb-2 flex items-center gap-2"><Sparkles className="size-4 text-forest-700" /><span className="eyebrow">질문 미리보기</span></div><CardTitle className="font-display text-xl">{selectedJourney.title}</CardTitle><CardDescription>후속 단계에서 이 입력을 실제 `/v1` 질의 흐름에 연결합니다.</CardDescription></CardHeader>
            <CardContent className="pt-1"><div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-4 text-[15px] leading-6">“{selectedJourney.prompt}”</div></CardContent>
            <CardFooter className="justify-between border-stone-100 bg-stone-50/70"><span className="flex items-center gap-1.5 text-xs text-stone-500"><Clock3 className="size-3.5" />예상 처리 {selectedJourney.eta}</span><Link href="/chat" className={buttonVariants({ className: 'bg-forest-950' })}>대화 시작 <ArrowRight /></Link></CardFooter>
          </Card>

          <section><div className="mb-3"><p className="eyebrow">화면 상태 계약</p><h2 className="font-display text-xl font-semibold">모든 상태를 숨기지 않습니다</h2></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card size="sm" className="border-stone-200 bg-white ring-0"><CardHeader><RefreshCw className="mb-2 size-5 animate-spin text-sky-600" /><CardTitle>불러오는 중</CardTitle><CardDescription>요청 처리와 근거 검색을 구분해 표시</CardDescription></CardHeader></Card>
            <Card size="sm" className="border-stone-200 bg-white ring-0"><CardHeader><Search className="mb-2 size-5 text-stone-500" /><CardTitle>결과 없음</CardTitle><CardDescription>조건을 바꾸거나 상담원 연결 안내</CardDescription></CardHeader></Card>
            <Card size="sm" className="border-stone-200 bg-white ring-0"><CardHeader><CircleAlert className="mb-2 size-5 text-rose-600" /><CardTitle>일시 오류</CardTitle><CardDescription>재시도와 correlation ID를 함께 제공</CardDescription></CardHeader></Card>
            <Card size="sm" className="border-stone-200 bg-white ring-0"><CardHeader><ShieldCheck className="mb-2 size-5 text-amber-600" /><CardTitle>권한 필요</CardTitle><CardDescription>관리 작업은 허용 역할만 접근</CardDescription></CardHeader></Card>
          </div></section>
        </div>

        <aside className="space-y-4">
          {health.status === 'error' ? <Alert className="border-amber-200 bg-amber-50 text-amber-950"><CircleAlert /><AlertTitle>AI Server 연결 대기</AlertTitle><AlertDescription><p>{health.error.message}</p><p className="mt-2 font-mono text-[11px] opacity-70">ID {health.error.correlationId}</p><Button size="sm" variant="outline" className="mt-3" onClick={checkHealth}><RefreshCw /> 다시 확인</Button></AlertDescription></Alert> : <Card className="border-0 bg-forest-950 text-white ring-0"><CardHeader><DatabaseZap className="mb-3 size-6 text-lime-300" /><CardTitle>연결 진단</CardTitle><CardDescription className="text-stone-400">BFF를 통해 AI Server 준비 상태를 확인합니다.</CardDescription></CardHeader><CardContent className="space-y-3 text-xs"><div className="flex justify-between border-b border-white/10 pb-2"><span className="text-stone-400">대상</span><span>AI Server :11000</span></div><div className="flex justify-between border-b border-white/10 pb-2"><span className="text-stone-400">상태</span><span>{health.status === 'ready' ? 'READY' : 'CHECKING'}</span></div><div className="flex justify-between gap-4"><span className="text-stone-400">Correlation</span><span className="truncate font-mono">{health.status === 'ready' ? health.data.correlationId : '발급 중'}</span></div></CardContent></Card>}
          <Card className="border-stone-200 bg-white ring-0"><CardHeader><BookOpenCheck className="mb-3 size-6 text-forest-700" /><CardTitle>준비된 지식</CardTitle><CardDescription>개인정보를 포함하지 않은 데모 fixture</CardDescription></CardHeader><CardContent className="space-y-3">{[['상품', '3개'], ['정책', '2개'], ['대표 여정', `${journeys.length}개`]].map(([label, value]) => <div key={label} className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 text-sm"><span>{label}</span><Badge variant="outline">{value}</Badge></div>)}</CardContent></Card>
          <div className="rounded-xl border border-dashed border-stone-300 px-4 py-3 text-xs leading-5 text-stone-500"><div className="mb-1 flex items-center gap-1.5 font-medium text-stone-700"><Bot className="size-3.5" /> 안전한 데모 경계</div>브라우저에는 관리자 credential을 저장하지 않으며, 모든 예시는 가상 ID와 비식별 데이터만 사용합니다.</div>
        </aside>
      </div>
      <footer className="mx-auto flex max-w-[1440px] items-center justify-between border-t border-stone-200 px-5 py-5 text-xs text-stone-500 lg:px-10"><span>HJ Solution · Service Demo Foundation</span><span className="flex items-center gap-1">ENV-SVC-01~04 <ExternalLink className="size-3" /></span></footer>
    </main>
  );
}
