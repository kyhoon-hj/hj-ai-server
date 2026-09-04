'use client';

import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import Link from 'next/link';
import {
  Archive,
  ArrowLeft,
  BookOpenCheck,
  FileText,
  LoaderCircle,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiFailure, apiRequest } from '@/lib/api-client';
import { failedIndexJobNotice } from '@/lib/index-job-notice';
import type {
  KnowledgeFileItem,
  KnowledgeIndexJobItem,
} from '@/lib/knowledge-management-contract';
import type { TenantId } from '@/lib/knowledge-contract';

type FileListResponse = {
  tenantId: TenantId;
  files: KnowledgeFileItem[];
  requestId: string;
};
type FileMutationResponse = {
  tenantId: TenantId;
  file: KnowledgeFileItem;
  requestId: string;
};
type JobMutationResponse = {
  tenantId: TenantId;
  file?: KnowledgeFileItem;
  job: KnowledgeIndexJobItem;
  requestId: string;
};
type JobStatusResponse = {
  tenantId: TenantId;
  job: KnowledgeIndexJobItem;
  requestId: string;
};
type ViewState =
  | { status: 'loading' }
  | { status: 'ready'; files: KnowledgeFileItem[]; requestId: string }
  | { status: 'error'; error: ApiFailure };
type FailedJob = { id: string; fileName: string; canRetry: boolean };

