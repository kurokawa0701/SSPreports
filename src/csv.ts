// csv.ts
// 要員データをCSV/Excelから取り込むための共通パーサー。
// 想定フォーマット: 氏名,提案数,面談数,オファー数,単価 (1行目はヘッダーでも可)
// CSVはクォート囲みや埋め込みカンマまでは対応していないシンプルな実装。
// エクセルからのコピペ等、複雑な引用符を含むデータは事前に整形してから取り込むこと。

import type { MemberData } from './types';

export interface CsvImportResult {
  members: MemberData[];
  errors: string[];
  // Excelの「SSPレポート」テンプレートから読み取れた場合のみ入る
  clientName?: string;
  period?: string;
}

/** CSV/Excelどちらから読んでも同じ行データ (セル配列の配列) として扱えるようにする */
export type ImportRow = (string | number)[];

function isBlankRow(row: ImportRow): boolean {
  return row.every((cell) => String(cell ?? '').trim() === '');
}

/** 行データ（CSVを分割した配列、またはExcelシートの行配列）から要員データを組み立てる */
export function parseMemberRows(rows: ImportRow[]): CsvImportResult {
  const trimmedRows = rows.filter((row) => !isBlankRow(row));

  if (trimmedRows.length === 0) {
    return { members: [], errors: ['データが空です。'] };
  }

  // 1行目の2列目が数値でなければヘッダー行とみなしてスキップする
  const firstRow = trimmedRows[0];
  const secondCell = String(firstRow[1] ?? '').trim();
  const startIndex = firstRow.length >= 5 && Number.isNaN(Number(secondCell)) ? 1 : 0;

  const members: MemberData[] = [];
  const errors: string[] = [];

  for (let i = startIndex; i < trimmedRows.length; i++) {
    const row = trimmedRows[i];
    const lineNo = i + 1;

    if (row.length < 5) {
      errors.push(`${lineNo}行目: 列数が不足しています（氏名,提案数,面談数,オファー数,単価の5列が必要）`);
      continue;
    }

    const name = String(row[0] ?? '').trim();
    const proposals = Number(row[1]);
    const interviews = Number(row[2]);
    const offers = Number(row[3]);
    const unitPrice = Number(row[4]);

    if ([proposals, interviews, offers, unitPrice].some((n) => Number.isNaN(n))) {
      errors.push(`${lineNo}行目: 数値に変換できない値があります`);
      continue;
    }
    if (!name) {
      errors.push(`${lineNo}行目: 氏名が空です`);
      continue;
    }

    members.push({
      id: `${Date.now()}-${i}`,
      name,
      proposals,
      interviews,
      offers,
      unitPrice,
    });
  }

  return { members, errors };
}

export function parseMembersCsv(text: string): CsvImportResult {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const rows: ImportRow[] = lines.map((line) => line.split(',').map((cell) => cell.trim()));
  return parseMemberRows(rows);
}
