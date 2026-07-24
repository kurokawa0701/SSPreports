// excel.ts
// 要員データをExcelファイル(.xlsx/.xls)から取り込むためのパーサー。
// 先頭シートを表形式として読み取り、csv.tsのparseMemberRowsで共通のバリデーションを行う。
// xlsxライブラリはサイズが大きいため、CSVのみ使う人の初期読み込みを軽くするために
// 動的import（実際にExcelファイルが渡されたときだけ読み込む）にしている。

import type { CsvImportResult, ImportRow } from './csv';
import { parseMemberRows } from './csv';
import { looksLikeSspTemplate, parseSspTemplate } from './sspTemplate';

/** ブック内のシート名一覧だけを取得する（月ごとにシートが分かれている場合の選択に使う） */
export async function listExcelSheetNames(buffer: ArrayBuffer): Promise<string[]> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { type: 'array', bookSheets: true });
  return workbook.SheetNames;
}

/** 指定したシート名を読み取って要員データに変換する */
export async function parseMembersExcelSheet(buffer: ArrayBuffer, sheetName: string): Promise<CsvImportResult> {
  try {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      return { members: [], errors: [`シート「${sheetName}」が見つかりませんでした。`] };
    }
    const rows = XLSX.utils.sheet_to_json<ImportRow>(sheet, { header: 1, raw: true, defval: '' });

    // 「要員別」セクションを含むテンプレート形式のシートは専用パーサーで読む
    if (looksLikeSspTemplate(rows)) {
      return parseSspTemplate(rows);
    }

    // それ以外は「1行=1要員」の単純な表として読む
    return parseMemberRows(rows);
  } catch {
    return { members: [], errors: ['Excelファイルの読み込みに失敗しました。ファイル形式を確認してください。'] };
  }
}
