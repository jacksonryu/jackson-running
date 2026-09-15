"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useRef, useState } from "react";

type JsonRecord = Record<string, any>;
type ReportRow = {
  id: number;
  report_date: string;
  report_type: string;
  input_context: JsonRecord | null;
  output: JsonRecord | null;
  model_used: string | null;
  created_at: string;
};

type Tab = "overview" | "simple" | "quality" | "peak" | "detail" | "coach";
type RaceMode = "overall" | "10k" | "half" | "marathon" | "trail50" | "trail100";

type PeakHistoryRow = {
  id?: number;
  metric_date: string;
  race_mode: RaceMode;
  overall_score: number | null;
  recovery_score: number | null;
  aerobic_score: number | null;
  speed_score: number | null;
  climbing_score: number | null;
  durability_score: number | null;
  training_state_score: number | null;
};


type UtmbSnapshot = {
  snapshot_date: string;
  captured_at: string;
  runner_name: string | null;
  age_group: string | null;
  overall_index: number | null;
  index_20k: number | null;
  index_50k: number | null;
  index_100k: number | null;
  index_100m: number | null;
  best_score: number | null;
  finished_races: number | null;
  top10: number | null;
  korea_men_rank_est: number | null;
  korea_men_rank_low: number | null;
  korea_men_rank_high: number | null;
  korea_age_rank_est: number | null;
  korea_age_rank_low: number | null;
  korea_age_rank_high: number | null;
  rank_status: string | null;
  rank_sample_size: number | null;
  profile_url: string | null;
};

type Tone = "good" | "neutral" | "warn";

type Signal = {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
};

const toneClasses: Record<Tone, { badge: string; dot: string; text: string; border: string; bg: string }> = {
  good: {
    badge: "border-emerald-700/60 bg-emerald-950/70 text-emerald-300",
    dot: "bg-emerald-400",
    text: "text-emerald-300",
    border: "border-emerald-900/60",
    bg: "bg-emerald-950/25",
  },
  neutral: {
    badge: "border-sky-700/60 bg-sky-950/70 text-sky-300",
    dot: "bg-sky-400",
    text: "text-sky-300",
    border: "border-sky-900/60",
    bg: "bg-sky-950/20",
  },
  warn: {
    badge: "border-amber-700/60 bg-amber-950/70 text-amber-300",
    dot: "bg-amber-400",
    text: "text-amber-300",
    border: "border-amber-900/60",
    bg: "bg-amber-950/20",
  },
};

function n(v: unknown, digits = 0) {
  if (typeof v !== "number" || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

function fmt(v: unknown, suffix = "", digits?: number) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") {
    return `${digits === undefined ? v : v.toFixed(digits)}${suffix}`;
  }
  return `${v}${suffix}`;
}

function prettyDate(v: unknown, includeTime = true) {
  if (typeof v !== "string" || !v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(d);
}

function clamp(v: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, v));
}

function safeNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}


const raceModeLabels: Record<RaceMode, string> = {
  overall: "OVERALL",
  "10k": "10K",
  half: "HALF",
  marathon: "MARATHON",
  trail50: "TRAIL 50K",
  trail100: "TRAIL 100K",
};

const peakAxisLabels = ["회복", "기본 엔진", "스피드", "오르막", "내구성", "훈련 적응"];

function scoreTone(score: number | null): Tone {
  if (score === null) return "neutral";
  if (score >= 95) return "good";
  if (score < 80) return "warn";
  return "neutral";
}

function scoreText(score: number | null) {
  return score === null ? "—" : `${n(score, 0)}%`;
}

function polygonPoints(values: number[], radius: number, cx: number, cy: number) {
  const count = values.length;
  return values.map((value, i) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / count;
    const r = radius * clamp(value, 0, 110) / 110;
    return `${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`;
  }).join(" ");
}

function RadarChart({ current, peak }: { current: Array<number | null>; peak: Array<number | null> }) {
  const size = 330;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 112;
  const rings = [25, 50, 75, 100];
  const currentVals = current.map((v) => v ?? 0);
  const peakVals = peak.map((v) => v ?? 0);
  const hasCurrent = current.some((v) => v !== null);

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[360px]">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full overflow-visible">
        {rings.map((ring) => (
          <polygon key={ring} points={polygonPoints(Array(6).fill(ring), radius, cx, cy)} fill="none" stroke="#27272a" strokeWidth="1" />
        ))}
        {peakAxisLabels.map((_, i) => {
          const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 6;
          const x = cx + Math.cos(angle) * radius;
          const y = cy + Math.sin(angle) * radius;
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#27272a" strokeWidth="1" />;
        })}
        <polygon points={polygonPoints(peakVals, radius, cx, cy)} fill="rgba(113,113,122,.08)" stroke="#52525b" strokeDasharray="5 5" strokeWidth="1.5" />
        <polygon points={polygonPoints(currentVals, radius, cx, cy)} fill="rgba(34,211,238,.16)" stroke="#22d3ee" strokeWidth="2.5" />
        {currentVals.map((v, i) => {
          const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 6;
          const r = radius * clamp(v, 0, 110) / 110;
          return <circle key={i} cx={cx + Math.cos(angle) * r} cy={cy + Math.sin(angle) * r} r="3.5" fill="#67e8f9" />;
        })}
        {peakAxisLabels.map((label, i) => {
          const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 6;
          const r = radius + 34;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          return <text key={label} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="#71717a" fontSize="11">{label}</text>;
        })}
      </svg>
      {!hasCurrent && <div className="absolute inset-0 grid place-items-center"><div className="rounded-full border border-zinc-800 bg-black/80 px-4 py-2 text-xs text-zinc-500">히스토리 백필 후 자동 표시</div></div>}
    </div>
  );
}

function PeakScoreCard({ label, score, peakDate, detail }: { label: string; score: number | null; peakDate: string | null; detail: string }) {
  const tone = scoreTone(score);
  return (
    <div className={`rounded-2xl border p-5 ${toneClasses[tone].border} ${toneClasses[tone].bg}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-zinc-500">{label}</div>
        <Pill tone={tone}>{score === null ? "대기" : score >= 100 ? "NEW PEAK" : score >= 95 ? "PEAK 근접" : score < 80 ? "보강 필요" : "성장 중"}</Pill>
      </div>
      <div className="mt-3 text-4xl font-semibold tracking-tight">{scoreText(score)}</div>
      <div className="mt-3"><ProgressBar value={score ?? 0} tone={tone} /></div>
      <div className="mt-3 text-xs leading-5 text-zinc-500">{detail}</div>
      <div className="mt-2 text-[11px] text-zinc-600">{peakDate ? `기준 최고점 ${prettyDate(peakDate, false)}` : "전체 과거 데이터 계산 후 최고점 날짜 표시"}</div>
    </div>
  );
}

function Icon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "heart") {
    return <svg {...common}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" /></svg>;
  }
  if (name === "moon") {
    return <svg {...common}><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" /></svg>;
  }
  if (name === "mountain") {
    return <svg {...common}><path d="m3 20 6-11 4 7 2-4 6 8H3Z" /></svg>;
  }
  if (name === "shoe") {
    return <svg {...common}><path d="M4 15.5c2.5 0 4.4-1.1 5.5-3.2l1.2-2.3 2.2 2.4c1.2 1.3 2.9 2.1 4.7 2.1H20v3.5H4v-2.5Z" /><path d="M8 16h2M12 16h2" /></svg>;
  }
  if (name === "bolt") {
    return <svg {...common}><path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z" /></svg>;
  }
  if (name === "trend") {
    return <svg {...common}><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>;
  }
  if (name === "target") {
    return <svg {...common}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v2M22 12h-2M12 22v-2M2 12h2" /></svg>;
  }
  if (name === "clock") {
    return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
  }
  if (name === "warning") {
    return <svg {...common}><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v4M12 17h.01" /></svg>;
  }
  if (name === "spark") {
    return <svg {...common}><path d="m12 2 1.7 5.3L19 9l-5.3 1.7L12 16l-1.7-5.3L5 9l5.3-1.7L12 2Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></svg>;
  }
  return <svg {...common}><circle cx="12" cy="12" r="9" /></svg>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <div className="mx-auto max-w-7xl px-4 pb-14 pt-5 sm:px-6 sm:pt-8">{children}</div>
    </main>
  );
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${toneClasses[tone].badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${toneClasses[tone].dot}`} />
      {children}
    </span>
  );
}

function MiniMetric({ icon, label, value, detail, tone = "neutral" }: { icon: string; label: string; value: string; detail: string; tone?: Tone }) {
  return (
    <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950/80 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-zinc-500">{label}</span>
        <span className={`rounded-xl p-2 ${toneClasses[tone].bg} ${toneClasses[tone].text}`}><Icon name={icon} className="h-4 w-4" /></span>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs leading-5 text-zinc-500">{detail}</div>
    </div>
  );
}

function ProgressBar({ value, tone = "neutral" }: { value: number; tone?: Tone }) {
  const gradient = tone === "good" ? "from-emerald-500 to-teal-300" : tone === "warn" ? "from-amber-500 to-orange-300" : "from-sky-500 to-cyan-300";
  return (
    <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
      <div className={`h-full rounded-full bg-gradient-to-r ${gradient}`} style={{ width: `${clamp(value)}%` }} />
    </div>
  );
}

function ComparisonRow({ label, current, baseline, unit, icon }: { label: string; current: number | null; baseline: number | null; unit: string; icon: string }) {
  const ratio = current !== null && baseline && baseline > 0 ? current / baseline : null;
  const pct = ratio !== null ? clamp(ratio * 50, 4, 100) : 0;
  const tone: Tone = ratio === null ? "neutral" : ratio > 1.35 ? "warn" : ratio >= 0.8 ? "good" : "neutral";
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-zinc-900 p-2 text-zinc-400"><Icon name={icon} className="h-4 w-4" /></span>
          <div>
            <div className="text-sm font-medium">{label}</div>
            <div className="mt-0.5 text-xs text-zinc-500">최근 7일 vs 최근 28일 주간 평균</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold">{current === null ? "—" : `${n(current, current >= 100 ? 0 : 1)}${unit}`}</div>
          <div className={`text-xs ${toneClasses[tone].text}`}>{ratio === null ? "비교 불가" : `${n(ratio * 100, 0)}%`}</div>
        </div>
      </div>
      <div className="mt-4"><ProgressBar value={pct} tone={tone} /></div>
      <div className="mt-2 text-xs text-zinc-600">주간 평균 {baseline === null ? "—" : `${n(baseline, baseline >= 100 ? 0 : 1)}${unit}`}</div>
    </div>
  );
}

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-zinc-500">{label}</div>
        {icon && <span className="text-zinc-600"><Icon name={icon} className="h-4 w-4" /></span>}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-2 text-sm leading-6 text-zinc-500">{sub}</div>}
    </div>
  );
}

function titleize(key: string) {
  const map: Record<string, string> = {
    recovery_today: "오늘 회복 상태",
    recovery_assessment: "오늘 회복 상태",
    recent_load_interpretation: "최근 훈련 부하",
    recent_key_workout_review: "최근 핵심 운동 평가",
    today_recommendation: "오늘 권장 훈련",
    today_workout: "오늘 권장 훈련",
    recommended_session: "오늘 권장 훈련",
    plan_b: "Plan B",
    planB: "Plan B",
    avoid_today: "오늘 피해야 할 훈련",
    next_3_days_plan: "향후 3일 계획",
    next_3_days: "향후 3일 계획",
    three_day_plan: "향후 3일 계획",
    next_three_days: "향후 3일 계획",
    low_confidence_areas: "데이터 품질 / 확신 낮은 부분",
  };
  return map[key] ?? key.replaceAll("_", " ");
}

function renderPrimitive(v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function ValueView({ value }: { value: unknown }) {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <p className="whitespace-pre-wrap leading-7 text-zinc-300">{renderPrimitive(value)}</p>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="text-zinc-500">없음</p>;
    return (
      <div className="space-y-2">
        {value.map((item, i) => (
          <div key={i} className="rounded-xl bg-zinc-950 px-4 py-3 text-sm leading-6 text-zinc-300">
            {typeof item === "object" && item !== null ? <ObjectRows obj={item as JsonRecord} /> : renderPrimitive(item)}
          </div>
        ))}
      </div>
    );
  }
  return <ObjectRows obj={value as JsonRecord} />;
}

function ObjectRows({ obj }: { obj: JsonRecord }) {
  return (
    <div className="space-y-3">
      {Object.entries(obj).map(([k, v]) => (
        <div key={k} className="grid gap-1 sm:grid-cols-[150px_1fr]">
          <div className="text-xs uppercase tracking-wide text-zinc-500">{k.replaceAll("_", " ")}</div>
          <div className="text-sm leading-6 text-zinc-300">{typeof v === "object" && v !== null ? <ValueView value={v} /> : renderPrimitive(v)}</div>
        </div>
      ))}
    </div>
  );
}

