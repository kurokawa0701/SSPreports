// diagnostics.ts
// 要員ごとの提案〜面談〜オファーの実績から、傾向診断コメントを生成するロジック。
// 以前は「提案1・面談1・オファー0」のような完全一致パターンでのみ診断が出ていたため、
// デモデータ以外の実データでは診断が一切表示されなかった。
// ここでは比率ベースのルールに置き換え、任意の数値でも診断が出るようにしている。
// しきい値は事業判断で調整可能な値なので、定数として上部にまとめている。

import type { Diagnosis, MemberData } from './types';

/** 提案数がこの件数未満の場合は、統計的に判断材料が不足しているとみなす */
export const MIN_SAMPLE_PROPOSALS = 3;

/** 面談数のうちオファーに至った割合がこれ以上なら「良好」と判断する */
export const OFFER_RATE_GOOD_THRESHOLD = 0.2;

/** 提案数のうち面談に至った割合がこれ未満なら「提案先ミスマッチ」の疑いと判断する */
export const INTERVIEW_RATE_LOW_THRESHOLD = 0.5;

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

export function diagnoseMember(m: MemberData): Diagnosis {
  if (m.proposals === 0) {
    return {
      tone: 'neutral',
      label: '提案未実施',
      comment: 'まだ提案実績がありません。',
    };
  }

  if (m.proposals < MIN_SAMPLE_PROPOSALS) {
    return {
      tone: 'neutral',
      label: '判断材料不足',
      comment: `提案数が${m.proposals}社とまだ少なく、傾向を判断する材料が不足。提案を継続して様子を見る。`,
    };
  }

  const interviewRate = m.interviews / m.proposals;
  const offerRate = m.interviews > 0 ? m.offers / m.interviews : 0;

  if (m.offers > 0 && offerRate >= OFFER_RATE_GOOD_THRESHOLD) {
    return {
      tone: 'success',
      label: 'スキル・面談力OK',
      comment: `提案${m.proposals}社・面談${m.interviews}社・オファー${m.offers}社。面談からのオファー転換率が${pct(offerRate)}と良好。現状のスキルで案件にマッチしているため、引き続き案件提案を行っていく。`,
    };
  }

  if (interviewRate < INTERVIEW_RATE_LOW_THRESHOLD) {
    return {
      tone: 'warning',
      label: '提案先ミスマッチ?',
      comment: `提案${m.proposals}社に対して面談${m.interviews}社（面談移行率${pct(interviewRate)}）と低調。提案先とのミスマッチが考えられるため、提案先を再検討。`,
    };
  }

  if (m.offers === 0) {
    return {
      tone: 'info',
      label: 'スキルアンマッチ?',
      comment: `面談${m.interviews}社（面談移行率${pct(interviewRate)}）まで進めているものの、オファー0社。スキルアンマッチ・経歴相違・面談スキル・案件選定を再検討。`,
    };
  }

  return {
    tone: 'neutral',
    label: '傾向を注視',
    comment: `提案${m.proposals}社・面談${m.interviews}社・オファー${m.offers}社。傾向を継続観察。`,
  };
}

export interface OverallTotals {
  totalProposals: number;
  totalInterviews: number;
  totalOffers: number;
}

/**
 * ヘッダーの「要約」欄が未入力のときに使う自動生成テキスト。
 * 以前は特定の会社向けに書かれた固定文（面談移行率95.2%等）がそのまま表示されていたが、
 * 実際の集計結果（面談移行率・オファー獲得率）から都度組み立てるようにした。
 * ユーザーが要約欄に文字を入力すればそちらが優先され、空に戻すと再び自動生成に戻る。
 */
export function buildAutoHeadline(totals: OverallTotals): string {
  const { totalProposals, totalInterviews, totalOffers } = totals;

  if (totalProposals === 0) {
    return '提案実績がまだありません。要員データを入力すると、実績に応じた要約がここに自動生成されます。';
  }

  const interviewRate = totalInterviews / totalProposals;
  const offerRate = totalInterviews > 0 ? totalOffers / totalInterviews : 0;
  const interviewPct = pct(interviewRate);
  const offerPct = pct(offerRate);

  const interviewGood = interviewRate >= INTERVIEW_RATE_LOW_THRESHOLD;
  const offerGood = totalOffers > 0 && offerRate >= OFFER_RATE_GOOD_THRESHOLD;

  if (interviewGood && offerGood) {
    return `面談移行率 (${interviewPct}) ・オファー獲得率 (${offerPct}) ともに良好で、パイプラインは順調に進捗している。`;
  }
  if (interviewGood && !offerGood) {
    return `強力なパイプライン形成により高い面談移行率 (${interviewPct}) を達成するも、オファー獲得率 (${offerPct}) に課題。要員ごとのピンポイントな戦略的介入が必要。`;
  }
  if (!interviewGood && offerGood) {
    return `面談移行率 (${interviewPct}) は伸び悩んでいるものの、面談からのオファー獲得率 (${offerPct}) は良好。提案先を絞り込むことでさらなる改善が期待できる。`;
  }
  return `面談移行率 (${interviewPct}) ・オファー獲得率 (${offerPct}) ともに伸び悩んでおり、提案先の選定や訴求内容の見直しが必要。`;
}

