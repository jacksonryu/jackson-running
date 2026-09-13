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

function prettyDate(v: unknown) {
  if (typeof v !== "string" || !v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
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
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return (
      <p className="whitespace-pre-wrap leading-7 text-zinc-300">
        {renderPrimitive(value)}
      </p>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="text-zinc-500">없음</p>;
    return (
      <div className="space-y-2">
        {value.map((item, i) => (
          <div
            key={i}
            className="rounded-xl bg-zinc-950 px-4 py-3 text-sm leading-6 text-zinc-300"
          >
            {typeof item === "object" && item !== null ? (
              <ObjectRows obj={item as JsonRecord} />
            ) : (
              renderPrimitive(item)
            )}
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
          <div className="text-xs uppercase tracking-wide text-zinc-500">
            {k.replaceAll("_", " ")}
          </div>
          <div className="text-sm leading-6 text-zinc-300">
            {typeof v === "object" && v !== null ? (
              <ValueView value={v} />
            ) : (
              renderPrimitive(v)
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
      <div className="text-sm text-zinc-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-2 text-sm leading-6 text-zinc-500">{sub}</div>}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-7xl px-4 py-7 sm:px-6 sm:py-10">{children}</div>
    </main>
  );
}

export default function Home() {
  const [report, setReport] = useState<ReportRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      setError("GitHub Actions에 Supabase 공개용 환경변수가 설정되지 않았습니다.");
      setLoading(false);
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let cancelled = false;

    async function load() {
      const { data, error: queryError } = await supabase
        .from("coach_reports")
        .select(
          "id, report_date, report_type, input_context, output, model_used, created_at",
        )
        .eq("report_type", "daily")
        .order("report_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      if (queryError || !data) {
        setError(
          queryError?.message ??
            "Supabase에 daily coach report가 없거나 공개 읽기 정책이 없습니다.",
        );
      } else {
        setReport(data as ReportRow);
      }
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
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
    const warnings: string[] = Array.isArray(d.warnings) ? d.warnings : [];

    const rawCoach = (report.output ?? {}) as JsonRecord;
    const coaching =
      rawCoach && typeof rawCoach === "object"
        ? rawCoach.coaching && typeof rawCoach.coaching === "object"
          ? (rawCoach.coaching as JsonRecord)
          : rawCoach
        : null;

    const preferredCoachKeys = [
      "recovery_today",
      "recovery_assessment",
      "recent_load_interpretation",
      "recent_key_workout_review",
      "today_recommendation",
      "today_workout",
      "recommended_session",
      "plan_b",
      "planB",
      "avoid_today",
      "next_3_days",
      "three_day_plan",
      "next_three_days",
      "low_confidence_areas",
    ];

    const coachEntries: [string, unknown][] = coaching
      ? [
          ...preferredCoachKeys
            .filter((k) => Object.prototype.hasOwnProperty.call(coaching, k))
            .map((k) => [k, coaching[k]] as [string, unknown]),
          ...Object.entries(coaching).filter(
            ([k]) => !preferredCoachKeys.includes(k),
          ),
        ]
      : [];

    return { d, r, v, load, ae, lr, ia, warnings, coachEntries };
  }, [report]);

  if (loading) {
    return (
      <Shell>
        <div className="pt-20 text-center">
          <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Running Analytics</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight">JACKSON RUNNING ENGINE</h1>
          <p className="mt-8 text-zinc-400">Supabase에서 최신 데이터를 불러오는 중...</p>
        </div>
      </Shell>
    );
  }

  if (error || !report || !view) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl pt-16">
          <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Running Analytics</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight">JACKSON RUNNING ENGINE</h1>
          <div className="mt-8 rounded-2xl border border-red-900 bg-red-950/30 p-6">
            <h2 className="font-semibold text-red-300">데이터를 불러오지 못했습니다.</h2>
            <p className="mt-3 break-words text-sm leading-6 text-red-200">{error}</p>
          </div>
        </div>
      </Shell>
    );
  }

  const { d, r, v, load, ae, lr, ia, warnings, coachEntries } = view;

  return (
    <Shell>
      <header className="flex flex-col gap-4 border-b border-zinc-800 pb-7 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">Running Analytics</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            JACKSON RUNNING ENGINE
          </h1>
        </div>
        <div className="text-sm text-zinc-500">
          Updated {prettyDate(d.generated_at_local ?? d.generated_at ?? report.created_at)}
        </div>
      </header>

      <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 sm:gap-4">
        <MetricCard
          label="HRV"
          value={`${fmt(r.latest_hrv)} ms`}
          sub={`28d baseline ${fmt(r.hrv_baseline_28d)} ms · ${fmt(r.hrv_deviation_pct)}%`}
        />
        <MetricCard
          label="Resting HR"
          value={`${fmt(r.latest_resting_hr)} bpm`}
          sub={`28d baseline ${fmt(r.resting_hr_baseline_28d)} bpm · ${fmt(r.resting_hr_deviation_pct)}%`}
        />
        <MetricCard
          label="Sleep"
          value={`${fmt(r.latest_sleep_hours)} h`}
          sub={`score ${fmt(r.latest_sleep_score)} · 7d avg ${fmt(r.sleep_7d_avg_hours)} h`}
        />
        <MetricCard
          label="ATL / CTL"
          value={`${n(r.latest_atl, 1)} / ${n(r.latest_ctl, 1)}`}
          sub={`ramp ${n(r.latest_ramp_rate, 1)}`}
        />
      </section>

      <section className="mt-3 grid grid-cols-1 gap-3 sm:mt-4 sm:grid-cols-2 lg:grid-cols-4 sm:gap-4">
        <MetricCard
          label="7d Distance"
          value={`${fmt(v.distance_7d_km)} km`}
          sub={`${fmt(v.duration_7d_hours)} h · load ${fmt(load.training_load_7d)}`}
        />
        <MetricCard
          label="28d Distance"
          value={`${fmt(v.distance_28d_km)} km`}
          sub={`${fmt(v.duration_28d_hours)} h · load ${fmt(load.training_load_28d)}`}
        />
        <MetricCard label="7d Elevation" value={`${fmt(v.elevation_7d_m)} m`} />
        <MetricCard label="28d Elevation" value={`${fmt(v.elevation_28d_m)} m`} />
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 sm:p-6">
          <div className="text-sm text-zinc-500">Easy efficiency</div>
          <div className="mt-3 text-4xl font-semibold">{fmt(ae.easy_efficiency_vs_baseline_pct, "%")}</div>
          <div className="mt-3 text-sm leading-6 text-zinc-500">
            latest {fmt(ae.latest_easy_efficiency)}
            <br />
            28d median {fmt(ae.easy_efficiency_28d_median)}
            <br />
            {fmt(ae.easy_sessions_used)} sessions
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 sm:p-6">
          <div className="text-sm text-zinc-500">Long run durability</div>
          <div className="mt-3 text-4xl font-semibold">{fmt(lr.latest_durability_decline_pct, "%")}</div>
          <div className="mt-3 text-sm leading-6 text-zinc-500">
            {fmt(lr.source_distance_km)} km · +{fmt(lr.source_elevation_gain_m)} m
            <br />
            decoupling {fmt(lr.latest_long_run_decoupling_pct, "%")}
            <br />
            {prettyDate(lr.source_date)}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 sm:p-6">
          <div className="text-sm text-zinc-500">Latest interval</div>
          <div className="mt-3 text-4xl font-semibold">
            {ia.status === "ok" ? `${fmt(ia.rep_count)} reps` : fmt(ia.status)}
          </div>
          <div className="mt-3 text-sm leading-6 text-zinc-500">
            {fmt(ia.median_group_distance_m)} m
            <br />
            pace CV {fmt(ia.pace_coefficient_of_variation_pct, "%")}
            <br />
            {prettyDate(ia.source_date)}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 sm:mt-8 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-zinc-500">AI Coach</div>
            <h2 className="mt-1 text-2xl font-semibold">Claude Coach</h2>
          </div>
          <span className="rounded-full bg-green-950 px-3 py-1 text-xs text-green-300">live</span>
        </div>

        {coachEntries.length ? (
          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            {coachEntries.map(([key, value]) => (
              <article key={key} className="rounded-2xl border border-zinc-800 bg-black p-5">
                <h3 className="text-base font-semibold">{titleize(key)}</h3>
                <div className="mt-4 text-sm"><ValueView value={value} /></div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-6 text-zinc-500">코칭 내용이 비어 있습니다.</div>
        )}
      </section>

      {warnings.length > 0 && (
        <section className="mt-6 rounded-2xl border border-amber-900/50 bg-amber-950/20 p-5 sm:p-6">
          <div className="text-sm font-semibold text-amber-300">Data quality</div>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-100/80">
            {warnings.map((w, i) => <li key={i}>• {w}</li>)}
          </ul>
        </section>
      )}
    </Shell>
  );
}
