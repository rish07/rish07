#!/usr/bin/env node
/**
 * Builds last-30-days contribution area charts as themed SVGs.
 * Uses GitHub GraphQL via GITHUB_TOKEN.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}

const username = process.env.GITHUB_USER_NAME || "rish07";
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const query = `
  query ($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }
`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "rish07-profile-activity",
  },
  body: JSON.stringify({ query, variables: { login: username } }),
});

if (!response.ok) {
  console.error("GitHub GraphQL failed", response.status, await response.text());
  process.exit(1);
}

const payload = await response.json();
const weeks =
  payload?.data?.user?.contributionsCollection?.contributionCalendar?.weeks ?? [];
const days = weeks.flatMap((week) => week.contributionDays);
const last30 = days.slice(-30);

if (last30.length === 0) {
  console.error("No contribution days returned");
  process.exit(1);
}

const counts = last30.map((day) => day.contributionCount);
const max = Math.max(1, ...counts);
const total = counts.reduce((sum, count) => sum + count, 0);

const width = 896;
const height = 220;
const padL = 48;
const padR = 28;
const padT = 52;
const padB = 40;
const innerW = width - padL - padR;
const innerH = height - padT - padB;

function xAt(i) {
  return padL + (i / Math.max(1, last30.length - 1)) * innerW;
}

function yAt(count) {
  return padT + innerH - (count / max) * innerH;
}

function clampY(y) {
  return Math.min(padT + innerH, Math.max(padT, y));
}

function smoothPath(points) {
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = clampY(p1.y + (p2.y - p0.y) / 6);
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = clampY(p2.y - (p3.y - p1.y) / 6);
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

const points = last30.map((day, i) => ({ x: xAt(i), y: yAt(day.contributionCount) }));
const line = smoothPath(points);
const area = `${line} L ${points[points.length - 1].x.toFixed(1)} ${(padT + innerH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(padT + innerH).toFixed(1)} Z`;

const startLabel = formatShort(last30[0].date);
const midLabel = formatShort(last30[Math.floor(last30.length / 2)].date);
const endLabel = formatShort(last30[last30.length - 1].date);

function formatShort(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function render(theme) {
  const dark = theme === "dark";
  const bg = dark ? "#0d1117" : "#ffffff";
  const surface = dark ? "#161b22" : "#f6f8fa";
  const text = dark ? "#e6edf3" : "#1f2328";
  const muted = dark ? "#8b949e" : "#656d76";
  const accent = dark ? "#e8b86d" : "#b45309";
  const lineColor = dark ? "#6ee7b7" : "#1a7f4b";
  const grid = dark ? "#21262d" : "#d0d7de";
  const fillId = dark ? "areaDark" : "areaLight";
  const fillTop = dark ? "#6ee7b7" : "#1a7f4b";

  const dots = last30
    .map((day, i) => {
      const r = day.contributionCount > 0 ? 3.2 : 1.6;
      const fill = day.contributionCount > 0 ? accent : muted;
      return `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(day.contributionCount).toFixed(1)}" r="${r}" fill="${fill}"/>`;
    })
    .join("");

  const yTicks = [0, Math.round(max / 2), max]
    .filter((value, index, all) => all.indexOf(value) === index)
    .map((value) => {
      const y = yAt(value);
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" stroke="${grid}" stroke-width="1"/>
      <text x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="${muted}" font-size="11">${value}</text>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">Last 30 days of GitHub contributions</title>
  <desc id="desc">${escapeXml(total)} contributions over the last 30 days. Peak day ${escapeXml(max)}.</desc>
  <style>
    text {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    }
    .line {
      fill: none;
      stroke: ${lineColor};
      stroke-width: 2.25;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  </style>
  <rect width="${width}" height="${height}" rx="12" fill="${bg}"/>
  <rect x="0" y="0" width="${width}" height="${height}" rx="12" fill="${surface}"/>
  <text x="${padL}" y="28" fill="${accent}" font-size="13" font-weight="600" letter-spacing="0.12em">LAST 30 DAYS</text>
  <text x="${width - padR}" y="28" text-anchor="end" fill="${muted}" font-size="13">${escapeXml(total)} contributions</text>
  ${yTicks}
  <defs>
    <linearGradient id="${fillId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${fillTop}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${fillTop}" stop-opacity="0.02"/>
    </linearGradient>
  </defs>
  <path d="${area}" fill="url(#${fillId})"/>
  <path class="line" d="${line}"/>
  ${dots}
  <text x="${padL}" y="${height - 14}" fill="${muted}" font-size="11">${escapeXml(startLabel)}</text>
  <text x="${width / 2}" y="${height - 14}" text-anchor="middle" fill="${muted}" font-size="11">${escapeXml(midLabel)}</text>
  <text x="${width - padR}" y="${height - 14}" text-anchor="end" fill="${muted}" font-size="11">${escapeXml(endLabel)}</text>
</svg>
`;
}

const darkPath = join(root, "assets/activity-dark.svg");
const lightPath = join(root, "assets/activity-light.svg");
writeFileSync(darkPath, render("dark"));
writeFileSync(lightPath, render("light"));
console.log(`wrote ${darkPath} and ${lightPath} (${total} contribs, peak ${max})`);
