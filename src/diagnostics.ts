// diagnostics.ts
// 要員ごとの提案〜面談〜オファーの実績から、傾向診断コメントを生成するロジック。
// 以前は「提案1・面談1・オファー0」のような完全一致パターンでのみ診断が出ていたため、
// デモデータ以外の実データでは診断が一切表示されなかった。
// ここでは比率ベースのルールに置き換え、任意の数値でも診断が出るようにしている。
// しきい値は事業判断で調整可能な値なので、定数として上部にまとめている。

import type { Diagnosis, MemberData } from './types';
import type { ReportPeriodRange, SalesPeriodInfo } from './salesPeriod';
import { formatPace, getSalesPeriodInfo, monthlyProposalPace } from './salesPeriod';

/** 提案数がこの件数未満の場合は、統計的に判断材料が不足しているとみなす */
export const MIN_SAMPLE_PROPOSALS = 3;

/** 面談数のうちオファーに至った割合がこれ以上なら「良好」と判断する */
export const OFFER_RATE_GOOD_THRESHOLD = 0.2;

/** 提案数のうち面談に至った割合がこれ未満なら「提案先ミスマッチ」の疑いと判断する（チーム全体の評価・ファネル分析に使用） */
export const INTERVIEW_RATE_LOW_THRESHOLD = 0.5;

/**
 * 要員個別の診断は、固定の絶対値（%）ではなく「チーム平均の面談移行率」に対する相対評価で行う。
 * 業種・時期によってチーム全体の面談移行率の水準自体が大きく変動するため、
 * 30%や50%といった固定しきい値では実データにおいて全員が同じ診断（例：全員「提案先ミスマッチ」）に
 * 一律で分類されてしまう問題があった。チーム平均と比較することで、平均が低い時期でも
 * 相対的に良い/悪いを個別に判定できるようにしている。
 */
/** チーム平均の面談移行率に対して、この比率未満なら明確な「提案先ミスマッチ」と判定する */
export const RELATIVE_INTERVIEW_SEVERE_RATIO = 0.5;
/** チーム平均の面談移行率に対して、この比率未満なら「改善余地あり」と判定する（severeとの間は軽度な課題） */
export const RELATIVE_INTERVIEW_LOW_RATIO = 1.0;

/**
 * 面談移行率の絶対的な下限水準。
 * 相対評価だけで判定すると、チーム全体が低調な月に「チーム平均は上回っているが実際は10%」という要員へ
 * 「書類段階は通過できている」という事実と食い違う診断が出てしまう。
 * この水準を下回る場合は、チーム平均との比較に関わらず書類（スキルシート）段階の課題として扱う。
 * 事業判断で調整可能な値。
 */
export const INTERVIEW_RATE_ABSOLUTE_FLOOR = 0.2;

/** 面談数がこの件数未満の場合、面談〜オファー段階の傾向を断定せず、その旨をコメントに添える */
export const MIN_SAMPLE_INTERVIEWS = 3;

