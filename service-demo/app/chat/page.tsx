'use client';

import { type SyntheticEvent, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowUp, Bot, CheckCircle2, CircleAlert, FileText, Headphones, LoaderCircle, MapPin, MessageCircleQuestion, ShieldCheck, ShoppingBasket, Sparkles, Store } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageGroup, MessageHeader } from '@/components/ui/message';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiFailure, apiRequest } from '@/lib/api-client';
import type { AnswerResult, TenantId } from '@/lib/knowledge-contract';

const stores: Record<TenantId, { name: string; region: string }> = {
  STORE_A: { name: '한결마트 성수점', region: '서울 동부' },
  STORE_B: { name: '한결마트 연남점', region: '서울 서부' },
};

const recommendations = [
  '개봉한 멀티탭도 교환할 수 있나요?',
  '이 매장은 매일 몇 시부터 몇 시까지 운영하나요?',
  '등록된 상품의 종류와 가격을 알려주세요.',
  '품절 상품의 다음 입고일을 알 수 있나요?',
];

type ConversationItem =
  | { id: string; kind: 'question'; text: string }
  | { id: string; kind: 'answer'; result: AnswerResult }
  | { id: string; kind: 'error'; error: ApiFailure };

function toApiFailure(error: unknown): ApiFailure {
  if (error instanceof ApiFailure) return error;
  return new ApiFailure('unexpected', null, 'UNKNOWN', '답변을 불러오지 못했습니다.', 'unknown', true);
}

