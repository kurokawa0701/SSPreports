// sampleData.ts
// アップロード画面の「サンプルデータで試す」や、編集画面の「サンプルデータに戻す」で使う
// デモ用データ。他のファイルでこのデータを再定義しないこと。

import type { ReportSummaryData } from './types';

export const sampleReportData: ReportSummaryData = {
  clientName: '株式会社ネイバーズ',
  period: '2026.7.x - 2026.8.x',
  // 空にしておくと、実際の集計結果から buildAutoHeadline が要約を自動生成する。
  // 固定文を入れると、下のmembersを変更したときに数値が食い違ってしまうため空にしている。
  headline: '',
  members: [
    {
      id: '1',
      name: '要員A',
      proposals: 1,
      interviews: 1,
      offers: 0,
      unitPrice: 0,
      proposalUnitPrice: 600000,
      supportFee: 30000,
      proposalReason: '想定単価に見合う案件が市場に少なく、提案先が限られた',
    },
    { id: '2', name: '要員B', proposals: 0, interviews: 0, offers: 0, unitPrice: 0, proposalUnitPrice: 500000, supportFee: 30000 },
    {
      id: '3',
      name: '要員C',
      proposals: 5,
      interviews: 3,
      offers: 1,
      unitPrice: 600000,
      proposalUnitPrice: 650000,
      supportFee: 20000,
    },
    {
      id: '4',
      name: '要員D',
      proposals: 5,
      interviews: 5,
      offers: 0,
      unitPrice: 0,
      proposalUnitPrice: 500000,
      supportFee: 30000,
      closeReason: '条件不一致',
    },
    {
      id: '5',
      name: '要員E',
      proposals: 5,
      interviews: 5,
      offers: 1,
      unitPrice: 550000,
      proposalUnitPrice: 550000,
      supportFee: 30000,
    },
    {
      id: '6',
      name: '要員F',
      proposals: 5,
      interviews: 5,
      offers: 0,
      unitPrice: 0,
      proposalUnitPrice: 500000,
      supportFee: 30000,
      closeReason: 'スキル不足',
    },
  ],
};
