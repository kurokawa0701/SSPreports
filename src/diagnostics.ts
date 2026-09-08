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

/**
 * 面談移行率がこれ未満の場合は、単なる「改善余地あり」ではなく
 * 明確な「提案先ミスマッチ」として強めに判定する。
 * INTERVIEW_RATE_LOW_THRESHOLDとの間（このしきい値以上・LOW_THRESHOLD未満）は
 * 軽度な課題として別ラベルに分け、全員が同じ診断に一律で分類されるのを防ぐ。
 */
export const INTERVIEW_RATE_SEVERE_THRESHOLD = 0.3;

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

/**
 * 案件母数（casePoolSize）が入力されている場合、提案消化率をコメント末尾に補足する。
 * 「紹介できる案件はあるのに提案数が少ない」といった、提案数だけでは見えない状況を反映する。
 */
function appendCaseContext(comment: string, m: MemberData): string {
  if (!m.casePoolSize || m.casePoolSize <= 0) return comment;
  const rate = m.proposals / m.casePoolSize;
  return `${comment}（案件母数${m.casePoolSize}件中${m.proposals}件へ提案・消化率${pct(rate)}）`;
}

/**
 * 営業終了理由（closeReason）が入力されている場合、コメント末尾に補足する。
 * オファーに至らず終了したケースでは、推測ではなく実際の終了理由を診断に反映する。
 * すでにオファーが出ている（成約）ケースでは終了理由は付けない。
 */
function appendCloseReason(comment: string, m: MemberData): string {
  if (m.offers > 0) return comment;
  const reason = m.closeReason?.trim();
  if (!reason) return comment;
  return `${comment}（終了理由：${reason}）`;
}

export function diagnoseMember(m: MemberData): Diagnosis {
  const finalize = (d: Diagnosis): Diagnosis => ({
    ...d,
    comment: appendCloseReason(appendCaseContext(d.comment, m), m),
  });

  if (m.proposals === 0) {
    return finalize({
      tone: 'neutral',
      label: '提案未実施',
      comment: 'まだ提案実績がありません。',
    });
  }

  if (m.proposals < MIN_SAMPLE_PROPOSALS) {
    return finalize({
      tone: 'neutral',
      label: '判断材料不足',
      comment: `提案数が${m.proposals}社とまだ少なく、傾向を判断する材料が不足。提案を継続して様子を見る。`,
    });
  }

  const interviewRate = m.interviews / m.proposals;
  const offerRate = m.interviews > 0 ? m.offers / m.interviews : 0;

  // 1. オファーが1件でもあれば、その時点で営業活動は完了（成約）とみなし最優先の高評価とする。
  //    オファーからの転換率の高低は、営業終了後の指標のため評価には使わない。
  if (m.offers > 0) {
    return finalize({
      tone: 'success',
      label: 'スキル・面談力OK',
      comment: `提案${m.proposals}社・面談${m.interviews}社・オファー${m.offers}社（オファー転換率${pct(offerRate)}）を獲得し、営業活動は完了。現状のスキルで案件にマッチしているため、引き続き同様の提案を行っていく。`,
    });
  }

  // 2. 面談が1件も獲得できていない → 提案先とのミスマッチの疑いが最も強いケース
  if (m.interviews === 0) {
    return finalize({
      tone: 'warning',
      label: '面談未獲得',
      comment: `提案${m.proposals}社に対して面談0社。提案先の選定・アプローチ内容のミスマッチが強く疑われるため、早急に提案先を見直す。`,
    });
  }

  // 3. 面談移行率が著しく低い（severeしきい値未満）→ 明確な提案先ミスマッチ
  if (interviewRate < INTERVIEW_RATE_SEVERE_THRESHOLD) {
    return finalize({
      tone: 'warning',
      label: '提案先ミスマッチ',
      comment: `提案${m.proposals}社に対して面談${m.interviews}社（面談移行率${pct(interviewRate)}）と低調。提案先とのミスマッチが考えられるため、提案先を再検討。`,
    });
  }

  // 4. 面談移行率がやや低い（severeしきい値〜lowしきい値）→ 致命的ではないが改善余地あり
  if (interviewRate < INTERVIEW_RATE_LOW_THRESHOLD) {
    return finalize({
      tone: 'info',
      label: '提案精度に改善余地',
      comment: `提案${m.proposals}社に対して面談${m.interviews}社（面談移行率${pct(interviewRate)}）。致命的な水準ではないが、提案先の絞り込みでさらなる改善が期待できる。`,
    });
  }

  // 5. 面談は十分に取れているがオファーが1件もない → スキル・経歴面のアンマッチ
  return finalize({
    tone: 'info',
    label: 'スキルアンマッチ',
    comment: `面談${m.interviews}社（面談移行率${pct(interviewRate)}）まで進めているものの、オファー0社。スキルアンマッチ・経歴相違・面談スキル・案件選定を再検討。`,
  });
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
  // whitespace-nowrap: 日本語は単語間にスペースがないため、幅の狭いセル内では
  // 文字の途中で改行されてしまう（例:「スキルアンマッチ」の「チ」だけ次行に落ちる）。
  // バッジは折り返さず1行で表示する。
  switch (tone) {
    case 'success':
      return 'whitespace-nowrap bg-green-50 text-green-800 border border-green-200';
    case 'warning':
      return 'whitespace-nowrap bg-amber-50 text-amber-800 border border-amber-200';
    case 'info':
      return 'whitespace-nowrap bg-indigo-50 text-indigo-700 border border-indigo-200';
    default:
      return 'whitespace-nowrap bg-slate-100 text-slate-600 border border-slate-200';
  }
}