function SourceList({ result }: { result: AnswerResult }) {
  if (!result.answerable || result.sources.length === 0) return null;
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {result.sources.map((source, index) => (
        <Card key={`${source.id}-${index}`} size="sm" className="border-stone-200 bg-white ring-0">
          <CardHeader>
            <div className="mb-1 flex items-center justify-between"><Badge variant="outline">근거 {index + 1}</Badge><span className="text-[11px] text-stone-500">답변에 사용한 문서</span></div>
            <CardTitle className="flex items-start gap-2 text-sm"><FileText className="mt-0.5 size-4 shrink-0 text-forest-700" />{source.name}</CardTitle>
            <CardDescription>{[source.page ? `${source.page}페이지` : null, source.productCode ? `상품 ${source.productCode}` : null].filter(Boolean).join(' · ') || '게시된 지식 문서'}</CardDescription>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

export default function ChatPage() {
  const [tenantId, setTenantId] = useState<TenantId>('STORE_A');
  const [query, setQuery] = useState('');
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [pending, setPending] = useState(false);
  const [reviewTicket, setReviewTicket] = useState<string | null>(null);

  const latestAnswer = [...conversation].reverse().find((item) => item.kind === 'answer');
  const canRequestReview = latestAnswer?.kind === 'answer' && !latestAnswer.result.answerable;

  async function submitQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed || pending) return;
    const questionId = crypto.randomUUID();
    setConversation((items) => [...items, { id: questionId, kind: 'question', text: trimmed }]);
    setQuery('');
    setReviewTicket(null);
    setPending(true);
    try {
      const result = await apiRequest<AnswerResult>('/api/answers', {
        method: 'POST',
        timeoutMs: 22_000,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, query: trimmed }),
      });
      setConversation((items) => [...items, { id: crypto.randomUUID(), kind: 'answer', result }]);
    } catch (error) {
      setConversation((items) => [...items, { id: crypto.randomUUID(), kind: 'error', error: toApiFailure(error) }]);
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitQuestion(query);
  }

  function requestReview() {
    setReviewTicket(`REVIEW-${Date.now().toString(36).toUpperCase()}`);
  }

  function changeTenant(value: TenantId | null) {
    if (!value) return;
    setTenantId(value);
    setConversation([]);
    setReviewTicket(null);
  }

  return (
    <main className="min-h-screen bg-canvas text-stone-900">
      <header className="border-b border-white/10 bg-forest-950 text-white">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-4 lg:px-10">
          <div className="flex items-center gap-3"><Link href="/" aria-label="업무 공간으로 돌아가기" className="grid size-9 place-items-center rounded-xl bg-white/10 hover:bg-white/15"><ArrowLeft className="size-4" /></Link><div><p className="font-semibold">AI 고객 상담</p><p className="text-[11px] text-stone-400">STRICT GROUNDED ANSWER</p></div></div>
          <Badge className="border border-lime-300/25 bg-lime-300/15 text-lime-100"><ShieldCheck /> 근거 우선 모드</Badge>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] gap-5 px-5 py-5 lg:grid-cols-[280px_minmax(0,1fr)_300px] lg:px-10">
        <aside className="space-y-4">
          <Card className="border-stone-200 bg-white ring-0">
            <CardHeader><div className="mb-2 grid size-9 place-items-center rounded-lg bg-lime-200 text-forest-950"><Store className="size-5" /></div><CardTitle>상담 매장</CardTitle><CardDescription>매장을 바꾸면 대화가 초기화되고 해당 tenant 지식만 사용합니다.</CardDescription></CardHeader>
            <CardContent>
              <Select value={tenantId} onValueChange={changeTenant}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(stores).map(([id, store]) => <SelectItem key={id} value={id}>{store.name}</SelectItem>)}</SelectContent></Select>
              <div className="mt-3 flex items-center gap-2 text-xs text-stone-500"><MapPin className="size-3.5" />{stores[tenantId].region} · {tenantId}</div>
            </CardContent>
          </Card>

          <Card className="border-stone-200 bg-white ring-0"><CardHeader><Sparkles className="mb-2 size-5 text-forest-700" /><CardTitle>추천 질문</CardTitle><CardDescription>대표 고객응대 여정을 바로 시험합니다.</CardDescription></CardHeader><CardContent className="space-y-2">{recommendations.map((item) => <button key={item} type="button" onClick={() => void submitQuestion(item)} disabled={pending} className="w-full rounded-lg border border-stone-200 px-3 py-2 text-left text-xs leading-5 hover:border-forest-300 hover:bg-forest-50 disabled:opacity-50">{item}</button>)}</CardContent></Card>
        </aside>

        <section className="flex min-h-[690px] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_20px_60px_rgb(20_45_36/7%)]">
          <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-full bg-forest-950 text-lime-200"><Bot className="size-5" /></div><div><h1 className="font-semibold">{stores[tenantId].name} 안내 도우미</h1><p className="text-xs text-stone-500">게시된 매장 자료에서만 답변합니다</p></div></div><Badge variant="outline">고객 01</Badge></div>

          <div className="flex-1 overflow-y-auto px-5 py-6">
            {conversation.length === 0 ? (
              <div className="grid h-full min-h-[380px] place-items-center text-center"><div className="max-w-md"><div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-lime-200 text-forest-950"><ShoppingBasket className="size-6" /></div><h2 className="font-display text-xl font-semibold">궁금한 상품이나 매장 정책을 물어보세요</h2><p className="mt-2 text-sm leading-6 text-stone-500">근거가 확인되는 경우 문서 출처와 함께 안내하며, 자료가 없으면 추측하지 않고 상담원 검토를 제안합니다.</p></div></div>
            ) : (
              <MessageGroup className="gap-6">
                {conversation.map((item) => item.kind === 'question' ? (
                  <Message key={item.id} align="end"><MessageContent><MessageHeader>고객 01</MessageHeader><div className="max-w-[80%] rounded-2xl rounded-br-sm bg-forest-950 px-4 py-3 leading-6 text-white">{item.text}</div></MessageContent></Message>
                ) : item.kind === 'answer' ? (
                  <Message key={item.id}><MessageAvatar className="bg-lime-200 text-forest-950"><Bot className="size-4" /></MessageAvatar><MessageContent><MessageHeader>HJ Mart Assist</MessageHeader><div className="whitespace-pre-wrap max-w-[92%] rounded-2xl rounded-bl-sm bg-stone-100 px-4 py-3 leading-6">{item.result.answer}</div><SourceList result={item.result} /><MessageFooter>{item.result.answerable ? `${item.result.sources.length}개 근거 · ${item.result.latencyMs}ms` : '근거 없음 · 상담원 검토 가능'} · ID {item.result.requestId}</MessageFooter></MessageContent></Message>
                ) : (
                  <Alert key={item.id} className="border-amber-200 bg-amber-50"><CircleAlert /><AlertTitle>답변을 불러오지 못했습니다</AlertTitle><AlertDescription>{item.error.message}<span className="mt-1 block font-mono text-[11px] opacity-70">ID {item.error.correlationId}</span></AlertDescription></Alert>
                ))}
                {pending && <Message><MessageAvatar className="bg-lime-200 text-forest-950"><Bot className="size-4" /></MessageAvatar><MessageContent><MessageHeader>근거를 확인하고 있습니다</MessageHeader><div className="w-full max-w-md space-y-2 rounded-2xl bg-stone-100 p-4"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-4/5" /><Skeleton className="h-3 w-2/3" /></div></MessageContent></Message>}
              </MessageGroup>
            )}
          </div>

          <form onSubmit={handleSubmit} className="border-t border-stone-100 bg-stone-50/70 p-4"><div className="relative"><Textarea value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} maxLength={1000} disabled={pending} placeholder="상품, 교환·환불 정책, 운영시간을 질문해보세요" aria-label="상담 질문" className="min-h-20 resize-none bg-white pr-14" /><Button type="submit" size="icon" disabled={pending || !query.trim()} aria-label="질문 보내기" className="absolute bottom-3 right-3 bg-forest-950">{pending ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}</Button></div><div className="mt-2 flex items-center justify-between text-[11px] text-stone-500"><span>Enter 전송 · Shift+Enter 줄바꿈</span><span>{query.length}/1000</span></div></form>
        </section>

        <aside className="space-y-4">
          <Card className="border-0 bg-forest-950 text-white ring-0"><CardHeader><MessageCircleQuestion className="mb-2 size-6 text-lime-300" /><CardTitle>답변 원칙</CardTitle><CardDescription className="text-stone-400">등록된 자료에서 확인된 내용만 안내합니다.</CardDescription></CardHeader><CardContent className="space-y-3 text-xs leading-5 text-stone-300"><p>1. 매장별 지식만 검색</p><p>2. 근거 문서가 있어야 답변</p><p>3. 불확실하면 상담원에게 이관</p></CardContent></Card>

          {canRequestReview && <Card className="border-amber-200 bg-amber-50 ring-0"><CardHeader><Headphones className="mb-2 size-6 text-amber-700" /><CardTitle>상담원 검토가 필요하신가요?</CardTitle><CardDescription>현재 질문과 추적 ID를 상담원 검토함에 남깁니다.</CardDescription></CardHeader><CardContent>{reviewTicket ? <Alert className="border-emerald-200 bg-emerald-50"><CheckCircle2 /><AlertTitle>검토 요청 준비 완료</AlertTitle><AlertDescription>접수번호 {reviewTicket}<br />현재 단계에서는 세션 내 요청으로만 보관됩니다.</AlertDescription></Alert> : <Button onClick={requestReview} className="w-full bg-amber-700 hover:bg-amber-800"><Headphones /> 상담원 검토 요청</Button>}</CardContent></Card>}

          <div className="rounded-xl border border-dashed border-stone-300 p-4 text-xs leading-5 text-stone-500"><div className="mb-1 font-medium text-stone-700">개인정보 보호</div>이름, 전화번호, 주문번호 등 실제 개인정보는 입력하지 마세요. 관리자 credential은 브라우저로 전달되지 않습니다.</div>
        </aside>
      </div>
    </main>
  );
}
