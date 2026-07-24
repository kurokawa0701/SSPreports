// UploadScreen.tsx
// アプリの入口となる画面。CSVをドラッグ&ドロップ（またはクリックして選択）すると
// レポート画面へ遷移する。データを持っていない場合は「サンプルデータで試す」から進める。
// Excelで月ごとにシートが分かれている場合は、いったんシート選択画面を挟む。

import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import type { CsvImportResult } from './csv';
import type { ReportSummaryData } from './types';
import type { PreparedImport } from './fileImport';
import { ACCEPTED_FILE_EXTENSIONS, ACCEPTED_FILE_MIME_TYPES, prepareImport, readMembers } from './fileImport';
import { sampleReportData } from './sampleData';

interface UploadScreenProps {
  onLoad: (data: ReportSummaryData, startInEditMode: boolean) => void;
}

function buildReportFromImport(result: CsvImportResult): ReportSummaryData {
  return {
    clientName: result.clientName ?? '',
    period: result.period ?? '',
    headline: '',
    members: result.members,
  };
}

const UploadScreen: React.FC<UploadScreenProps> = ({ onLoad }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [pendingSheets, setPendingSheets] = useState<
    Extract<PreparedImport, { kind: 'excel-multi' }> | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const finalizeResult = (result: CsvImportResult) => {
    if (result.members.length === 0) {
      setErrors(result.errors.length > 0 ? result.errors : ['要員データを読み取れませんでした。']);
      return;
    }
    setErrors(result.errors);
    // 要約はファイルに含まれないため、レポート画面側で入力（または自動生成）してもらう
    onLoad(buildReportFromImport(result), true);
  };

  const processFile = async (file: File) => {
    setErrors([]);
    const prepared = await prepareImport(file);
    if (prepared.kind === 'excel-multi') {
      setPendingSheets(prepared);
      return;
    }
    finalizeResult(await readMembers(prepared));
  };

  const handleSelectSheet = async (sheetName: string) => {
    if (!pendingSheets) return;
    const result = await readMembers(pendingSheets, sheetName);
    setPendingSheets(null);
    finalizeResult(result);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void processFile(file);
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
    if (file) void processFile(file);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
      <div className="max-w-xl w-full bg-white rounded-2xl shadow-lg border border-slate-100 p-10 text-center space-y-6">
        <div>
          <span className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-slate-900 text-white text-2xl font-bold">
            S
          </span>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-slate-900">SSP（SES）レポート</h1>
          <p className="mt-1 text-sm text-slate-500">要員データのCSVを読み込んでレポートを作成します</p>
        </div>

        {pendingSheets ? (
          <div className="text-left space-y-3">
            <p className="text-sm font-semibold text-slate-700">
              複数のシートが見つかりました。読み込むシートを選んでください。
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {pendingSheets.sheetNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => void handleSelectSheet(name)}
                  className="w-full text-left px-4 py-2.5 rounded-lg border border-slate-200 hover:border-slate-400 hover:bg-slate-50 text-sm font-medium text-slate-700 transition-colors"
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
              キャンセルしてファイルを選び直す
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
            className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-12 cursor-pointer transition-colors ${
              isDragOver ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
            }`}
          >
            <p className="text-base font-semibold text-slate-700">CSV/Excelファイルをここにドラッグ&ドロップ</p>
            <p className="text-sm text-slate-400">またはクリックしてファイルを選択</p>
            <input
              ref={fileInputRef}
              type="file"
              accept={`${ACCEPTED_FILE_EXTENSIONS},${ACCEPTED_FILE_MIME_TYPES}`}
              className="hidden"
              onChange={handleChange}
            />
          </div>
        )}

        {errors.length > 0 && (
          <div className="text-left p-3 rounded-lg bg-red-50 border border-red-100 text-xs text-red-700 space-y-1">
            <p className="font-semibold">読み込みに失敗しました：</p>
            {errors.map((err) => (
              <p key={err}>・{err}</p>
            ))}
          </div>
        )}

        {!pendingSheets && (
          <button
            type="button"
            onClick={() => onLoad(sampleReportData, false)}
            className="text-sm font-semibold text-slate-500 hover:text-slate-800 underline"
          >
            サンプルデータで試す
          </button>
        )}
      </div>
    </div>
  );
};

export default UploadScreen;
