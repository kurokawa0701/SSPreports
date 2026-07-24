// types.ts
// アプリ全体で共有する型定義。UIコンポーネント側で同じinterfaceを再定義しないこと。

export interface MemberData {
  id: string;
  name: string;          // 例: "要員A"
  proposals: number;     // 提案数
  interviews: number;    // 面談数
  offers: number;        // オファー数
  unitPrice: number;     // オファー単価
}

export interface ReportSummaryData {
  clientName: string;      // 顧客名 (例: 株式会社ネイバーズ)
  period: string;          // レポート期間
  headline: string;        // メインキャッチコピー
  members: MemberData[];
}

// 還元率別損益シミュレーションの選択肢 (60% / 70% / 80%)
export interface ReturnRateOption {
  rateLabel: string;       // "60%還元"
  returnRate: number;      // 0.6
}

export type DiagnosisTone = 'success' | 'warning' | 'info' | 'neutral';

export interface Diagnosis {
  tone: DiagnosisTone;
  label: string;
  comment: string;
}

// 要員ごとの計算結果 (MemberDataに計算値を付加した型)
export interface MemberCalculation extends MemberData {
  returnRate: number;   // % (選択された還元率)
  baseCost: number;     // 還元社原価
  grossProfit: number;  // 粗利額
  diagnosis: Diagnosis;
}

// 還元率別 (60/70/80%) の全体粗利・対効果シミュレーション結果
export interface ProfitScenario {
  returnRate: number; // % (要員への還元率)
  grossProfit: number; // 想定粗利
  costEffectiveness: number; // 費用対効果 (= 粗利 ÷ 還元コスト × 100)
}