const storeNames: Record<TenantId, string> = {
  STORE_A: '한결마트 성수점',
  STORE_B: '한결마트 마포점',
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function StatusBadge({ file }: { file: KnowledgeFileItem }) {
  if (file.hasError) return <Badge variant="destructive">오류</Badge>;
  if (file.status === 'indexed' && file.chunkCount > 0)
    return <Badge className="bg-emerald-700">검색 가능</Badge>;
  return <Badge variant="outline">{file.status}</Badge>;
}

export default function KnowledgeManagementPage() {
  const [tenantId, setTenantId] = useState<TenantId>('STORE_A');
  const [view, setView] = useState<ViewState>({ status: 'loading' });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [operation, setOperation] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failedJob, setFailedJob] = useState<FailedJob | null>(null);
  const [pausedJob, setPausedJob] = useState<{
    job: KnowledgeIndexJobItem;
    fileName: string;
    tenantId: TenantId;
    requestId: string;
  } | null>(null);

  const loadFiles = useCallback(async (targetTenant: TenantId) => {
    setView({ status: 'loading' });
    try {
      const result = await apiRequest<FileListResponse>(
        `/api/knowledge/files?tenantId=${targetTenant}`,
        { timeoutMs: 10_000 },
      );
      setView({
        status: 'ready',
        files: result.files,
        requestId: result.requestId,
      });
    } catch (error) {
      setView({
        status: 'error',
        error:
          error instanceof ApiFailure
            ? error
            : new ApiFailure(
                'unexpected',
                null,
                'UNKNOWN',
                '문서 목록을 불러오지 못했습니다.',
                'unknown',
                true,
              ),
      });
    }
  }, []);

  async function waitForJob(
    initialJob: KnowledgeIndexJobItem,
    fileName: string,
    targetTenant: TenantId,
    initialRequestId: string,
  ) {
    let job = initialJob;
    let requestId = initialRequestId;
    setPausedJob(null);
    for (let poll = 0; poll < 90; poll += 1) {
      if (job.status === 'completed') {
        setNotice(`${fileName} 인덱싱을 완료했습니다.`);
        setFailedJob(null);
        await loadFiles(targetTenant);
        return;
      }
      if (job.status === 'failed') {
        setNotice(`${failedIndexJobNotice(job, fileName)} · ID ${requestId}`);
        setFailedJob({ id: job.id, fileName, canRetry: job.canRetry });
        return;
      }
      setNotice(
        job.status === 'processing'
          ? `${fileName} 지식을 검색 가능하게 만드는 중입니다.`
          : job.nextAttemptAt
            ? `${fileName} 일시 장애를 복구 중이며 다음 시도를 기다리고 있습니다.`
            : `${fileName} 인덱싱 작업이 대기 중입니다.`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      let result: JobStatusResponse;
      try {
        result = await apiRequest<JobStatusResponse>(
          `/api/knowledge/files?tenantId=${targetTenant}&jobId=${encodeURIComponent(job.id)}`,
          { timeoutMs: 10_000 },
        );
      } catch (error) {
        const id =
          error instanceof ApiFailure ? error.correlationId : requestId;
        setNotice(
          `${fileName} 작업 상태를 확인하지 못했습니다. 작업 실패를 의미하지 않습니다. 상태를 다시 확인해주세요. · ID ${id}`,
        );
        setPausedJob({ job, fileName, tenantId: targetTenant, requestId: id });
        return;
      }
      job = result.job;
      requestId = result.requestId;
    }
    setNotice(
      `${fileName} 상태 확인 대기 시간이 끝났습니다. 서버 작업은 계속될 수 있습니다. · ID ${requestId}`,
    );
    setPausedJob({ job, fileName, tenantId: targetTenant, requestId });
  }

  async function resumeJobStatus() {
    if (!pausedJob || operation !== null) return;
    const target = pausedJob;
    setOperation(`status:${target.job.id}`);
    try {
      await waitForJob(
        target.job,
        target.fileName,
        target.tenantId,
        target.requestId,
      );
    } finally {
      setOperation(null);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void (async () => {
        await apiRequest('/api/manager-session', {
          method: 'POST',
          timeoutMs: 5_000,
        }).catch(() => null);
        await loadFiles(tenantId);
      })();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadFiles, tenantId]);

  async function uploadFile(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) return;
    setOperation('upload');
    setPausedJob(null);
    setNotice(null);
    setFailedJob(null);
    const form = new FormData();
    form.set('tenantId', tenantId);
    form.set('file', selectedFile);
    try {
      const result = await apiRequest<JobMutationResponse>(
        '/api/knowledge/files',
        { method: 'POST', body: form, timeoutMs: 20_000 },
      );
      const fileName = result.file?.name ?? selectedFile.name;
      setSelectedFile(null);
      setInputKey((value) => value + 1);
      await waitForJob(result.job, fileName, tenantId, result.requestId);
    } catch (error) {
      setView((current) =>
        current.status === 'ready'
          ? current
          : { status: 'error', error: error as ApiFailure },
      );
      setNotice(
        error instanceof ApiFailure
          ? `${error.message} · ID ${error.correlationId}`
          : '문서 업로드에 실패했습니다.',
      );
    } finally {
      setOperation(null);
    }
  }

  async function reindex(file: KnowledgeFileItem) {
    setOperation(`reindex:${file.id}`);
    setPausedJob(null);
    setNotice(null);
    setFailedJob(null);
    try {
      const result = await apiRequest<JobMutationResponse>(
        '/api/knowledge/files',
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            fileId: file.id,
            action: 'reindex',
          }),
          timeoutMs: 20_000,
        },
      );
      await waitForJob(result.job, file.name, tenantId, result.requestId);
    } catch (error) {
      setNotice(
        error instanceof ApiFailure
          ? `${error.message} · ID ${error.correlationId}`
          : '재인덱싱에 실패했습니다.',
      );
    } finally {
      setOperation(null);
    }
  }

  async function retryJob() {
    if (!failedJob?.canRetry) return;
    const target = failedJob;
    setOperation(`retry:${target.id}`);
    setPausedJob(null);
    setNotice(null);
    setFailedJob(null);
    try {
      const result = await apiRequest<JobMutationResponse>(
        '/api/knowledge/files',
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            jobId: target.id,
            action: 'retry-job',
          }),
          timeoutMs: 20_000,
        },
      );
      await waitForJob(result.job, target.fileName, tenantId, result.requestId);
    } catch (error) {
      setNotice(
        error instanceof ApiFailure
          ? `${error.message} · ID ${error.correlationId}`
          : '인덱싱 재시도에 실패했습니다.',
      );
    } finally {
      setOperation(null);
    }
  }

  async function archive(file: KnowledgeFileItem) {
    setOperation(`archive:${file.id}`);
    setPausedJob(null);
    setNotice(null);
    try {
      await apiRequest<FileMutationResponse>('/api/knowledge/files', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, fileId: file.id }),
        timeoutMs: 20_000,
      });
      setNotice(`${file.name}을 보관 처리했습니다.`);
      await loadFiles(tenantId);
    } catch (error) {
      setNotice(
        error instanceof ApiFailure
          ? `${error.message} · ID ${error.correlationId}`
          : '문서 보관에 실패했습니다.',
      );
    } finally {
      setOperation(null);
    }
  }

  return (
    <main className="min-h-screen bg-canvas text-stone-900">
      <header className="bg-forest-950 text-white">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-4 lg:px-10">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-xl bg-amber-300 text-forest-950">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <p className="font-semibold">매장 관리자 지식관리</p>
              <p className="text-[11px] text-stone-400">
                KNW-SVC-04 · 서버 전용 권한
              </p>
            </div>
          </div>
          <Link
            href="/"
            className={buttonVariants({
              variant: 'ghost',
              size: 'sm',
              className: 'text-white hover:bg-white/10 hover:text-white',
            })}
          >
            <ArrowLeft /> 업무 공간
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] space-y-6 px-5 py-6 lg:px-10">
        <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">검증된 지식만 고객에게 제공</p>
            <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              문서 업로드와 버전 관리
            </h1>
            <p className="mt-2 text-sm text-stone-500">
              새 버전을 먼저 검색 가능 상태로 만든 뒤 고객 답변을 확인하고 이전
              버전을 보관하세요.
            </p>
          </div>
          <div>
            <label
              className="mb-1.5 block text-xs font-medium text-stone-600"
              htmlFor="store-select"
            >
              관리 매장
            </label>
            <Select
              value={tenantId}
              disabled={operation !== null}
              onValueChange={(value) => {
                setTenantId(value as TenantId);
                setSelectedFile(null);
                setNotice(null);
                setFailedJob(null);
                setPausedJob(null);
              }}
            >
              <SelectTrigger id="store-select" className="w-56 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="STORE_A">한결마트 성수점</SelectItem>
                <SelectItem value="STORE_B">한결마트 마포점</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className="space-y-4">
            <Card className="border-stone-200 bg-white ring-0">
              <CardHeader>
                <div className="mb-2 grid size-10 place-items-center rounded-xl bg-lime-200 text-forest-950">
                  <Upload className="size-5" />
                </div>
                <CardTitle>새 버전 업로드</CardTitle>
                <CardDescription>
                  MD, CSV, PDF, DOCX, XLSX · 최대 30MB
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={uploadFile}>
                  <input
                    key={inputKey}
                    type="file"
                    accept=".md,.csv,.pdf,.docx,.xlsx"
                    onChange={(event) =>
                      setSelectedFile(event.target.files?.[0] ?? null)
                    }
                    disabled={operation !== null}
                    aria-label="지식 문서 선택"
                    className="block w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-1.5 file:font-medium disabled:opacity-50"
                  />
                  <div className="rounded-lg bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-600">
                    선택한 파일은 {storeNames[tenantId]}에만 등록되며 업로드 후
                    인덱싱 상태를 실시간으로 확인합니다.
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg-forest-950"
                    disabled={!selectedFile || operation !== null}
                  >
                    {operation === 'upload' ? (
                      <>
                        <LoaderCircle className="animate-spin" /> 검색 준비 상태
                        확인 중
                      </>
                    ) : (
                      <>
                        <Upload /> 업로드하고 검색 준비
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
            <Alert className="border-amber-200 bg-amber-50">
              <BookOpenCheck />
              <AlertTitle>안전한 업데이트 순서</AlertTitle>
              <AlertDescription>
                새 문서 업로드 → 고객 채팅에서 답변 확인 → 이전 문서 보관. 기존
                파일을 직접 덮어쓰지 않습니다.
              </AlertDescription>
            </Alert>
            {notice && (
              <Alert>
                <AlertTitle>
                  {operation ? '작업 진행 상태' : '작업 결과'}
                </AlertTitle>
                <AlertDescription>
                  <span>{notice}</span>
                  {pausedJob && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full"
                      disabled={operation !== null}
                      onClick={() => void resumeJobStatus()}
                    >
                      <RefreshCw /> 작업 상태 다시 확인
                    </Button>
                  )}
                  {failedJob?.canRetry && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full"
                      disabled={operation !== null}
                      onClick={() => void retryJob()}
                    >
                      <RotateCw /> 실패 작업 다시 시도
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>

          <Card className="border-stone-200 bg-white ring-0">
            <CardHeader className="flex-row items-start justify-between border-b border-stone-100">
              <div>
                <CardTitle>{storeNames[tenantId]} 지식 문서</CardTitle>
                <CardDescription>
                  현재 고객 답변 검색에 사용할 수 있는 문서와 처리 상태입니다.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadFiles(tenantId)}
                disabled={view.status === 'loading' || operation !== null}
              >
                <RefreshCw
                  className={view.status === 'loading' ? 'animate-spin' : ''}
                />{' '}
                새로고침
              </Button>
            </CardHeader>
            <CardContent className="pt-2">
              {view.status === 'loading' && (
                <div className="space-y-3 py-4">
                  {[1, 2, 3].map((item) => (
                    <Skeleton key={item} className="h-14 w-full" />
                  ))}
                </div>
              )}
              {view.status === 'error' && (
                <Alert className="my-4 border-rose-200 bg-rose-50">
                  <AlertTitle>문서 목록을 불러오지 못했습니다</AlertTitle>
                  <AlertDescription>
                    {view.error.message}
                    <span className="mt-1 block font-mono text-[11px]">
                      ID {view.error.correlationId}
                    </span>
                  </AlertDescription>
                </Alert>
              )}
              {view.status === 'ready' && view.files.length === 0 && (
                <div className="grid min-h-56 place-items-center text-center">
                  <div>
                    <FileText className="mx-auto mb-3 size-8 text-stone-400" />
                    <p className="font-medium">등록된 문서가 없습니다</p>
                    <p className="mt-1 text-sm text-stone-500">
                      왼쪽에서 첫 지식 문서를 업로드하세요.
                    </p>
                  </div>
                </div>
              )}
              {view.status === 'ready' && view.files.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>문서</TableHead>
                      <TableHead>상태</TableHead>
                      <TableHead>검색 조각</TableHead>
                      <TableHead>업데이트</TableHead>
                      <TableHead className="text-right">작업</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view.files.map((file) => (
                      <TableRow key={file.id}>
                        <TableCell>
                          <div
                            className="max-w-64 truncate font-medium"
                            title={file.name}
                          >
                            {file.name}
                          </div>
                          <div className="mt-1 text-xs text-stone-500">
                            {formatBytes(file.size)} · {file.businessStatus}
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge file={file} />
                        </TableCell>
                        <TableCell>{file.chunkCount}개</TableCell>
                        <TableCell className="text-xs text-stone-500">
                          {formatDate(file.updatedAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void reindex(file)}
                              disabled={operation !== null}
                            >
                              {operation === `reindex:${file.id}` ? (
                                <LoaderCircle className="animate-spin" />
                              ) : (
                                <RotateCw />
                              )}{' '}
                              재인덱싱
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-rose-700"
                              disabled={operation !== null}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `${file.name}을 고객 검색에서 제외하고 보관할까요?`,
                                  )
                                )
                                  void archive(file);
                              }}
                            >
                              <Archive /> 보관
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {view.status === 'ready' && (
                <div className="mt-3 border-t border-stone-100 pt-3 text-[11px] text-stone-400">
                  요청 ID {view.requestId}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
