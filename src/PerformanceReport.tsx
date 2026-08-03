// PerformanceReport.tsx
import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import type {
  MemberCalculation,
  MemberData,
  ProfitScenario,
  ReportSummaryData,
  ReturnRateOption,
} from './types';
import {
  INTERVIEW_RATE_LOW_THRESHOLD,
  OFFER_RATE_GOOD_THRESHOLD,
  buildActionPlan,
  buildAutoHeadline,
  buildDiagnosisCopyText,
  diagnoseMember,
  evaluateAbove,
  groupDiagnoses,
  toneBadgeClasses,
  toneCardClasses,
} from './diagnostics';
import type { CsvImportResult } from './csv';
import type { PreparedImport } from './fileImport';
import { ACCEPTED_FILE_EXTENSIONS, ACCEPTED_FILE_MIME_TYPES, prepareImport, readMembers } from './fileImport';
import { sampleReportData } from './sampleData';

// プロップスの定義
interface PerformanceReportProps {
  data?: ReportSummaryData;
  // アップロード画面から遷移した直後は、顧客名などの未入力項目を埋めてもらうため
  // 編集モードで開始する
  startInEditMode?: boolean;
  // 指定するとヘッダーに「別のデータを読み込む」ボタンが表示され、アップロード画面に戻れる
  onBackToUpload?: () => void;
}

const RETURN_RATE_OPTIONS: ReturnRateOption[] = [
  { rateLabel: '60%還元', returnRate: 0.6 },
  { rateLabel: '70%還元', returnRate: 0.7 },
  { rateLabel: '80%還元', returnRate: 0.8 },
];

// 費用対効果シミュレーションで使う固定の基準額（35万円換算）。
// 元のExcelレポート（SSPレポートテンプレート）の計算方法に合わせている。
const COST_EFFECTIVENESS_BASELINE = 350000;

// ヘッダーのロゴに使う頭文字を決めるための、法人格などの一般的な接頭辞・接尾辞。
// これを取り除かないと「株式会社◯◯」のような会社名が軒並み「株」になってしまう。
const COMPANY_AFFIX_PATTERN =
  /(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|医療法人|特定非営利活動法人|\(株\)|（株）|\(有\)|（有）)/g;

function getClientInitial(clientName: string): string {
  const trimmed = clientName.trim();
  if (!trimmed) return '?';
  const core = trimmed.replace(COMPANY_AFFIX_PATTERN, '').trim();
  return (core || trimmed).charAt(0).toUpperCase();
}

function createEmptyMember(index: number): MemberData {
  return {
    id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `m-${Date.now()}-${index}`,
    name: `要員${index}`,
    proposals: 0,
    interviews: 0,
    offers: 0,
    unitPrice: 0,
  };
}

