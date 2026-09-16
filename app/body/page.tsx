"use client";

import { useEffect, useMemo, useState } from "react";

type BodyRow = {
  id?: number;
  measured_at: string;
  weight_kg: number | null;
  skeletal_muscle_mass_kg: number | null;
  body_fat_mass_kg: number | null;
  body_fat_percent: number | null;
  bmi: number | null;
  basal_metabolic_rate_kcal: number | null;
  visceral_fat_level: number | null;
  ecw_ratio: number | null;
  source?: string | null;
};

const TOKEN_KEY = "jackson-body-private-token";

function num(v: unknown) {
  const n = Number(String(v ?? "").replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function dateToLocalInput(d = new Date()) {
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

const aliases: Record<keyof Omit<BodyRow, "id" | "source">, string[]> = {
  measured_at: ["measured_at", "측정일", "측정일시", "측정날짜", "date", "datetime", "measurementdate", "measurementtime"],
  weight_kg: ["weight_kg", "체중", "weight", "weightkg"],
  skeletal_muscle_mass_kg: ["skeletal_muscle_mass_kg", "골격근량", "skeletalmusclemass", "smm"],
  body_fat_mass_kg: ["body_fat_mass_kg", "체지방량", "bodyfatmass", "bfm"],
  body_fat_percent: ["body_fat_percent", "체지방률", "bodyfatpercent", "percentbodyfat", "pbf"],
  bmi: ["bmi", "체질량지수"],
  basal_metabolic_rate_kcal: ["basal_metabolic_rate_kcal", "기초대사량", "basalmetabolicrate", "bmr"],
  visceral_fat_level: ["visceral_fat_level", "내장지방레벨", "내장지방", "visceralfatlevel", "vfl"],
  ecw_ratio: ["ecw_ratio", "세포외수분비", "ecwtbw", "ecwratio"],
};

function norm(s: string) {
  return s.toLowerCase().replace(/[\s_()%/.-]/g, "").replace(/kg|kcal/g, "");
}

function splitCsvLine(line: string, delimiter: string) {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      out.push(cur.trim()); cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseCsv(text: string): BodyRow[] {
  const cleaned = text.replace(/^\uFEFF/, "").trim();
  if (!cleaned) return [];
  const lines = cleaned.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = splitCsvLine(lines[0], delimiter);
  const normalized = headers.map(norm);

  const idx = (key: keyof Omit<BodyRow, "id" | "source">) => {
    const candidates = aliases[key].map(norm);
    return normalized.findIndex((h) => candidates.includes(h));
  };
  const indexes = Object.fromEntries(Object.keys(aliases).map((k) => [k, idx(k as any)])) as Record<string, number>;

  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line, delimiter);
    const pick = (key: string) => indexes[key] >= 0 ? cells[indexes[key]] : "";
    const rawDate = pick("measured_at");
    const parsedDate = rawDate ? new Date(rawDate.replace(/\./g, "-")) : null;
    const measured = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : "";
    return {
      measured_at: measured,
      weight_kg: num(pick("weight_kg")),
      skeletal_muscle_mass_kg: num(pick("skeletal_muscle_mass_kg")),
      body_fat_mass_kg: num(pick("body_fat_mass_kg")),
      body_fat_percent: num(pick("body_fat_percent")),
      bmi: num(pick("bmi")),
      basal_metabolic_rate_kcal: num(pick("basal_metabolic_rate_kcal")),
      visceral_fat_level: num(pick("visceral_fat_level")),
      ecw_ratio: num(pick("ecw_ratio")),
      source: "inbody",
    };
  }).filter((row) => row.measured_at);
}

function metric(v: number | null | undefined, suffix = "") {
  return v === null || v === undefined ? "—" : `${v}${suffix}`;
}

export default function BodyAdminPage() {
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<BodyRow[]>([]);
  const [csvRows, setCsvRows] = useState<BodyRow[]>([]);
  const [form, setForm] = useState({
    measured_at: dateToLocalInput(), weight_kg: "", skeletal_muscle_mass_kg: "", body_fat_mass_kg: "",
    body_fat_percent: "", bmi: "", basal_metabolic_rate_kcal: "", visceral_fat_level: "", ecw_ratio: "",
  });

  useEffect(() => {
    const saved = window.sessionStorage.getItem(TOKEN_KEY) || window.localStorage.getItem(TOKEN_KEY) || "";
    if (saved) { setToken(saved); setRemember(Boolean(window.localStorage.getItem(TOKEN_KEY))); }
  }, []);

  const endpoint = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return url ? `${url.replace(/\/$/, "")}/functions/v1/body-composition` : "";
  }, []);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  async function callBody(body: any) {
    if (!endpoint || !anonKey) throw new Error("Supabase 공개 환경변수가 없습니다.");
    if (!token.trim()) throw new Error("BODY PRIVATE token을 입력하세요.");
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${anonKey}`, "x-admin-token": token.trim() },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error ?? `BODY API 오류 (${res.status})`);
    if (remember) window.localStorage.setItem(TOKEN_KEY, token.trim());
    else { window.sessionStorage.setItem(TOKEN_KEY, token.trim()); window.localStorage.removeItem(TOKEN_KEY); }
    return payload;
  }

  async function loadHistory() {
    setBusy(true); setStatus("");
    try { const p = await callBody({ action: "history", limit: 36 }); setHistory(p.rows ?? []); setStatus("BODY PRIVATE 연결 완료"); }
    catch (e) { setStatus(e instanceof Error ? e.message : "불러오기 실패"); }
    finally { setBusy(false); }
  }

  async function saveManual() {
    const row = {
      measured_at: new Date(form.measured_at).toISOString(), source: "inbody",
      weight_kg: num(form.weight_kg), skeletal_muscle_mass_kg: num(form.skeletal_muscle_mass_kg), body_fat_mass_kg: num(form.body_fat_mass_kg),
      body_fat_percent: num(form.body_fat_percent), bmi: num(form.bmi), basal_metabolic_rate_kcal: num(form.basal_metabolic_rate_kcal),
      visceral_fat_level: num(form.visceral_fat_level), ecw_ratio: num(form.ecw_ratio),
    };
    setBusy(true); setStatus("");
    try { const p = await callBody({ action: "upsert", row }); setStatus(`${p.saved ?? 1}개 측정값 저장 완료`); await loadHistory(); }
    catch (e) { setStatus(e instanceof Error ? e.message : "저장 실패"); }
    finally { setBusy(false); }
  }

  async function saveCsv() {
    if (!csvRows.length) { setStatus("먼저 CSV를 선택하세요."); return; }
    setBusy(true); setStatus("");
    try { const p = await callBody({ action: "upsert", rows: csvRows }); setStatus(`${p.saved ?? csvRows.length}개 CSV 측정값 저장 완료`); await loadHistory(); }
    catch (e) { setStatus(e instanceof Error ? e.message : "CSV 저장 실패"); }
    finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-black px-4 py-7 text-white" style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Apple SD Gothic Neo",sans-serif' }}>
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="flex items-end justify-between gap-4">
          <div><div className="text-[11px] font-black tracking-[.18em] text-white/35">JACKSON RUNNING ENGINE</div><h1 className="mt-1 text-4xl font-black tracking-[-.055em]">BODY PRIVATE</h1></div>
          <a href="/jackson-running/" className="rounded-full border border-white/15 px-4 py-2 text-xs font-black text-white/65">← ENGINE</a>
        </header>

        <section className="rounded-[24px] border border-white/10 bg-[#1C1C1E] p-5">
          <div className="text-[10px] font-black tracking-[.16em] text-[#30D158]">PRIVATE ACCESS</div>
          <p className="mt-2 text-sm leading-6 text-white/55">체성분 데이터는 public Supabase policy를 만들지 않는다. 이 token은 코드에 저장하지 않고 Edge Function에서만 검증한다.</p>
          <div className="mt-4 flex gap-2"><input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="INBODY_ADMIN_TOKEN" className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black px-4 py-3 text-sm outline-none"/><button onClick={loadHistory} disabled={busy} className="rounded-2xl bg-[#0A84FF] px-5 text-sm font-black disabled:opacity-40">UNLOCK</button></div>
          <label className="mt-3 flex items-center gap-2 text-xs text-white/45"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />이 기기에서 token 기억하기</label>
          {status && <div className="mt-3 text-xs font-bold text-white/55">{status}</div>}
        </section>

        <section className="rounded-[24px] border border-white/10 bg-[#1C1C1E] p-5">
          <div className="text-[10px] font-black tracking-[.16em] text-[#FFD60A]">MANUAL IMPORT</div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="col-span-2 sm:col-span-3 text-xs text-white/45">측정일<input type="datetime-local" value={form.measured_at} onChange={(e) => setForm({ ...form, measured_at: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black p-3 text-white"/></label>
            {[
              ["weight_kg","체중 kg"],["skeletal_muscle_mass_kg","골격근량 kg"],["body_fat_mass_kg","체지방량 kg"],["body_fat_percent","체지방률 %"],["bmi","BMI"],["basal_metabolic_rate_kcal","BMR kcal"],["visceral_fat_level","내장지방 레벨"],["ecw_ratio","ECW/TBW"],
            ].map(([key,label]) => <label key={key} className="text-xs text-white/45">{label}<input inputMode="decimal" value={(form as any)[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="mt-1 w-full rounded-xl border border-white/10 bg-black p-3 text-white outline-none"/></label>)}
          </div>
          <button onClick={saveManual} disabled={busy} className="mt-4 w-full rounded-2xl bg-[#30D158] py-3 text-sm font-black text-black disabled:opacity-40">SAVE MEASUREMENT</button>
        </section>

        <section className="rounded-[24px] border border-white/10 bg-[#1C1C1E] p-5">
          <div className="text-[10px] font-black tracking-[.16em] text-[#FF453A]">CSV IMPORT</div>
          <p className="mt-2 text-sm leading-6 text-white/50">InBody CSV의 한글/영문 헤더를 자동 매핑한다. 측정일, 체중, 골격근량, 체지방량/률, BMI, BMR, 내장지방, ECW/TBW를 인식한다.</p>
          <input type="file" accept=".csv,.txt" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const rows = parseCsv(await f.text()); setCsvRows(rows); setStatus(`${rows.length}개 행 인식`); }} className="mt-4 block w-full text-xs text-white/55"/>
          {csvRows.length > 0 && <div className="mt-4 overflow-x-auto rounded-xl bg-black p-3 text-xs text-white/55">{csvRows.slice(0,5).map((r,i) => <div key={i} className="border-b border-white/5 py-2 last:border-0">{new Date(r.measured_at).toLocaleDateString("ko-KR")} · {metric(r.weight_kg,"kg")} · SMM {metric(r.skeletal_muscle_mass_kg,"kg")} · PBF {metric(r.body_fat_percent,"%")}</div>)}</div>}
          <button onClick={saveCsv} disabled={busy || !csvRows.length} className="mt-4 w-full rounded-2xl bg-[#FF453A] py-3 text-sm font-black text-white disabled:opacity-30">IMPORT {csvRows.length || "CSV"}</button>
        </section>

        {history.length > 0 && <section className="rounded-[24px] border border-white/10 bg-[#1C1C1E] p-5"><div className="text-[10px] font-black tracking-[.16em] text-[#0A84FF]">HISTORY</div><div className="mt-4 space-y-2">{history.map((r) => <div key={`${r.id}-${r.measured_at}`} className="grid grid-cols-[1.2fr_1fr_1fr_1fr] gap-2 rounded-xl bg-black p-3 text-xs"><span className="text-white/45">{new Date(r.measured_at).toLocaleDateString("ko-KR")}</span><b>{metric(r.weight_kg,"kg")}</b><b>SMM {metric(r.skeletal_muscle_mass_kg,"kg")}</b><b>PBF {metric(r.body_fat_percent,"%")}</b></div>)}</div></section>}
      </div>
    </main>
  );
}
