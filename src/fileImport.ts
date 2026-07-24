// fileImport.ts
// アップロード画面・編集画面のどちらからでも、拡張子に応じてCSV/Excelを
// 適切なパーサーに振り分けて読み込むための共通ヘルパー。
//
// Excelは月ごとにシートが分かれているなど複数シートのブックがありうるため、
// 「ファイルを読む(prepareImport)」と「実際にデータへ変換する(readMembers)」を分けている。
// シートが複数あるときは prepareImport が kind: 'excel-multi' を返すので、
// 呼び出し側でシートを選ばせてから readMembers(prepared, sheetName) を呼ぶ。

import type { CsvImportResult } from './csv';
import { parseMembersCsv } from './csv';
import { listExcelSheetNames, parseMembersExcelSheet } from './excel';

export const ACCEPTED_FILE_EXTENSIONS = '.csv,.xlsx,.xls';
export const ACCEPTED_FILE_MIME_TYPES =
  'text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

function isExcelFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase();
  return ext === 'xlsx' || ext === 'xls';
}

function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました。'));
    reader.readAsArrayBuffer(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました。'));
    reader.readAsText(file);
  });
}

export type PreparedImport =
  | { kind: 'csv'; file: File }
  | { kind: 'excel-single'; file: File; buffer: ArrayBuffer; sheetName: string }
  | { kind: 'excel-multi'; file: File; buffer: ArrayBuffer; sheetNames: string[] };

/** ファイルの種類を判定し、Excelなら中のシート名も調べる。まだデータへの変換はしない */
export async function prepareImport(file: File): Promise<PreparedImport> {
  if (!isExcelFile(file.name)) {
    return { kind: 'csv', file };
  }
  const buffer = await readAsArrayBuffer(file);
  const sheetNames = await listExcelSheetNames(buffer);
  if (sheetNames.length <= 1) {
    return { kind: 'excel-single', file, buffer, sheetName: sheetNames[0] ?? '' };
  }
  return { kind: 'excel-multi', file, buffer, sheetNames };
}

/** prepareImportの結果から実際に要員データを読み取る。excel-multiのときはsheetName必須 */
export async function readMembers(prepared: PreparedImport, sheetName?: string): Promise<CsvImportResult> {
  if (prepared.kind === 'csv') {
    const text = await readAsText(prepared.file);
    return parseMembersCsv(text);
  }

  const targetSheet = sheetName ?? (prepared.kind === 'excel-single' ? prepared.sheetName : undefined);
  if (!targetSheet) {
    return { members: [], errors: ['読み込むシートを選択してください。'] };
  }
  return parseMembersExcelSheet(prepared.buffer, targetSheet);
}
