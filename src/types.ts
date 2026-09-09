// types.ts
// アプリ全体で共有する型定義。UIコンポーネント側で同じinterfaceを再定義しないこと。

import type { SalesPeriodInfo } from './salesPeriod';

export interface MemberData {
  id: string;
  name: string;          // 例: "要員A"
  proposals: number;     // 提案数
  interviews: number;    // 面談数
  offers: number;        // オファー数
  unitPrice: number;     // オファー単価（実際に獲得した単価。売上・実質粗利・費用対効果はすべてこの値で計算する）
  // 提案時の単価（任意項目）。金額計算には使わず、「どの単価帯で提案しているか」を示す情報として表示する。
  // オファーが出た場合は、提案単価との差額（値下げ幅）が読み取れる。
  // オファー未獲得の要員でも単価帯が分かるため、単価欄が¥0のまま並ぶのを防げる。
  proposalUnitPrice?: number;
  supportFee: number;    // 支援費（要員1名あたりの月額想定コスト。実質粗利の算出に使用）
  closeReason?: string;  // 営業終了理由（オファーに至らず終了した場合の理由。任意項目）
  // 営業開始日／営業終了日（"YYYY-MM-DD"。任意項目）。
  // 案件延長などで対象期間の途中で営業を終了したケースでは、提案数の絶対値だけを見ると
  // 「提案が足りない」と誤読されてしまう。実際に営業していた日数を持たせることで、
  // 診断・今後の対策を「月換算の提案ペース」で評価できるようにする。
  // 終了日が空の場合は、レポート期間の末日（読み取れない場合は当日）まで営業継続とみなす。
  salesStartDate?: string;
  salesEndDate?: string;
  // 提案が伸びない要因（提案数が0件〜少数の場合に、その理由を明記するための任意項目）。
  // 例: 「想定単価に見合う案件が市場に少ない」「稼働開始が期末のため対象案件が限られた」。
  // 未入力でも診断は成立するが、記載があると読み手に営業活動の稼働不足と誤解されにくくなる。
  proposalReason?: string;
  // 要員ごとの「今後の対策」の自由編集テキスト。空/未入力なら診断ラベルから自動生成した内容を表示する。
  actionNote?: string;
  // 要員ごとの「診断結果」コメントの自由編集テキスト。空/未入力なら自動診断のコメントを表示する。
  diagnosisNote?: string;
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
  // 営業開始日から求めた営業期間（開始日未入力の要員はnull）。表示と診断の両方で使う。
  salesPeriod: SalesPeriodInfo | null;
  returnRate: number;   // % (選択された還元率)
  baseCost: number;     // 還元社原価
  grossProfit: number;  // 実質粗利額 (= 売上単価 - 還元額 - 支援費)
  diagnosis: Diagnosis; // diagnosisNoteで上書きされている場合はcommentがその内容になる
  autoDiagnosisComment: string; // 自動診断本来のコメント（編集欄のプレースホルダー・リセット先として使用）
}

// 還元率別 (60/70/80%) の全体実質粗利・対効果シミュレーション結果
export interface ProfitScenario {
  returnRate: number; // % (要員への還元率)
  grossProfit: number; // 実質粗利 (= 売上単価 - 還元額 - 支援費の合計)
  costEffectiveness: number; // 費用対効果 (= 実質粗利 ÷ 固定基準額 × 100)
}
