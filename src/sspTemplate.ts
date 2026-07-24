// sspTemplate.ts
// 実際に使われているExcelレポート（「SSP レポートデータ」テンプレート）専用のパーサー。
//
// このテンプレートはcsv.tsが想定する「1行=1要員」の単純な表ではなく、
// 顧客名・全体実績・還元率シミュレーションのセクションに続けて、
// 「要員別」セクションでは要員名が横方向（列）に並び、提案数・面談数・オファー数・単価が
// 縦方向（行）に並ぶ、いわゆるピボット（クロス集計）形式になっている。
// 例:
//   要員別 |    | 要員A | 要員B | 要員C | ...
//   提案数 |    |     1 |     1 |     5 | ...
//   面談数 |    |     1 |     1 |     3 | ...
//
// 面談移行率・オファー獲得率の行は自前で計算し直すため読み飛ばす。

import type { MemberData } from './types';
import type { CsvImportResult, ImportRow } from './csv';

function cellToString(cell: unknown): string {
  return cell === null || cell === undefined ? '' : String(cell).trim();
}

function cellToNumber(cell: unknown): number | null {
  if (cell === null || cell === undefined || cell === '') return null;
  const n = Number(cell);
  return Number.isNaN(n) ? null : n;
}

/** シート内に「要員別」セクションの目印があるかどうかで、このテンプレートかを判定する */
export function looksLikeSspTemplate(rows: ImportRow[]): boolean {
  return rows.some((row) => cellToString(row[0]) === '要員別');
}

type MetricKey = 'proposals' | 'interviews' | 'offers' | 'unitPrice';

function matchMetricKey(label: string): MetricKey | null {
  if (label.includes('提案数')) return 'proposals';
  if (label.includes('面談数')) return 'interviews';
  if (label.includes('オファー数')) return 'offers';
  if (label.includes('単価')) return 'unitPrice';
  return null; // 面談移行率・オファー獲得率などは計算し直すのでスキップ
}

export function parseSspTemplate(rows: ImportRow[]): CsvImportResult {
  let clientName: string | undefined;
  let period: string | undefined;

  for (const row of rows) {
    const first = cellToString(row[0]);
    if (first.includes('顧客名')) {
      clientName = first.replace(/^顧客名[：:]\s*/, '').trim();
    }
    const periodIdx = row.findIndex((cell) => cellToString(cell) === 'レポート期間');
    if (periodIdx >= 0) {
      for (let i = periodIdx + 1; i < row.length; i++) {
        const v = cellToString(row[i]);
        if (v) {
          period = v;
          break;
        }
      }
    }
  }

  // 「要員別」ラベルの行のうち、C列以降に要員名（数値に変換できない文字列）が並ぶ行を探す
  const nameRowIndex = rows.findIndex((row) => {
    if (cellToString(row[0]) !== '要員別') return false;
    return row.slice(2).some((cell) => {
      const s = cellToString(cell);
      return s !== '' && Number.isNaN(Number(s));
    });
  });

  if (nameRowIndex === -1) {
    return { members: [], errors: ['「要員別」セクションの要員名の行が見つかりませんでした。'], clientName, period };
  }

  const nameRow = rows[nameRowIndex];
  const memberColumns: { colIndex: number; name: string }[] = [];
  for (let i = 2; i < nameRow.length; i++) {
    const name = cellToString(nameRow[i]);
    if (name) memberColumns.push({ colIndex: i, name });
  }

  if (memberColumns.length === 0) {
    return { members: [], errors: ['要員名を読み取れませんでした。'], clientName, period };
  }

  const values: Record<MetricKey, Record<number, number>> = {
    proposals: {},
    interviews: {},
    offers: {},
    unitPrice: {},
  };

  for (let r = nameRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    const label = cellToString(row[0]);
    if (!label) continue;

    const key = matchMetricKey(label);
    if (!key) continue;

    for (const { colIndex } of memberColumns) {
      const n = cellToNumber(row[colIndex]);
      if (n !== null) values[key][colIndex] = n;
    }
  }

  const members: MemberData[] = memberColumns.map(({ colIndex, name }, idx) => ({
    id: `${Date.now()}-${idx}`,
    name,
    proposals: values.proposals[colIndex] ?? 0,
    interviews: values.interviews[colIndex] ?? 0,
    offers: values.offers[colIndex] ?? 0,
    unitPrice: values.unitPrice[colIndex] ?? 0,
  }));

  return { members, errors: [], clientName, period };
}
