#!/usr/bin/env node
/**
 * 用 github-readme-stats 官方代码渲染「统计卡」，产出静态 SVG。
 *
 * 为什么不自己画：那张卡的排版（左边五行数据 + 右边 rank 圆环）是它的设计，
 * 自己仿容易走样。这里直接 import 它的 fetchStats / renderStatsCard，
 * 只是把结果落成静态文件，绕开已经挂掉的公共实例。
 *
 * 环境变量：
 *   GHS_DIR      github-readme-stats 的本地路径（workflow 里现 clone 一份）
 *   PAT_1        官方 fetcher 认这个名字的 token
 *   TARGET_USER  要统计的用户名
 *   OUT_DIR      输出目录，默认 profile-summary-card-output/stats
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const GHS_DIR = process.env.GHS_DIR || ".cache/github-readme-stats";
const OUT_DIR = process.env.OUT_DIR || "profile-summary-card-output/stats";
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

/**
 * 把带 CSS 动画的卡片改成静态的。
 *
 * 官方卡片靠 animation 渐显：`.stagger { opacity: 0; animation: fadeIn ... }`，
 * 圆环的填充比例也藏在 @keyframes rankAnimation 的终态里。
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
    .replace(/\.stagger\s*\{[^}]*\}/g, ".stagger { opacity: 1; }");

  if (finalOffset) {
    out = out.replace(
      /<circle class="rank-circle"/,
      `<circle class="rank-circle" style="stroke-dashoffset: ${finalOffset}"`,
    );
  }
  return out;
}

const stats = await fetchStats(USER);

const common = {
  show_icons: true,
  rank_icon: "default",
  bg_color: "00000000",
};

const variants = {
  light: { ...common, theme: "default" },
  dark: { ...common, theme: "dracula" },
};

await mkdir(OUT_DIR, { recursive: true });
for (const [name, options] of Object.entries(variants)) {
  const svg = staticize(renderStatsCard(stats, options));
  const file = join(OUT_DIR, `stats-${name}.svg`);
  await writeFile(file, svg, "utf8");
  console.log(`写入 ${file}`);
}

console.log(
  `stars=${stats.totalStars} commits=${stats.totalCommits} prs=${stats.totalPRs} issues=${stats.totalIssues} contributedTo=${stats.contributedTo}`,
);
console.log(`rank=${stats.rank.level} percentile=${stats.rank.percentile.toFixed(2)}`);
