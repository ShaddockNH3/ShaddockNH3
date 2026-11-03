#!/usr/bin/env node
/**
 * 用 github-readme-stats 官方代码渲染卡片，产出静态 SVG。
 *
 * 为什么不自己画：这些卡的排版是上游的设计，自己仿容易走样。
 * 这里直接 import 它的 fetch / render 函数，只把结果落成静态文件，
 * 绕开已经挂掉的公共实例，也不用自建 Vercel。
 *
 * 产出：
 *   profile-summary-card-output/stats/stats-{light,dark}.svg   统计卡（含 rank 圆环）
 *   profile-summary-card-output/langs/langs-{light,dark}.svg   语言卡（compact 布局）
 *
 * 环境变量：
 *   GHS_DIR      github-readme-stats 的本地路径（workflow 里现 clone 一份）
 *   PAT_1        官方 fetcher 认这个名字的 token
 *   TARGET_USER  要统计的用户名
 *   OUT_ROOT     输出根目录，默认 profile-summary-card-output
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const GHS_DIR = process.env.GHS_DIR || ".cache/github-readme-stats";
const OUT_ROOT = process.env.OUT_ROOT || "profile-summary-card-output";
const USER = process.env.TARGET_USER || process.env.GITHUB_REPOSITORY_OWNER;

if (!process.env.PAT_1) {
  console.error("缺少 PAT_1（官方 fetcher 只认这个变量名）");
  process.exit(1);
}
if (!USER) {
  console.error("缺少 TARGET_USER");
  process.exit(1);
}

const base = resolve(GHS_DIR);
const importFrom = (rel) => import(pathToFileURL(join(base, rel)).href);

const { fetchStats } = await importFrom("src/fetchers/stats.js");
const { renderStatsCard } = await importFrom("src/cards/stats.js");
const { fetchTopLanguages } = await importFrom("src/fetchers/top-languages.js");
const { renderTopLanguages } = await importFrom("src/cards/top-languages.js");

/**
 * 把带 CSS 动画的卡片改成静态的。
 *
 * 上游卡片靠 animation 渐显：例如 `.stagger { opacity: 0; animation: fadeIn ... }`，
 * 圆环的填充比例藏在 @keyframes rankAnimation 的终态里。
 * 静态 SVG 没有动画，不处理就会整片空白 / 圆环永远是整圈。
 */
function staticize(svg) {
  const m = svg.match(
    /@keyframes\s+rankAnimation\s*\{[\s\S]*?to\s*\{\s*stroke-dashoffset:\s*([\d.]+)/,
  );
  const finalOffset = m ? m[1] : null;

  let out = svg
    .replace(/@keyframes[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, "")
    .replace(/animation(-[a-z]+)?:[^;]*;/g, "")
    .replace(/opacity:\s*0;/g, "opacity: 1;")
    .replace(/\.stagger\s*\{[^}]*\}/g, ".stagger { opacity: 1; }");

  if (finalOffset) {
    out = out.replace(
      /<circle class="rank-circle"/,
      `<circle class="rank-circle" style="stroke-dashoffset: ${finalOffset}"`,
    );
  }
  return out;
}

const THEMES = {
  light: { theme: "default" },
  dark: { theme: "dracula" },
};

async function writeCard(dirName, filePrefix, render) {
  const dir = join(OUT_ROOT, dirName);
  await mkdir(dir, { recursive: true });
  for (const [variant, { theme }] of Object.entries(THEMES)) {
    const svg = staticize(render(theme));
    const file = join(dir, `${filePrefix}-${variant}.svg`);
    await writeFile(file, svg, "utf8");
    console.log(`写入 ${file}`);
  }
}

const stats = await fetchStats(USER);
await writeCard("stats", "stats", (theme) =>
  renderStatsCard(stats, {
    show_icons: true,
    rank_icon: "default",
    bg_color: "00000000",
    theme,
  }),
);
console.log(
  `stats: stars=${stats.totalStars} commits=${stats.totalCommits} prs=${stats.totalPRs} issues=${stats.totalIssues} contributedTo=${stats.contributedTo} rank=${stats.rank.level}`,
);

const langs = await fetchTopLanguages(USER);
await writeCard("langs", "langs", (theme) =>
  renderTopLanguages(langs, {
    // compact = 一条堆叠横条 + 双列图例，比甜甜圈紧凑
    layout: "compact",
    langs_count: 8,
    bg_color: "00000000",
    theme,
  }),
);
console.log(`langs: ${Object.keys(langs).slice(0, 8).join(", ")}`);
