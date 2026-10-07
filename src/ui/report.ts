// 学习结果图:Canvas API 绘制(已完成章节/观察图层/故障结果/调度时间线/指标快照)
import { COLORS } from '../scene/materials';
import type { SimSnapshot } from '../kernel/sim';
import type { ChallengeId } from '../state/store';
import { t } from '../i18n';
import type { StringKey } from '../i18n';

export interface ReportInput {
  lang: 'zh' | 'en';
  chaptersDone: string[];
  viewMode: string;
  camera: string;
  explode: number;
  section: number;
  challenges: Record<ChallengeId, 'pass' | 'fail' | null>;
  snapshot: SimSnapshot | null;
}

const W = 960;
const H = 640;

function drawPlate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color = COLORS.brass
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

export function renderReport(input: ReportInput): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  const { snapshot: snap } = input;

  // 背景
  ctx.fillStyle = '#07080a';
  ctx.fillRect(0, 0, W, H);
  // 网格
  ctx.strokeStyle = '#10131a';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
    ctx.stroke();
  }

  // 标题铭牌
  drawPlate(ctx, 24, 24, W - 48, 74);
  ctx.fillStyle = COLORS.bone;
  ctx.font = '700 24px Consolas, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillText(t('report_title'), 44, 52);
  ctx.fillStyle = COLORS.dim;
  ctx.font = '12px Consolas, monospace';
  ctx.fillText(t('report_sub'), 46, 80);
  ctx.fillStyle = COLORS.brass;
  ctx.fillText(
    `${t('report_date')}: ${new Date().toLocaleString(input.lang === 'zh' ? 'zh-CN' : 'en-US')}`,
    W - 350,
    80
  );

  let y = 118;

  // 已完成章节
  ctx.fillStyle = COLORS.brass;
  ctx.font = '12px Consolas, monospace';
  ctx.fillText(`▸ ${t('report_chapters')}`, 40, y);
  y += 14;
  drawPlate(ctx, 40, y, 420, 64, COLORS.line);
  const chapters: [string, StringKey][] = [
    ['ch1', 'ch1'],
    ['ch2', 'ch2'],
    ['ch3', 'ch3'],
    ['ch4', 'ch4'],
    ['ch5', 'ch5']
  ];
  chapters.forEach(([id, key], i) => {
    const cx = 56 + (i % 5) * 82;
    const cy = y + 12 + Math.floor(i / 5) * 28;
    const done = input.chaptersDone.includes(id);
    ctx.fillStyle = done ? COLORS.green : '#3a414c';
    ctx.fillRect(cx, cy, 12, 12);
    ctx.fillStyle = done ? COLORS.bone : COLORS.dim;
    ctx.font = '11px Consolas, monospace';
    ctx.fillText(t(key).slice(0, 4), cx + 17, cy + 6);
  });
  y += 78;

  // 当前观察图层
  ctx.fillStyle = COLORS.brass;
  ctx.fillText(`▸ ${t('report_view')}`, 40, y);
  y += 14;
  drawPlate(ctx, 40, y, 420, 46, COLORS.line);
  ctx.fillStyle = COLORS.bone;
  ctx.font = '12px Consolas, monospace';
  const viewLabel = t(`view_${input.viewMode}` as StringKey);
  const camLabel = t(`cam_${input.camera}` as StringKey);
  ctx.fillText(
    `${viewLabel} · ${camLabel} · ${t('c_explode')} ${(input.explode * 100).toFixed(0)}% · ${t('c_section')} ${
      input.section < 0 ? t('c_section_off') : `${(input.section * 100).toFixed(0)}%`
    }`,
    56,
    y + 24
  );
  y += 60;

  // 故障挑战结果
  ctx.fillStyle = COLORS.brass;
  ctx.fillText(`▸ ${t('report_challenge')}`, 40, y);
  y += 14;
  drawPlate(ctx, 40, y, 420, 78, COLORS.line);
  (['deadlock', 'thrash', 'starve'] as ChallengeId[]).forEach((id, i) => {
    const r = input.challenges[id];
    const cy = y + 16 + i * 22;
    ctx.fillStyle = r === 'pass' ? COLORS.green : r === 'fail' ? COLORS.alarm : COLORS.dim;
    ctx.fillRect(56, cy - 6, 12, 12);
    ctx.fillStyle = COLORS.bone;
    ctx.font = '12px Consolas, monospace';
    ctx.fillText(
      `${t(`chal_${id}` as StringKey)}  ${r === 'pass' ? t('chal_pass') : r === 'fail' ? t('chal_fail') : t('chal_none')}`,
      78,
      cy
    );
  });
  y += 96;

  // 指标快照
  ctx.fillStyle = COLORS.brass;
  ctx.fillText(`▸ ${t('report_metrics')}`, 40, y);
  y += 14;
  drawPlate(ctx, 40, y, 420, 110, COLORS.line);
  const m = snap?.metrics;
  const metrics: [string, string][] = [
    [t('m_cpu'), `${((m?.cpuUtil ?? 0) * 100).toFixed(1)}%`],
    [t('m_cache'), `${((m?.cacheHit ?? 0) * 100).toFixed(1)}%`],
    [t('m_fault'), `${((m?.faultRate ?? 0) * 100).toFixed(2)}%`],
    [t('m_ctx'), `${m?.ctxSwitches ?? 0} ${t('unit_switch')}`],
    [t('m_tat'), `${Math.round(m?.avgTurnaround ?? 0)} ${t('unit_cycle')}`],
    [t('m_thr'), `${((m?.throughput ?? 0) / 10000).toFixed(2)} ${t('unit_proc10k')}`],
    [t('m_instr'), `${m?.instructions ?? 0} ${t('unit_instr')}`],
    [t('m_cycle'), `${snap?.cycle ?? 0}`]
  ];
  metrics.forEach(([k, v], i) => {
    const cx = 56 + (i % 2) * 205;
    const cy = y + 18 + Math.floor(i / 2) * 26;
    ctx.fillStyle = COLORS.dim;
    ctx.font = '10px Consolas, monospace';
    ctx.fillText(k, cx, cy);
    ctx.fillStyle = COLORS.cold;
    ctx.font = '13px Consolas, monospace';
    ctx.fillText(v, cx, cy + 15);
  });
  y += 130;

  // 关键调度决策时间线
  ctx.fillStyle = COLORS.brass;
  ctx.fillText(`▸ ${t('report_timeline')}`, 492, 118);
  drawPlate(ctx, 492, 134, 424, 496, COLORS.line);
  const tl = (snap?.timeline ?? []).slice(-16);
  tl.forEach((e, i) => {
    const cy = 156 + i * 30;
    ctx.fillStyle = '#565c66';
    ctx.font = '10px Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(String(e.t), 540, cy);
    ctx.textAlign = 'left';
    const color =
      e.kind === 'preempt' || e.kind === 'sched'
        ? COLORS.warm
        : e.kind === 'fault'
          ? COLORS.alarm
          : e.kind === 'sys' || e.kind === 'int'
            ? COLORS.brass
            : e.kind === 'shutdown'
              ? COLORS.dim
              : COLORS.cold;
    ctx.fillStyle = color;
    ctx.fillRect(550, cy - 7, 8, 8);
    ctx.fillStyle = COLORS.bone;
    ctx.font = '11px Consolas, monospace';
    const text = t(e.key as StringKey, { pid: e.pid ?? '', a: e.a ?? '', num: e.num ?? '' });
    ctx.fillText(text.slice(0, 30), 568, cy);
  });
  if (tl.length === 0) {
    ctx.fillStyle = COLORS.dim;
    ctx.font = '11px Consolas, monospace';
    ctx.fillText('--', 568, 156);
  }

  // 装饰角标
  ctx.strokeStyle = COLORS.brass;
  ctx.lineWidth = 2;
  const L = 18;
  [[24, 24, 1, 1], [W - 24, 24, -1, 1], [24, H - 24, 1, -1], [W - 24, H - 24, -1, -1]].forEach(
    ([x, yy, dx, dy]) => {
      ctx.beginPath();
      ctx.moveTo(x + dx * L, yy);
      ctx.lineTo(x, yy);
      ctx.lineTo(x, yy + dy * L);
      ctx.stroke();
    }
  );

  return cv;
}

export function downloadReport(input: ReportInput): void {
  const cv = renderReport(input);
  cv.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `os-lab-report-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, 'image/png');
}