function WorkoutCard({ recommendation }: { recommendation: JsonRecord | null }) {
  if (!recommendation) {
    return (
      <div className="rounded-[28px] border border-zinc-800 bg-zinc-950 p-6">
        <div className="text-sm text-zinc-500">오늘 추천 훈련</div>
        <div className="mt-3 text-xl font-semibold">코치 추천 데이터가 없습니다.</div>
      </div>
    );
  }
  const type = recommendation.training_type ?? recommendation.type ?? recommendation.session_type ?? "오늘 훈련";
  const distance = safeNumber(recommendation.distance_km);
  const duration = safeNumber(recommendation.duration_minutes);
  const rpe = safeNumber(recommendation.target_rpe);
  const intensity = recommendation.intensity_or_pace ?? recommendation.intensity ?? recommendation.pace ?? "편안한 강도로 진행";
  const reasoning = recommendation.reasoning ?? recommendation.reason ?? "회복과 최근 훈련 부하를 반영한 추천입니다.";

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-cyan-900/40 bg-gradient-to-br from-cyan-950/40 via-zinc-950 to-zinc-950 p-6 sm:p-7">
      <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="relative">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm font-medium text-cyan-300"><Icon name="target" className="h-4 w-4" />오늘 추천 훈련</div>
          <span className="rounded-full border border-cyan-800/70 bg-cyan-950/70 px-3 py-1 text-xs text-cyan-300">AI COACH</span>
        </div>
        <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">{String(type)}</h2>
        <div className="mt-5 grid grid-cols-3 gap-2 sm:max-w-lg sm:gap-3">
          <div className="rounded-2xl bg-black/40 p-3"><div className="text-[11px] text-zinc-500">거리</div><div className="mt-1 text-lg font-semibold">{distance === null ? "—" : `${n(distance, 1)}km`}</div></div>
          <div className="rounded-2xl bg-black/40 p-3"><div className="text-[11px] text-zinc-500">시간</div><div className="mt-1 text-lg font-semibold">{duration === null ? "—" : `${n(duration, 0)}분`}</div></div>
          <div className="rounded-2xl bg-black/40 p-3"><div className="text-[11px] text-zinc-500">RPE</div><div className="mt-1 text-lg font-semibold">{rpe === null ? "—" : n(rpe, 0)}</div></div>
        </div>
        <div className="mt-5 rounded-2xl border border-zinc-800/80 bg-black/30 p-4">
          <div className="text-xs font-medium text-zinc-500">강도 / 페이스</div>
          <div className="mt-1 text-sm font-medium leading-6 text-zinc-200">{String(intensity)}</div>
        </div>
        <p className="mt-4 text-sm leading-7 text-zinc-400">{String(reasoning)}</p>
      </div>
    </div>
  );
}