// コンポーネント本体
const PerformanceReport: React.FC<PerformanceReportProps> = ({
  data: initialData,
  startInEditMode = false,
  onBackToUpload,
}) => {
  const [data, setData] = useState<ReportSummaryData>(() => initialData ?? sampleReportData);
  const [isEditing, setIsEditing] = useState(startInEditMode);
  const [selectedReturnRate, setSelectedReturnRate] = useState(0.7);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pendingSheets, setPendingSheets] = useState<Extract<PreparedImport, { kind: 'excel-multi' }> | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- 自動計算ロジック ---
  const calculatedData = useMemo(() => {
    const totalUnitPrices = data.members.reduce((sum, m) => sum + m.unitPrice, 0);
    const totalOffers = data.members.reduce((sum, m) => sum + m.offers, 0);
    const totalInterviews = data.members.reduce((sum, m) => sum + m.interviews, 0);
    const totalProposals = data.members.reduce((sum, m) => sum + m.proposals, 0);

    // 粗利・費用対効果シミュレーション (60%, 70%, 80% 還元の3パターン比較)
    // 費用対効果 = 粗利 ÷ 固定費用基準額（35万円換算）× 100
    // ※35万円は元のExcelレポート（SSPレポートテンプレート）の計算方法に合わせた固定の基準値
    const RETURN_RATE_SCENARIOS = [0.6, 0.7, 0.8];
    const profitData: ProfitScenario[] = RETURN_RATE_SCENARIOS.map((rate) => {
      const grossProfit = totalUnitPrices * (1 - rate);
      const costEffectiveness = (grossProfit / COST_EFFECTIVENESS_BASELINE) * 100;
      return {
        returnRate: rate * 100,
        grossProfit,
        costEffectiveness,
      };
    });

    // 各要員の還元率・原価・粗利・診断 (還元率はUIで選択可能)
    const memberCalculations: MemberCalculation[] = data.members.map((m) => {
      const grossProfit = m.unitPrice * (1 - selectedReturnRate);
      return {
        ...m,
        returnRate: selectedReturnRate * 100,
        baseCost: m.unitPrice * selectedReturnRate,
        grossProfit,
        diagnosis: diagnoseMember(m),
      };
    });

    const diagnosisGroups = groupDiagnoses(
      memberCalculations.map((m) => ({ name: m.name, diagnosis: m.diagnosis }))
    );

    const actionPlan = buildActionPlan(diagnosisGroups);

    // ファネル分析の面談移行率・オファー獲得率としきい値による良否判定
    const interviewRate = totalProposals > 0 ? totalInterviews / totalProposals : 0;
    const offerRate = totalInterviews > 0 ? totalOffers / totalInterviews : 0;
    const interviewEvaluation = evaluateAbove(
      interviewRate,
      INTERVIEW_RATE_LOW_THRESHOLD,
      '非常に高い水準',
      '改善の余地あり'
    );
    const offerEvaluation = evaluateAbove(offerRate, OFFER_RATE_GOOD_THRESHOLD, '良好な水準', '重要課題');

    // 選択中の還元率における想定粗利（全体実績カードのKPI用）
    const selectedGrossProfit = totalUnitPrices * (1 - selectedReturnRate);

    // ファネルのバー幅（提案数を100%とした割合）
    const interviewBarWidth = totalProposals > 0 ? Math.min(100, (totalInterviews / totalProposals) * 100) : 0;
    const offerBarWidth = totalProposals > 0 ? Math.min(100, (totalOffers / totalProposals) * 100) : 0;

    return {
      totalUnitPrices,
      totalOffers,
      totalInterviews,
      totalProposals,
      profitData,
      memberCalculations,
      diagnosisGroups,
      actionPlan,
      interviewRate,
      offerRate,
      interviewEvaluation,
      offerEvaluation,
      selectedGrossProfit,
      interviewBarWidth,
      offerBarWidth,
    };
  }, [data.members, selectedReturnRate]);

  // 要約欄が未入力のときに表示する自動生成テキスト（実績から都度計算）
  const autoHeadline = useMemo(
    () =>
      buildAutoHeadline({
        totalProposals: calculatedData.totalProposals,
        totalInterviews: calculatedData.totalInterviews,
        totalOffers: calculatedData.totalOffers,
      }),
    [calculatedData.totalProposals, calculatedData.totalInterviews, calculatedData.totalOffers]
  );
  const displayedHeadline = data.headline.trim() ? data.headline : autoHeadline;

  // --- ヘルパー関数 ---
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(
      amount
    );

  const calculateRate = (numerator: number, denominator: number) => {
    if (denominator === 0) return '0.0%';
    return `${((numerator / denominator) * 100).toFixed(1)}%`;
  };

  // --- 編集ハンドラ ---
  const updateHeaderField = (patch: Partial<Pick<ReportSummaryData, 'clientName' | 'period' | 'headline'>>) => {
    setData((prev) => ({ ...prev, ...patch }));
  };

  const updateMember = (id: string, patch: Partial<MemberData>) => {
    setData((prev) => ({
      ...prev,
      members: prev.members.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
  };

  const removeMember = (id: string) => {
    setData((prev) => ({ ...prev, members: prev.members.filter((m) => m.id !== id) }));
  };

  const addMember = () => {
    setData((prev) => ({ ...prev, members: [...prev.members, createEmptyMember(prev.members.length + 1)] }));
  };

  const applyImportResult = (result: CsvImportResult) => {
    setImportErrors(result.errors);
    if (result.members.length > 0) {
      setData((prev) => ({
        ...prev,
        members: result.members,
        // すでに入力済みの顧客名・期間は上書きしない
        clientName: prev.clientName.trim() ? prev.clientName : (result.clientName ?? prev.clientName),
        period: prev.period.trim() ? prev.period : (result.period ?? prev.period),
      }));
    }
  };

  const processImportFile = async (file: File) => {
    setImportErrors([]);
    const prepared = await prepareImport(file);
    if (prepared.kind === 'excel-multi') {
      setPendingSheets(prepared);
      return;
    }
    applyImportResult(await readMembers(prepared));
  };

  const handleSelectSheet = async (sheetName: string) => {
    if (!pendingSheets) return;
    const result = await readMembers(pendingSheets, sheetName);
    setPendingSheets(null);
    applyImportResult(result);
  };

  const handleCsvChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void processImportFile(file);
    e.target.value = '';
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void processImportFile(file);
  };

  const handleReset = () => {
    if (!window.confirm('編集内容を破棄してサンプルデータに戻しますか？')) return;
    setData(sampleReportData);
    setImportErrors([]);
  };

  const handleCopyDiagnosis = async () => {
    const text = buildDiagnosisCopyText(calculatedData.diagnosisGroups);
    const showCopied = () => {
      setCopied(true);
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
      copyResetTimer.current = setTimeout(() => setCopied(false), 1800);
    };
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
      showCopied();
    } catch {
      showCopied();
    }
  };

  const handleDownloadPdf = () => {
    window.print();
  };

  const hasMembers = calculatedData.memberCalculations.length > 0;

  return (
    <div className="max-w-[1200px] mx-auto p-6 bg-white shadow-lg rounded-xl space-y-8 font-sans text-slate-900 border border-slate-100 print:shadow-none print:border-0 print:rounded-none">
      {/* ヘッダー */}
      <header className="border-b border-slate-100 pb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-flex items-center justify-center shrink-0 w-14 h-14 rounded-xl bg-slate-900 text-white text-2xl font-bold">
              {getClientInitial(data.clientName)}
            </span>
            <div className="min-w-0">
              {isEditing ? (
                <input
                  className="text-sm font-medium text-slate-500 border border-slate-200 rounded px-2 py-1 w-64"
                  value={data.clientName}
                  onChange={(e) => updateHeaderField({ clientName: e.target.value })}
                />
              ) : (
                <p className="text-sm font-medium text-slate-500">{data.clientName}</p>
              )}
              <h1 className="text-2xl font-extrabold tracking-tight">SSP（SES）レポート</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            {onBackToUpload && (
              <button
                type="button"
                onClick={onBackToUpload}
                className="px-3 py-1.5 text-sm font-semibold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
              >
                別のデータを読み込む
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsEditing((v) => !v)}
              className={`px-3 py-1.5 text-sm font-semibold rounded-lg border transition-colors ${
                isEditing
                  ? 'bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-500'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {isEditing ? '編集を終える' : 'データを編集'}
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          {isEditing ? (
            <input
              className="text-sm font-semibold rounded-full bg-slate-50 text-slate-600 border border-slate-200 px-3 py-1 text-right"
              value={data.period}
              onChange={(e) => updateHeaderField({ period: e.target.value })}
            />
          ) : (
            <p className="px-3 py-1 text-sm font-semibold rounded-full bg-slate-50 text-slate-600 border border-slate-100">
              {data.period}
            </p>
          )}
        </div>

        <div className="mt-6 p-5 rounded-2xl bg-white border border-slate-100 shadow-sm flex gap-4 items-start">
          <span className="shrink-0 w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l1.9 4.9L19 9.8l-4.1 3 1.5 5L12 15l-4.4 2.8 1.5-5L5 9.8l5.1-1.9z" />
            </svg>
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-indigo-600 tracking-wide">サマリー</span>
              {isEditing && data.headline.trim() && (
                <button
                  type="button"
                  onClick={() => updateHeaderField({ headline: '' })}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline print:hidden"
                >
                  自動生成に戻す
                </button>
              )}
            </div>
            {isEditing ? (
              <textarea
                className="mt-2 block w-full rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 text-sm leading-relaxed text-slate-900"
                rows={3}
                placeholder={autoHeadline}
                value={data.headline}
                onChange={(e) => updateHeaderField({ headline: e.target.value })}
              />
            ) : (
              <p className="text-slate-900 leading-relaxed font-medium mt-1">{displayedHeadline}</p>
            )}
          </div>
        </div>

        {isEditing && (
          <div className="mt-4 space-y-3">
            {pendingSheets ? (
              <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                <p className="text-sm font-semibold text-slate-700">
                  複数のシートが見つかりました。読み込むシートを選んでください。
                </p>
                <div className="flex flex-wrap gap-2">
                  {pendingSheets.sheetNames.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => void handleSelectSheet(name)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-400 hover:bg-slate-50 text-sm font-medium text-slate-700 transition-colors"
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setPendingSheets(null)}
                  className="text-xs font-semibold text-slate-400 hover:text-slate-600 underline"
                >
                  キャンセル
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                role="button"
                tabIndex={0}
                className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
                  isDragOver ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                }`}
              >
                <p className="text-sm font-semibold text-slate-700">
                  CSV/Excelファイルをここにドラッグ&ドロップ、またはクリックして選択
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={`${ACCEPTED_FILE_EXTENSIONS},${ACCEPTED_FILE_MIME_TYPES}`}
                  className="hidden"
                  onChange={handleCsvChange}
                />
              </div>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleReset}
                className="px-3 py-1.5 text-sm font-semibold rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
              >
                サンプルデータに戻す
              </button>
            </div>
          </div>
        )}
        {importErrors.length > 0 && (
          <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-100 text-xs text-red-700 space-y-1">
            <p className="font-semibold">ファイル読み込みで一部の行をスキップしました：</p>
            {importErrors.map((err) => (
              <p key={err}>・{err}</p>
            ))}
          </div>
        )}
      </header>

      {/* サマリー: 2x2クアドラント */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 全体実績 */}
        <section className="p-6 bg-slate-50 rounded-2xl border border-slate-100 print:break-inside-avoid">
          <h2 className="text-lg font-bold mb-4">全体実績</h2>
          <div className="flex flex-col gap-3.5">
            <div className="p-5 bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl border border-green-100 text-center">
              <p className="text-sm font-semibold text-green-800">売上獲得金額（合計単価）</p>
              <p className="font-display text-4xl font-extrabold mt-1 text-green-600 tabular-nums break-all">
                {formatCurrency(calculatedData.totalUnitPrices)}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3.5">
              <div className="p-4 bg-white rounded-xl border border-slate-200 text-center">
                <p className="text-xs text-slate-500">稼働要員数</p>
                <p className="font-display text-2xl font-extrabold mt-1.5 tabular-nums">
                  {data.members.length}
                  <span className="text-xs font-semibold text-slate-500 ml-0.5">名</span>
                </p>
              </div>
              <div className="p-4 bg-white rounded-xl border border-slate-200 text-center">
                <p className="text-xs text-slate-500">要員平均単価</p>
                <p className="font-display text-2xl font-extrabold mt-1.5 tabular-nums">
                  {formatCurrency(
                    data.members.length > 0 ? Math.round(calculatedData.totalUnitPrices / data.members.length) : 0
                  )}
                </p>
              </div>
            </div>
            <div className="p-4 bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl border border-green-100 text-center">
              <p className="text-xs font-semibold text-green-800">想定粗利（{selectedReturnRate * 100}%還元時）</p>
              <p className="font-display text-2xl font-extrabold mt-1.5 text-green-600 tabular-nums">
                {formatCurrency(calculatedData.selectedGrossProfit)}
              </p>
            </div>
          </div>
        </section>

        {/* ファネル分析 */}
        <section className="p-6 bg-slate-50 rounded-2xl border border-slate-100 print:break-inside-avoid flex flex-col">
          <h2 className="text-lg font-bold mb-4">ファネル分析</h2>
          {hasMembers ? (
            <div className="flex-1 flex flex-col justify-center">
              {/* 提案 */}
              <div className="flex items-center gap-3">
                <div className="w-14 shrink-0 text-xs font-bold text-slate-600 text-right">提案</div>
                <div className="flex-1 h-11 bg-slate-100 rounded-xl overflow-hidden">
                  <div className="h-full rounded-xl bg-gradient-to-r from-slate-700 to-slate-500" style={{ width: '100%' }} />
                </div>
                <div className="w-16 shrink-0 font-display text-xl font-extrabold tabular-nums">
                  {calculatedData.totalProposals}
                  <span className="text-xs font-semibold text-slate-500 ml-0.5">件</span>
                </div>
              </div>

              {/* 面談移行率コネクタ */}
              <div className="flex items-center gap-2 py-2 pl-[68px]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 5v14M6 13l6 6 6-6" />
                </svg>
                <span className="text-xs text-slate-500">面談移行率</span>
                <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                  {calculateRate(calculatedData.totalInterviews, calculatedData.totalProposals)}
                </span>
                <span
                  className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold ${toneBadgeClasses(calculatedData.interviewEvaluation.tone)}`}
                >
                  {calculatedData.interviewEvaluation.label}
                </span>
              </div>

              {/* 面談 */}
              <div className="flex items-center gap-3">
                <div className="w-14 shrink-0 text-xs font-bold text-slate-600 text-right">面談</div>
                <div className="flex-1 h-11 bg-slate-100 rounded-xl overflow-hidden">
                  <div
                    className="h-full rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500"
                    style={{ width: `${calculatedData.interviewBarWidth}%` }}
                  />
                </div>
                <div className="w-16 shrink-0 font-display text-xl font-extrabold tabular-nums">
                  {calculatedData.totalInterviews}
                  <span className="text-xs font-semibold text-slate-500 ml-0.5">件</span>
                </div>
              </div>

              {/* オファー獲得率コネクタ */}
              <div className="flex items-center gap-2 py-2 pl-[68px]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 5v14M6 13l6 6 6-6" />
                </svg>
                <span className="text-xs text-slate-500">オファー獲得率</span>
                <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                  {calculateRate(calculatedData.totalOffers, calculatedData.totalInterviews)}
                </span>
                <span
                  className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold ${toneBadgeClasses(calculatedData.offerEvaluation.tone)}`}
                >
                  {calculatedData.offerEvaluation.label}
                </span>
              </div>

              {/* オファー */}
              <div className="flex items-center gap-3">
                <div className="w-14 shrink-0 text-xs font-bold text-amber-600 text-right">オファー</div>
                <div className="flex-1 h-11 bg-slate-100 rounded-xl overflow-hidden">
                  <div
                    className="h-full rounded-xl bg-gradient-to-r from-amber-500 to-amber-400"
                    style={{ width: `${Math.max(calculatedData.offerBarWidth, calculatedData.totalOffers > 0 ? 6 : 0)}%` }}
                  />
                </div>
                <div className="w-16 shrink-0 font-display text-xl font-extrabold tabular-nums">
                  {calculatedData.totalOffers}
                  <span className="text-xs font-semibold text-slate-500 ml-0.5">件</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-6 text-center rounded-xl border border-dashed border-slate-200 text-slate-400 text-sm">
              要員データがありません
            </div>
          )}
        </section>

        {/* 還元率別の想定粗利と対効果 */}
        <section className="p-6 bg-slate-50 rounded-2xl border border-slate-100 print:break-inside-avoid">
          <h2 className="text-lg font-bold mb-1">還元率別の想定粗利と対効果</h2>
          <p className="text-xs text-slate-400 mb-3 print:hidden">行をクリックすると下部の還元率が切り替わります</p>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-white text-slate-500 font-medium">
                <tr>
                  <th className="p-3 text-left">還元率</th>
                  <th className="p-3 text-right">想定粗利</th>
                  <th className="p-3 text-right">費用対効果</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {calculatedData.profitData.map((profit) => {
                  const isActive = Math.round(profit.returnRate) === Math.round(selectedReturnRate * 100);
                  return (
                    <tr
                      key={profit.returnRate}
                      onClick={() => setSelectedReturnRate(profit.returnRate / 100)}
                      className={`cursor-pointer transition-colors print:cursor-auto ${isActive ? 'bg-indigo-50/60' : 'bg-white/60 hover:bg-slate-50'}`}
                    >
                      <td
                        className={`p-3 border-l-[3px] ${isActive ? 'border-l-indigo-600 font-bold text-slate-900' : 'border-l-transparent font-medium text-slate-700'}`}
                      >
                        {profit.returnRate}%還元
                      </td>
                      <td className="p-3 text-right font-semibold tabular-nums">{formatCurrency(profit.grossProfit)}</td>
                      <td className="p-3 text-right font-bold text-indigo-600 tabular-nums">
                        {profit.costEffectiveness.toFixed(0)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400 mt-3">
            費用対効果 = 想定粗利 ÷ {formatCurrency(COST_EFFECTIVENESS_BASELINE)}換算。還元率の上昇に伴う粗利・対効果のトレードオフを可視化。
          </p>
        </section>

        {/* 要員別診断と今後の対策 */}
        <section className="p-6 bg-slate-50 rounded-2xl border border-slate-100 print:break-inside-avoid">
          <h2 className="text-lg font-bold mb-4">要員別診断と今後の対策</h2>
          {hasMembers ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                {calculatedData.diagnosisGroups.map((group) => (
                  <div key={group.label} className={`p-3 rounded-xl ${toneCardClasses(group.tone)}`}>
                    <p className="font-bold text-sm">{group.label}</p>
                    <p className="text-xs mt-1 opacity-80">{group.entries.map((e) => e.name).join('、')}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-3">
                {calculatedData.actionPlan.map((action, idx) => (
                  <div key={action} className="flex gap-3 p-3 bg-white rounded-xl border border-slate-200">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">
                      {idx + 1}
                    </span>
                    <p className="text-xs leading-relaxed text-slate-700">{action}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-6 text-center rounded-xl border border-dashed border-slate-200 text-slate-400 text-sm">
              要員データがありません
            </div>
          )}
        </section>
      </div>

      {/* 要員別診断 & ファネル図 */}
      <section className="space-y-8 print:break-inside-avoid">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold border-l-4 border-indigo-600 pl-3">要員別詳細データ</h2>
          <div className="flex items-center gap-3 print:hidden">
            <span className="text-sm font-semibold text-slate-500">還元率</span>
            <div className="inline-flex gap-1 bg-slate-100 p-1 rounded-2xl border border-slate-200">
              {RETURN_RATE_OPTIONS.map((opt) => {
                const isActive = Math.round(opt.returnRate * 100) === Math.round(selectedReturnRate * 100);
                return (
                  <button
                    key={opt.returnRate}
                    type="button"
                    onClick={() => setSelectedReturnRate(opt.returnRate)}
                    className={`rounded-xl px-4 py-1.5 text-sm font-bold transition-colors ${
                      isActive ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white'
                    }`}
                  >
                    {opt.returnRate * 100}%
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {!hasMembers ? (
          <div className="p-10 text-center rounded-xl border border-dashed border-slate-200 text-slate-400">
            <p className="font-semibold">要員データがありません</p>
            <p className="text-sm mt-1">「データを編集」から要員を追加するか、CSVを読み込んでください。</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-100 shadow-inner">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 font-medium">
                <tr>
                  <th className="p-4 text-left">要員ID</th>
                  <th className="p-4 text-left">氏名</th>
                  <th className="p-4 text-right">単価</th>
                  <th className="p-4 text-center">提案社数</th>
                  <th className="p-4 text-center">面談移行率</th>
                  <th className="p-4 text-center">面談社数</th>
                  <th className="p-4 text-center">オファー社数</th>
                  <th className="p-4 text-right">粗利額（{selectedReturnRate * 100}%還元）</th>
                  <th className="p-4 text-center">診断結果</th>
                  {isEditing && <th className="p-4 text-center print:hidden">操作</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {calculatedData.memberCalculations.map((m, idx) => (
                  <tr key={m.id} className={idx % 2 === 0 ? '' : 'bg-slate-50/20'}>
                    <td className="p-4 font-mono text-xs text-slate-400">{idx + 1}</td>
                    <td className="p-4 font-semibold">
                      {isEditing ? (
                        <input
                          className="w-28 rounded border border-slate-200 px-2 py-1"
                          value={m.name}
                          onChange={(e) => updateMember(m.id, { name: e.target.value })}
                        />
                      ) : (
                        m.name
                      )}
                    </td>
                    <td className="p-4 text-right font-bold">
                      {isEditing ? (
                        <input
                          type="number"
                          className="w-28 rounded border border-slate-200 px-2 py-1 text-right"
                          value={m.unitPrice}
                          onChange={(e) => updateMember(m.id, { unitPrice: Number(e.target.value) })}
                        />
                      ) : (
                        formatCurrency(m.unitPrice)
                      )}
                    </td>
                    <td className="p-4 text-center">
                      {isEditing ? (
                        <input
                          type="number"
                          className="w-16 rounded border border-slate-200 px-2 py-1 text-center"
                          value={m.proposals}
                          onChange={(e) => updateMember(m.id, { proposals: Number(e.target.value) })}
                        />
                      ) : (
                        m.proposals
                      )}
                    </td>
                    <td className="p-4 text-center font-semibold text-slate-600">
                      {calculateRate(m.interviews, m.proposals)}
                    </td>
                    <td className="p-4 text-center">
                      {isEditing ? (
                        <input
                          type="number"
                          className="w-16 rounded border border-slate-200 px-2 py-1 text-center"
                          value={m.interviews}
                          onChange={(e) => updateMember(m.id, { interviews: Number(e.target.value) })}
                        />
                      ) : (
                        m.interviews
                      )}
                    </td>
                    <td className="p-4 text-center">
                      {isEditing ? (
                        <input
                          type="number"
                          className="w-16 rounded border border-slate-200 px-2 py-1 text-center"
                          value={m.offers}
                          onChange={(e) => updateMember(m.id, { offers: Number(e.target.value) })}
                        />
                      ) : (
                        m.offers
                      )}
                    </td>
                    <td className="p-4 text-right font-bold text-indigo-700 tabular-nums">{formatCurrency(m.grossProfit)}</td>
                    <td className="p-4 text-center">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${toneBadgeClasses(m.diagnosis.tone)}`}>
                        {m.diagnosis.label}
                      </span>
                    </td>
                    {isEditing && (
                      <td className="p-4 text-center print:hidden">
                        <button
                          type="button"
                          onClick={() => removeMember(m.id)}
                          className="text-red-500 hover:text-red-700 text-xs font-semibold"
                        >
                          削除
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {isEditing && (
              <div className="p-3 bg-slate-50 border-t border-slate-100">
                <button
                  type="button"
                  onClick={addMember}
                  className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                >
                  ＋ 要員を追加
                </button>
              </div>
            )}
          </div>
        )}

      </section>

      {/* 診断コピペ用まとめ */}
      {hasMembers && (
        <section className="space-y-4 print:break-inside-avoid">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-xl font-bold border-l-4 border-indigo-600 pl-3">全体診断（コピペ用）</h2>
            <button
              type="button"
              onClick={() => void handleCopyDiagnosis()}
              className={`px-3 py-1.5 text-sm font-bold rounded-lg border transition-colors print:hidden ${
                copied
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {copied ? 'コピーしました ✓' : 'テキストをコピー'}
            </button>
          </div>
          <div className="p-6 bg-white rounded-2xl border border-slate-100">
            <div className="space-y-3 text-xs leading-relaxed text-slate-600 p-4 rounded-xl border border-dashed border-slate-200 max-h-80 overflow-y-auto">
              {calculatedData.diagnosisGroups.map((group) => (
                <div key={group.label}>
                  <p className={`inline-block px-2 py-0.5 rounded-full font-semibold mb-1 ${toneBadgeClasses(group.tone)}`}>
                    {group.label}
                  </p>
                  {group.entries.map((entry) => (
                    <p key={entry.name}>
                      <span className="font-semibold text-slate-800">【{entry.name}】：</span>
                      {entry.comment}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* フッター */}
      <footer className="border-t border-slate-100 pt-6 text-center print:hidden">
        <button
          type="button"
          onClick={handleDownloadPdf}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-500 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12" />
            <path d="M7 10l5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
          PDFをダウンロード
        </button>
      </footer>
    </div>
  );
};

export default PerformanceReport;
