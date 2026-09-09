// salesPeriod.ts
// 要員ごとの「営業開始日〜営業終了日」から、実際に営業していた日数と月換算の提案ペースを求める。
//
// 【なぜ必要か】
// 案件の延長などで対象期間の途中で営業を終了した要員は、提案数の絶対値だけを見ると
// 「提案が少ない＝営業が動いていない」と誤読されてしまう。営業日数を持たせることで、
// 「10日間で2社＝月換算6社ペース」のように、期間を揃えた妥当な評価ができるようにする。
//
// 日付はすべてローカルタイムの0時に正規化して扱う（時差でずれた日数にならないようにする）。

import type { MemberData } from './types';

/** 月換算に使う日数。暦月のばらつき（28〜31日）は評価に影響しないため30日固定とする */
export const DAYS_PER_MONTH = 30;

/**
 * 営業日数がこれ未満の場合は、提案数の多寡そのものを評価しない。
 * 2週間未満では提案先の選定〜提出が一巡しないため、提案0件でも稼働不足とは判断できない。
 */
export const SHORT_SALES_PERIOD_DAYS = 14;

/** 概ね1か月。これ以上営業していれば「対象期間を通して営業できた」とみなす */
export const FULL_SALES_PERIOD_DAYS = 28;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 月末日を返す（"2026年8月" のように日が省略された期間表記の終端に使う） */
function endOfMonth(year: number, month1to12: number): Date {
  return new Date(year, month1to12, 0);
}

/**
 * Excelのシリアル値・Dateオブジェクト・文字列のいずれで来ても "YYYY-MM-DD" に正規化する。
 * ExcelはXLSX.read(raw:true)だと日付セルをシリアル値（1899-12-30起点の連番）で返すため、
 * 数値の場合はシリアル値として変換する。
 */
export function normalizeDateInput(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toIsoDate(value);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    // 1900年前後のシリアル値は業務上あり得ないため、極端な値は日付として扱わない
    if (value < 1 || value > 60000) return undefined;
    const ms = Date.UTC(1899, 11, 30) + Math.round(value) * MS_PER_DAY;
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  const text = String(value).trim();
  if (!text) return undefined;

  // "2026-08-01" / "2026/8/1" / "2026年8月1日" のいずれにも対応する
  const m = text.match(/(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : toIsoDate(parsed);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseIsoDate(value: string | undefined): Date | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    const normalized = normalizeDateInput(value);
    if (!normalized || normalized === value) return null;
    return parseIsoDate(normalized);
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface ReportPeriodRange {
  start: Date | null;
  end: Date | null;
}

/**
 * レポート期間の自由入力文字列（例: "2026/08/01〜2026/08/31"、"2026年8月"、"2026.7.x - 2026.8.x"）から
 * 開始日・終了日を推定する。読み取れない場合はnullを返し、その場合は日数の比較を行わない。
 * 日が省略された表記（"2026年8月"）は、終端をその月の末日として扱う。
 */
export function parseReportPeriod(period: string | undefined): ReportPeriodRange {
  if (!period) return { start: null, end: null };

  const matches = [...period.matchAll(/(\d{4})\s*[-/年.]\s*(\d{1,2})(?:\s*[-/月.]\s*(\d{1,2}))?/g)];
  if (matches.length === 0) return { start: null, end: null };

  const first = matches[0];
  const last = matches[matches.length - 1];

  const start = new Date(Number(first[1]), Number(first[2]) - 1, first[3] ? Number(first[3]) : 1);
  const end = last[3]
    ? new Date(Number(last[1]), Number(last[2]) - 1, Number(last[3]))
    : endOfMonth(Number(last[1]), Number(last[2]));

  return {
    start: Number.isNaN(start.getTime()) ? null : start,
    end: Number.isNaN(end.getTime()) ? null : end,
  };
}

export interface SalesPeriodInfo {
  startDate: Date;
  endDate: Date;
  /** 営業していた暦日数（両端を含む） */
  days: number;
  /** 終了日が未入力で、期間末（または当日）まで営業継続とみなしたかどうか */
  isOngoing: boolean;
  /** 提案数の多寡を評価できないほど営業期間が短いか */
  isShort: boolean;
  /** レポート期間の途中から開始、または途中で終了しているか（＝通期で営業できていない） */
  isPartial: boolean;
  /** "8/1〜8/12" 形式の表示用ラベル */
  label: string;
}

/**
 * 要員の営業開始日・終了日から営業期間を組み立てる。
 * 開始日が未入力の要員はnullを返し、従来どおり提案数の絶対値だけで評価する。
 */
export function getSalesPeriodInfo(
  m: Pick<MemberData, 'salesStartDate' | 'salesEndDate'>,
  reportPeriod: ReportPeriodRange = { start: null, end: null },
  today: Date = new Date()
): SalesPeriodInfo | null {
  const startDate = parseIsoDate(m.salesStartDate);
  if (!startDate) return null;

  const explicitEnd = parseIsoDate(m.salesEndDate);
  // 終了日が未入力なら「レポート期間の末日まで営業継続」とみなす。
  // 期間が読み取れない場合のみ当日で代用する。
  const fallbackEnd = reportPeriod.end ?? atMidnight(today);
  const endDate = explicitEnd ?? fallbackEnd;

  if (endDate.getTime() < startDate.getTime()) return null;

  const days = Math.round((endDate.getTime() - startDate.getTime()) / MS_PER_DAY) + 1;

  const startedLate = reportPeriod.start ? startDate.getTime() > reportPeriod.start.getTime() : false;
  const endedEarly = explicitEnd && reportPeriod.end ? explicitEnd.getTime() < reportPeriod.end.getTime() : false;
  // レポート期間が読み取れない場合は、日数そのもので通期稼働かどうかを判断する
  const isPartial =
    reportPeriod.start || reportPeriod.end ? startedLate || endedEarly : days < FULL_SALES_PERIOD_DAYS;

  return {
    startDate,
    endDate,
    days,
    isOngoing: !explicitEnd,
    isShort: days < SHORT_SALES_PERIOD_DAYS,
    isPartial,
    // 終了日が未入力の場合は、みなしの終端であることが分かるよう「継続」と添える
    label: explicitEnd
      ? `${formatShortDate(startDate)}〜${formatShortDate(endDate)}`
      : `${formatShortDate(startDate)}〜継続`,
  };
}

function formatShortDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 提案数を月換算のペースに直す（例: 10日間で2社 → 月換算6.0社） */
export function monthlyProposalPace(proposals: number, days: number): number {
  if (days <= 0) return 0;
  return (proposals / days) * DAYS_PER_MONTH;
}

/** 月換算ペースの表示用文字列（小数第1位まで） */
export function formatPace(pace: number): string {
  return pace.toFixed(1);
}