function SimpleBullet({ tone, title, detail }: { tone: Tone; title: string; detail: string }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${toneClasses[tone].dot}`} />
      <div><div className="font-medium text-zinc-100">{title}</div><div className="mt-1 text-sm leading-6 text-zinc-500">{detail}</div></div>
    </div>
  );
}



type QualitySession = {
  day: string;
  title: string;
  subtitle: string;
  tone: Tone;
  main: string;
  details: string[];
  fallback: string;
  reason: string;
};

function weekRotationIndex() {
  const now = new Date();
  const utcDay = Math.floor(now.getTime() / 86400000);
  return Math.floor(utcDay / 7) % 4;
}

function nextWeekdayLabel(targetDay: number) {
  const now = new Date();
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const diff = (targetDay - kst.getDay() + 7) % 7;
  const d = new Date(kst);
  d.setDate(kst.getDate() + diff);
  const label = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", weekday: "short" }).format(d);
  return diff === 0 ? `오늘 · ${label}` : label;
}

function QualitySessionCard({ session }: { session: QualitySession }) {
  return (
    <article className={`rounded-[28px] border p-5 sm:p-6 ${toneClasses[session.tone].border} ${toneClasses[session.tone].bg}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-zinc-600">{session.day}</div>
          <h3 className="mt-1 text-2xl font-semibold tracking-tight">{session.title}</h3>
          <div className="mt-1 text-sm text-zinc-500">{session.subtitle}</div>
        </div>
        <Pill tone={session.tone}>{session.tone === "good" ? "GO" : session.tone === "warn" ? "HOLD" : "조건부"}</Pill>
      </div>
      <div className="mt-5 rounded-2xl border border-zinc-800/80 bg-black/35 p-4">
        <div className="text-xs text-zinc-600">메인 세션</div>
        <div className="mt-2 text-lg font-semibold leading-7 text-zinc-100">{session.main}</div>
      </div>
      <div className="mt-4 grid gap-2">
        {session.details.map((item, i) => <div key={i} className="flex gap-2 text-sm leading-6 text-zinc-400"><span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${toneClasses[session.tone].dot}`} />{item}</div>)}
      </div>
      <div className="mt-4 rounded-2xl bg-zinc-950/70 p-4 text-sm leading-6 text-zinc-500"><span className="font-medium text-zinc-300">Plan B · </span>{session.fallback}</div>
      <div className="mt-3 text-xs leading-5 text-zinc-600">{session.reason}</div>
    </article>
  );
}


type TrainingGroup = "special" | "group1" | "group2";

const trainingGroupLabels: Record<TrainingGroup, string> = {
  special: "특조",
  group1: "1조",
  group2: "2조",
};

type TrainingFormat = {
  label: string;
  work: string;
  pace: string;
  recovery: string;
  volume: string;
  lap400?: string;
  note?: string;
};

type TuesdayVariant = {
  track: TrainingFormat;
  treadmill: TrainingFormat;
};

type TrainingWeekPlan = {
  week: number;
  focus: string;
  tuesdayTitle: string;
  tuesdayGroups: Record<TrainingGroup, TuesdayVariant>;
  thursdayTitle: string;
  thursdayOutdoor: TrainingFormat;
  thursdayTreadmill: TrainingFormat;
  loadNote: string;
};

function sharedTuesday(track: TrainingFormat, treadmill: TrainingFormat): Record<TrainingGroup, TuesdayVariant> {
  return {
    special: { track, treadmill },
    group1: { track, treadmill },
    group2: { track, treadmill },
  };
}

const detailedTrainingCycle: TrainingWeekPlan[] = [
  {
    week: 1, focus: "NSM / Threshold 리듬", tuesdayTitle: "NSM 6분 반복 · 개인 기준 공통",
    tuesdayGroups: sharedTuesday(
      {
        label: "TRACK", work: "6:00 × 6세트", pace: "약 1600m/세트 · 3:42–3:45/km",
        lap400: "약 89–90초/400m (3:42–3:45/km)",
        recovery: "2:00 easy jog · 트랙 기준 약 400m 전후", volume: "질주 약 9.6km",
        note: "NSM은 표의 조별 세션이 아니라 개인 threshold 세션이라 특조/1조/2조 선택과 무관하게 동일하게 표시."
      },
      {
        label: "TREADMILL", work: "6:00 × 6세트", pace: "16.0–16.2 km/h (3:45–3:42/km) · 경사 0–1%",
        lap400: "400m 환산 약 90–89초 (3:45–3:42/km)",
        recovery: "2:00 @ 9–10 km/h (6:40–6:00/km)", volume: "질주 약 9.6km",
        note: "벨트 가속 시간을 고려해 거리보다 6분 시간을 기준으로 수행."
      },
    ),
    thursdayTitle: "긴 업힐 파워",
    thursdayOutdoor: { label: "OUTDOOR HILL", work: "400m 업힐 × 6–8", pace: "RPE 8 · 약 2:00–2:20/회", recovery: "내리막 조깅 2:30–3:00", volume: "상승 반복 6–8회", note: "마지막 2회에도 자세와 케이던스 유지" },
    thursdayTreadmill: { label: "INCLINE TREADMILL", work: "7:00 × 3", pace: "13% · 9.0–9.3 km/h (6:40–6:27/km)", recovery: "3:00 @ 6–7 km/h (10:00–8:34/km) · 경사 0–3%", volume: "질주 21분", note: "네가 해온 13% 7분 세션을 기준으로 시작" },
    loadNote: "볼륨 주간. 화요일을 완주했으면 목요일은 마지막 세트를 억지로 올리지 않는다."
  },
  {
    week: 2, focus: "1K 속도지구력", tuesdayTitle: "1000m + 200m 회복 · 표 원안",
    tuesdayGroups: {
      special: {
        track: {
          label: "TRACK · 특조", work: "1000m × 12 · 1–6세트 3:35 / 7–12세트 3:30",
          pace: "1–6세트 86+86+43초 = 3:35/km · 7–12세트 84+84+42초 = 3:30/km",
          lap400: "86초/400m (3:35/km) → 84초/400m (3:30/km)",
          recovery: "200m 65초 (5:25/km)", volume: "질주 12km · 회복 포함 약 14.4km",
          note: "원본 표 12세트 그대로."
        },
        treadmill: {
          label: "TREADMILL · 특조", work: "3:35 × 6 + 3:30 × 6",
          pace: "16.7 km/h (3:35/km) → 17.1 km/h (3:30/km)",
          lap400: "400m 환산 86초 → 84초",
          recovery: "65초 @ 11.1 km/h (5:25/km)", volume: "질주 12km",
          note: "각 1K는 거리 기준. 기계 가속이 느리면 work 구간 시작 전 미리 속도 전환."
        },
      },
      group1: {
        track: {
          label: "TRACK · 1조", work: "1000m × 12 · 1–6세트 3:45 / 7–12세트 3:40",
          pace: "1–6세트 90+90+45초 = 3:45/km · 7–12세트 88+88+44초 = 3:40/km",
          lap400: "90초/400m (3:45/km) → 88초/400m (3:40/km)",
          recovery: "200m 65초 (5:25/km)", volume: "질주 12km · 회복 포함 약 14.4km",
          note: "원본 표 1조 기준."
        },
        treadmill: {
          label: "TREADMILL · 1조", work: "3:45 × 6 + 3:40 × 6",
          pace: "16.0 km/h (3:45/km) → 16.4 km/h (3:40/km)",
          lap400: "400m 환산 90초 → 88초",
          recovery: "65초 @ 11.1 km/h (5:25/km)", volume: "질주 12km",
          note: "후반 6세트만 속도를 올림."
        },
      },
      group2: {
        track: {
          label: "TRACK · 2조", work: "1라운드 1000m × 6 + 2라운드 × 5",
          pace: "① 94+94+47초 = 3:55/km · ② 92+92+46초 = 3:50/km",
          lap400: "94초/400m (3:55/km) → 92초/400m (3:50/km)",
          recovery: "200m 70초 (5:50/km)", volume: "원본 표: 6세트 + 5세트 구성",
          note: "이미지 원문 표기의 6세트/5세트 2라운드를 그대로 반영."
        },
        treadmill: {
          label: "TREADMILL · 2조", work: "3:55 × 6 + 3:50 × 5",
          pace: "15.3 km/h (3:55/km) → 15.7 km/h (3:50/km)",
          lap400: "400m 환산 94초 → 92초",
          recovery: "70초 @ 10.3 km/h (5:50/km)", volume: "질주 11km",
          note: "원본 표의 2조 세트 수를 그대로 적용."
        },
      },
    },
    thursdayTitle: "중간 길이 업힐",
    thursdayOutdoor: { label: "OUTDOOR HILL", work: "2:30–3:00 × 6–8", pace: "RPE 8 · 일정한 경사", recovery: "내리막 2:00–3:00", volume: "강한 오르막 15–24분", note: "첫 2회는 통제, 중간부터 목표 강도" },
    thursdayTreadmill: { label: "INCLINE TREADMILL", work: "3:00 × 8", pace: "10% · 12.0–12.5 km/h (5:00–4:48/km)", recovery: "90초 @ 6–7 km/h (10:00–8:34/km) · 경사 0–3%", volume: "질주 24분", note: "화요일 1K 후 다리가 무거우면 6세트로 축소" },
    loadNote: "속도 자극 주간. 선택한 조의 페이스를 지키되 화요일 성공 여부가 목요일 세트 수를 결정한다."
  },
  {
    week: 3, focus: "2K 역치 / 하프 지구력", tuesdayTitle: "2000m + 400m 회복 · 표 원안",
    tuesdayGroups: {
      special: {
        track: {
          label: "TRACK · 특조", work: "2000m × 6 · 1–4세트 7:10 / 5–6세트 7:00",
          pace: "1–4세트 86초×5 = 7:10 · 5–6세트 84초×5 = 7:00",
          lap400: "86초/400m (3:35/km) → 84초/400m (3:30/km)",
          recovery: "400m 115초 (4:47.5/km)", volume: "질주 12km · 표 전체 14.4km",
          note: "원본 특조 6세트."
        },
        treadmill: {
          label: "TREADMILL · 특조", work: "2km × 4 @ 7:10 + 2km × 2 @ 7:00",
          pace: "16.7 km/h (3:35/km) → 17.1 km/h (3:30/km)",
          lap400: "400m 환산 86초 → 84초",
          recovery: "115초 @ 12.5 km/h (4:48/km)", volume: "질주 12km",
          note: "회복도 빠른 편이라 연속 threshold 성격이 강함."
        },
      },
      group1: {
        track: {
          label: "TRACK · 1조", work: "2000m × 6 · 1–4세트 7:30 / 5–6세트 7:20",
          pace: "1–4세트 90초×5 = 7:30 · 5–6세트 88초×5 = 7:20",
          lap400: "90초/400m (3:45/km) → 88초/400m (3:40/km)",
          recovery: "400m 120초 (5:00/km)", volume: "질주 12km",
          note: "원본 1조 6세트."
        },
        treadmill: {
          label: "TREADMILL · 1조", work: "2km × 4 @ 7:30 + 2km × 2 @ 7:20",
          pace: "16.0 km/h (3:45/km) → 16.4 km/h (3:40/km)",
          lap400: "400m 환산 90초 → 88초",
          recovery: "120초 @ 12.0 km/h (5:00/km)", volume: "질주 12km",
          note: "후반 2세트만 한 단계 상승."
        },
      },
      group2: {
        track: {
          label: "TRACK · 2조", work: "2000m × 6 · 1–4세트 7:50 / 5–6세트 7:40",
          pace: "1–4세트 94초×5 = 7:50 · 5–6세트 92초×5 = 7:40",
          lap400: "94초/400m (3:55/km) → 92초/400m (3:50/km)",
          recovery: "400m 120초 (5:00/km)", volume: "질주 12km",
          note: "원본 2조 표기의 1–4세트 94초, 후반 92초를 반영."
        },
        treadmill: {
          label: "TREADMILL · 2조", work: "2km × 4 @ 7:50 + 2km × 2 @ 7:40",
          pace: "15.3 km/h (3:55/km) → 15.7 km/h (3:50/km)",
          lap400: "400m 환산 94초 → 92초",
          recovery: "120초 @ 12.0 km/h (5:00/km)", volume: "질주 12km",
          note: "후반 2세트만 속도 상승."
        },
      },
    },
    thursdayTitle: "5분 업힐 역치",
    thursdayOutdoor: { label: "OUTDOOR HILL", work: "4:30–5:00 × 5", pace: "RPE 7.5–8", recovery: "내리막 2:00–3:00", volume: "강한 오르막 22–25분", note: "경사가 급하면 시간만 맞추고 거리 집착 금지" },
    thursdayTreadmill: { label: "INCLINE TREADMILL", work: "5:00 × 5", pace: "12% · 10.5–11.0 km/h (5:43–5:27/km)", recovery: "2:00 @ 6–7 km/h (10:00–8:34/km) · 경사 0–3%", volume: "질주 25분", note: "마지막 1분만 속도를 0.3–0.5 올리는 건 선택" },
    loadNote: "역치 주간. 주말 롱런이 길다면 목요일은 4세트면 충분하다."
  },
  {
    week: 4, focus: "400m 경제성 / 고볼륨", tuesdayTitle: "400m + 200m 회복 · 22세트 표 원안",
    tuesdayGroups: {
      special: {
        track: {
          label: "TRACK · 특조", work: "400m × 22 · 앞 11회 82초 / 뒤 11회 81초",
          pace: "82초 = 3:25/km · 81초 = 3:22.5/km",
          lap400: "82초/400m (3:25/km) → 81초/400m (3:22.5/km)",
          recovery: "매회 200m 60초 (5:00/km)", volume: "질주 8.8km + 회복 4.4km",
          note: "35분 이내 표기. 고볼륨 세션이라 당일 컨디션에 따라 16–18회에서 종료 가능."
        },
        treadmill: {
          label: "TREADMILL · 특조", work: "82초 × 11 + 81초 × 11",
          pace: "17.6 km/h (3:25/km) → 17.8 km/h (3:22.5/km)",
          lap400: "400m 환산 82초 → 81초",
          recovery: "60초 @ 12.0 km/h (5:00/km)", volume: "질주 8.8km",
          note: "벨트 가속 때문에 400m 거리보다 82/81초 시간을 기준으로 맞추는 편이 안정적."
        },
      },
      group1: {
        track: {
          label: "TRACK · 1조", work: "400m × 22 · 앞 11회 86초 / 뒤 11회 85초",
          pace: "86초 = 3:35/km · 85초 = 3:32.5/km",
          lap400: "86초/400m (3:35/km) → 85초/400m (3:32.5/km)",
          recovery: "매회 200m 60초 (5:00/km)", volume: "질주 8.8km + 회복 4.4km",
          note: "37분 이내 표기."
        },
        treadmill: {
          label: "TREADMILL · 1조", work: "86초 × 11 + 85초 × 11",
          pace: "16.7 km/h (3:35/km) → 16.9 km/h (3:32.5/km)",
          lap400: "400m 환산 86초 → 85초",
          recovery: "60초 @ 12.0 km/h (5:00/km)", volume: "질주 8.8km",
          note: "후반 11회만 한 단계 상승."
        },
      },
      group2: {
        track: {
          label: "TRACK · 2조", work: "400m × 22 · 앞 11회 90초 / 뒤 11회 89초",
          pace: "90초 = 3:45/km · 89초 = 3:42.5/km",
          lap400: "90초/400m (3:45/km) → 89초/400m (3:42.5/km)",
          recovery: "매회 200m 65초 (5:25/km)", volume: "질주 8.8km + 회복 4.4km",
          note: "39분 이내 표기."
        },
        treadmill: {
          label: "TREADMILL · 2조", work: "90초 × 11 + 89초 × 11",
          pace: "16.0 km/h (3:45/km) → 16.2 km/h (3:42.5/km)",
          lap400: "400m 환산 90초 → 89초",
          recovery: "65초 @ 11.1 km/h (5:25/km)", volume: "질주 8.8km",
          note: "회복 속도까지 2조 표 기준으로 낮춤."
        },
      },
    },
    thursdayTitle: "짧은 업힐 스피드",
    thursdayOutdoor: { label: "OUTDOOR HILL", work: "60초 × 8–10", pace: "RPE 8 · 빠른 케이던스", recovery: "90초 걷기/조깅", volume: "질주 8–10분", note: "힘으로 찍어누르지 말고 리듬 중심" },
    thursdayTreadmill: { label: "INCLINE TREADMILL", work: "60초 × 8–10", pace: "10% · 13.5–14.0 km/h (4:27–4:17/km)", recovery: "90초 @ 6–7 km/h (10:00–8:34/km) · 경사 3%", volume: "질주 8–10분", note: "화요일 22세트 완주 시 목요일은 8회면 충분" },
    loadNote: "400m 고볼륨 주간. 화요일을 특조 전체로 했다면 목요일은 짧게 끝내는 편이 낫다."
  },
  {
    week: 5, focus: "800m VO2 / 속도 유지", tuesdayTitle: "800m + 400m 회복 · 표 원안",
    tuesdayGroups: {
      special: {
        track: {
          label: "TRACK · 특조", work: "800m × 12 · 1–6세트 2:52 / 7–12세트 2:48",
          pace: "86초×2 = 2:52 (3:35/km) → 84초×2 = 2:48 (3:30/km)",
          lap400: "86초/400m (3:35/km) → 84초/400m (3:30/km)",
          recovery: "400m 96초 (4:00/km)", volume: "표 기준 34바퀴 · 약 13.6km",
          note: "원본 표 12세트 흐름 반영."
        },
        treadmill: {
          label: "TREADMILL · 특조", work: "2:52 × 6 + 2:48 × 6",
          pace: "16.7 km/h (3:35/km) → 17.1 km/h (3:30/km)",
          lap400: "400m 환산 86초 → 84초",
          recovery: "96초 @ 15.0 km/h (4:00/km)", volume: "질주 9.6km",
          note: "회복 속도가 빠르므로 체감상 매우 연속적인 세션."
        },
      },
      group1: {
        track: {
          label: "TRACK · 1조", work: "800m 반복 · 전반 3:00 / 후반 2:56",
          pace: "90초×2 = 3:00 (3:45/km) → 88초×2 = 2:56 (3:40/km)",
          lap400: "90초/400m (3:45/km) → 88초/400m (3:40/km)",
          recovery: "400m 100초 (4:10/km)", volume: "표 기준 34바퀴",
          note: "원본 1조 표의 전반/후반 800m 페이스를 반영."
        },
        treadmill: {
          label: "TREADMILL · 1조", work: "3:00 반복 → 후반 2:56",
          pace: "16.0 km/h (3:45/km) → 16.4 km/h (3:40/km)",
          lap400: "400m 환산 90초 → 88초",
          recovery: "100초 @ 14.4 km/h (4:10/km)", volume: "원본 표 세트 구성 준수",
          note: "세트 수는 표의 라운드 구성에 맞춤."
        },
      },
      group2: {
        track: {
          label: "TRACK · 2조", work: "800m 반복 · 전반 3:08 / 후반 3:04",
          pace: "94초×2 = 3:08 (3:55/km) → 92초×2 = 3:04 (3:50/km)",
          lap400: "94초/400m (3:55/km) → 92초/400m (3:50/km)",
          recovery: "400m 104초 (4:20/km)", volume: "원본 표: 17세트 표기",
          note: "이미지 원문은 17세트로 표기되어 있어 그대로 표시."
        },
        treadmill: {
          label: "TREADMILL · 2조", work: "3:08 반복 → 후반 3:04",
          pace: "15.3 km/h (3:55/km) → 15.7 km/h (3:50/km)",
          lap400: "400m 환산 94초 → 92초",
          recovery: "104초 @ 13.8 km/h (4:20/km)", volume: "원본 표 17세트",
          note: "세트가 많으므로 당일 컨디션으로 조절."
        },
      },
    },
    thursdayTitle: "긴 업힐 재확인",
    thursdayOutdoor: { label: "OUTDOOR HILL", work: "400m × 6–8", pace: "RPE 8", recovery: "내리막 완전 회복", volume: "상승 반복 6–8회", note: "1주차보다 속도보다 균일성 확인" },
    thursdayTreadmill: { label: "INCLINE TREADMILL", work: "7:00 × 3", pace: "13% · 9.2–9.5 km/h (6:31–6:19/km)", recovery: "3:00 @ 6–7 km/h (10:00–8:34/km) · 경사 0–3%", volume: "질주 21분", note: "3세트 모두 비슷한 심박/자세가 목표" },
    loadNote: "빠른 800m 주간. 목요일은 증가보다 유지가 목적."
  },
  {
    week: 6, focus: "롤러코스터 복합 지구력", tuesdayTitle: "3–2–1–1–2–3km 변속 · 표 원안",
    tuesdayGroups: {
      special: {
        track: {
          label: "TRACK · 특조", work: "3K → 2K → 1K → 1K → 2K → 3K",
          pace: "3K 85초/lap · 2K 83초/lap · 1K 81초/lap",
          lap400: "85초 (3:32.5/km) → 83초 (3:27.5/km) → 81초 (3:22.5/km)",
          recovery: "600m 180초 → 400m 120초 → 200m 60초 → 200m 60초 → 400m 120초", volume: "질주 12km",
          note: "표 원안 그대로."
        },
        treadmill: {
          label: "TREADMILL · 특조", work: "3K → 2K → 1K → 1K → 2K → 3K",
          pace: "16.9 km/h (3:32.5/km) → 17.3 (3:27.5/km) → 17.8 (3:22.5/km) → 역순",
          lap400: "400m 환산 85초 → 83초 → 81초",
          recovery: "600/400/200m 모두 12.0 km/h (5:00/km) 기준", volume: "질주 12km",
          note: "거리 버튼 전환이 번거로우면 각 구간 목표 시간을 계산해 시간 기준으로 수행."
        },
      },
      group1: {
        track: {
          label: "TRACK · 1조", work: "3K → 2K → 1K → 1K → 2K → 3K",
          pace: "3K 90초/lap · 2K 88초/lap · 1K 86초/lap",
          lap400: "90초 (3:45/km) → 88초 (3:40/km) → 86초 (3:35/km)",
          recovery: "600m 180초 → 400m 120초 → 200m 60초 → 200m 60초 → 400m 120초", volume: "질주 12km",
          note: "1조 원안."
        },
        treadmill: {
          label: "TREADMILL · 1조", work: "3K → 2K → 1K → 1K → 2K → 3K",
          pace: "16.0 km/h (3:45/km) → 16.4 (3:40/km) → 16.7 (3:35/km) → 역순",
          lap400: "400m 환산 90초 → 88초 → 86초",
          recovery: "600/400/200m 모두 12.0 km/h (5:00/km) 기준", volume: "질주 12km",
          note: "1조 페이스로 동일 구조."
        },
      },
      group2: {
        track: {
          label: "TRACK · 2조", work: "3K → 2K → 1K → 1K → 2K → 3K",
          pace: "3K 95초/lap · 2K 93초/lap · 1K 91초/lap",
          lap400: "95초 (3:57.5/km) → 93초 (3:52.5/km) → 91초 (3:47.5/km)",
          recovery: "600m 180초 → 400m 120초 → 200m 60초 → 200m 60초 → 400m 120초", volume: "질주 12km",
          note: "2조 원안."
        },
        treadmill: {
          label: "TREADMILL · 2조", work: "3K → 2K → 1K → 1K → 2K → 3K",
          pace: "15.2 km/h (3:57.5/km) → 15.5 (3:52.5/km) → 15.8 (3:47.5/km) → 역순",
          lap400: "400m 환산 95초 → 93초 → 91초",
          recovery: "600/400/200m 모두 12.0 km/h (5:00/km) 기준", volume: "질주 12km",
          note: "2조 페이스로 동일 구조."
        },
      },
    },
    thursdayTitle: "업힐 유지 세션",
    thursdayOutdoor: { label: "OUTDOOR HILL", work: "90초 × 6", pace: "RPE 7.5", recovery: "90초–2:00", volume: "질주 9분", note: "화요일 피로를 풀지 못했으면 생략" },
    thursdayTreadmill: { label: "INCLINE TREADMILL", work: "2:00 × 6", pace: "10% · 12.5–13.0 km/h (4:48–4:37/km)", recovery: "90초 @ 6–7 km/h (10:00–8:34/km) · 경사 3%", volume: "질주 12분", note: "두 번째 강훈련이 아니라 신경계 유지용" },
    loadNote: "가장 큰 화요일. 목요일은 무조건 축소판으로 운영한다."
  },
  {
    week: 7, focus: "3K 반복 / 장거리 속도지구력", tuesdayTitle: "3000m + 600m 회복 · 표 원안",
    tuesdayGroups: {
      special: {
        track: {
          label: "TRACK · 특조", work: "3000m × 5 · 1–4세트 10:45 / 5세트 10:32",
          pace: "1–4세트 86초×7+43초 · 5세트 84초×7+44초",
          lap400: "86초/400m (3:35/km) → 84초/400m (3:30/km)",
          recovery: "600m 180초 (5:00/km) · 5세트 후 회복 없음", volume: "질주 15km · 표 전체 18km",
          note: "원본 특조 5세트."
        },
        treadmill: {
          label: "TREADMILL · 특조", work: "3km × 4 @ 10:45 + 마지막 3km @ 약 10:32",
          pace: "16.7 km/h (3:35/km) → 17.1 km/h (3:30/km)",
          lap400: "400m 환산 86초 → 84초",
          recovery: "180초 @ 12.0 km/h (5:00/km)", volume: "질주 15km",
          note: "마지막 세트의 원문 200m 44초 때문에 총시간은 정확히 10:32."
        },
      },
      group1: {
        track: {
          label: "TRACK · 1조", work: "3000m × 5 · 1–4세트 11:15 / 5세트 11:00",
          pace: "1–4세트 90초×7+45초 · 5세트 88초×7+44초",
          lap400: "90초/400m (3:45/km) → 88초/400m (3:40/km)",
          recovery: "600m 180초 (5:00/km) · 마지막 후 회복 없음", volume: "질주 15km",
          note: "원본 1조 5세트."
        },
        treadmill: {
          label: "TREADMILL · 1조", work: "3km × 4 @ 11:15 + 마지막 3km @ 11:00",
          pace: "16.0 km/h (3:45/km) → 16.4 km/h (3:40/km)",
          lap400: "400m 환산 90초 → 88초",
          recovery: "180초 @ 12.0 km/h (5:00/km)", volume: "질주 15km",
          note: "마지막 한 세트만 상승."
        },
      },
      group2: {
        track: {
          label: "TRACK · 2조", work: "3000m × 5 · 1–4세트 95초/lap / 5세트 93초/lap",
          pace: "1–4세트 약 11:52.5 (3:57.5/km) · 5세트 약 11:37.5 (3:52.5/km)",
          lap400: "95초/400m (3:57.5/km) → 93초/400m (3:52.5/km)",
          recovery: "600m 185초 (5:08/km) · 마지막 후 회복 없음", volume: "질주 15km",
          note: "원본 2조는 1–4세트 95초+600m185초, 5세트 93초+무회복으로 표기."
        },
        treadmill: {
          label: "TREADMILL · 2조", work: "3km × 4 @ 95초/lap + 마지막 3km @ 93초/lap",
          pace: "15.2 km/h (3:57.5/km) → 15.5 km/h (3:52.5/km)",
          lap400: "400m 환산 95초 → 93초",
          recovery: "185초 @ 11.7 km/h (5:08/km)", volume: "질주 15km",
          note: "원본 2조 회복 600m 185초 반영."
        },
      },
    },
    thursdayTitle: "업힐 역치 유지",
    thursdayOutdoor: { label: "OUTDOOR HILL", work: "4:00 × 4–5", pace: "RPE 7.5–8", recovery: "2:00–3:00", volume: "질주 16–20분", note: "주말 롱런 전 과피로 금지" },
    thursdayTreadmill: { label: "INCLINE TREADMILL", work: "4:00 × 5", pace: "12% · 10.5–11.0 km/h (5:43–5:27/km)", recovery: "2:00 @ 6–7 km/h (10:00–8:34/km) · 경사 0–3%", volume: "질주 20분", note: "화요일 전체 5세트를 했다면 목요일은 4세트" },
    loadNote: "3K 반복은 가장 큰 주간 중 하나. 마지막 세트가 무너지면 다음 사이클 속도 상향 금지."
  },
  {
    week: 8, focus: "3K 테스트 / 흡수", tuesdayTitle: "3000m 테스트 · 표 원안",
    tuesdayGroups: {
      special: {
        track: {
          label: "TRACK · 특조", work: "3000m × 1 · 목표 10:00",
          pace: "400m 80초 × 7.5바퀴 = 10:00",
          lap400: "80초/400m (3:20/km)",
          recovery: "없음 · 종료 후 10–15분 easy", volume: "질주 3km",
          note: "첫 1600m를 5:20보다 빠르게 끌고 가지 않기."
        },
        treadmill: {
          label: "TREADMILL · 특조", work: "10:00 연속",
          pace: "18.0 km/h (3:20/km) · 경사 0–1%",
          lap400: "400m 환산 80초",
          recovery: "종료 후 10–15분 @ 8–10 km/h (7:30–6:00/km)", volume: "질주 3km",
          note: "트레드밀 기록과 트랙 TT를 완전히 같은 기록으로 등치하지 않음."
        },
      },
      group1: {
        track: {
          label: "TRACK · 1조", work: "3000m × 1 · 목표 10:37.5",
          pace: "400m 85초 × 7.5바퀴 = 10:37.5",
          lap400: "85초/400m (3:32.5/km)",
          recovery: "없음 · 종료 후 10–15분 easy", volume: "질주 3km",
          note: "1조 표 원안 85초/400m."
        },
        treadmill: {
          label: "TREADMILL · 1조", work: "10:37.5 연속",
          pace: "16.9 km/h (3:32.5/km) · 경사 0–1%",
          lap400: "400m 환산 85초",
          recovery: "종료 후 10–15분 @ 8–10 km/h (7:30–6:00/km)", volume: "질주 3km",
          note: "1조 기준."
        },
      },
      group2: {
        track: {
          label: "TRACK · 2조", work: "3000m × 1 · 목표 11:15",
          pace: "400m 90초 × 7.5바퀴 = 11:15",
          lap400: "90초/400m (3:45/km)",
          recovery: "없음 · 종료 후 10–15분 easy", volume: "질주 3km",
          note: "2조 표 원안 90초/400m."
        },
        treadmill: {
          label: "TREADMILL · 2조", work: "11:15 연속",
          pace: "16.0 km/h (3:45/km) · 경사 0–1%",
          lap400: "400m 환산 90초",
          recovery: "종료 후 10–15분 @ 8–10 km/h (7:30–6:00/km)", volume: "질주 3km",
          note: "2조 기준."
        },
      },
    },
    thursdayTitle: "흡수 / 짧은 업힐",
    thursdayOutdoor: { label: "OUTDOOR HILL", work: "45초 × 6–8", pace: "RPE 7", recovery: "75–90초", volume: "질주 4.5–6분", note: "다리가 무거우면 완전 생략" },
    thursdayTreadmill: { label: "INCLINE TREADMILL", work: "45초 × 8", pace: "10% · 14.0–14.5 km/h (4:17–4:08/km)", recovery: "75초 @ 6–7 km/h (10:00–8:34/km) · 경사 3%", volume: "질주 6분", note: "다음 블록 전 신경계만 깨우는 정도" },
    loadNote: "평가와 회복 주간. 화요일 결과보다 다음 블록을 건강하게 시작하는 게 우선."
  },
];

function eightWeekRotationIndex() {
  const now = new Date();
  const utcDay = Math.floor(now.getTime() / 86400000);
  return Math.floor(utcDay / 7) % 8;
}

function TrainingFormatCard({ spec, tone = "neutral" }: { spec: TrainingFormat; tone?: Tone }) {
  return (
    <div className={`rounded-2xl border p-4 ${toneClasses[tone].border} bg-black/30`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold tracking-[0.16em] text-zinc-500">{spec.label}</div>
        <div className="text-[11px] text-zinc-700">{spec.volume}</div>
      </div>
      <div className="mt-3 text-lg font-semibold leading-7 text-zinc-100">{spec.work}</div>
      <div className="mt-3 grid gap-2 text-sm leading-6">
        {spec.lap400 && <div className="grid grid-cols-[72px_1fr] gap-2"><span className="text-zinc-600">400m 기준</span><span className="font-medium text-zinc-200">{spec.lap400}</span></div>}
        <div className="grid grid-cols-[72px_1fr] gap-2"><span className="text-zinc-600">목표</span><span className="text-zinc-300">{spec.pace}</span></div>
        <div className="grid grid-cols-[72px_1fr] gap-2"><span className="text-zinc-600">회복</span><span className="text-zinc-300">{spec.recovery}</span></div>
      </div>
      {spec.note && <div className="mt-3 border-t border-zinc-900 pt-3 text-xs leading-5 text-zinc-600">{spec.note}</div>}
    </div>
  );
}


const RUNNER_CYCLE_SPRITE = "data:image/webp;base64,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";

function RunnerMotion({ compact = false, label = "RUNNING ENGINE" }: { compact?: boolean; label?: string }) {
  const frameW = compact ? 112 : 160;
  const frameH = compact ? 140 : 200;
  const sheetShift = -(frameW * 9);
  const restShift = -(frameW * 4);

  return (
    <div
      className={`jr-motion ${compact ? "is-compact" : ""} relative overflow-hidden rounded-[28px] border border-zinc-800/80 bg-black ${compact ? "p-3" : "p-4 sm:p-5"}`}
      style={{
        ["--jr-frame-w" as any]: `${frameW}px`,
        ["--jr-frame-h" as any]: `${frameH}px`,
        ["--jr-sheet-shift" as any]: `${sheetShift}px`,
        ["--jr-rest-shift" as any]: `${restShift}px`,
      }}
    >
      <style>{`
        @keyframes jrRunCycle {
          from { transform: translate3d(0,0,0); }
          to { transform: translate3d(var(--jr-sheet-shift),0,0); }
        }
        @keyframes jrRunnerFloat {
          0%, 100% { transform: translate3d(0,0,0); }
          24% { transform: translate3d(2px,-2px,0); }
          52% { transform: translate3d(0,1px,0); }
          76% { transform: translate3d(-2px,-3px,0); }
        }
        @keyframes jrGroundMove {
          from { background-position-x: 0; }
          to { background-position-x: -96px; }
        }
        @keyframes jrTrailMove {
          0% { transform: translateX(-22%); opacity: 0; }
          18% { opacity: .48; }
          72% { opacity: .16; }
          100% { transform: translateX(118%); opacity: 0; }
        }
        @keyframes jrBreath {
          0%,100% { opacity: .35; }
          50% { opacity: .95; }
        }
        .jr-motion .jr-cycle-viewport {
          width: var(--jr-frame-w);
          height: var(--jr-frame-h);
          overflow: hidden;
          flex: 0 0 auto;
          filter: drop-shadow(0 0 12px rgba(255,255,255,.035));
          animation: jrRunnerFloat .74s steps(9,end) infinite;
        }
        .jr-motion .jr-cycle-strip {
          display: block;
          height: var(--jr-frame-h);
          width: auto;
          max-width: none;
          user-select: none;
          pointer-events: none;
          animation: jrRunCycle .74s steps(9,end) infinite;
          will-change: transform;
        }
        .jr-motion .jr-ground {
          background-image: repeating-linear-gradient(90deg, rgba(161,161,170,.08) 0 22px, transparent 22px 48px);
          animation: jrGroundMove .55s linear infinite;
        }
        .jr-motion .jr-trail { animation: jrTrailMove 2.2s ease-in-out infinite; }
        .jr-motion .jr-live-dot { animation: jrBreath 1.55s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .jr-motion .jr-cycle-viewport,
          .jr-motion .jr-ground,
          .jr-motion .jr-trail,
          .jr-motion .jr-live-dot { animation: none !important; }
          .jr-motion .jr-cycle-strip { animation: none !important; transform: translate3d(var(--jr-rest-shift),0,0); }
        }
      `}</style>

      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(circle at 52% 46%, rgba(255,255,255,.055), transparent 27%), radial-gradient(circle at 70% 46%, rgba(34,211,238,.045), transparent 30%)" }} />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-black via-black/70 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-1/3 bg-gradient-to-l from-black via-black/70 to-transparent" />

      <div className="relative flex items-center justify-between gap-4 px-1 pb-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-500">{label}</div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-zinc-700">
          <span className="jr-live-dot h-1.5 w-1.5 rounded-full bg-zinc-300" />9-frame run cycle
        </div>
      </div>

      <div className={`relative ${compact ? "h-[146px]" : "h-[210px]"} overflow-hidden`}>
        <div className="jr-trail pointer-events-none absolute left-[4%] right-[4%] top-[42%] h-px bg-gradient-to-r from-transparent via-zinc-400/25 to-transparent" />
        <div className="jr-trail pointer-events-none absolute left-[10%] right-[12%] top-[55%] h-[2px] bg-gradient-to-r from-transparent via-zinc-300/15 to-transparent" style={{ animationDelay: "-.9s" }} />
        <div className="jr-trail pointer-events-none absolute left-[18%] right-[2%] top-[66%] h-px bg-gradient-to-r from-transparent via-cyan-300/10 to-transparent" style={{ animationDelay: "-1.45s" }} />

        <div className="absolute inset-0 flex items-center justify-center">
          <div className="jr-cycle-viewport" aria-label="한 명의 러너가 실제 러닝 동작 9프레임을 반복하는 애니메이션">
            <img className="jr-cycle-strip" src={RUNNER_CYCLE_SPRITE} alt="달리기 동작의 연속 프레임" draggable={false} />
          </div>
        </div>

        <div className="jr-ground pointer-events-none absolute bottom-2 left-[12%] right-[12%] h-px opacity-80" />
        {!compact && (
          <div className="pointer-events-none absolute bottom-4 left-4 right-4 flex items-end justify-between text-[9px] uppercase tracking-[0.22em] text-zinc-800">
            <span>contact</span><span>flight</span><span>drive</span>
          </div>
        )}
      </div>
    </div>
  );
}

function RecentSessionsChart({ sessions }: { sessions: JsonRecord[] }) {
  const data = sessions.slice(0, 7).reverse();
  const maxDist = Math.max(1, ...data.map((s) => safeNumber(s.distance_km) ?? 0));
  return (
    <div className="rounded-[28px] border border-zinc-800 bg-zinc-950/70 p-5 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <div><div className="text-sm text-zinc-500">최근 세션</div><h3 className="mt-1 text-xl font-semibold">달린 흐름</h3></div>
        <Icon name="trend" className="h-5 w-5 text-zinc-600" />
      </div>
      <div className="mt-6 flex h-36 items-end gap-2 sm:gap-3">
        {data.map((s, i) => {
          const dist = safeNumber(s.distance_km) ?? 0;
          const h = clamp((dist / maxDist) * 100, dist > 0 ? 8 : 2, 100);
          const hard = (safeNumber(s.rpe) ?? 0) >= 6 || (safeNumber(s.training_load) ?? 0) >= 80;
          return (
            <div key={`${s.date}-${i}`} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
              <div className={`w-full max-w-10 rounded-t-lg ${hard ? "bg-amber-500/70" : "bg-cyan-500/65"}`} style={{ height: `${h}%` }} title={`${dist} km`} />
              <div className="w-full truncate text-center text-[10px] text-zinc-600">{prettyDate(s.date, false)}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex gap-4 text-[11px] text-zinc-500"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-cyan-500/70" />일반 세션</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500/70" />강한 세션</span></div>
    </div>
  );
}

export default function Home() {
  const [report, setReport] = useState<ReportRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [raceMode, setRaceMode] = useState<RaceMode>("overall");
  const [trainingGroup, setTrainingGroup] = useState<TrainingGroup>("special");
  const [peakRows, setPeakRows] = useState<PeakHistoryRow[]>([]);
  const [peakLoading, setPeakLoading] = useState(false);
  const [utmb, setUtmb] = useState<UtmbSnapshot | null>(null);
  const [utmbLoading, setUtmbLoading] = useState(false);
  const [recoveryExpanded, setRecoveryExpanded] = useState(false);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      setError("GitHub Actions에 Supabase 공개용 환경변수가 설정되지 않았습니다.");
      setLoading(false);
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    let cancelled = false;

    async function load() {
      const { data, error: queryError } = await supabase
        .from("coach_reports")
        .select("id, report_date, report_type, input_context, output, model_used, created_at")
        .eq("report_type", "daily")
        .order("report_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      if (queryError || !data) {
        setError(queryError?.message ?? "Supabase에 daily coach report가 없거나 공개 읽기 정책이 없습니다.");
      } else {
        setReport(data as ReportRow);
      }
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) return;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    let cancelled = false;

    async function loadPeakHistory() {
      setPeakLoading(true);
      const { data, error: peakError } = await supabase
        .from("peak_history")
        .select("metric_date,race_mode,overall_score,recovery_score,aerobic_score,speed_score,climbing_score,durability_score,training_state_score")
        .eq("race_mode", raceMode)
        .order("metric_date", { ascending: true })
        .limit(5000);

      if (cancelled) return;
      if (peakError || !Array.isArray(data)) setPeakRows([]);
      else setPeakRows(data as PeakHistoryRow[]);
      setPeakLoading(false);
    }

    loadPeakHistory();
    return () => { cancelled = true; };
  }, [raceMode]);

  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) return;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    let cancelled = false;

    async function loadUtmb() {
      setUtmbLoading(true);
      const { data, error: utmbError } = await supabase
        .from("utmb_snapshots")
        .select("snapshot_date,captured_at,runner_name,age_group,overall_index,index_20k,index_50k,index_100k,index_100m,best_score,finished_races,top10,korea_men_rank_est,korea_men_rank_low,korea_men_rank_high,korea_age_rank_est,korea_age_rank_low,korea_age_rank_high,rank_status,rank_sample_size,profile_url")
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      if (!utmbError && data) setUtmb(data as UtmbSnapshot);
      else setUtmb(null);
      setUtmbLoading(false);
    }

    loadUtmb();
    return () => { cancelled = true; };
  }, []);

  const view = useMemo(() => {
    if (!report) return null;

    const d = (report.input_context ?? {}) as JsonRecord;
    const r = d.recovery ?? {};
    const v = d.training_volume ?? {};
    const load = d.load ?? {};
    const ae = d.aerobic_efficiency ?? {};
    const lr = d.long_run ?? {};
    const ia = d.interval_analysis ?? {};
    const sessions: JsonRecord[] = Array.isArray(d.recent_sessions) ? d.recent_sessions : [];
    const warnings: string[] = Array.isArray(d.warnings) ? d.warnings : [];

    const rawCoach = (report.output ?? {}) as JsonRecord;
    const coaching = rawCoach && typeof rawCoach === "object"
      ? rawCoach.coaching && typeof rawCoach.coaching === "object"
        ? (rawCoach.coaching as JsonRecord)
        : rawCoach
      : null;

    const recommendation = coaching
      ? (coaching.today_recommendation ?? coaching.today_workout ?? coaching.recommended_session ?? null)
      : null;
    const recoveryText = coaching ? (coaching.recovery_today ?? coaching.recovery_assessment ?? "") : "";
    const planB = coaching ? (coaching.plan_b ?? coaching.planB ?? "") : "";
    const avoidToday = coaching && Array.isArray(coaching.avoid_today) ? coaching.avoid_today : [];
    const next3 = coaching
      ? (coaching.next_3_days_plan ?? coaching.next_3_days ?? coaching.three_day_plan ?? coaching.next_three_days ?? [])
      : [];

    const hrvDev = safeNumber(r.hrv_deviation_pct);
    const rhrDev = safeNumber(r.resting_hr_deviation_pct);
    const sleep = safeNumber(r.latest_sleep_hours);
    const atl = safeNumber(r.latest_atl);
    const ctl = safeNumber(r.latest_ctl);

    const hrvTone: Tone = hrvDev === null ? "neutral" : hrvDev >= 5 ? "good" : hrvDev <= -8 ? "warn" : "neutral";
    const rhrTone: Tone = rhrDev === null ? "neutral" : rhrDev <= -2 ? "good" : rhrDev >= 5 ? "warn" : "neutral";
    const sleepTone: Tone = sleep === null ? "neutral" : sleep >= 7.5 ? "good" : sleep < 6.5 ? "warn" : "neutral";
    const loadRatio = atl !== null && ctl && ctl > 0 ? atl / ctl : null;
    const loadTone: Tone = loadRatio === null ? "neutral" : loadRatio > 1.25 ? "warn" : loadRatio < 0.9 ? "good" : "neutral";

    const tones: Tone[] = [hrvTone, rhrTone, sleepTone, loadTone];
    const warningCount = tones.filter((t) => t === "warn").length;
    const goodCount = tones.filter((t) => t === "good").length;
    const overallTone: Tone = warningCount >= 2 ? "warn" : warningCount === 0 && goodCount >= 3 ? "good" : "neutral";
    const overallLabel = overallTone === "good" ? "좋음" : overallTone === "warn" ? "주의" : "보통";
    const ringValue = overallTone === "good" ? 84 : overallTone === "warn" ? 42 : 64;

    const signals: Signal[] = [
      { label: "회복 신호", value: hrvDev === null ? "—" : `${hrvDev >= 0 ? "+" : ""}${n(hrvDev, 1)}%`, detail: `HRV ${fmt(r.latest_hrv)} · 평소 ${fmt(r.hrv_baseline_28d)}`, tone: hrvTone },
      { label: "수면", value: sleep === null ? "—" : `${n(sleep, 1)}시간`, detail: `점수 ${fmt(r.latest_sleep_score)} · 7일 평균 ${fmt(r.sleep_7d_avg_hours)}h`, tone: sleepTone },
      { label: "단기 피로", value: atl === null ? "—" : n(atl, 1), detail: `체력 베이스 ${ctl === null ? "—" : n(ctl, 1)}`, tone: loadTone },
    ];

    const preferredCoachKeys = ["recovery_today", "recovery_assessment", "recent_load_interpretation", "recent_key_workout_review", "today_recommendation", "today_workout", "recommended_session", "plan_b", "planB", "avoid_today", "next_3_days_plan", "next_3_days", "three_day_plan", "next_three_days", "low_confidence_areas"];
    const coachEntries: [string, unknown][] = coaching
      ? [...preferredCoachKeys.filter((k) => Object.prototype.hasOwnProperty.call(coaching, k)).map((k) => [k, coaching[k]] as [string, unknown]), ...Object.entries(coaching).filter(([k]) => !preferredCoachKeys.includes(k))]
      : [];

    const dist7 = safeNumber(v.distance_7d_km);
    const dist28 = safeNumber(v.distance_28d_km);
    const elev7 = safeNumber(v.elevation_7d_m);
    const elev28 = safeNumber(v.elevation_28d_m);
    const load7 = safeNumber(load.training_load_7d);
    const load28 = safeNumber(load.training_load_28d);

    return {
      d, r, v, load, ae, lr, ia, sessions, warnings, coaching, recommendation, recoveryText, planB, avoidToday, next3,
      hrvTone, rhrTone, sleepTone, loadTone, overallTone, overallLabel, ringValue, signals, coachEntries,
      dist7, distWeeklyAvg: dist28 === null ? null : dist28 / 4,
      elev7, elevWeeklyAvg: elev28 === null ? null : elev28 / 4,
      load7, loadWeeklyAvg: load28 === null ? null : load28 / 4,
    };
  }, [report]);

  if (loading) {
    return <Shell><div className="mx-auto max-w-3xl pt-16"><RunnerMotion compact label="SYNCING RUNNING DATA" /><p className="mt-5 text-center text-sm text-zinc-500">최신 러닝 데이터를 불러오는 중...</p></div></Shell>;
  }

  if (error || !report || !view) {
    return (
      <Shell><div className="mx-auto max-w-3xl pt-16"><p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Running Analytics</p><h1 className="mt-3 text-4xl font-bold tracking-tight">JACKSON RUNNING ENGINE</h1><div className="mt-8 rounded-2xl border border-red-900 bg-red-950/30 p-6"><h2 className="font-semibold text-red-300">데이터를 불러오지 못했습니다.</h2><p className="mt-3 break-words text-sm leading-6 text-red-200">{error}</p></div></div></Shell>
    );
  }

  const {
    d, r, v, load, ae, lr, ia, sessions, warnings, recommendation, recoveryText, planB, avoidToday, next3,
    hrvTone, rhrTone, sleepTone, loadTone, overallTone, overallLabel, ringValue, signals, coachEntries,
    dist7, distWeeklyAvg, elev7, elevWeeklyAvg, load7, loadWeeklyAvg,
  } = view;

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "한눈에" },
    { id: "simple", label: "쉽게 보기" },
    { id: "quality", label: "훈련" },
    { id: "peak", label: "PEAK" },
    { id: "detail", label: "상세" },
    { id: "coach", label: "코치" },
  ];

  const onSwipeStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    swipeStart.current = { x: t.clientX, y: t.clientY };
  };

  const onSwipeEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || !e.changedTouches[0]) return;
    const end = e.changedTouches[0];
    const dx = end.clientX - start.x;
    const dy = end.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.15) return;
    const index = tabs.findIndex((item) => item.id === tab);
    if (dx < 0 && index < tabs.length - 1) setTab(tabs[index + 1].id);
    if (dx > 0 && index > 0) setTab(tabs[index - 1].id);
  };

  return (
    <Shell>
      <header className="flex flex-col gap-5 border-b border-zinc-800/80 pb-5 sm:pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.28em] text-zinc-500"><span className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_14px_rgba(34,211,238,.7)]" />Running Intelligence</div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">JACKSON RUNNING</h1>
        </div>
        <div className="text-xs text-zinc-600">Updated {prettyDate(d.generated_at_local ?? d.generated_at ?? report.created_at)}</div>
      </header>

      <nav className="sticky top-0 z-20 -mx-4 mt-4 border-b border-zinc-900 bg-[#050505]/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto rounded-2xl bg-zinc-950 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((item) => (
            <button key={item.id} onClick={() => setTab(item.id)} className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-medium transition sm:flex-1 ${tab === item.id ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}>{item.label}</button>
          ))}
        </div>
      </nav>

      <div onTouchStart={onSwipeStart} onTouchEnd={onSwipeEnd} className="touch-pan-y">
      {tab === "overview" && (
        <div className="mt-6 space-y-5 sm:mt-8">
          <RunnerMotion label="JACKSON RUNNING ENGINE · LIVE" />
          <section className="grid gap-4 lg:grid-cols-[0.85fr_1.55fr]">
            <div className={`relative overflow-hidden rounded-[30px] border p-6 sm:p-7 ${toneClasses[overallTone].border} ${toneClasses[overallTone].bg}`}>
              <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/5 blur-3xl" />
              <div className="relative flex items-center justify-between gap-6">
                <div>
                  <div className="text-sm text-zinc-500">오늘 몸 상태</div>
                  <div className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">{overallLabel}</div>
                  <div className="mt-3"><Pill tone={overallTone}>{overallTone === "good" ? "강한 훈련도 검토 가능" : overallTone === "warn" ? "회복 우선" : "무리 없이 진행"}</Pill></div>
                </div>
                <div className="relative grid h-28 w-28 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${overallTone === "good" ? "#34d399" : overallTone === "warn" ? "#f59e0b" : "#38bdf8"} ${ringValue * 3.6}deg, #27272a 0deg)` }}>
                  <div className="grid h-[88px] w-[88px] place-items-center rounded-full bg-[#080808]"><div className="text-center"><div className="text-2xl font-bold">{ringValue}</div><div className="text-[10px] text-zinc-600">READINESS</div></div></div>
                </div>
              </div>
              {recoveryText && (
                <div className="relative mt-6">
                  <button
                    type="button"
                    onClick={() => setRecoveryExpanded((v) => !v)}
                    className="block w-full text-left"
                    aria-expanded={recoveryExpanded}
                  >
                    <p className={`${recoveryExpanded ? "" : "line-clamp-4"} whitespace-pre-wrap break-words text-sm leading-7 text-zinc-400`}>
                      {String(recoveryText)}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecoveryExpanded((v) => !v)}
                    className="mt-2 rounded-lg px-1 py-1 text-xs font-medium text-cyan-300 transition hover:text-cyan-200"
                    aria-expanded={recoveryExpanded}
                  >
                    {recoveryExpanded ? "접기 ▲" : "전체 보기 ▼"}
                  </button>
                </div>
              )}
            </div>
            <WorkoutCard recommendation={recommendation as JsonRecord | null} />
          </section>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {signals.map((s) => <MiniMetric key={s.label} icon={s.label === "회복 신호" ? "heart" : s.label === "수면" ? "moon" : "bolt"} label={s.label} value={s.value} detail={s.detail} tone={s.tone} />)}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <ComparisonRow label="주간 거리" current={dist7} baseline={distWeeklyAvg} unit="km" icon="shoe" />
              <ComparisonRow label="주간 상승고도" current={elev7} baseline={elevWeeklyAvg} unit="m" icon="mountain" />
              <ComparisonRow label="주간 훈련 부하" current={load7} baseline={loadWeeklyAvg} unit="" icon="bolt" />
            </div>
            <RecentSessionsChart sessions={sessions} />
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5"><div className="text-sm text-zinc-500">편한 달리기 효율</div><div className="mt-2 text-3xl font-semibold">{fmt(ae.easy_efficiency_vs_baseline_pct, "%")}</div><div className="mt-2 text-xs leading-5 text-zinc-600">최근 easy run이 평소보다 얼마나 효율적인지</div></div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5"><div className="text-sm text-zinc-500">롱런 후반 저하</div><div className="mt-2 text-3xl font-semibold">{fmt(lr.latest_durability_decline_pct, "%")}</div><div className="mt-2 text-xs leading-5 text-zinc-600">낮을수록 후반까지 페이스/효율 유지가 좋음</div></div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5"><div className="text-sm text-zinc-500">최근 반복주</div><div className="mt-2 text-3xl font-semibold">{ia.status === "ok" ? `${fmt(ia.rep_count)}회` : "—"}</div><div className="mt-2 text-xs leading-5 text-zinc-600">{fmt(ia.median_group_distance_m)}m · 편차 {fmt(ia.pace_coefficient_of_variation_pct, "%")}</div></div>
          </section>
        </div>
      )}

      {tab === "simple" && (
        <div className="mt-6 space-y-5 sm:mt-8">
          <section className="rounded-[30px] border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950 p-6 sm:p-8">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-400"><Icon name="spark" className="h-4 w-4 text-cyan-300" />오늘의 쉬운 요약</div>
            <h2 className="mt-4 max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
              {overallTone === "good" ? "몸 상태는 좋다. 오늘 계획한 훈련을 해도 괜찮다." : overallTone === "warn" ? "오늘은 기록 욕심보다 회복이 먼저다." : "몸 상태는 무난하다. 예정된 훈련을 과하게만 하지 말자."}
            </h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-zinc-400">숫자를 몰라도 오늘 무엇을 할지 바로 판단할 수 있게 정리한 화면이야.</p>
          </section>

          <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className="space-y-3">
              <h3 className="px-1 text-sm font-semibold text-zinc-300">왜 이렇게 판단했냐면</h3>
              <SimpleBullet tone={hrvTone} title={hrvTone === "good" ? "회복 신호가 좋음" : hrvTone === "warn" ? "회복 신호가 평소보다 낮음" : "회복 신호는 평소 수준"} detail={`HRV가 ${fmt(r.latest_hrv)}ms이고 최근 28일 기준 대비 ${fmt(r.hrv_deviation_pct, "%")}야.`} />
              <SimpleBullet tone={sleepTone} title={sleepTone === "good" ? "잠은 충분히 잤음" : sleepTone === "warn" ? "수면이 부족함" : "수면은 무난함"} detail={`최근 수면 ${fmt(r.latest_sleep_hours)}시간, 수면 점수 ${fmt(r.latest_sleep_score)}.`} />
              <SimpleBullet tone={loadTone} title={loadTone === "warn" ? "최근 피로가 많이 쌓임" : loadTone === "good" ? "최근 피로가 많이 쌓인 상태는 아님" : "피로와 체력의 균형은 보통"} detail={`단기 피로(ATL) ${n(r.latest_atl, 1)}, 체력 베이스(CTL) ${n(r.latest_ctl, 1)}.`} />
            </div>
            <WorkoutCard recommendation={recommendation as JsonRecord | null} />
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[26px] border border-zinc-800 bg-zinc-950/70 p-5 sm:p-6">
              <div className="flex items-center gap-2 text-sm font-semibold"><Icon name="warning" className="h-4 w-4 text-amber-300" />오늘 피하면 좋은 것</div>
              <div className="mt-4 space-y-2">
                {avoidToday.length ? avoidToday.map((item: unknown, i: number) => <div key={i} className="rounded-xl bg-zinc-900/70 px-4 py-3 text-sm leading-6 text-zinc-300">{String(item)}</div>) : <div className="text-sm text-zinc-500">특별히 피해야 할 훈련이 표시되지 않았어.</div>}
              </div>
            </div>
            <div className="rounded-[26px] border border-zinc-800 bg-zinc-950/70 p-5 sm:p-6">
              <div className="flex items-center gap-2 text-sm font-semibold"><Icon name="target" className="h-4 w-4 text-sky-300" />Plan B</div>
              <p className="mt-4 text-sm leading-7 text-zinc-400">{planB ? String(planB) : "몸이 예상보다 무거우면 거리와 강도를 줄이고 회복 러닝으로 전환."}</p>
            </div>
          </section>

          {Array.isArray(next3) && next3.length > 0 && (
            <section className="rounded-[26px] border border-zinc-800 bg-zinc-950/70 p-5 sm:p-6">
              <div className="text-sm font-semibold">앞으로 3일</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {next3.slice(0, 3).map((item: any, i: number) => <div key={i} className="rounded-2xl bg-zinc-900/70 p-4"><div className="text-xs text-zinc-500">D+{item.day_offset ?? i + 1}</div><div className="mt-2 text-sm leading-6 text-zinc-300">{item.summary ?? renderPrimitive(item)}</div></div>)}
              </div>
            </section>
          )}

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MiniMetric icon="heart" label="HRV = 회복 신호" value={`${fmt(r.latest_hrv)} ms`} detail="평소보다 높으면 대체로 회복이 잘 된 신호" tone={hrvTone} />
            <MiniMetric icon="heart" label="안정 심박" value={`${fmt(r.latest_resting_hr)} bpm`} detail="내 평소보다 높아지면 피로/스트레스 신호일 수 있음" tone={rhrTone} />
            <MiniMetric icon="bolt" label="ATL = 단기 피로" value={n(r.latest_atl, 1)} detail="최근 며칠의 훈련 피로가 얼마나 쌓였는지" tone={loadTone} />
            <MiniMetric icon="trend" label="CTL = 체력 베이스" value={n(r.latest_ctl, 1)} detail="최근 몇 주간 쌓인 훈련 기반을 보여주는 값" tone="neutral" />
          </section>
        </div>
      )}


      {tab === "quality" && (() => {
        const latestPeak = peakRows.length ? peakRows[peakRows.length - 1] : null;
        const speedScore = safeNumber(latestPeak?.speed_score);
        const climbScore = safeNumber(latestPeak?.climbing_score);
        const hrvDev = safeNumber(r.hrv_deviation_pct);
        const sleepHours = safeNumber(r.latest_sleep_hours);
        const atl = safeNumber(r.latest_atl);
        const ctl = safeNumber(r.latest_ctl);
        const loadRatio = atl !== null && ctl !== null && ctl > 0 ? atl / ctl : null;
        const hardStop = overallTone === "warn" || (hrvDev !== null && hrvDev <= -10) || (sleepHours !== null && sleepHours < 6) || (loadRatio !== null && loadRatio > 1.35);
        const cautious = !hardStop && ((hrvDev !== null && hrvDev < -4) || (loadRatio !== null && loadRatio > 1.15));
        const currentWeekIndex = eightWeekRotationIndex();
        const plan = detailedTrainingCycle[currentWeekIndex];
        const tuesdayVariant = plan.tuesdayGroups[trainingGroup];
        const tueTone: Tone = hardStop ? "warn" : cautious ? "neutral" : "good";
        const thuTone: Tone = hardStop ? "warn" : cautious || overallTone !== "good" ? "neutral" : "good";
        const executionLabel = hardStop ? "HOLD" : cautious ? "75% VOLUME" : "FULL";
        const executionText = hardStop
          ? "품질훈련은 보류. 30–50분 이지런 또는 휴식으로 교체."
          : cautious
          ? "목표 속도는 유지하되 마지막 1–2세트 또는 총 질주량 20–25%를 삭제."
          : "표시된 기본 세트 수를 수행. 마지막 세트까지 폼이 유지될 때만 추가 세트 허용.";
        const modeModifier: Record<RaceMode, string> = {
          overall: "기본안 그대로. 화요일과 목요일의 균형을 우선.",
          "10k": "화요일 빠른 반복을 우선하고 목요일은 1세트 줄여도 됨.",
          half: "2K·3K·NSM 주간을 우선. 400m 주간은 총량보다 리듬 확인.",
          marathon: "NSM·2K·3K 주간을 우선하고 짧은 400/800은 과속하지 않기.",
          trail50: "목요일 업힐을 핵심으로 유지하고 화요일 세트는 80–90%로 줄여도 됨.",
          trail100: "화요일은 70–80% 볼륨, 목요일도 RPE 8을 넘기지 않고 주말 롱런 여유 확보.",
        };

        return (
          <div className="mt-6 space-y-5 sm:mt-8">
            <RunnerMotion compact label="QUALITY SESSION · TUE / THU" />
            <section className="relative overflow-hidden rounded-[32px] border border-violet-900/40 bg-gradient-to-br from-violet-950/30 via-zinc-950 to-black p-6 sm:p-8">
              <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-violet-400/10 blur-3xl" />
              <div className="relative">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-zinc-500"><span className="h-2 w-2 rounded-full bg-violet-300" />8-Week Quality Cycle</div>
                  <Pill tone={tueTone}>{executionLabel}</Pill>
                </div>
                <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">화요일 평지 + 목요일 업힐, 수치까지 한 화면에.</h2>
                <p className="mt-3 max-w-4xl text-sm leading-7 text-zinc-400">보낸 인터벌 표를 특조·1조·2조까지 모두 넣었어. 당일 컨디션이나 같이 뛰는 사람에 맞춰 조를 바꾸면 트랙 랩타임과 트레드밀 속도가 동시에 바뀌고, 모든 속도 옆에 km당 페이스를 같이 표시해.</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {(Object.keys(raceModeLabels) as RaceMode[]).map((mode) => <button key={mode} onClick={() => setRaceMode(mode)} className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${raceMode === mode ? "border-violet-500/70 bg-violet-950/70 text-violet-200" : "border-zinc-800 bg-black/30 text-zinc-500 hover:text-zinc-300"}`}>{raceModeLabels[mode]}</button>)}
                </div>
                <div className="mt-5 rounded-2xl border border-cyan-900/50 bg-cyan-950/10 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-cyan-500">훈련조 선택</div>
                      <div className="mt-1 text-sm text-zinc-400">그날 상태나 동행 러너에 따라 바로 바꿔도 돼.</div>
                    </div>
                    <div className="flex gap-2">
                      {(Object.keys(trainingGroupLabels) as TrainingGroup[]).map((group) => (
                        <button key={group} onClick={() => setTrainingGroup(group)} className={`min-w-[64px] rounded-full border px-4 py-2 text-sm font-semibold transition ${trainingGroup === group ? "border-cyan-400/70 bg-cyan-950/80 text-cyan-200" : "border-zinc-800 bg-black/30 text-zinc-500 hover:text-zinc-300"}`}>
                          {trainingGroupLabels[group]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3 text-xs leading-5 text-zinc-600">현재 선택 · <span className="font-semibold text-cyan-300">{trainingGroupLabels[trainingGroup]}</span> · NSM 주간은 개인 기준 공통, 나머지 표 기반 세션은 선택한 조가 적용돼.</div>
                </div>
                <div className="mt-5 rounded-2xl border border-zinc-800 bg-black/25 p-4 text-sm leading-6 text-zinc-400"><span className="font-semibold text-zinc-200">{raceModeLabels[raceMode]} 보정 · </span>{modeModifier[raceMode]}</div>
              </div>
            </section>

            <section className="rounded-[30px] border border-zinc-800 bg-zinc-950/70 p-5 sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-violet-300">WEEK {plan.week} · {plan.focus} · {trainingGroupLabels[trainingGroup]}</div>
                  <h3 className="mt-2 text-2xl font-semibold">이번 주 상세 스케줄</h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-500">{executionText}</p>
                </div>
                <div className="text-right text-xs leading-5 text-zinc-600">스피드 Peak {speedScore === null ? "—" : `${n(speedScore,0)}%`}<br />오르막 Peak {climbScore === null ? "—" : `${n(climbScore,0)}%`}</div>
              </div>

              <div className="mt-6 rounded-[26px] border border-cyan-900/40 bg-cyan-950/10 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div><div className="text-xs uppercase tracking-[0.18em] text-cyan-400">{nextWeekdayLabel(2)} · TUESDAY</div><h4 className="mt-1 text-xl font-semibold">{plan.tuesdayTitle}</h4></div>
                  <Pill tone={tueTone}>{hardStop ? "HOLD" : cautious ? "세트 감량" : "GO"}</Pill>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <TrainingFormatCard spec={tuesdayVariant.track} tone={tueTone} />
                  <TrainingFormatCard spec={tuesdayVariant.treadmill} tone={tueTone} />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3 text-sm leading-6">
                  <div className="rounded-2xl bg-black/30 p-4"><div className="text-xs text-zinc-600">워밍업</div><div className="mt-1 text-zinc-300">15–20분 easy + 러닝드릴 + 20초 스트라이드 4회</div></div>
                  <div className="rounded-2xl bg-black/30 p-4"><div className="text-xs text-zinc-600">종료 기준</div><div className="mt-1 text-zinc-300">폼 붕괴 · 목표 대비 3% 이상 저하 · 비정상 어지럼이면 즉시 종료</div></div>
                  <div className="rounded-2xl bg-black/30 p-4"><div className="text-xs text-zinc-600">쿨다운</div><div className="mt-1 text-zinc-300">10–15분 easy. 다음날은 완전 easy 또는 휴식</div></div>
                </div>
              </div>

              <div className="mt-4 rounded-[26px] border border-amber-900/40 bg-amber-950/10 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div><div className="text-xs uppercase tracking-[0.18em] text-amber-400">{nextWeekdayLabel(4)} · THURSDAY</div><h4 className="mt-1 text-xl font-semibold">{plan.thursdayTitle}</h4></div>
                  <Pill tone={thuTone}>{hardStop ? "HOLD" : cautious ? "조건부" : "GO"}</Pill>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <TrainingFormatCard spec={plan.thursdayOutdoor} tone={thuTone} />
                  <TrainingFormatCard spec={plan.thursdayTreadmill} tone={thuTone} />
                </div>
                <div className="mt-4 rounded-2xl bg-black/30 p-4 text-sm leading-6 text-zinc-400"><span className="font-semibold text-zinc-200">목요일 원칙 · </span>화요일 이후 48시간 회복이 밀리면 세트 수를 줄이거나 생략. 목요일을 금요일/주말로 미뤄서 억지로 채우지 않는다.</div>
              </div>

              <div className="mt-4 rounded-2xl border border-zinc-800 bg-black/20 p-4 text-sm leading-6 text-zinc-500"><span className="font-semibold text-zinc-300">이번 주 부하 메모 · </span>{plan.loadNote}</div>
            </section>

            <section className="rounded-[28px] border border-zinc-800 bg-zinc-950/70 p-5 sm:p-6">
              <div className="flex items-center justify-between gap-4"><div><div className="text-sm text-zinc-500">8주 전체 보기 · {trainingGroupLabels[trainingGroup]}</div><h3 className="mt-1 text-xl font-semibold">인터벌 표 + NSM 로테이션</h3></div><Icon name="clock" className="h-5 w-5 text-zinc-600" /></div>
              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                {detailedTrainingCycle.map((w, i) => (
                  <div key={w.week} className={`rounded-2xl border p-4 ${i === currentWeekIndex ? "border-violet-600/60 bg-violet-950/20" : "border-zinc-900 bg-black/25"}`}>
                    <div className="flex items-center justify-between gap-3"><div className="text-xs font-semibold tracking-[0.16em] text-zinc-500">WEEK {w.week}</div>{i === currentWeekIndex && <Pill tone="neutral">CURRENT</Pill>}</div>
                    <div className="mt-2 font-semibold text-zinc-200">{w.focus}</div>
                    <div className="mt-3 grid gap-2 text-sm leading-6">
                      <div className="grid grid-cols-[34px_1fr] gap-2"><span className="text-cyan-400">화</span><span className="text-zinc-400">{w.tuesdayGroups[trainingGroup].track.work} · {w.tuesdayGroups[trainingGroup].track.lap400 ?? w.tuesdayGroups[trainingGroup].track.pace}</span></div>
                      <div className="grid grid-cols-[34px_1fr] gap-2"><span className="text-amber-400">목</span><span className="text-zinc-400">{w.thursdayTreadmill.work} · {w.thursdayTreadmill.pace}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[28px] border border-zinc-800 bg-zinc-950/70 p-5 sm:p-6">
              <div className="text-sm text-zinc-500">컨디션 자동 조정</div>
              <h3 className="mt-1 text-xl font-semibold">페이스보다 볼륨을 먼저 조절</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <SimpleBullet tone="good" title="GO · FULL" detail="HRV·수면·ATL/CTL이 정상 범위면 기본 세트 수행. 추가 세트는 마지막까지 폼이 좋을 때만." />
                <SimpleBullet tone="neutral" title="CAUTION · 75%" detail="목표 속도는 유지하고 마지막 1–2세트 삭제. 목요일은 추가로 1세트 더 감량 가능." />
                <SimpleBullet tone="warn" title="HOLD" detail="HRV 급락, 수면 6시간 미만, ATL/CTL 과도 또는 어지럼이 있으면 강도 취소." />
              </div>
              <div className="mt-4 text-xs leading-5 text-zinc-600">현재: HRV {fmt(r.latest_hrv)} · HRV 편차 {fmt(r.hrv_deviation_pct, "%")} · 수면 {fmt(r.latest_sleep_hours)}h · ATL/CTL {n(r.latest_atl,1)}/{n(r.latest_ctl,1)}</div>
            </section>

            <div className="text-center text-xs text-zinc-700 sm:hidden">← 화면을 좌우로 스와이프하면 탭이 넘어가 →</div>
          </div>
        );
      })()}


      {tab === "peak" && (() => {
        const latestPeak = peakRows.length ? peakRows[peakRows.length - 1] : null;
        const bestPeak = peakRows.length ? peakRows.reduce((best, row) => (safeNumber(row.overall_score) ?? -1) > (safeNumber(best.overall_score) ?? -1) ? row : best, peakRows[0]) : null;
        const currentOverall = safeNumber(latestPeak?.overall_score);
        const bestOverall = safeNumber(bestPeak?.overall_score);
        const match = currentOverall !== null && bestOverall && bestOverall > 0 ? currentOverall / bestOverall * 100 : null;
        const currentAxes = [
          safeNumber(latestPeak?.recovery_score), safeNumber(latestPeak?.aerobic_score), safeNumber(latestPeak?.speed_score),
          safeNumber(latestPeak?.climbing_score), safeNumber(latestPeak?.durability_score), safeNumber(latestPeak?.training_state_score),
        ];
        const bestAxes = bestPeak ? [
          safeNumber(bestPeak.recovery_score), safeNumber(bestPeak.aerobic_score), safeNumber(bestPeak.speed_score),
          safeNumber(bestPeak.climbing_score), safeNumber(bestPeak.durability_score), safeNumber(bestPeak.training_state_score),
        ] : [null, null, null, null, null, null];

        const provisionalNotes = [
          { label: "최근 28일 거리", value: `${fmt(v.distance_28d_km)} km`, detail: "기본 지구력 계산에 사용" },
          { label: "최근 28일 상승", value: `${fmt(v.elevation_28d_m)} m`, detail: "트레일/오르막 준비도 계산에 사용" },
          { label: "롱런 후반 저하", value: fmt(lr.latest_durability_decline_pct, "%"), detail: "낮을수록 장거리 내구성이 좋음" },
          { label: "최근 인터벌", value: ia.status === "ok" ? `${fmt(ia.rep_count)} reps` : "—", detail: "스피드/역치 준비도 계산에 사용" },
        ];

        return (
          <div className="mt-6 space-y-5 sm:mt-8">
            <section className="relative overflow-hidden rounded-[32px] border border-cyan-900/40 bg-gradient-to-br from-cyan-950/30 via-zinc-950 to-black p-6 sm:p-8">
              <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
              <div className="relative grid gap-8 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.24em] text-zinc-500"><span className="h-2 w-2 rounded-full bg-cyan-300" />Peak / Progress</div>
                  <div className="mt-5 flex items-end gap-3">
                    <div className="text-6xl font-bold tracking-[-0.06em] sm:text-7xl">{match === null ? "—" : n(match, 0)}</div>
                    <div className="pb-2 text-lg text-zinc-500">% OF PEAK</div>
                  </div>
                  <p className="mt-4 max-w-xl text-sm leading-7 text-zinc-400">
                    {match === null ? "페이지는 준비됐어. Garmin 전체 이력 → Supabase 백필 → Peak Engine 계산이 끝나면 현재 몸 상태를 과거 최고점과 자동 비교해." : match >= 100 ? "현재가 기존 최고점을 넘어선 새로운 최고 상태야." : match >= 95 ? "역대 최고점에 거의 도달한 상태야. 레이스 특이 자극만 잘 맞추면 돼." : match >= 85 ? "좋은 빌드업 구간이지만 몇 축은 아직 이전 최고점 아래야." : "현재는 최고점 대비 빌드업 중이야. 부족한 축을 확인해서 올리는 단계야."}
                  </p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    {(Object.keys(raceModeLabels) as RaceMode[]).map((mode) => <button key={mode} onClick={() => setRaceMode(mode)} className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${raceMode === mode ? "border-cyan-500/70 bg-cyan-950/70 text-cyan-200" : "border-zinc-800 bg-black/30 text-zinc-500 hover:text-zinc-300"}`}>{raceModeLabels[mode]}</button>)}
                  </div>
                </div>
                <RadarChart current={currentAxes} peak={bestAxes} />
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
              <div className="relative overflow-hidden rounded-[28px] border border-orange-900/40 bg-gradient-to-br from-orange-950/25 via-zinc-950 to-black p-5 sm:p-6">
                <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-orange-400/10 blur-3xl" />
                <div className="relative">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.22em] text-orange-300/70">UTMB INDEX</div>
                      <div className="mt-2 flex items-end gap-3">
                        <div className="text-6xl font-bold tracking-[-0.06em]">{utmb?.overall_index ?? "—"}</div>
                        <div className="pb-2 text-sm text-zinc-500">OVERALL</div>
                      </div>
                    </div>
                    <div className="rounded-full border border-zinc-800 bg-black/40 px-3 py-2 text-[11px] text-zinc-500">{utmb ? `갱신 ${prettyDate(utmb.captured_at)}` : utmbLoading ? "UTMB 확인 중..." : "동기화 대기"}</div>
                  </div>

                  <div className="mt-5 grid grid-cols-4 gap-2">
                    {[
                      ["20K", utmb?.index_20k],
                      ["50K", utmb?.index_50k],
                      ["100K", utmb?.index_100k],
                      ["100M", utmb?.index_100m],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-2xl border border-zinc-800/80 bg-black/35 p-3">
                        <div className="text-[10px] text-zinc-600">{label}</div>
                        <div className="mt-1 text-xl font-semibold">{typeof value === "number" ? value : "—"}</div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-500">
                    <span className="rounded-full border border-zinc-800 px-3 py-1.5">Best score {utmb?.best_score ?? "—"}</span>
                    <span className="rounded-full border border-zinc-800 px-3 py-1.5">Finished {utmb?.finished_races ?? "—"}</span>
                    <span className="rounded-full border border-zinc-800 px-3 py-1.5">Top 10 {utmb?.top10 ?? "—"}</span>
                  </div>
                </div>
              </div>

              {utmb?.korea_men_rank_est || utmb?.korea_age_rank_est ? (
                <div className="rounded-[28px] border border-zinc-800 bg-zinc-950/70 p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.22em] text-zinc-600">KOREA RANK</div>
                      <h3 className="mt-1 text-xl font-semibold">대한민국에서 지금 어디쯤?</h3>
                    </div>
                    <Icon name="target" className="h-5 w-5 text-zinc-600" />
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-black/40 p-4">
                      <div className="text-xs text-zinc-500">한국 남자 · Overall</div>
                      <div className="mt-2 text-4xl font-semibold tracking-tight">{utmb?.korea_men_rank_est ? `#${utmb.korea_men_rank_est}` : "—"}</div>
                      <div className="mt-2 text-[11px] text-zinc-600">{utmb?.korea_men_rank_low && utmb?.korea_men_rank_high ? `추정 범위 #${utmb.korea_men_rank_low}–#${utmb.korea_men_rank_high}` : "—"}</div>
                    </div>
                    <div className="rounded-2xl bg-black/40 p-4">
                      <div className="text-xs text-zinc-500">한국 남자 · {utmb?.age_group ?? "35–39"}</div>
                      <div className="mt-2 text-4xl font-semibold tracking-tight">{utmb?.korea_age_rank_est ? `#${utmb.korea_age_rank_est}` : "—"}</div>
                      <div className="mt-2 text-[11px] text-zinc-600">{utmb?.korea_age_rank_low && utmb?.korea_age_rank_high ? `추정 범위 #${utmb.korea_age_rank_low}–#${utmb.korea_age_rank_high}` : "—"}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-[28px] border border-zinc-800 bg-zinc-950/70 p-5 sm:p-6">
                  <div className="text-xs uppercase tracking-[0.22em] text-zinc-600">KOREA RANK</div>
                  <h3 className="mt-1 text-xl font-semibold">국가 순위 자동 연동 준비 중</h3>
                  <p className="mt-4 text-sm leading-6 text-zinc-500">UTMB가 국가별 순위를 안정적으로 조회할 수 있는 공개 방식은 제공하지 않아, 부정확한 숫자는 표시하지 않도록 잠시 숨겼어.</p>
                </div>
              )}
            </section>

            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <PeakScoreCard label="회복 상태" score={safeNumber(latestPeak?.recovery_score)} peakDate={bestPeak?.metric_date ?? null} detail="HRV · 안정 심박 · 수면 · 최근 피로 균형" />
              <PeakScoreCard label="기본 엔진" score={safeNumber(latestPeak?.aerobic_score)} peakDate={bestPeak?.metric_date ?? null} detail="28일 거리 · 시간 · easy 효율 기반" />
              <PeakScoreCard label="스피드 / 역치" score={safeNumber(latestPeak?.speed_score)} peakDate={bestPeak?.metric_date ?? null} detail="최근 인터벌 품질과 빠른 페이스 노출" />
              <PeakScoreCard label="오르막" score={safeNumber(latestPeak?.climbing_score)} peakDate={bestPeak?.metric_date ?? null} detail="상승고도 · 트레일 부하 · 업힐 적응" />
              <PeakScoreCard label="롱런 내구성" score={safeNumber(latestPeak?.durability_score)} peakDate={bestPeak?.metric_date ?? null} detail="decoupling과 후반 효율 저하" />
              <PeakScoreCard label="훈련 적응" score={safeNumber(latestPeak?.training_state_score)} peakDate={bestPeak?.metric_date ?? null} detail="최근 부하와 체력 베이스의 균형" />
            </section>

            <section className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
              <div className="rounded-[28px] border border-zinc-800 bg-zinc-950/70 p-5 sm:p-6">
                <div className="flex items-center justify-between gap-4"><div><div className="text-sm text-zinc-500">현재 계산 입력값</div><h3 className="mt-1 text-xl font-semibold">Peak Engine이 볼 데이터</h3></div><Icon name="trend" className="h-5 w-5 text-zinc-600" /></div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {provisionalNotes.map((item) => <div key={item.label} className="rounded-2xl bg-black/40 p-4"><div className="text-xs text-zinc-500">{item.label}</div><div className="mt-2 text-2xl font-semibold">{item.value}</div><div className="mt-2 text-xs leading-5 text-zinc-600">{item.detail}</div></div>)}
                </div>
              </div>
              <div className="rounded-[28px] border border-zinc-800 bg-zinc-950/70 p-5 sm:p-6">
                <div className="text-sm text-zinc-500">상태</div>
                <h3 className="mt-1 text-xl font-semibold">히스토리 계산 준비</h3>
                <div className="mt-5 space-y-3">
                  <SimpleBullet tone="good" title="PEAK UI 준비 완료" detail="사이트 페이지는 지금부터 사용할 수 있어." />
                  <SimpleBullet tone={peakRows.length ? "good" : "neutral"} title={peakRows.length ? "Peak history 연결됨" : "과거 이력 계산 대기"} detail={peakRows.length ? `${peakRows.length}일치 스냅샷을 불러왔어.` : "Intervals 전체 가져오기 완료 후 Full History Backfill과 Peak Engine을 돌리면 자동으로 채워져."} />
                  <SimpleBullet tone="neutral" title={`${raceModeLabels[raceMode]} 기준`} detail="레이스 종류에 따라 거리·스피드·오르막·내구성 가중치를 다르게 적용할 예정." />
                </div>
                {peakLoading && <div className="mt-4 text-xs text-cyan-400">Peak history 확인 중...</div>}
              </div>
            </section>

            {peakRows.length > 1 && (
              <section className="rounded-[28px] border border-zinc-800 bg-zinc-950/70 p-5 sm:p-6">
                <div className="flex items-center justify-between gap-4"><div><div className="text-sm text-zinc-500">Form timeline</div><h3 className="mt-1 text-xl font-semibold">최고점으로 가는 흐름</h3></div><div className="text-xs text-zinc-600">{raceModeLabels[raceMode]}</div></div>
                <div className="mt-6 flex h-40 items-end gap-1 overflow-hidden">
                  {peakRows.slice(-90).map((row, i) => { const score = safeNumber(row.overall_score) ?? 0; return <div key={`${row.metric_date}-${i}`} className="min-w-0 flex-1 rounded-t-sm bg-cyan-500/60" style={{ height: `${Math.max(4, clamp(score, 0, 110) / 110 * 100)}%` }} title={`${row.metric_date}: ${score}`} />; })}
                </div>
              </section>
            )}
          </div>
        );
      })()}

      {tab === "detail" && (
        <div className="mt-6 space-y-5 sm:mt-8">
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="HRV" value={`${fmt(r.latest_hrv)} ms`} sub={`28d baseline ${fmt(r.hrv_baseline_28d)} ms · ${fmt(r.hrv_deviation_pct)}%`} icon="heart" />
            <StatCard label="Resting HR" value={`${fmt(r.latest_resting_hr)} bpm`} sub={`28d baseline ${fmt(r.resting_hr_baseline_28d)} bpm · ${fmt(r.resting_hr_deviation_pct)}%`} icon="heart" />
            <StatCard label="Sleep" value={`${fmt(r.latest_sleep_hours)} h`} sub={`score ${fmt(r.latest_sleep_score)} · 7d avg ${fmt(r.sleep_7d_avg_hours)} h`} icon="moon" />
            <StatCard label="ATL / CTL" value={`${n(r.latest_atl, 1)} / ${n(r.latest_ctl, 1)}`} sub={`ramp ${n(r.latest_ramp_rate, 1)}`} icon="trend" />
          </section>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="7d Distance" value={`${fmt(v.distance_7d_km)} km`} sub={`${fmt(v.duration_7d_hours)} h · load ${fmt(load.training_load_7d)}`} icon="shoe" />
            <StatCard label="28d Distance" value={`${fmt(v.distance_28d_km)} km`} sub={`${fmt(v.duration_28d_hours)} h · load ${fmt(load.training_load_28d)}`} icon="shoe" />
            <StatCard label="7d Elevation" value={`${fmt(v.elevation_7d_m)} m`} icon="mountain" />
            <StatCard label="28d Elevation" value={`${fmt(v.elevation_28d_m)} m`} icon="mountain" />
          </section>
          <section className="grid gap-4 lg:grid-cols-3">
            <StatCard label="Easy efficiency" value={fmt(ae.easy_efficiency_vs_baseline_pct, "%")} sub={`latest ${fmt(ae.latest_easy_efficiency)} · 28d median ${fmt(ae.easy_efficiency_28d_median)} · ${fmt(ae.easy_sessions_used)} sessions`} />
            <StatCard label="Long run durability" value={fmt(lr.latest_durability_decline_pct, "%")} sub={`${fmt(lr.source_distance_km)} km · +${fmt(lr.source_elevation_gain_m)} m · decoupling ${fmt(lr.latest_long_run_decoupling_pct, "%")}`} />
            <StatCard label="Latest interval" value={ia.status === "ok" ? `${fmt(ia.rep_count)} reps` : fmt(ia.status)} sub={`${fmt(ia.median_group_distance_m)} m · pace CV ${fmt(ia.pace_coefficient_of_variation_pct, "%")} · ${prettyDate(ia.source_date)}`} />
          </section>
          {warnings.length > 0 && <section className="rounded-2xl border border-amber-900/50 bg-amber-950/20 p-5 sm:p-6"><div className="text-sm font-semibold text-amber-300">Data quality</div><ul className="mt-3 space-y-2 text-sm leading-6 text-amber-100/80">{warnings.map((w, i) => <li key={i}>• {w}</li>)}</ul></section>}
        </div>
      )}

      {tab === "coach" && (
        <section className="mt-6 rounded-[30px] border border-zinc-800 bg-zinc-950/80 p-5 sm:mt-8 sm:p-7">
          <div className="flex items-center justify-between gap-4"><div><div className="text-sm text-zinc-500">AI Coach</div><h2 className="mt-1 text-2xl font-semibold">Claude Coach</h2></div><span className="rounded-full bg-emerald-950 px-3 py-1 text-xs text-emerald-300">live</span></div>
          {coachEntries.length ? <div className="mt-6 grid gap-4 xl:grid-cols-2">{coachEntries.map(([key, value]) => <article key={key} className="rounded-2xl border border-zinc-800 bg-black p-5"><h3 className="text-base font-semibold">{titleize(key)}</h3><div className="mt-4 text-sm"><ValueView value={value} /></div></article>)}</div> : <div className="mt-6 text-zinc-500">코칭 내용이 비어 있습니다.</div>}
        </section>
      )}
      </div>
    </Shell>
  );
}
