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


type PressureMark = {
  id: number;
  x: number;
  y: number;
  size: number;
  intensity: number;
  rotation: number;
  duration: number;
};

type ActivePressurePoint = {
  x: number;
  y: number;
  startedAt: number;
  updatedAt: number;
  lastEmitAt: number;
  lastEmitX: number;
  lastEmitY: number;
  force: number;
};

function TouchPressureOverlay() {
  const [marks, setMarks] = useState<PressureMark[]>([]);
  const activeTouches = useRef<Map<number, ActivePressurePoint>>(new Map());
  const nextId = useRef(1);
  const mouseDown = useRef(false);
  const mousePoint = useRef<ActivePressurePoint | null>(null);

  useEffect(() => {
    const spawnMark = (x: number, y: number, intensity: number, speed = 0) => {
      const clamped = Math.max(0.28, Math.min(1, intensity));
      const speedFactor = Math.max(0, Math.min(1, speed / 1.2));
      const id = nextId.current++;
      const size = 78 + clamped * 118 + (1 - speedFactor) * 20;
      const mark: PressureMark = {
        id,
        x,
        y,
        size,
        intensity: clamped,
        rotation: -10 + Math.random() * 20,
        duration: 760 + Math.round((1 - speedFactor) * 420),
      };

      setMarks((prev) => [...prev.slice(-30), mark]);
      window.setTimeout(() => {
        setMarks((prev) => prev.filter((item) => item.id !== id));
      }, mark.duration + 120);
    };

    const pressureFor = (point: ActivePressurePoint, now: number, rawForce: number, speed: number) => {
      if (Number.isFinite(rawForce) && rawForce > 0.01) {
        return Math.max(0.34, Math.min(1, rawForce));
      }
      const held = Math.min(1, (now - point.startedAt) / 950);
      const slowBonus = 1 - Math.min(1, speed / 1.1);
      return Math.min(1, 0.42 + held * 0.36 + slowBonus * 0.18);
    };

    const updateTouch = (touch: Touch, isStart = false) => {
      const now = performance.now();
      const prev = activeTouches.current.get(touch.identifier);
      const force = typeof touch.force === "number" ? touch.force : 0;

      if (!prev || isStart) {
        const point: ActivePressurePoint = {
          x: touch.clientX,
          y: touch.clientY,
          startedAt: now,
          updatedAt: now,
          lastEmitAt: now,
          lastEmitX: touch.clientX,
          lastEmitY: touch.clientY,
          force,
        };
        activeTouches.current.set(touch.identifier, point);
        spawnMark(touch.clientX, touch.clientY, force > 0.01 ? force : 0.5, 0);
        return;
      }

      const dt = Math.max(16, now - prev.updatedAt);
      const dx = touch.clientX - prev.x;
      const dy = touch.clientY - prev.y;
      const speed = Math.hypot(dx, dy) / dt;
      const emitDistance = Math.hypot(touch.clientX - prev.lastEmitX, touch.clientY - prev.lastEmitY);
      const shouldEmit = emitDistance >= 9 || now - prev.lastEmitAt >= 58;
      const intensity = pressureFor(prev, now, force, speed);

      prev.x = touch.clientX;
      prev.y = touch.clientY;
      prev.updatedAt = now;
      prev.force = force;

      if (shouldEmit) {
        prev.lastEmitAt = now;
        prev.lastEmitX = touch.clientX;
        prev.lastEmitY = touch.clientY;
        spawnMark(touch.clientX, touch.clientY, intensity, speed);
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      Array.from(event.changedTouches).forEach((touch) => updateTouch(touch, true));
    };
    const onTouchMove = (event: TouchEvent) => {
      Array.from(event.changedTouches).forEach((touch) => updateTouch(touch));
    };
    const onTouchEnd = (event: TouchEvent) => {
      const now = performance.now();
      Array.from(event.changedTouches).forEach((touch) => {
        const point = activeTouches.current.get(touch.identifier);
        if (point) {
          const held = Math.min(1, (now - point.startedAt) / 900);
          spawnMark(touch.clientX, touch.clientY, 0.48 + held * 0.42, 0);
        }
        activeTouches.current.delete(touch.identifier);
      });
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      mouseDown.current = true;
      const now = performance.now();
      mousePoint.current = {
        x: event.clientX,
        y: event.clientY,
        startedAt: now,
        updatedAt: now,
        lastEmitAt: now,
        lastEmitX: event.clientX,
        lastEmitY: event.clientY,
        force: 0.5,
      };
      spawnMark(event.clientX, event.clientY, 0.5, 0);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !mouseDown.current || !mousePoint.current) return;
      const now = performance.now();
      const point = mousePoint.current;
      const dt = Math.max(16, now - point.updatedAt);
      const dx = event.clientX - point.x;
      const dy = event.clientY - point.y;
      const speed = Math.hypot(dx, dy) / dt;
      const emitDistance = Math.hypot(event.clientX - point.lastEmitX, event.clientY - point.lastEmitY);
      const held = Math.min(1, (now - point.startedAt) / 950);
      point.x = event.clientX;
      point.y = event.clientY;
      point.updatedAt = now;
      if (emitDistance >= 10 || now - point.lastEmitAt >= 64) {
        point.lastEmitAt = now;
        point.lastEmitX = event.clientX;
        point.lastEmitY = event.clientY;
        spawnMark(event.clientX, event.clientY, Math.min(1, 0.44 + held * 0.38), speed);
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      if (mouseDown.current) spawnMark(event.clientX, event.clientY, 0.62, 0);
      mouseDown.current = false;
      mousePoint.current = null;
    };

    const holdTimer = window.setInterval(() => {
      const now = performance.now();
      activeTouches.current.forEach((point) => {
        if (now - point.lastEmitAt < 115) return;
        const held = Math.min(1, (now - point.startedAt) / 1100);
        const rawForce = point.force;
        const intensity = rawForce > 0.01 ? Math.max(0.38, rawForce) : 0.5 + held * 0.45;
        point.lastEmitAt = now;
        point.lastEmitX = point.x;
        point.lastEmitY = point.y;
        spawnMark(point.x, point.y, intensity, 0);
      });
    }, 90);

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("pointercancel", onPointerUp, { passive: true });

    return () => {
      window.clearInterval(holdTimer);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {marks.map((mark) => (
        <div
          key={mark.id}
          className="absolute -translate-x-1/2 -translate-y-1/2 will-change-transform pressure-mark"
          style={{
            left: mark.x,
            top: mark.y,
            width: mark.size,
            height: mark.size,
            animationDuration: `${mark.duration}ms`,
          }}
        >
          <div
            className="absolute inset-0 rounded-full mix-blend-screen"
            style={{
              opacity: 0.35 + mark.intensity * 0.58,
              transform: `rotate(${mark.rotation}deg)`,
              background: "radial-gradient(circle at 48% 46%, rgba(255,0,0,1) 0 12%, rgba(255,35,0,.98) 18%, rgba(255,118,0,.92) 31%, rgba(255,235,0,.78) 45%, rgba(64,255,0,.45) 58%, rgba(0,210,255,.18) 68%, rgba(24,50,255,.04) 76%, transparent 82%)",
              filter: `blur(${1.2 + (1 - mark.intensity) * 2}px) saturate(1.7) contrast(1.12)`,
            }}
          />
          <div
            className="absolute left-1/2 top-1/2 rounded-full mix-blend-screen"
            style={{
              width: `${26 + mark.intensity * 27}%`,
              height: `${26 + mark.intensity * 27}%`,
              transform: "translate(-50%, -50%)",
              opacity: 0.3 + mark.intensity * 0.62,
              background: "radial-gradient(circle, rgba(255,0,0,.98) 0%, rgba(255,32,0,.76) 46%, transparent 74%)",
              filter: "blur(3px)",
            }}
          />
          <div
            className="absolute inset-[10%] rounded-[44%_56%_51%_49%/54%_44%_56%_46%] opacity-30 mix-blend-screen"
            style={{
              transform: `rotate(${-mark.rotation * 1.4}deg)`,
              backgroundImage: "repeating-linear-gradient(118deg, transparent 0 4px, rgba(255,255,255,.22) 5px, transparent 6px 10px)",
              maskImage: "radial-gradient(circle, #000 0 58%, transparent 76%)",
              WebkitMaskImage: "radial-gradient(circle, #000 0 58%, transparent 76%)",
            }}
          />
        </div>
      ))}

      <style jsx>{`
        .pressure-mark {
          animation-name: pressureBloom;
          animation-timing-function: cubic-bezier(.18,.75,.22,1);
          animation-fill-mode: forwards;
        }
        @keyframes pressureBloom {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(.42); }
          12% { opacity: .95; transform: translate(-50%, -50%) scale(.82); }
          42% { opacity: .82; transform: translate(-50%, -50%) scale(1.02); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(1.48); }
        }
        @media (prefers-reduced-motion: reduce) {
          .pressure-mark { animation-duration: 240ms !important; }
        }
      `}</style>
    </div>
  );
}

function Shell({ children, backdrop }: { children: React.ReactNode; backdrop?: React.ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#020203] text-white">
      {backdrop}
      <TouchPressureOverlay />
      <div className="relative z-10 mx-auto max-w-7xl px-4 pb-14 pt-5 sm:px-6 sm:pt-8">{children}</div>
    </main>
  );
}

type FootscanTheme = {
  bgA: string;
  bgB: string;
  glowA: string;
  glowB: string;
  hue: number;
  rotate: number;
  x: number;
  y: number;
  scale: number;
  seed: number;
};

const footscanThemes: Record<Tab, FootscanTheme> = {
  overview: { bgA: "#02060b", bgB: "#13020c", glowA: "#063b4c", glowB: "#3a071c", hue: 0, rotate: -8, x: 66, y: 11, scale: 1.02, seed: 2 },
  simple:   { bgA: "#05030c", bgB: "#071625", glowA: "#28134c", glowB: "#063a48", hue: 12, rotate: -3, x: 61, y: 15, scale: 1.05, seed: 5 },
  quality:  { bgA: "#020806", bgB: "#111006", glowA: "#063a2c", glowB: "#4d2506", hue: -9, rotate: 5, x: 64, y: 13, scale: 1.08, seed: 7 },
  peak:     { bgA: "#08030d", bgB: "#07101b", glowA: "#4b123c", glowB: "#082d45", hue: 19, rotate: 9, x: 59, y: 10, scale: 1.03, seed: 11 },
  detail:   { bgA: "#090403", bgB: "#071019", glowA: "#482008", glowB: "#082b3d", hue: -14, rotate: -12, x: 68, y: 17, scale: 1.07, seed: 13 },
  coach:    { bgA: "#040512", bgB: "#12040e", glowA: "#102f59", glowB: "#4c1036", hue: 7, rotate: 2, x: 62, y: 12, scale: 1.04, seed: 17 },
};

function FootscanBackdrop({ tab }: { tab: Tab }) {
  const t = footscanThemes[tab];
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden transition-[background] duration-700 ease-out"
      style={{
        background: `radial-gradient(circle at 18% 12%, ${t.glowA} 0%, transparent 34%), radial-gradient(circle at 82% 76%, ${t.glowB} 0%, transparent 38%), linear-gradient(145deg, ${t.bgA} 0%, ${t.bgB} 100%)`,
      }}
    >
      <div
        className="absolute inset-0 opacity-[0.17] mix-blend-screen"
        style={{
          backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,.055) 0px, rgba(255,255,255,.055) 1px, transparent 1px, transparent 4px), repeating-linear-gradient(90deg, rgba(0,255,255,.025) 0px, rgba(0,255,255,.025) 1px, transparent 1px, transparent 7px)",
        }}
      />

      <div
        key={`foot-main-${tab}`}
        className="absolute h-[76vh] w-[38vh] min-h-[520px] min-w-[260px] max-h-[880px] max-w-[440px] origin-center opacity-[0.46] mix-blend-screen sm:opacity-[0.54]"
        style={{
          left: `${t.x}%`,
          top: `${t.y}%`,
          transform: `translateX(-50%) rotate(${t.rotate}deg) scale(${t.scale})`,
          filter: `hue-rotate(${t.hue}deg) saturate(1.35) contrast(1.18)`,
          animation: "footscanSwap .72s cubic-bezier(.2,.8,.2,1) both, footscanDrift 9s ease-in-out .72s infinite alternate",
        }}
      >
        <svg viewBox="0 0 320 700" className="h-full w-full overflow-visible" role="presentation">
          <defs>
            <radialGradient id="heatBall" cx="50%" cy="45%" r="60%">
              <stop offset="0%" stopColor="#ff1111" />
              <stop offset="28%" stopColor="#ff5b00" />
              <stop offset="49%" stopColor="#ffe600" />
              <stop offset="68%" stopColor="#3cff00" />
              <stop offset="84%" stopColor="#00d8ff" />
              <stop offset="100%" stopColor="#1636ff" stopOpacity=".2" />
            </radialGradient>
            <radialGradient id="heatHeel" cx="52%" cy="58%" r="60%">
              <stop offset="0%" stopColor="#ff2a00" />
              <stop offset="32%" stopColor="#ff8a00" />
              <stop offset="54%" stopColor="#efff00" />
              <stop offset="72%" stopColor="#15ef35" />
              <stop offset="88%" stopColor="#00c7ff" />
              <stop offset="100%" stopColor="#103cff" stopOpacity=".18" />
            </radialGradient>
            <radialGradient id="heatToe" cx="50%" cy="52%" r="64%">
              <stop offset="0%" stopColor="#ff2700" />
              <stop offset="38%" stopColor="#ffcf00" />
              <stop offset="68%" stopColor="#41ff00" />
              <stop offset="100%" stopColor="#00a9ff" stopOpacity=".15" />
            </radialGradient>
            <linearGradient id="archHeat" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#00dfff" stopOpacity=".72" />
              <stop offset="28%" stopColor="#16ff54" stopOpacity=".62" />
              <stop offset="56%" stopColor="#fff000" stopOpacity=".48" />
              <stop offset="78%" stopColor="#00e1ff" stopOpacity=".42" />
              <stop offset="100%" stopColor="#1538ff" stopOpacity=".18" />
            </linearGradient>
            <filter id="footRough" x="-30%" y="-30%" width="160%" height="160%">
              <feTurbulence type="fractalNoise" baseFrequency="0.018 0.028" numOctaves="2" seed={t.seed} result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="10" xChannelSelector="R" yChannelSelector="G" />
            </filter>
            <filter id="heatSoft" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="2.1" />
            </filter>
          </defs>

          <g filter="url(#footRough)">
            <ellipse cx="154" cy="575" rx="78" ry="104" fill="url(#heatHeel)" />
            <path d="M104 520 C92 475 91 432 103 385 C112 350 116 318 108 289 C101 265 113 241 139 230 C166 219 194 229 205 255 C217 285 216 320 207 350 C197 385 199 423 211 458 C221 490 208 523 181 544 C157 561 120 552 104 520Z" fill="url(#archHeat)" opacity=".84" />
            <ellipse cx="156" cy="250" rx="116" ry="96" fill="url(#heatBall)" />
            <ellipse cx="78" cy="150" rx="31" ry="38" fill="url(#heatToe)" />
            <ellipse cx="114" cy="115" rx="34" ry="42" fill="url(#heatToe)" />
            <ellipse cx="158" cy="94" rx="38" ry="46" fill="url(#heatToe)" />
            <ellipse cx="207" cy="101" rx="39" ry="48" fill="url(#heatToe)" />
            <ellipse cx="258" cy="139" rx="47" ry="58" fill="url(#heatToe)" />
          </g>

          <g opacity=".32" filter="url(#heatSoft)">
            <ellipse cx="154" cy="244" rx="77" ry="55" fill="#ff1600" />
            <ellipse cx="156" cy="585" rx="48" ry="58" fill="#ff2500" />
            <ellipse cx="257" cy="138" rx="26" ry="33" fill="#ff1a00" />
          </g>

          <path d="M91 158 C53 207 39 279 70 340 C88 376 82 430 82 478 C82 558 106 651 157 674 C204 660 231 585 224 511 C221 466 221 420 239 374 C260 321 277 259 245 198" fill="none" stroke="rgba(83,243,255,.34)" strokeWidth="2" strokeDasharray="4 10" />
        </svg>
      </div>

      <div
        key={`foot-ghost-${tab}`}
        className="absolute -left-[8vh] top-[58vh] h-[42vh] w-[21vh] min-h-[300px] min-w-[150px] opacity-[0.13] mix-blend-screen"
        style={{
          transform: `rotate(${t.rotate + 16}deg) scaleX(-1)`,
          filter: `hue-rotate(${t.hue + 26}deg) saturate(1.35)`,
          animation: "footscanGhost 11s ease-in-out infinite alternate",
        }}
      >
        <svg viewBox="0 0 320 700" className="h-full w-full">
          <ellipse cx="154" cy="575" rx="78" ry="104" fill="#00d9ff" />
          <path d="M104 520 C92 475 91 432 103 385 C112 350 116 318 108 289 C101 265 113 241 139 230 C166 219 194 229 205 255 C217 285 216 320 207 350 C197 385 199 423 211 458 C221 490 208 523 181 544 C157 561 120 552 104 520Z" fill="#16ff54" opacity=".72" />
          <ellipse cx="156" cy="250" rx="116" ry="96" fill="#ffed00" />
          <ellipse cx="78" cy="150" rx="31" ry="38" fill="#00d9ff" />
          <ellipse cx="114" cy="115" rx="34" ry="42" fill="#38ff00" />
          <ellipse cx="158" cy="94" rx="38" ry="46" fill="#ffea00" />
          <ellipse cx="207" cy="101" rx="39" ry="48" fill="#ff7b00" />
          <ellipse cx="258" cy="139" rx="47" ry="58" fill="#ff2500" />
        </svg>
      </div>

      <svg className="absolute inset-0 h-full w-full opacity-[0.095] mix-blend-overlay" role="presentation">
        <filter id="screenNoise">
          <feTurbulence type="fractalNoise" baseFrequency="0.78" numOctaves="1" seed={t.seed + 31} />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#screenNoise)" opacity=".55" />
      </svg>

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,.08)_58%,rgba(0,0,0,.58)_100%)]" />

      <style jsx>{`
        @keyframes footscanSwap {
          0% { opacity: .12; transform: translateX(-50%) translate3d(9vw, 2vh, 0) rotate(${t.rotate - 5}deg) scale(${t.scale * 0.94}); filter: hue-rotate(${t.hue - 10}deg) saturate(1.1) contrast(1.05); }
          100% { opacity: .46; transform: translateX(-50%) translate3d(0, 0, 0) rotate(${t.rotate}deg) scale(${t.scale}); filter: hue-rotate(${t.hue}deg) saturate(1.35) contrast(1.18); }
        }
        @keyframes footscanDrift {
          0% { margin-top: 0; margin-left: 0; }
          100% { margin-top: 1.2vh; margin-left: -1.1vw; }
        }
        @keyframes footscanGhost {
          0% { margin-top: 0; opacity: .08; }
          100% { margin-top: -2vh; opacity: .16; }
        }
        @media (prefers-reduced-motion: reduce) {
          div { animation-duration: .001ms !important; animation-iteration-count: 1 !important; }
        }
      `}</style>
    </div>
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
  const palette = tone === "good"
    ? "bg-[#8EF7A4] text-black border-black/10"
    : tone === "warn"
      ? "bg-[#FFE348] text-black border-black/10"
      : "bg-[#C9C7FF] text-black border-black/10";
  return (
    <div className={`rounded-[24px] border p-4 sm:p-5 ${palette}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-55">{label}</span>
        <span className="rounded-full border border-black/15 bg-black/5 p-2"><Icon name={icon} className="h-4 w-4" /></span>
      </div>
      <div className="mt-4 text-3xl font-black tracking-[-0.04em]">{value}</div>
      <div className="mt-2 text-xs font-medium leading-5 opacity-65">{detail}</div>
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
  const palette = label.includes("거리") ? "bg-[#E7FF43]" : label.includes("상승") ? "bg-[#8EE8FF]" : "bg-[#FFB28F]";
  return (
    <div className={`rounded-[24px] border border-black/10 p-4 text-black sm:p-5 ${palette}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-50">{label}</div>
          <div className="mt-2 text-4xl font-black tracking-[-0.05em]">{current === null ? "—" : `${n(current, current >= 100 ? 0 : 1)}${unit}`}</div>
        </div>
        <span className="rounded-full border border-black/15 bg-black/5 p-2"><Icon name={icon} className="h-4 w-4" /></span>
      </div>
      <div className="mt-4 flex items-end justify-between gap-4">
        <div className="text-xs font-medium opacity-55">28일 주간평균 {baseline === null ? "—" : `${n(baseline, baseline >= 100 ? 0 : 1)}${unit}`}</div>
        <div className="text-lg font-black">{ratio === null ? "—" : `${n(ratio * 100, 0)}%`}</div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/10"><div className="h-full rounded-full bg-black/70" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: string }) {
  const palette = label.includes("HRV") || label.includes("Sleep")
    ? "bg-[#C9C7FF]"
    : label.includes("Elevation") || label.includes("오르막")
      ? "bg-[#8EE8FF]"
      : label.includes("Distance") || label.includes("효율") || label.includes("Easy")
        ? "bg-[#E7FF43]"
        : label.includes("interval") || label.includes("스피드")
          ? "bg-[#FFB28F]"
          : "bg-[#F4F1E8]";
  return (
    <div className={`rounded-[24px] border border-black/10 p-5 text-black ${palette}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-50">{label}</div>
        {icon && <span className="rounded-full border border-black/15 bg-black/5 p-2"><Icon name={icon} className="h-4 w-4" /></span>}
      </div>
      <div className="mt-4 text-3xl font-black tracking-[-0.05em]">{value}</div>
      {sub && <div className="mt-3 text-xs font-medium leading-5 opacity-60">{sub}</div>}
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
      <div className="rounded-[28px] border border-black/10 bg-[#FFE348] p-6 text-black">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-50">오늘 추천 훈련</div>
        <div className="mt-3 text-2xl font-black">코치 추천 데이터가 없습니다.</div>
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
    <div className="relative overflow-hidden rounded-[28px] border border-black/10 bg-[#FFE348] p-6 text-black sm:p-7">
      <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-white/35 blur-2xl" />
      <div className="relative">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] opacity-55"><Icon name="target" className="h-4 w-4" />오늘 추천 훈련</div>
          <span className="rounded-full border border-black/15 bg-black/5 px-3 py-1 text-[10px] font-bold">AI COACH</span>
        </div>
        <h2 className="mt-4 text-4xl font-black tracking-[-0.06em] sm:text-5xl">{String(type)}</h2>
        <div className="mt-5 grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-black p-3 text-white"><div className="text-[10px] text-zinc-500">거리</div><div className="mt-1 text-lg font-black">{distance === null ? "—" : `${n(distance, 1)}km`}</div></div>
          <div className="rounded-2xl bg-black p-3 text-white"><div className="text-[10px] text-zinc-500">시간</div><div className="mt-1 text-lg font-black">{duration === null ? "—" : `${n(duration, 0)}분`}</div></div>
          <div className="rounded-2xl bg-black p-3 text-white"><div className="text-[10px] text-zinc-500">RPE</div><div className="mt-1 text-lg font-black">{rpe === null ? "—" : n(rpe, 0)}</div></div>
        </div>
        <div className="mt-4 rounded-2xl border border-black/10 bg-black/5 p-4"><div className="text-[10px] font-bold uppercase tracking-[0.15em] opacity-45">강도 / 페이스</div><div className="mt-2 text-sm font-bold leading-6">{String(intensity)}</div></div>
        <p className="mt-4 text-sm font-medium leading-7 opacity-65">{String(reasoning)}</p>
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
type TrainingVenue = "track" | "treadmill";
type TrainingDay = "tuesday" | "thursday";

const trainingGroupLabels: Record<TrainingGroup, string> = {
  special: "특조",
  group1: "1조",
  group2: "2조",
};

const trainingVenueLabels: Record<TrainingVenue, string> = {
  track: "TRACK",
  treadmill: "TREADMILL",
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

function trainingSetCount(work: string) {
  const match = work.match(/×\s*(\d+)/);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isFinite(count) && count > 0 ? count : null;
}

function TrainingSetStrip({ work, accent = "bg-black" }: { work: string; accent?: string }) {
  const count = trainingSetCount(work);
  if (!count) return null;
  const shown = Math.min(count, 12);
  return (
    <div className="mt-5">
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] opacity-45">
        <span>SET MAP</span><span>{count} SETS</span>
      </div>
      <div className="mt-2 flex gap-1.5">
        {Array.from({ length: shown }).map((_, i) => <span key={i} className={`h-2 min-w-0 flex-1 rounded-full ${accent}`} />)}
        {count > shown && <span className="ml-1 text-xs font-black">+{count - shown}</span>}
      </div>
    </div>
  );
}

function TrainingInfographicCard({ spec, day, venue, status }: { spec: TrainingFormat; day: TrainingDay; venue: TrainingVenue; status: string }) {
  const bg = day === "tuesday"
    ? venue === "track" ? "bg-[#8EE8FF]" : "bg-[#C9C7FF]"
    : venue === "track" ? "bg-[#FFB28F]" : "bg-[#FFE348]";
  const dayLabel = day === "tuesday" ? "TUESDAY QUALITY" : "THURSDAY HILL";
  const venueLabel = venue === "track" ? (day === "tuesday" ? "TRACK" : "OUTDOOR HILL") : "TREADMILL";

  return (
    <article className={`relative overflow-hidden rounded-[30px] border border-black/10 p-5 text-black sm:p-7 ${bg}`}>
      <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-white/30 blur-3xl" />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.22em] opacity-45">{dayLabel} · {venueLabel}</div>
            <div className="mt-2 text-3xl font-black leading-[1.02] tracking-[-0.05em] sm:text-4xl">{spec.work}</div>
          </div>
          <span className="shrink-0 rounded-full bg-black px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-white">{status}</span>
        </div>

        <TrainingSetStrip work={spec.work} />

        <div className="mt-5 rounded-[22px] bg-black p-4 text-white sm:p-5">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">TARGET PACE / SPEED</div>
          <div className="mt-2 text-lg font-black leading-7 tracking-[-0.02em] sm:text-xl">{spec.pace}</div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {spec.lap400 && (
            <div className="rounded-[20px] bg-white/75 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] opacity-40">400M LAP</div>
              <div className="mt-2 text-base font-black leading-6">{spec.lap400}</div>
            </div>
          )}
          <div className="rounded-[20px] bg-white/75 p-4">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] opacity-40">RECOVERY</div>
            <div className="mt-2 text-base font-black leading-6">{spec.recovery}</div>
          </div>
          <div className="rounded-[20px] bg-white/75 p-4">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] opacity-40">VOLUME</div>
            <div className="mt-2 text-base font-black leading-6">{spec.volume}</div>
          </div>
        </div>

        {spec.note && <div className="mt-4 border-t border-black/15 pt-4 text-xs font-semibold leading-5 opacity-55">{spec.note}</div>}
      </div>
    </article>
  );
}


const JACKSON_HAND_TITLE = "data:image/png;base64,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";

const RUNNER_CYCLE_SPRITE = "data:image/png;base64,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";

function RunnerMotion({ compact = false }: { compact?: boolean; label?: string }) {
  const frameW = compact ? 120 : 150;
  const frameH = compact ? 154 : 192;
  const imageH = compact ? 154 : 192;
  const sheetShift = -(frameW * 9);
  const restShift = -(frameW * 4);

  return (
    <div className={`jr-motion relative overflow-hidden ${compact ? "h-[150px]" : "h-[204px] sm:h-[214px]"}`}
      style={{
        ["--jr-frame-w" as any]: `${frameW}px`,
        ["--jr-frame-h" as any]: `${frameH}px`,
        ["--jr-image-h" as any]: `${imageH}px`,
        ["--jr-sheet-shift" as any]: `${sheetShift}px`,
        ["--jr-rest-shift" as any]: `${restShift}px`,
      }}
    >
      <style>{`
        @keyframes jrRunCycle {
          from { transform: translate3d(0, 0, 0); }
          to { transform: translate3d(var(--jr-sheet-shift), 0, 0); }
        }
        @keyframes jrRunnerFloat {
          0%, 100% { transform: translate3d(0,0,0); }
          25% { transform: translate3d(2px,-1px,0); }
          55% { transform: translate3d(0,1px,0); }
          78% { transform: translate3d(-2px,-2px,0); }
        }
        @keyframes jrSpeedLineA {
          from { transform: translateX(-20%); opacity: 0; }
          20% { opacity: .24; }
          80% { opacity: .06; }
          to { transform: translateX(110%); opacity: 0; }
        }
        @keyframes jrSpeedLineB {
          from { transform: translateX(-16%); opacity: 0; }
          22% { opacity: .18; }
          82% { opacity: .05; }
          to { transform: translateX(116%); opacity: 0; }
        }
        .jr-motion .jr-cycle-viewport {
          width: var(--jr-frame-w);
          height: var(--jr-frame-h);
          overflow: hidden;
          flex: 0 0 auto;
          animation: jrRunnerFloat .74s steps(9,end) infinite;
          filter: drop-shadow(0 0 8px rgba(255,255,255,.08)) drop-shadow(0 0 16px rgba(255,255,255,.05));
        }
        .jr-motion .jr-cycle-strip {
          display: block;
          height: var(--jr-image-h);
          width: auto;
          max-width: none;
          user-select: none;
          pointer-events: none;
          animation: jrRunCycle .74s steps(9,end) infinite;
          will-change: transform;
        }
        .jr-motion .jr-speed-a { animation: jrSpeedLineA 1.7s linear infinite; }
        .jr-motion .jr-speed-b { animation: jrSpeedLineB 2.05s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          .jr-motion .jr-cycle-viewport,
          .jr-motion .jr-speed-a,
          .jr-motion .jr-speed-b { animation: none !important; }
          .jr-motion .jr-cycle-strip { animation: none !important; transform: translate3d(var(--jr-rest-shift), 0, 0); }
        }
      `}</style>

      <div className="pointer-events-none absolute inset-x-[10%] top-[42%] h-px bg-gradient-to-r from-transparent via-zinc-500/20 to-transparent jr-speed-a" />
      <div className="pointer-events-none absolute inset-x-[18%] top-[56%] h-[2px] bg-gradient-to-r from-transparent via-zinc-400/10 to-transparent jr-speed-b" />
      <div className="pointer-events-none absolute inset-x-[14%] top-[67%] h-px bg-gradient-to-r from-transparent via-zinc-300/10 to-transparent jr-speed-a" style={{ animationDelay: '-.8s' }} />

      <div className="absolute inset-0 flex items-center justify-center">
        <div className="jr-cycle-viewport" aria-label="한 명의 러너가 실제 러닝 동작 9프레임을 반복하는 애니메이션">
          <img className="jr-cycle-strip" src={RUNNER_CYCLE_SPRITE} alt="달리기 동작의 연속 프레임" draggable={false} />
        </div>
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

function SectionBanner({ tag, title, caption, color = "lime" }: { tag: string; title: string; caption?: string; color?: "lime" | "yellow" | "blue" | "purple" | "coral" }) {
  const cls = color === "yellow" ? "bg-[#FFE348]" : color === "blue" ? "bg-[#8EE8FF]" : color === "purple" ? "bg-[#C9C7FF]" : color === "coral" ? "bg-[#FFB28F]" : "bg-[#8EF7A4]";
  return <div className={`rounded-[28px] border border-black/10 p-5 text-black sm:p-6 ${cls}`}><div className="text-[10px] font-bold uppercase tracking-[0.22em] opacity-50">{tag}</div><div className="mt-2 text-3xl font-black tracking-[-0.05em] sm:text-4xl">{title}</div>{caption && <div className="mt-3 max-w-2xl text-sm font-medium leading-6 opacity-60">{caption}</div>}</div>;
}

export default function Home() {
  const [report, setReport] = useState<ReportRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [raceMode, setRaceMode] = useState<RaceMode>("overall");
  const [trainingGroup, setTrainingGroup] = useState<TrainingGroup>("special");
  const [trainingVenue, setTrainingVenue] = useState<TrainingVenue>("track");
  const [trainingDay, setTrainingDay] = useState<TrainingDay>("tuesday");
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
      hrvDev, sleep, loadRatio,
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
    hrvDev, sleep, loadRatio,
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
    <Shell backdrop={<FootscanBackdrop tab={tab} />}>
      <header className="pb-2 sm:pb-3">
        <img
          src={JACKSON_HAND_TITLE}
          alt="JACKSON RUNNING ENGINE"
          className="h-auto w-[330px] max-w-[92vw] object-contain object-left opacity-100 sm:w-[430px]"
          draggable={false}
        />
        <div className="mt-1 text-[11px] text-zinc-700">Updated {prettyDate(d.generated_at_local ?? d.generated_at ?? report.created_at)}</div>
      </header>

      <div className="-mx-2 mt-1 sm:-mx-3">
        <RunnerMotion compact />
      </div>

      <nav className="sticky top-0 z-20 -mx-4 mt-1 bg-[#050505]/92 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <div className="mx-auto flex max-w-7xl gap-1.5 overflow-x-auto rounded-[20px] border border-zinc-900 bg-zinc-950 p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((item) => (
            <button key={item.id} onClick={() => setTab(item.id)} className={`shrink-0 rounded-[14px] px-4 py-2.5 text-sm font-bold transition sm:flex-1 ${tab === item.id ? "bg-[#E7FF43] text-black" : "text-zinc-500 hover:text-zinc-300"}`}>{item.label}</button>
          ))}
        </div>
      </nav>

      <div onTouchStart={onSwipeStart} onTouchEnd={onSwipeEnd} className="touch-pan-y">
      {tab === "overview" && (
        <div className="mt-5 space-y-4 sm:mt-7 sm:space-y-5">
          <section className="grid gap-4 lg:grid-cols-[0.85fr_1.55fr]">
            <div className={`relative overflow-hidden rounded-[28px] border border-black/10 p-6 text-black sm:p-7 ${overallTone === "good" ? "bg-[#8EF7A4]" : overallTone === "warn" ? "bg-[#FFB28F]" : "bg-[#C9C7FF]"}`}>
              <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/5 blur-3xl" />
              <div className="relative flex items-center justify-between gap-6">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-50">오늘 몸 상태</div>
                  <div className="mt-2 text-5xl font-black tracking-[-0.06em] sm:text-6xl">{overallLabel}</div>
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
                    <p className={`${recoveryExpanded ? "" : "line-clamp-4"} whitespace-pre-wrap break-words text-sm font-medium leading-7 opacity-65`}>
                      {String(recoveryText)}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecoveryExpanded((v) => !v)}
                    className="mt-2 rounded-lg px-1 py-1 text-xs font-bold text-black/60 transition hover:text-black"
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
        <div className="mt-5 space-y-4 sm:mt-7 sm:space-y-5">
          <section className="rounded-[28px] border border-black/10 bg-[#F4F1E8] p-6 text-black sm:p-8">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] opacity-50"><Icon name="spark" className="h-4 w-4" />오늘의 쉬운 요약</div>
            <h2 className="mt-4 max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
              {overallTone === "good" ? "몸 상태는 좋다. 오늘 계획한 훈련을 해도 괜찮다." : overallTone === "warn" ? "오늘은 기록 욕심보다 회복이 먼저다." : "몸 상태는 무난하다. 예정된 훈련을 과하게만 하지 말자."}
            </h2>
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
        const currentWeekIndex = eightWeekRotationIndex();
        const plan = detailedTrainingCycle[currentWeekIndex];
        const tuesdayVariant = plan.tuesdayGroups[trainingGroup];
        const hardStop = overallTone === "warn" || (hrvDev !== null && hrvDev <= -10) || (sleep !== null && sleep < 6) || (loadRatio !== null && loadRatio > 1.35);
        const cautious = !hardStop && ((hrvDev !== null && hrvDev < -4) || (loadRatio !== null && loadRatio > 1.15));
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
        const selectedSpec = trainingDay === "tuesday"
          ? tuesdayVariant[trainingVenue]
          : trainingVenue === "track" ? plan.thursdayOutdoor : plan.thursdayTreadmill;
        const selectedTone = trainingDay === "tuesday" ? tueTone : thuTone;
        const selectedStatus = hardStop ? "HOLD" : cautious ? "REDUCE" : "GO";
        const selectedTitle = trainingDay === "tuesday" ? plan.tuesdayTitle : plan.thursdayTitle;
        const selectedDate = trainingDay === "tuesday" ? nextWeekdayLabel(2) : nextWeekdayLabel(4);

        return (
          <div className="mt-5 space-y-4 sm:mt-7 sm:space-y-5">
            <section className="rounded-[28px] border border-zinc-800 bg-zinc-950/75 p-4 sm:p-5">
              <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-600">TRAINING CONTROL</div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div>
                      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-600">DAY</div>
                      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-black p-1">
                        <button onClick={() => setTrainingDay("tuesday")} className={`rounded-xl px-3 py-2.5 text-xs font-bold transition ${trainingDay === "tuesday" ? "bg-[#8EE8FF] text-black" : "text-zinc-500"}`}>화요일 평지</button>
                        <button onClick={() => setTrainingDay("thursday")} className={`rounded-xl px-3 py-2.5 text-xs font-bold transition ${trainingDay === "thursday" ? "bg-[#FFE348] text-black" : "text-zinc-500"}`}>목요일 업힐</button>
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-600">GROUP</div>
                      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-black p-1">
                        {(Object.keys(trainingGroupLabels) as TrainingGroup[]).map((group) => (
                          <button key={group} onClick={() => setTrainingGroup(group)} className={`rounded-xl px-2 py-2.5 text-xs font-bold transition ${trainingGroup === group ? "bg-white text-black" : "text-zinc-500"}`}>{trainingGroupLabels[group]}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-600">VENUE</div>
                      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-black p-1">
                        {(Object.keys(trainingVenueLabels) as TrainingVenue[]).map((venue) => (
                          <button key={venue} onClick={() => setTrainingVenue(venue)} className={`rounded-xl px-3 py-2.5 text-xs font-bold transition ${trainingVenue === venue ? "bg-[#C9C7FF] text-black" : "text-zinc-500"}`}>{trainingVenueLabels[venue]}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 lg:justify-end">
                  <span className={`rounded-full border px-3 py-1.5 text-xs font-bold ${toneClasses[selectedTone].badge}`}>{executionLabel}</span>
                </div>
              </div>
              {trainingDay === "thursday" && <div className="mt-3 text-[11px] leading-5 text-zinc-600">목요일 업힐은 조별 페이스가 아니라 공통 세션이므로 특조/1조/2조 선택은 화요일 세션에만 반영돼.</div>}
            </section>

            <section className="rounded-[30px] border border-zinc-800 bg-zinc-950/70 p-4 sm:p-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600">WEEK {plan.week} · {plan.focus}</div>
                  <h3 className="mt-2 text-2xl font-black tracking-[-0.04em]">{selectedDate} · {selectedTitle}</h3>
                  <div className="mt-2 text-sm leading-6 text-zinc-500">{executionText}</div>
                </div>
                <div className="text-right text-[11px] leading-5 text-zinc-600">{trainingGroupLabels[trainingGroup]} · {trainingVenueLabels[trainingVenue]}<br />{raceModeLabels[raceMode]}</div>
              </div>

              <div className="mt-5">
                <TrainingInfographicCard spec={selectedSpec} day={trainingDay} venue={trainingVenue} status={selectedStatus} />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-[22px] border border-zinc-800 bg-black/35 p-4"><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-600">WARM UP</div><div className="mt-2 text-sm font-semibold leading-6 text-zinc-300">15–20분 easy + 러닝드릴 + 20초 스트라이드 4회</div></div>
                <div className="rounded-[22px] border border-zinc-800 bg-black/35 p-4"><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-600">STOP SIGNAL</div><div className="mt-2 text-sm font-semibold leading-6 text-zinc-300">폼 붕괴 · 목표 대비 3% 이상 저하 · 비정상 어지럼이면 즉시 종료</div></div>
                <div className="rounded-[22px] border border-zinc-800 bg-black/35 p-4"><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-600">COOL DOWN</div><div className="mt-2 text-sm font-semibold leading-6 text-zinc-300">10–15분 easy. 다음날은 완전 easy 또는 휴식</div></div>
              </div>

              <div className="mt-4 rounded-[22px] border border-zinc-800 bg-black/25 p-4 text-sm leading-6 text-zinc-500"><span className="font-semibold text-zinc-300">{raceModeLabels[raceMode]} 보정 · </span>{modeModifier[raceMode]}</div>
            </section>

            <section className="rounded-[28px] border border-zinc-800 bg-zinc-950/70 p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div><div className="text-sm text-zinc-500">8주 전체 보기</div><h3 className="mt-1 text-xl font-semibold">{trainingGroupLabels[trainingGroup]} · {trainingVenueLabels[trainingVenue]}</h3></div>
                <div className="flex gap-1 rounded-2xl bg-black p-1">
                  {(Object.keys(raceModeLabels) as RaceMode[]).map((mode) => <button key={mode} onClick={() => setRaceMode(mode)} className={`rounded-xl px-2.5 py-2 text-[10px] font-bold transition ${raceMode === mode ? "bg-white text-black" : "text-zinc-600"}`}>{raceModeLabels[mode]}</button>)}
                </div>
              </div>
              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                {detailedTrainingCycle.map((w, i) => {
                  const tue = w.tuesdayGroups[trainingGroup][trainingVenue];
                  const thu = trainingVenue === "track" ? w.thursdayOutdoor : w.thursdayTreadmill;
                  return (
                    <div key={w.week} className={`rounded-[22px] border p-4 ${i === currentWeekIndex ? "border-violet-500/60 bg-violet-950/20" : "border-zinc-900 bg-black/25"}`}>
                      <div className="flex items-center justify-between gap-3"><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-600">WEEK {w.week}</div>{i === currentWeekIndex && <span className="rounded-full bg-white px-2.5 py-1 text-[9px] font-black text-black">CURRENT</span>}</div>
                      <div className="mt-2 font-bold text-zinc-200">{w.focus}</div>
                      <div className="mt-4 grid gap-3">
                        <button type="button" onClick={() => { setTrainingDay("tuesday"); }} className="rounded-2xl bg-cyan-950/20 p-3 text-left">
                          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-400">TUE</div>
                          <div className="mt-1 text-sm font-semibold leading-6 text-zinc-300">{tue.work}</div>
                          <div className="mt-1 text-xs leading-5 text-zinc-600">{tue.lap400 ?? tue.pace}</div>
                        </button>
                        <button type="button" onClick={() => { setTrainingDay("thursday"); }} className="rounded-2xl bg-amber-950/20 p-3 text-left">
                          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-400">THU</div>
                          <div className="mt-1 text-sm font-semibold leading-6 text-zinc-300">{thu.work}</div>
                          <div className="mt-1 text-xs leading-5 text-zinc-600">{thu.pace}</div>
                        </button>
                      </div>
                    </div>
                  );
                })}
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
          <div className="mt-5 space-y-4 sm:mt-7 sm:space-y-5">
            <section className="relative overflow-hidden rounded-[28px] border border-black/10 bg-[#E7FF43] p-6 text-black sm:p-8">
              <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
              <div className="relative grid gap-8 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.24em] text-zinc-500"><span className="h-2 w-2 rounded-full bg-cyan-300" />Peak / Progress</div>
                  <div className="mt-5 flex items-end gap-3">
                    <div className="text-6xl font-bold tracking-[-0.06em] sm:text-7xl">{match === null ? "—" : n(match, 0)}</div>
                    <div className="pb-2 text-lg font-bold opacity-45">% OF PEAK</div>
                  </div>
                  <p className="mt-4 max-w-xl text-sm font-medium leading-7 opacity-60">
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
        <div className="mt-5 space-y-4 sm:mt-7 sm:space-y-5">
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
        <div className="mt-5 space-y-4 sm:mt-7 sm:space-y-5">
        <section className="rounded-[28px] border border-zinc-800 bg-zinc-950/80 p-5 sm:p-7">
          <div className="flex items-center justify-between gap-4"><div><div className="text-sm text-zinc-500">AI Coach</div><h2 className="mt-1 text-2xl font-semibold">Claude Coach</h2></div><span className="rounded-full bg-emerald-950 px-3 py-1 text-xs text-emerald-300">live</span></div>
          {coachEntries.length ? <div className="mt-6 grid gap-4 xl:grid-cols-2">{coachEntries.map(([key, value]) => <article key={key} className="rounded-2xl border border-zinc-800 bg-black p-5"><h3 className="text-base font-semibold">{titleize(key)}</h3><div className="mt-4 text-sm"><ValueView value={value} /></div></article>)}</div> : <div className="mt-6 text-zinc-500">코칭 내용이 비어 있습니다.</div>}
        </section>
        </div>
      )}
      </div>
    </Shell>
  );
}