export interface DiagnosisContext {
  /** チーム全体の面談移行率（面談数合計 ÷ 提案数合計）。個別診断の相対評価の基準値として使う */
  teamInterviewRate: number;
  /**
   * レポート期間（「2026/08/01〜2026/08/31」等の自由入力）から推定した開始日・終了日。
   * 要員の営業開始日／終了日と突き合わせ、「通期で営業できたのか、途中で終了したのか」を判定する。
   * 読み取れない場合はstart/endともnullでよい（その場合は営業日数だけで判断する）。
   */
  reportPeriod?: ReportPeriodRange;
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

/**
 * 診断ラベルの一覧。
 * ラベル文字列は ACTION_RECOMMENDATIONS のキー・UIのグルーピングキーを兼ねるため定数化している。
 *
 * 【命名の方針（2026-09 改定）】
 * このレポートは、営業代行を委託いただいているクライアント企業（要員の所属元）に対して
 * 「提案〜オファー獲得の過程でどこに課題があるか」を伝えるための資料である。そのため:
 *  - 「提案未実施」「判断材料不足」のように、営業代行側の稼働不足やツール不備を疑わせる表現は使わない。
 *    提案数が伸びない要因は「条件に合致する案件の母数」の問題として表現し、実際の要因は入力欄で明記する。
 *  - 「スキル・面談力OK」「スキルアンマッチ」のように要員の能力を断定する表現も使わない。
 *    書類段階（提案→面談）と面談段階（面談→オファー）は別の要因で決まるため、
 *    ラベルはファネル上のどこで止まっているかという事実に留め、原因の解釈はコメント側で述べる。
 */
export const DIAGNOSIS_LABELS = {
  /** 提案0件。合致する案件が確保できていない */
  noOpportunity: '提案機会なし',
  /** 提案が少数。評価できる母数に達していない */
  limitedOpportunity: '提案機会が限定的',
  /** オファー獲得済み（能力面は断定しない） */
  offerWon: 'オファー獲得',
  /** 提案はあるが面談0件。書類段階で止まっている */
  noInterview: '面談未到達',
  /** 面談移行率がチーム平均を大きく下回る */
  interviewRateLow: '面談移行が低位',
  /** 面談移行率がチーム平均をやや下回る */
  interviewRateSlightlyLow: '面談移行にやや課題',
  /** 面談は平均以上に取れているがオファー0件 */
  offerConversionIssue: 'オファー転換に課題',
  /**
   * 案件延長などで対象期間の途中で営業を終了した／途中から開始したため、
   * 提案数の絶対値では評価できないケース。
   * 「提案機会なし／限定的」と分類してしまうと、実際は期間が短かっただけなのに
   * 案件確保の問題として読まれてしまうため、専用のラベルを分けている。
   */
  shortSalesPeriod: '営業期間が短期',
} as const;

/**
 * 「提案が伸びない要因」(proposalReason) が入力されている場合、コメント末尾に補足する。
 * なぜ提案できていないかを明示しないと、読み手に営業活動の稼働不足やツール不備と
 * 受け取られかねないため、提案数が0件〜少数のケースでは要因の記載を優先的に反映する。
 */
function appendProposalReason(comment: string, m: MemberData): string {
  const reason = m.proposalReason?.trim();
  if (!reason) return comment;
  return `${comment}（要因：${reason}）`;
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

/**
 * 営業期間の注記をコメント末尾に付ける。
 * 通期（レポート期間の頭から末まで）営業できていた要員には付けない。
 * 途中開始・途中終了の要員だけに付けることで、「提案数が少ないのは期間が短いからだ」という
 * 前提を読み手が判断できるようにする。
 */
function appendSalesPeriod(comment: string, sp: SalesPeriodInfo | null, proposals: number): string {
  if (!sp || !sp.isPartial) return comment;
  const pace = monthlyProposalPace(proposals, sp.days);
  const paceNote = proposals > 0 ? `・月換算${formatPace(pace)}社ペース` : '';
  return `${comment}（営業期間：${sp.label}の${sp.days}日間${paceNote}）`;
}

export function diagnoseMember(m: MemberData, context: DiagnosisContext): Diagnosis {
  const salesPeriod = getSalesPeriodInfo(m, context.reportPeriod);

  // withPeriodNote=false は、コメント本文ですでに営業期間に言及している診断（営業期間が短期）用。
  // 二重に「（営業期間：…）」が付くのを防ぐ。
  const finalize = (d: Diagnosis, withPeriodNote = true): Diagnosis => ({
    ...d,
    comment: withPeriodNote
      ? appendSalesPeriod(appendCloseReason(d.comment, m), salesPeriod, m.proposals)
      : appendCloseReason(d.comment, m),
  });

  const interviewRate = m.proposals > 0 ? m.interviews / m.proposals : 0;
  const offerRate = m.interviews > 0 ? m.offers / m.interviews : 0;
  const teamRate = context.teamInterviewRate;

  // 1. オファーが1件でもあれば、その時点で営業活動は完了（成約）とみなし最優先の高評価とする。
  //    提案数の多寡・営業期間の長短に関わらず、この判定を最初に行う
  //    （提案2社でオファー1件の要員が「提案機会が限定的」に分類されてしまうのを防ぐため）。
  //    オファーからの転換率の高低は、営業終了後の指標のため評価には使わない。
  //    ただし書類段階（面談移行率）が強かったのか、面談で挽回したのかは読み手にとって重要なため、
  //    能力を断定するラベルではなく事実のみのラベルとし、水準はコメントで示す。
  if (m.offers > 0) {
    // 面談を経ずにオファーへ至ったケース（書類のみで決まった等）は転換率を出しても意味がないため文面を分ける
    const funnelNote =
      m.interviews > 0
        ? `提案${m.proposals}社・面談${m.interviews}社・オファー${m.offers}社（オファー転換率${pct(offerRate)}）で営業活動は完了。`
        : `提案${m.proposals}社・オファー${m.offers}社で営業活動は完了（面談の記録なし）。`;
    const stageNote =
      m.interviews === 0
        ? ''
        : teamRate > 0 && interviewRate < teamRate
          ? `面談移行率は${pct(interviewRate)}（チーム平均${pct(teamRate)}）と平均を下回るものの、面談からは着実にオファーへ繋げている。書類段階の訴求を強化できれば、さらに母数を増やせる。`
          : `面談移行率${pct(interviewRate)}（チーム平均${pct(teamRate)}）と書類段階から順調に進み、オファー獲得に至っている。`;
    return finalize({
      tone: 'success',
      label: DIAGNOSIS_LABELS.offerWon,
      comment: `${funnelNote}${stageNote}`,
    });
  }

  // 2. 営業期間そのものが短いケース。
  //    案件延長などで対象期間の途中で営業を終了した要員は、提案数の絶対値で見ると必ず少なくなる。
  //    「営業日数が2週間未満」または「月換算のペースでは評価に足る提案ができている」場合は、
  //    案件の母数の問題ではなく期間の問題として切り分ける（オファー獲得済みの要員は上で成功として返している）。
  if (salesPeriod && m.proposals < MIN_SAMPLE_PROPOSALS) {
    const pace = monthlyProposalPace(m.proposals, salesPeriod.days);
    const paceIsAdequate = pace >= MIN_SAMPLE_PROPOSALS;
    if (salesPeriod.isShort || paceIsAdequate) {
      const body = paceIsAdequate
        ? `営業期間は${salesPeriod.days}日間（${salesPeriod.label}）で提案${m.proposals}社。月換算では${formatPace(pace)}社ペースにあたり、提案数の少なさは営業期間の短さによるもの。`
        : `営業期間が${salesPeriod.days}日間（${salesPeriod.label}）と短く、提案${m.proposals}社。提案先の選定から提出までが一巡しておらず、提案数の多寡で評価できる状態にない。`;
      return finalize(
        {
          tone: 'neutral',
          label: DIAGNOSIS_LABELS.shortSalesPeriod,
          comment: appendProposalReason(body, m),
        },
        false
      );
    }
  }

  // 3. 提案が0件・少数のケースは、要員の能力ではなく「提案できる案件の母数」の問題として扱う。
  if (m.proposals === 0) {
    return finalize({
      tone: 'neutral',
      label: DIAGNOSIS_LABELS.noOpportunity,
      comment: appendProposalReason(
        '対象期間中、条件に合致する案件がなく提案に至らなかった。想定単価・稼働条件・対応領域の見直しにより、提案可能な案件を確保する余地がある。',
        m
      ),
    });
  }

  if (m.proposals < MIN_SAMPLE_PROPOSALS) {
    return finalize({
      tone: 'neutral',
      label: DIAGNOSIS_LABELS.limitedOpportunity,
      comment: appendProposalReason(
        `対象期間中の提案は${m.proposals}社。条件に合致する案件が限定的で、傾向を評価できる母数に達していない。まずは提案先の範囲を広げることが先決。`,
        m
      ),
    });
  }

  // 4. 面談が1件も獲得できていない → 書類（スキルシート）段階で止まっているケース
  if (m.interviews === 0) {
    return finalize({
      tone: 'warning',
      label: DIAGNOSIS_LABELS.noInterview,
      comment: `提案${m.proposals}社に対して面談0社。書類段階で止まっているため、スキルシートの訴求内容と提案先の案件レイヤーの双方を見直す必要がある。`,
    });
  }

  // 5. ここから先は面談移行率の評価。チーム平均との相対評価を基本としつつ、
  //    絶対水準の下限（INTERVIEW_RATE_ABSOLUTE_FLOOR）も併せて見る。
  //    相対評価のみだと、チーム全体が低調な月に「平均は上回るが実際は10%」という要員へ
  //    「書類段階は通過できている」という事実と食い違う診断が出てしまうため。
  const relativeRatio = teamRate > 0 ? interviewRate / teamRate : interviewRate > 0 ? Infinity : 0;

  if (interviewRate < INTERVIEW_RATE_ABSOLUTE_FLOOR) {
    const relativeNote =
      relativeRatio >= RELATIVE_INTERVIEW_LOW_RATIO
        ? `チーム平均${pct(teamRate)}は上回っているものの、絶対水準としては低く、書類段階に課題が残る。`
        : `チーム平均${pct(teamRate)}も下回っており、書類段階での訴求が課題。`;
    return finalize({
      tone: 'warning',
      label: DIAGNOSIS_LABELS.interviewRateLow,
      comment: `提案${m.proposals}社に対して面談${m.interviews}社（面談移行率${pct(interviewRate)}）。${relativeNote}提案先の案件要件とスキルシートの訴求点を突き合わせて見直す。`,
    });
  }

  if (relativeRatio < RELATIVE_INTERVIEW_SEVERE_RATIO) {
    return finalize({
      tone: 'warning',
      label: DIAGNOSIS_LABELS.interviewRateLow,
      comment: `提案${m.proposals}社に対して面談${m.interviews}社（面談移行率${pct(interviewRate)}、チーム平均${pct(teamRate)}の${pct(relativeRatio)}水準）。提案先の案件要件とスキルシートの訴求点が噛み合っていない可能性が高い。`,
    });
  }

  if (relativeRatio < RELATIVE_INTERVIEW_LOW_RATIO) {
    return finalize({
      tone: 'info',
      label: DIAGNOSIS_LABELS.interviewRateSlightlyLow,
      comment: `提案${m.proposals}社に対して面談${m.interviews}社（面談移行率${pct(interviewRate)}、チーム平均${pct(teamRate)}）。致命的な水準ではないが、提案先を絞り込むことで面談移行率の底上げが期待できる。`,
    });
  }

  // 6. 書類段階は絶対水準・チーム平均の双方をクリアしているがオファーが1件もない
  //    → 課題は面談〜選考の段階にあると判断できる
  const sampleNote =
    m.interviews < MIN_SAMPLE_INTERVIEWS
      ? `ただし面談は${m.interviews}社と少なく、傾向としての断定は避け、次月の面談結果と併せて判断する。`
      : '';
  return finalize({
    tone: 'info',
    label: DIAGNOSIS_LABELS.offerConversionIssue,
    comment: `提案${m.proposals}社に対して面談${m.interviews}社（面談移行率${pct(interviewRate)}、チーム平均${pct(teamRate)}以上）と書類段階は通過できているが、オファーは0社。面談での訴求内容・想定質疑への準備・条件面の擦り合わせを重点的に対策する。${sampleNote}`,
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
  [DIAGNOSIS_LABELS.offerWon]:
    '成功要因の横展開：オファーに至った提案先の特徴と、面談での訴求内容を整理し、他要員の提案活動へ展開する。',
  [DIAGNOSIS_LABELS.noInterview]:
    'スキルシートと提案先の抜本的な見直し：提案は行えているが書類段階で止まっているため、スキルシートの訴求内容・対象業界・案件レイヤーを根本から再検討する。',
  [DIAGNOSIS_LABELS.interviewRateLow]:
    '提案先の選定見直し：案件要件とスキルシートの訴求点を突き合わせ、対象業界・案件レイヤーを再設定する。',
  [DIAGNOSIS_LABELS.interviewRateSlightlyLow]:
    '提案先の絞り込み：要員のスキル・志向により合致する案件へ絞り込み、面談移行率の底上げを図る。',
  [DIAGNOSIS_LABELS.offerConversionIssue]:
    '面談対策の強化：書類は通過できているため、想定質疑の準備・経歴の伝え方・条件面の事前擦り合わせを行い、面談からの転換率を高める。',
  [DIAGNOSIS_LABELS.limitedOpportunity]:
    '提案可能な案件の拡大：条件に合致する案件が限定的なため、想定単価・稼働条件・対応領域・対象エリアの緩和余地を協議し、提案先の母数を増やす。',
  [DIAGNOSIS_LABELS.noOpportunity]:
    '提案可能な案件の確保：条件に合致する案件が確保できていないため、想定単価・稼働条件・対応領域の見直しを協議し、まず提案対象となる案件を確保する。',
  [DIAGNOSIS_LABELS.shortSalesPeriod]:
    '営業期間を揃えた評価と着手の前倒し：案件延長等により対象期間中の営業日数が短いため、提案数の絶対値ではなく月換算ペースで評価する。次回は稼働終了予定日から逆算して営業開始日を前倒しし、通期での提案数を確保する。',
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

/**
 * 「全体診断（コピペ用）」セクションの中身を、チーム全体の総括テキストとして組み立てる。
 * 以前は要員別診断カードやコピー用リストで既に見せている「要員ごとのコメント」をそのまま列挙していたため、
 * 個別診断と内容が丸ごと重複していた。ここでは重複を避け、実績サマリー・診断内訳（人数）・
 * 今後の対策の3点に絞った、社外に送っても読みやすい総括文を自動生成する。
 */
export function buildOverallDiagnosisSummary(totals: OverallTotals, groups: DiagnosisGroup[]): string {
  const { totalProposals, totalInterviews, totalOffers } = totals;

  if (totalProposals === 0 || groups.length === 0) {
    return '提案実績がまだありません。要員データを入力すると、実績に応じた総括がここに自動生成されます。';
  }

  const interviewRate = totalInterviews / totalProposals;
  const offerRate = totalInterviews > 0 ? totalOffers / totalInterviews : 0;
  const memberCount = groups.reduce((sum, g) => sum + g.entries.length, 0);

  const overview = `対象要員${memberCount}名（提案${totalProposals}社・面談${totalInterviews}社・オファー${totalOffers}社、面談移行率${pct(interviewRate)}・オファー獲得率${pct(offerRate)}）。`;

  const breakdown = groups
    .map((g) => `・${g.label}：${g.entries.length}名（${g.entries.map((e) => e.name).join('、')}）`)
    .join('\n');

  const actionPlan = buildActionPlan(groups);
  const actionText = actionPlan.map((a, i) => `${i + 1}. ${a}`).join('\n');

  return [overview, `【診断内訳】\n${breakdown}`, `【今後の対策】\n${actionText}`].join('\n\n');
}