export function toneBadgeClasses(tone: DiagnosisToneLike): string {
  switch (tone) {
    case 'success':
      return 'bg-green-100 text-green-900 border border-green-200';
    case 'warning':
      return 'bg-orange-100 text-orange-900 border border-orange-200';
    case 'info':
      return 'bg-blue-100 text-blue-900 border border-blue-200';
    default:
      return 'bg-slate-100 text-slate-600 border border-slate-200';
  }
}

/** ティア別カードの背景・左アクセント線のスタイル（toneBadgeClassesのカード版） */
export function toneCardClasses(tone: DiagnosisToneLike): string {
  switch (tone) {
    case 'success':
      return 'bg-green-50 border border-green-200 border-l-4 border-l-green-500 text-green-900';
    case 'warning':
      return 'bg-orange-50 border border-orange-200 border-l-4 border-l-orange-500 text-orange-900';
    case 'info':
      return 'bg-blue-50 border border-blue-200 border-l-4 border-l-blue-500 text-blue-900';
    default:
      return 'bg-slate-50 border border-slate-200 border-l-4 border-l-slate-400 text-slate-700';
  }
}

type DiagnosisToneLike = Diagnosis['tone'];

export interface RateEvaluation {
  tone: 'success' | 'warning';
  label: string;
}

/** ファネル分析の矢印部分で使う、しきい値ベースの良否判定 */
export function evaluateAbove(
  rate: number,
  threshold: number,
  goodLabel: string,
  badLabel: string
): RateEvaluation {
  return rate >= threshold ? { tone: 'success', label: goodLabel } : { tone: 'warning', label: badLabel };
}

/** 診断ラベルごとの推奨アクション文。要員別診断カードの隣に出す「今後の対策」リストに使う */
export const ACTION_RECOMMENDATIONS: Record<string, string> = {
  'スキル・面談力OK': '成功事例の横展開：好調な要員の提案・面談のノウハウをチーム全体へ共有する。',
  '提案先ミスマッチ?': '提案先の選定見直し：ターゲット業界・案件レイヤーを再検討し、提案の精度を高める。',
  'スキルアンマッチ?': '面談対策の強化：面談には進むもののオファーに至らないため、スキルシートや訴求内容を見直す。',
  '判断材料不足': '提案数の底上げ：まずは提案数を増やし、傾向を判断できるだけのデータを蓄積する。',
  '提案未実施': '提案の開始：対象案件の選定と提案活動をまず開始する。',
  '傾向を注視': '継続観察：現状のペースを維持しつつ、次回以降の推移を確認する。',
};

/** 実際に発生している診断ラベルの分だけ、重複なく対策リストを組み立てる */
export function buildActionPlan(groups: { label: string }[]): string[] {
  const seen = new Set<string>();
  const plan: string[] = [];
  for (const g of groups) {
    if (seen.has(g.label)) continue;
    seen.add(g.label);
    plan.push(ACTION_RECOMMENDATIONS[g.label] ?? `${g.label}：状況を確認し、必要な対策を検討する。`);
  }
  return plan;
}

export interface DiagnosisGroup {
  label: string;
  tone: DiagnosisToneLike;
  entries: { name: string; comment: string }[];
}

/** 同じ診断ラベルの要員をまとめて、コピペ用の要約セクションを作る */
export function groupDiagnoses(
  members: { name: string; diagnosis: Diagnosis }[]
): DiagnosisGroup[] {
  const order: string[] = [];
  const groups = new Map<string, DiagnosisGroup>();

  for (const m of members) {
    const key = m.diagnosis.label;
    if (!groups.has(key)) {
      groups.set(key, { label: key, tone: m.diagnosis.tone, entries: [] });
      order.push(key);
    }
    groups.get(key)!.entries.push({ name: m.name, comment: m.diagnosis.comment });
  }

  return order.map((key) => groups.get(key)!);
}
