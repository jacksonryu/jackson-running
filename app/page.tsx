"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

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

type Tab = "overview" | "simple" | "peak" | "detail" | "coach";
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
    { id: "peak", label: "PEAK" },
    { id: "detail", label: "상세" },
    { id: "coach", label: "코치" },
  ];

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
        <div className="mx-auto flex max-w-7xl gap-1 rounded-2xl bg-zinc-950 p-1">
          {tabs.map((item) => (
            <button key={item.id} onClick={() => setTab(item.id)} className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-medium transition ${tab === item.id ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}>{item.label}</button>
          ))}
        </div>
      </nav>

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
    </Shell>
  );
}
