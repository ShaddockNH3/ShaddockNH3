#!/usr/bin/env node
/**
 * 生成 GitHub Rank 圆环卡（仿 github-readme-stats 的 rank 圈）。
 *
 * 为什么要自己写：github-readme-stats 的公共实例已经 503（Vercel 部署被暂停），
 * 而且它靠别人的 token 跑，随时可能再挂。这里把算法搬过来，用我们自己的
 * PAT 在 Actions 里算，产出静态 SVG，不依赖任何第三方服务。
 *
 * 算法与 github-readme-stats 保持一致：
 *   exponential_cdf(x) = 1 - 2^(-x)
 *   rank = 1 - (Σ 权重_i × cdf(值_i / 中位数_i)) / 总权重
 *   percentile = rank × 100   （越小越好）
 *
 * 环境变量：
 *   GITHUB_TOKEN  PAT（classic，public_repo + read:user）
 *   USERNAME      要统计的用户名
 *   OUT_DIR       输出目录，默认 profile-summary-card-output/rank
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const API = "https://api.github.com";

const TOKEN = process.env.GITHUB_TOKEN;
const LOGIN = process.env.USERNAME || process.env.GITHUB_REPOSITORY_OWNER;
const OUT_DIR = process.env.OUT_DIR || "profile-summary-card-output/rank";

if (!TOKEN) {
  console.error("缺少 GITHUB_TOKEN");
  process.exit(1);
}
if (!LOGIN) {
  console.error("缺少 USERNAME");
  process.exit(1);
}

/** 权重与中位数，取自 github-readme-stats 的 rank 计算 */
const WEIGHT = { commits: 2, prs: 3, issues: 1, stars: 4, followers: 1 };
const MEDIAN = { commits: 250, prs: 50, issues: 25, stars: 50, followers: 10 };
const TOTAL_WEIGHT = Object.values(WEIGHT).reduce((a, b) => a + b, 0);

const QUERY = `
  query ($login: String!) {
    user(login: $login) {
      followers { totalCount }
      contributionsCollection {
        totalCommitContributions
        totalPullRequestContributions
        totalIssueContributions
        restrictedContributionsCount
      }
      repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
        nodes { stargazerCount }
      }
    }
  }
`;

async function fetchStats() {
  const res = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "rank-card-generator",
    },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });

  if (!res.ok) {
    throw new Error(`GraphQL ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL 返回错误: ${JSON.stringify(json.errors)}`);
  }

  const user = json.data.user;
  if (!user) throw new Error(`找不到用户 ${LOGIN}`);

  const c = user.contributionsCollection;
  return {
    followers: user.followers.totalCount,
    commits: c.totalCommitContributions + c.restrictedContributionsCount,
    prs: c.totalPullRequestContributions,
    issues: c.totalIssueContributions,
    stars: user.repositories.nodes.reduce(
      (sum, r) => sum + r.stargazerCount,
      0,
    ),
  };
}

const exponentialCdf = (x) => 1 - 2 ** -x;

function computeRank(s) {
  const score =
    (WEIGHT.commits * exponentialCdf(s.commits / MEDIAN.commits) +
      WEIGHT.prs * exponentialCdf(s.prs / MEDIAN.prs) +
      WEIGHT.issues * exponentialCdf(s.issues / MEDIAN.issues) +
      WEIGHT.stars * exponentialCdf(s.stars / MEDIAN.stars) +
      WEIGHT.followers * exponentialCdf(s.followers / MEDIAN.followers)) /
    TOTAL_WEIGHT;

  const rank = 1 - score;
  // 夹到 1~100，避免爆表或负值
  const percentile = Math.min(100, Math.max(1, rank * 100));
  return { rank, percentile, grade: gradeFor(percentile) };
}

function gradeFor(p) {
  if (p <= 1) return "S+";
  if (p <= 12.5) return "S";
  if (p <= 25) return "A+";
  if (p <= 37.5) return "A";
  if (p <= 50) return "A-";
  if (p <= 62.5) return "B+";
  if (p <= 75) return "B";
  if (p <= 87.5) return "B-";
  return "C+";
}

const GRADE_COLOR = {
  "S+": "#F778BA",
  S: "#FF8C42",
  "A+": "#2EA043",
  A: "#3FB950",
  "A-": "#56A64B",
  "B+": "#2F81F7",
  B: "#4C8EF7",
  "B-": "#6E9BF0",
  "C+": "#8B949E",
};

const THEMES = {
  dark: {
    track: "#2D333B",
    title: "#C9D1D9",
    muted: "#8B949E",
    border: "#30363D",
  },
  light: {
    track: "#E4E6EA",
    title: "#24292F",
    muted: "#57606A",
    border: "#D0D7DE",
  },
};

const W = 340;
const H = 200;
const CX = W / 2;
const CY = 100;
const R = 48;
const STROKE = 9;
const CIRC = 2 * Math.PI * R;

function escapeXml(s) {
  return String(s).replace(
    /[<>&'"]/g,
    (c) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[
        c
      ],
  );
}

function render(themeName, stats, { percentile, grade }) {
  const t = THEMES[themeName];
  const color = GRADE_COLOR[grade];
  // percentile 越小越好 → 圆环越满
  const progress = 1 - percentile / 100;
  const dash = `${(CIRC * progress).toFixed(2)} ${CIRC.toFixed(2)}`;
  const topLabel = `Top ${percentile < 10 ? percentile.toFixed(1) : Math.round(percentile)}%`;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub Rank ${grade}">
  <title>GitHub Rank ${grade}</title>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6" fill="none" stroke="${t.border}" stroke-width="1"/>
  <text x="24" y="32" font-family="'Segoe UI', Ubuntu, 'Helvetica Neue', sans-serif" font-size="12" letter-spacing="2.4" fill="${t.muted}">RANK</text>
  <g transform="rotate(-90 ${CX} ${CY})">
    <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${t.track}" stroke-width="${STROKE}"/>
    <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${color}" stroke-width="${STROKE}" stroke-dasharray="${dash}" stroke-linecap="round"/>
  </g>
  <text x="${CX}" y="${CY + 1}" text-anchor="middle" dominant-baseline="central" font-family="'Segoe UI', Ubuntu, 'Helvetica Neue', sans-serif" font-size="34" font-weight="600" fill="${color}">${escapeXml(grade)}</text>
  <text x="${CX}" y="172" text-anchor="middle" font-family="'Segoe UI', Ubuntu, 'Helvetica Neue', sans-serif" font-size="12" fill="${t.muted}">${escapeXml(topLabel)}</text>
</svg>
`;
}

const stats = await fetchStats();
const computed = computeRank(stats);

await mkdir(OUT_DIR, { recursive: true });
for (const themeName of Object.keys(THEMES)) {
  const file = join(OUT_DIR, `rank-${themeName}.svg`);
  await writeFile(file, render(themeName, stats, computed), "utf8");
  console.log(`写入 ${file}`);
}

console.log(
  `commits=${stats.commits} prs=${stats.prs} issues=${stats.issues} stars=${stats.stars} followers=${stats.followers}`,
);
console.log(
  `rank=${computed.rank.toFixed(4)} percentile=${computed.percentile.toFixed(2)} grade=${computed.grade}`,
);
