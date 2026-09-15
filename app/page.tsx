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


type TrainingFormat = {
  label: string;
  work: string;
  pace: string;
  recovery: string;
  volume: string;
  note?: string;
};

type TrainingWeekPlan = {
  week: number;
  focus: string;
  tuesdayTitle: string;
  tuesdayTrack: TrainingFormat;
  tuesdayTreadmill: TrainingFormat;
  thursdayTitle: string;
  thursdayOutdoor: TrainingFormat;
  thursdayTreadmill: TrainingFormat;
  loadNote: string;
};

const detailedTrainingCycle: TrainingWeekPlan[] = [
  {
    week: 1, focus: "NSM / Threshold 리듬", tuesdayTitle: "NSM 6분 반복",
    tuesdayTrack: { label: "TRACK", work: "1600m × 6", pace: "5:56–6:00 / 1600m · 3:42–3:45/km", recovery: "400m 조깅 2:00", volume: "질주 9.6km", note: "첫 4세트 일정하게, 마지막 2세트만 자연스럽게 올리기" },
    tuesdayTreadmill: { label: "TREADMILL", work: "6:00 × 6", pace: "16.0–16.2 km/h · 경사 0–1%", recovery: "2:00 @ 9–10 km/h", volume: "질주 약 9.6km", note: "트랙과 같은 자극. 벨트 가속 때문에 시간 기준으로 수행" },
    thursdayTitle: "긴 업힐 파워",
    thursdayOutdoor: { label: "OUTDOOR HILL", work: "400m 업힐 × 6–8", pace: "RPE 8 · 약 2:00–2:20/회", recovery: "내리막 조깅 2:30–3:00", volume: "상승 반복 6–8회", note: "마지막 2회에도 자세와 케이던스 유지" },
    thursdayTreadmill: { label: "INCLINE TREADMILL", work: "7:00 × 3", pace: "13% · 9.0–9.3 km/h", recovery: "3:00 @ 0–3% · 6–7 km/h", volume: "질주 21분", note: "네가 해온 13% 7분 세션을 기준으로 시작" },
    loadNote: "볼륨 주간. 화요일을 완주했으면 목요일은 마지막 세트를 억지로 올리지 않는다."
  },
  {
    week: 2, focus: "1K 속도지구력", tuesdayTitle: "1000m 반복 · 표 기반",
    tuesdayTrack: { label: "TRACK", work: "1000m × 8 (GO면 10)", pace: "1–4회 3:35 · 5–8회 3:30", recovery: "200m 65초", volume: "질주 8–10km", note: "보낸 표 원안은 12세트. 화/목 2품질 구조에서는 8세트 기본, 최상 컨디션만 10–12" },
    tuesdayTreadmill: { label: "TREADMILL", work: "3:35 × 4 + 3:30 × 4", pace: "16.7 km/h → 17.1 km/h", recovery: "65초 @ 11.1 km/h", volume: "질주 8km", note: "10세트 시 마지막 2세트만 17.1–17.3 km/h" },
    thursdayTitle: "중간 길이 업힐",
    thursdayOutdoor: { label: "OUTDOOR HILL", work: "2:30–3:00 × 6–8", pace: "RPE 8 · 일정한 경사", recovery: "내리막 2:00–3:00", volume: "강한 오르막 15–24분", note: "첫 2회는 통제, 중간부터 목표 강도" },
    thursdayTreadmill: { label: "INCLINE TREADMILL", work: "3:00 × 8", pace: "10% · 12.0–12.5 km/h", recovery: "90초 @ 0–3% · 6–7 km/h", volume: "질주 24분", note: "화요일 1K 후 다리가 무거우면 6세트로 축소" },
    loadNote: "속도 자극 주간. 화요일 페이스 성공 여부가 목요일 세트 수를 결정한다."
  },
  {
    week: 3, focus: "2K 역치 / 하프 지구력", tuesdayTitle: "2000m 반복 · 표 기반",
    tuesdayTrack: { label: "TRACK", work: "2000m × 4", pace: "1–2회 7:10 · 3–4회 7:00", recovery: "400m 115초", volume: "질주 8km", note: "보낸 표 원안은 6세트. 현재 주간 구조에서는 4세트 기본, 컨디션 매우 좋으면 5" },
    tuesdayTreadmill: { label: "TREADMILL", work: "7:10 × 2 + 7:00 × 2", pace: "16.7 km/h → 17.1 km/h", recovery: "115초 @ 12.5 km/h", volume: "질주 8km", note: "회복도 빠른 편이라 체감은 연속주에 가깝다" },
    thursdayTitle: "5분 업힐 역치",
    thursdayOutdoor: { label: "OUTDOOR HILL", work: "4:30–5:00 × 5", pace: "RPE 7.5–8", recovery: "내리막 2:00–3:00", volume: "강한 오르막 22–25분", note: "경사가 급하면 시간만 맞추고 거리 집착 금지" },
    thursdayTreadmill: { label: "INCLINE TREADMILL", work: "5:00 × 5", pace: "12% · 10.5–11.0 km/h", recovery: "2:00 @ 0–3% · 6–7 km/h", volume: "질주 25분", note: "마지막 1분만 속도를 0.3–0.5 올리는 건 선택" },
    loadNote: "역치 주간. 주말 롱런이 길다면 목요일은 4세트면 충분하다."
  },
  {
    week: 4, focus: "400m 경제성 / 리셋", tuesdayTitle: "400m 반복 · 표 기반",
    tuesdayTrack: { label: "TRACK", work: "400m × 10–12", pace: "1–6회 82초 · 이후 80–81초", recovery: "200m 60초", volume: "질주 4.0–4.8km", note: "표 원안 22세트는 특수 고볼륨 세션. 평소 화/목 구조에선 10–12세트가 기본" },
    tuesdayTreadmill: { label: "TREADMILL", work: "80–82초 × 10–12", pace: "17.6 → 17.8–18.0 km/h", recovery: "60초 @ 12.0 km/h", volume: "질주 약 4.0–4.8km", note: "짧은 반복은 거리보다 시간으로 맞춰 벨트 가속 오차를 줄임" },
    thursdayTitle: "짧은 업힐 스피드",
    thursdayOutdoor: { label: "OUTDOOR HILL", work: "60초 × 8–10", pace: "RPE 8 · 빠른 케이던스", recovery: "90초 걷기/조깅", volume: "질주 8–10분", note: "힘으로 찍어누르지 말고 리듬 중심" },
    thursdayTreadmill: { label: "INCLINE TREADMILL", work: "60초 × 8–10", pace: "10% · 13.5–14.0 km/h", recovery: "90초 @ 3% · 6–7 km/h", volume: "질주 8–10분", note: "리셋 주간이라 총량은 작게" },
    loadNote: "리셋 성격. 화요일은 빠르지만 총 질주량이 작고, 목요일도 짧게 끝낸다."
  },
  {
    week: 5, focus: "800m VO2 / 속도 유지", tuesdayTitle: "800m 반복 · 표 기반",
    tuesdayTrack: { label: "TRACK", work: "800m × 8", pace: "1–4회 2:48 · 5–8회 2:44", recovery: "400m 94–96초 (필요시 첫 4회만 800m 회복)", volume: "질주 6.4km", note: "표의 84초×2 → 82초×2 흐름 반영. 회복 거리는 컨디션에 따라 400–800m" },
    tuesdayTreadmill: { label: "TREADMILL", work: "2:48 × 4 + 2:44 × 4", pace: "17.1 → 17.6 km/h", recovery: "94–96초 @ 15.0–15.3 km/h 또는 더 느리게", volume: "질주 6.4km", note: "표의 회복 속도는 매우 빠르므로 주간 피로가 있으면 회복을 10–12 km/h로 낮춰도 됨" },
    thursdayTitle: "긴 업힐 재확인",
    thursdayOutdoor: { label: "OUTDOOR HILL", work: "400m × 6–8", pace: "RPE 8", recovery: "내리막 완전 회복", volume: "상승 반복 6–8회", note: "1주차보다 속도보다 균일성 확인" },
    thursdayTreadmill: { label: "INCLINE TREADMILL", work: "7:00 × 3", pace: "13% · 9.2–9.5 km/h", recovery: "3:00 @ 0–3% · 6–7 km/h", volume: "질주 21분", note: "3세트 모두 비슷한 심박/자세가 목표" },
    loadNote: "빠른 800m 주간. 목요일은 증가보다 유지가 목적."
  },
  {
    week: 6, focus: "롤러코스터 복합 지구력", tuesdayTitle: "3–2–1–1–2–3km 변속 · 표 기반",
    tuesdayTrack: { label: "TRACK", work: "3K → 2K → 1K → 1K → 2K → 3K", pace: "3K 85초/lap · 2K 83초/lap · 1K 81초/lap", recovery: "600m 3:00 → 400m 2:00 → 200m 1:00 → 200m 1:00 → 400m 2:00", volume: "질주 12km", note: "대략 3K 10:37 · 2K 6:55 · 1K 3:22–3:23" },
    tuesdayTreadmill: { label: "TREADMILL", work: "3K → 2K → 1K → 1K → 2K → 3K", pace: "16.9 → 17.3 → 17.8 → 17.8 → 17.3 → 16.9 km/h", recovery: "3:00 → 2:00 → 1:00 → 1:00 → 2:00 @ 12 km/h", volume: "질주 12km", note: "이번 8주 중 가장 큰 화요일 세션" },
    thursdayTitle: "업힐 유지 세션",
    thursdayOutdoor: { label: "OUTDOOR HILL", work: "90초 × 6", pace: "RPE 7.5", recovery: "90초–2:00", volume: "질주 9분", note: "화요일 피로를 풀지 못했으면 생략" },
    thursdayTreadmill: { label: "INCLINE TREADMILL", work: "2:00 × 6", pace: "10% · 12.5–13.0 km/h", recovery: "90초 @ 3% · 6–7 km/h", volume: "질주 12분", note: "두 번째 강훈련이 아니라 신경계 유지용" },
    loadNote: "가장 큰 화요일. 목요일은 무조건 축소판으로 운영한다."
  },
  {
    week: 7, focus: "3K 반복 / 장거리 속도지구력", tuesdayTitle: "3000m 반복 · 표 기반",
    tuesdayTrack: { label: "TRACK", work: "3000m × 3 (GO면 4)", pace: "10:45 → 10:37 → 10:30", recovery: "600m 180초", volume: "질주 9–12km", note: "표 원안은 5세트. 주간 전체 품질을 고려해 3세트 기본" },
    tuesdayTreadmill: { label: "TREADMILL", work: "3km × 3", pace: "16.7 → 16.9 → 17.1 km/h", recovery: "3:00 @ 12 km/h", volume: "질주 9km", note: "3세트째에도 17.1이 통제되면 다음 사이클에 4세트 검토" },
    thursdayTitle: "업힐 역치 유지",
    thursdayOutdoor: { label: "OUTDOOR HILL", work: "4:00 × 4–5", pace: "RPE 7.5–8", recovery: "2:00–3:00", volume: "질주 16–20분", note: "주말 롱런 전 과피로 금지" },
    thursdayTreadmill: { label: "INCLINE TREADMILL", work: "4:00 × 5", pace: "12% · 10.5–11.0 km/h", recovery: "2:00 @ 0–3% · 6–7 km/h", volume: "질주 20분", note: "화요일 4세트를 했다면 목요일은 4세트" },
    loadNote: "3K 반복은 체력 확인용. 마지막 세트가 무너지면 다음 사이클 속도 상향 금지."
  },
  {
    week: 8, focus: "3K 테스트 / 흡수", tuesdayTitle: "3000m 테스트",
    tuesdayTrack: { label: "TRACK", work: "3000m × 1", pace: "400m 80초 · 목표 10:00", recovery: "없음 · 종료 후 10–15분 조깅", volume: "질주 3km", note: "첫 1600m를 5:20보다 빠르게 끌고 가지 않기" },
    tuesdayTreadmill: { label: "TREADMILL", work: "10:00 연속", pace: "18.0 km/h · 경사 0–1%", recovery: "종료 후 10–15분 easy", volume: "질주 3km", note: "트레드밀은 체감이 다르므로 트랙 TT와 동일 기록으로 직접 등치하지 않음" },
    thursdayTitle: "흡수 / 짧은 업힐",
    thursdayOutdoor: { label: "OUTDOOR HILL", work: "45초 × 6–8", pace: "RPE 7", recovery: "75–90초", volume: "질주 4.5–6분", note: "다리가 무거우면 완전 생략" },
    thursdayTreadmill: { label: "INCLINE TREADMILL", work: "45초 × 8", pace: "10% · 14.0–14.5 km/h", recovery: "75초 @ 3% · 6–7 km/h", volume: "질주 6분", note: "다음 블록 전 신경계만 깨우는 정도" },
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
        <div className="grid grid-cols-[64px_1fr] gap-2"><span className="text-zinc-600">속도</span><span className="text-zinc-300">{spec.pace}</span></div>
        <div className="grid grid-cols-[64px_1fr] gap-2"><span className="text-zinc-600">회복</span><span className="text-zinc-300">{spec.recovery}</span></div>
      </div>
      {spec.note && <div className="mt-3 border-t border-zinc-900 pt-3 text-xs leading-5 text-zinc-600">{spec.note}</div>}
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
  const [peakRows, setPeakRows] = useState<PeakHistoryRow[]>([]);
  const [peakLoading, setPeakLoading] = useState(false);
  const [utmb, setUtmb] = useState<UtmbSnapshot | null>(null);
  const [utmbLoading, setUtmbLoading] = useState(false);
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
    return <Shell><div className="pt-24 text-center"><div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-zinc-800 border-t-cyan-400" /><p className="mt-5 text-sm text-zinc-500">최신 러닝 데이터를 불러오는 중...</p></div></Shell>;
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
              {recoveryText && <p className="relative mt-6 line-clamp-4 text-sm leading-7 text-zinc-400">{String(recoveryText)}</p>}
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
            <section className="relative overflow-hidden rounded-[32px] border border-violet-900/40 bg-gradient-to-br from-violet-950/30 via-zinc-950 to-black p-6 sm:p-8">
              <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-violet-400/10 blur-3xl" />
              <div className="relative">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-zinc-500"><span className="h-2 w-2 rounded-full bg-violet-300" />8-Week Quality Cycle</div>
                  <Pill tone={tueTone}>{executionLabel}</Pill>
                </div>
                <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">화요일 평지 + 목요일 업힐, 수치까지 한 화면에.</h2>
                <p className="mt-3 max-w-4xl text-sm leading-7 text-zinc-400">보낸 인터벌 표의 400m·800m·1K·2K·3K·롤러코스터 세션과 네 NSM 루틴을 8주로 묶었어. 트랙과 트레드밀을 동시에 표시하고, 회복 상태가 애매하면 속도보다 세트 수를 먼저 줄이는 구조야.</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {(Object.keys(raceModeLabels) as RaceMode[]).map((mode) => <button key={mode} onClick={() => setRaceMode(mode)} className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${raceMode === mode ? "border-violet-500/70 bg-violet-950/70 text-violet-200" : "border-zinc-800 bg-black/30 text-zinc-500 hover:text-zinc-300"}`}>{raceModeLabels[mode]}</button>)}
                </div>
                <div className="mt-5 rounded-2xl border border-zinc-800 bg-black/25 p-4 text-sm leading-6 text-zinc-400"><span className="font-semibold text-zinc-200">{raceModeLabels[raceMode]} 보정 · </span>{modeModifier[raceMode]}</div>
              </div>
            </section>

            <section className="rounded-[30px] border border-zinc-800 bg-zinc-950/70 p-5 sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-violet-300">WEEK {plan.week} · {plan.focus}</div>
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
                  <TrainingFormatCard spec={plan.tuesdayTrack} tone={tueTone} />
                  <TrainingFormatCard spec={plan.tuesdayTreadmill} tone={tueTone} />
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
              <div className="flex items-center justify-between gap-4"><div><div className="text-sm text-zinc-500">8주 전체 보기</div><h3 className="mt-1 text-xl font-semibold">인터벌 표 + NSM 로테이션</h3></div><Icon name="clock" className="h-5 w-5 text-zinc-600" /></div>
              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                {detailedTrainingCycle.map((w, i) => (
                  <div key={w.week} className={`rounded-2xl border p-4 ${i === currentWeekIndex ? "border-violet-600/60 bg-violet-950/20" : "border-zinc-900 bg-black/25"}`}>
                    <div className="flex items-center justify-between gap-3"><div className="text-xs font-semibold tracking-[0.16em] text-zinc-500">WEEK {w.week}</div>{i === currentWeekIndex && <Pill tone="neutral">CURRENT</Pill>}</div>
                    <div className="mt-2 font-semibold text-zinc-200">{w.focus}</div>
                    <div className="mt-3 grid gap-2 text-sm leading-6">
                      <div className="grid grid-cols-[34px_1fr] gap-2"><span className="text-cyan-400">화</span><span className="text-zinc-400">{w.tuesdayTrack.work} · {w.tuesdayTrack.pace}</span></div>
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
