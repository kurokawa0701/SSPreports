// sampleData.ts
// アップロード画面の「サンプルデータで試す」や、編集画面の「サンプルデータに戻す」で使う
// デモ用データ。他のファイルでこのデータを再定義しないこと。

import type { ReportSummaryData } from './types';

export const sampleReportData: ReportSummaryData = {
  clientName: '株式会社ネイバーズ',
  period: '2026.7.x - 2026.8.x',
  headline: '強力なパイプライン形成により高い面談移行率 (95.2%) を達成するも、オファー獲得 (2.5%) に課題。要員ごとのピンポイントな戦略的介入が必要。',
  members: [
    { id: '1', name: '要員A', proposals: 1, interviews: 1, offers: 0, unitPrice: 600000 },
    { id: '2', name: '要員B', proposals: 1, interviews: 1, offers: 0, unitPrice: 500000 },
    { id: '3', name: '要員C', proposals: 5, interviews: 3, offers: 1, unitPrice: 400000 },
    { id: '4', name: '要員D', proposals: 5, interviews: 5, offers: 0, unitPrice: 500000 },
    { id: '5', name: '要員E', proposals: 5, interviews: 5, offers: 0, unitPrice: 500000 },
    { id: '6', name: '要員F', proposals: 5, interviews: 5, offers: 0, unitPrice: 500000 },
  ],
};
