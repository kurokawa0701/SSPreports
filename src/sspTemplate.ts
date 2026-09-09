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
// 「営業終了理由」「支援費」「提案が伸びない要因」「営業開始日」「営業終了日」の行がある場合は
// 任意項目として読み込む（無くてもエラーにはならない。支援費は未指定なら0）。
// 営業開始日・終了日はExcelの日付セル（シリアル値）でも文字列でも読める。

import type { MemberData } from './types';
import type { CsvImportResult, ImportRow } from './csv';
import { normalizeDateInput, parseReportPeriod } from './salesPeriod';

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

type NumericMetricKey = 'proposals' | 'interviews' | 'offers' | 'unitPrice' | 'proposalUnitPrice' | 'supportFee';
type StringMetricKey = 'closeReason' | 'proposalReason';
type DateMetricKey = 'salesStartDate' | 'salesEndDate';

/**
 * 「営業開始日」「営業終了日」の行。
 * 数値・文字列のどちらの判定よりも先に評価する（「営業終了日」が「終了理由」判定に、
 * また日付のシリアル値が数値項目に吸われないようにするため）。
 */
function matchDateMetricKey(label: string): DateMetricKey | null {
  // 「稼働開始日」（案件の稼働開始）と誤認しないよう、「営業」が付くか単独の「開始日／終了日」だけを拾う
  if (/営業/.test(label) || /^(開始日|終了日)$/.test(label)) {
    if (label.includes('開始日')) return 'salesStartDate';
    if (label.includes('終了日')) return 'salesEndDate';
  }
  return null;
}

function matchNumericMetricKey(label: string): NumericMetricKey | null {
  if (label.includes('提案数')) return 'proposals';
  if (label.includes('面談数')) return 'interviews';
  if (label.includes('オファー数')) return 'offers';
  if (label.includes('支援費')) return 'supportFee';
  // 「提案単価」は「単価」を含むため、オファー単価より先に判定する（順序を入れ替えないこと）
  if (label.includes('提案単価')) return 'proposalUnitPrice';
  if (label.includes('単価')) return 'unitPrice';
  return null; // 面談移行率・オファー獲得率などは計算し直すのでスキップ
}

function matchStringMetricKey(label: string): StringMetricKey | null {
  if (label.includes('終了理由')) return 'closeReason';
  // 「提案が伸びない要因」「提案要因」など、提案数が伸びない理由を書く行。
  // 「提案数」の行と誤認しないよう、数値メトリクスの判定より後に評価される点に注意。
  if (label.includes('要因')) return 'proposalReason';
  return null;
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

  // 年を省略した営業開始日／終了日の年を補うために、レポート期間を先に解析しておく
  const reportPeriod = parseReportPeriod(period);

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

  const values: Record<NumericMetricKey, Record<number, number>> = {
    proposals: {},
    interviews: {},
    offers: {},
    unitPrice: {},
    proposalUnitPrice: {},
    supportFee: {},
  };
  const stringValues: Record<StringMetricKey, Record<number, string>> = {
    closeReason: {},
    proposalReason: {},
  };
  const dateValues: Record<DateMetricKey, Record<number, string>> = {
    salesStartDate: {},
    salesEndDate: {},
  };

  for (let r = nameRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    const label = cellToString(row[0]);
    if (!label) continue;

    const dateKey = matchDateMetricKey(label);
    if (dateKey) {
      for (const { colIndex } of memberColumns) {
        // 「8月17日～」のように年を省略した書き方が多いため、レポート期間から年を補う
        const iso = normalizeDateInput(row[colIndex], reportPeriod);
        if (iso) dateValues[dateKey][colIndex] = iso;
      }
      continue;
    }

    const numericKey = matchNumericMetricKey(label);
    if (numericKey) {
      for (const { colIndex } of memberColumns) {
        const n = cellToNumber(row[colIndex]);
        if (n !== null) values[numericKey][colIndex] = n;
      }
      continue;
    }

    const stringKey = matchStringMetricKey(label);
    if (stringKey) {
      for (const { colIndex } of memberColumns) {
        const s = cellToString(row[colIndex]);
        if (s) stringValues[stringKey][colIndex] = s;
      }
    }
  }

  const members: MemberData[] = memberColumns.map(({ colIndex, name }, idx) => {
    const closeReason = stringValues.closeReason[colIndex];
    const proposalReason = stringValues.proposalReason[colIndex];
    const proposalUnitPrice = values.proposalUnitPrice[colIndex];
    const salesStartDate = dateValues.salesStartDate[colIndex];
    const salesEndDate = dateValues.salesEndDate[colIndex];
    return {
      id: `${Date.now()}-${idx}`,
      name,
      proposals: values.proposals[colIndex] ?? 0,
      interviews: values.interviews[colIndex] ?? 0,
      offers: values.offers[colIndex] ?? 0,
      unitPrice: values.unitPrice[colIndex] ?? 0,
      supportFee: values.supportFee[colIndex] ?? 0,
      ...(closeReason !== undefined ? { closeReason } : {}),
      ...(proposalReason !== undefined ? { proposalReason } : {}),
      ...(proposalUnitPrice !== undefined ? { proposalUnitPrice } : {}),
      ...(salesStartDate !== undefined ? { salesStartDate } : {}),
      ...(salesEndDate !== undefined ? { salesEndDate } : {}),
    };
  });

  return { members, errors: [], clientName, period };
}
