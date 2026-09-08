// types.ts
// アプリ全体で共有する型定義。UIコンポーネント側で同じinterfaceを再定義しないこと。

export interface MemberData {
  id: string;
  name: string;          // 例: "要員A"
  proposals: number;     // 提案数
  interviews: number;    // 面談数
  offers: number;        // オファー数
  unitPrice: number;     // オファー単価
  supportFee: number;    // 支援費（要員1名あたりの月額想定コスト。実質粗利の算出に使用）
  closeReason?: string;  // 営業終了理由（オファーに至らず終了した場合の理由。任意項目）
  // 要員ごとの「今後の対策」の自由編集テキスト。空/未入力なら診断ラベルから自動生成した内容を表示する。
  actionNote?: string;
}

export interface ReportSummaryData {
  clientName: string;      // 顧客名 (例: 株式会社ネイバーズ)
  period: string;          // レポート期間
  headline: string;        // メインキャッチコピー
  members: MemberData[];
  // 「今後の対策」の自由編集テキスト（1行1項目）。空/未入力なら診断結果から自動生成した内容を表示する。
  actionPlanText?: string;
  // 「全体診断（コピペ用）」の自由編集テキスト。空/未入力なら診断結果から自動生成した内容を表示する。
  diagnosisSummaryText?: string;
  // レポート作成会社名（表紙ページに表示。社外提出用のPDFを想定）
  providerName?: string;
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
  grossProfit: number;  // 実質粗利額 (= 売上単価 - 還元額 - 支援費)
  diagnosis: Diagnosis;
}

// 還元率別 (60/70/80%) の全体実質粗利・対効果シミュレーション結果
export interface ProfitScenario {
  returnRate: number; // % (要員への還元率)
  grossProfit: number; // 実質粗利 (= 売上単価 - 還元額 - 支援費の合計)
  costEffectiveness: number; // 費用対効果 (= 実質粗利 ÷ 固定基準額 × 100)
}