/** ティア別カードの背景・左アクセント線のスタイル（toneBadgeClassesのカード版） */
export function toneCardClasses(tone: DiagnosisToneLike): string {
  switch (tone) {
    case 'success':
      return 'bg-green-50 border border-green-200 border-l-4 border-l-green-500 text-green-900';
    case 'warning':
      return 'bg-amber-50 border border-amber-200 border-l-4 border-l-amber-500 text-amber-900';
    case 'info':
      return 'bg-indigo-50 border border-indigo-200 border-l-4 border-l-indigo-500 text-indigo-900';
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
  '面談未獲得': '提案先の抜本的な見直し：面談に一切進めていないため、ターゲット業界・案件レイヤー・アプローチ方法を根本から再検討する。',
  '提案先ミスマッチ': '提案先の選定見直し：ターゲット業界・案件レイヤーを再検討し、提案の精度を高める。',
  '提案精度に改善余地': '提案先の絞り込み：致命的ではないが、より要員のスキル・志向に合った案件への絞り込みで面談移行率の改善を狙う。',
  'スキルアンマッチ': '面談対策の強化：面談には進むもののオファーに至らないため、スキルシートや訴求内容を見直す。',
  '判断材料不足': '提案数の底上げ：まずは提案数を増やし、傾向を判断できるだけのデータを蓄積する。',
  '提案未実施': '提案の開始：対象案件の選定と提案活動をまず開始する。',
};

/** 診断ラベル1件分の推奨アクション文を返す（要員別詳細データの「今後の対策」列で使う） */
export function getActionRecommendation(label: string): string {
  return ACTION_RECOMMENDATIONS[label] ?? `${label}：状況を確認し、必要な対策を検討する。`;
}

/** 実際に発生している診断ラベルの分だけ、重複なく対策リストを組み立てる */
export function buildActionPlan(groups: { label: string }[]): string[] {
  const seen = new Set<string>();
  const plan: string[] = [];
  for (const g of groups) {
    if (seen.has(g.label)) continue;
    seen.add(g.label);
    plan.push(getActionRecommendation(g.label));
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

/** 「全体診断（コピペ用）」セクションの中身を、クリップボードコピー用のプレーンテキストに整形する */
export function buildDiagnosisCopyText(groups: DiagnosisGroup[]): string {
  return groups
    .map((group) => {
      const lines = group.entries.map((entry) => `【${entry.name}】：${entry.comment}`);
      return [`【${group.label}】`, ...lines].join('\n');
    })
    .join('\n\n');
}
