import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import * as d3 from "d3";
import { formatEther, parseEther } from "viem";
import {
  adjudicate,
  autoSettle,
  fileClaim,
  fundBond,
  getCase,
  getCounts,
  getPoolBalance,
  listAll,
  type QuakeCaseView,
  type QuakeRow,
  type Verdict,
} from "./contractService";
type Hex = `0x${string}`;
type IntensityBand = "pending" | "low" | "moderate" | "severe";

const STATUS_LABEL = ["Filed", "Ruled", "Settled"];
const SEVERE_THRESHOLD = 7;
const MODERATE_THRESHOLD = 4;
const PREFERS_REDUCED =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function shortAddr(value: string): string {
  return value && value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value || "-";
}

function gen(wei: string): string {
  if (!wei || wei === "0") return "0";
  try {
    const value = formatEther(BigInt(wei));
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return value;
    if (numberValue === 0) return "0";
    if (numberValue >= 100) return numberValue.toFixed(0);
    if (numberValue >= 1) return numberValue.toFixed(3).replace(/\.?0+$/, "");
    return numberValue.toPrecision(3);
  } catch {
    return "0";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function intensityBand(row: Pick<QuakeCaseView, "mmi" | "verdict"> | null | undefined): IntensityBand {
  if (!row || !row.verdict) return "pending";
  if (row.verdict === "SEVERE_SHAKE" || row.mmi >= SEVERE_THRESHOLD) return "severe";
  if (row.verdict === "MODERATE" || row.mmi >= MODERATE_THRESHOLD) return "moderate";
  return "low";
}

function verdictText(verdict: Verdict): string {
  return verdict ? verdict.replace("_", " ") : "Pending";
}

function hashPoint(row: QuakeRow): { left: number; top: number } {
  const seed = `${row.id}:${row.epicenter}:${row.claimant}`;
  let hash = 17;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 100_000;
  }
  const angle = ((hash % 360) * Math.PI) / 180;
  const radius = 20 + (hash % 36);
  return {
    left: clamp(50 + Math.cos(angle) * radius * 0.78, 13, 87),
    top: clamp(50 + Math.sin(angle) * radius * 0.58, 15, 85),
  };
}

function Sparkline({ rows }: { rows: QuakeRow[] }) {
  const ref = useRef<SVGSVGElement | null>(null);
  const data = useMemo(() => rows.slice().reverse(), [rows]);

  useEffect(() => {
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();

    const width = 300;
    const height = 54;
    const pad = { x: 8, y: 8 };

    if (data.length === 0) {
      svg
        .append("line")
        .attr("x1", pad.x)
        .attr("x2", width - pad.x)
        .attr("y1", height / 2)
        .attr("y2", height / 2)
        .attr("class", "mini-flat");
      return;
    }

    const x = d3
      .scaleLinear()
      .domain([0, Math.max(1, data.length - 1)])
      .range([pad.x, width - pad.x]);
    const y = d3.scaleLinear().domain([0, 12]).range([height - pad.y, pad.y]);
    const area = d3
      .area<QuakeRow>()
      .x((_, index) => x(index))
      .y0(height - pad.y)
      .y1((d) => y(d.mmi || 0))
      .curve(d3.curveMonotoneX);
    const line = d3
      .line<QuakeRow>()
      .x((_, index) => x(index))
      .y((d) => y(d.mmi || 0))
      .curve(d3.curveMonotoneX);

    svg.append("path").datum(data).attr("d", area).attr("class", "mini-area");
    svg.append("path").datum(data).attr("d", line).attr("class", "mini-line");
    svg
      .append("g")
      .selectAll("circle")
      .data(data.filter((row) => row.verdict))
      .join("circle")
      .attr("cx", (d) => x(data.indexOf(d)))
      .attr("cy", (d) => y(d.mmi || 0))
      .attr("r", 2.5)
      .attr("class", (d) => `mini-dot band-${intensityBand(d)}`);
  }, [data]);

  return <svg ref={ref} className="sparkline" viewBox="0 0 300 54" preserveAspectRatio="none" />;
}

function SeismicTimeline({ rows, selectedId }: { rows: QuakeRow[]; selectedId: number | null }) {
  const ref = useRef<SVGSVGElement | null>(null);
  const data = useMemo(() => rows.slice().reverse(), [rows]);

  useEffect(() => {
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();

    const width = 780;
    const height = 230;
    const pad = { left: 48, right: 24, top: 18, bottom: 32 };
    const x = d3
      .scaleLinear()
      .domain([0, Math.max(1, data.length - 1)])
      .range([pad.left, width - pad.right]);
    const y = d3.scaleLinear().domain([0, 12]).range([height - pad.bottom, pad.top]);

    const grid = svg.append("g").attr("class", "timeline-grid");
    [0, 4, 7, 12].forEach((tick) => {
      grid
        .append("line")
        .attr("x1", pad.left)
        .attr("x2", width - pad.right)
        .attr("y1", y(tick))
        .attr("y2", y(tick))
        .attr("class", tick === 4 || tick === 7 ? "threshold" : "base");
      grid
        .append("text")
        .attr("x", 8)
        .attr("y", y(tick))
        .attr("dy", "0.35em")
        .attr("class", "axis-label")
        .text(`MMI ${tick}`);
    });

    grid
      .append("text")
      .attr("x", width - pad.right)
      .attr("y", y(7) - 8)
      .attr("text-anchor", "end")
      .attr("class", "threshold-label severe")
      .text("severe payout trigger");
    grid
      .append("text")
      .attr("x", width - pad.right)
      .attr("y", y(4) - 8)
      .attr("text-anchor", "end")
      .attr("class", "threshold-label moderate")
      .text("moderate observation band");

    if (data.length === 0) {
      svg
        .append("text")
        .attr("x", width / 2)
        .attr("y", height / 2)
        .attr("text-anchor", "middle")
        .attr("class", "timeline-empty")
        .text("No quake claims yet. The trace will render after the first filing.");
      return;
    }

    const curve = d3
      .line<QuakeRow>()
      .x((_, index) => x(index))
      .y((d) => y(d.mmi || 0))
      .curve(d3.curveCatmullRom.alpha(0.45));

    const area = d3
      .area<QuakeRow>()
      .x((_, index) => x(index))
      .y0(y(0))
      .y1((d) => y(d.mmi || 0))
      .curve(d3.curveCatmullRom.alpha(0.45));

    svg.append("path").datum(data).attr("d", area).attr("class", "timeline-area");
    const path = svg.append("path").datum(data).attr("d", curve).attr("class", "timeline-line");
    const pathNode = path.node();
    if (pathNode && !PREFERS_REDUCED) {
      const length = pathNode.getTotalLength();
      path
        .attr("stroke-dasharray", `${length} ${length}`)
        .attr("stroke-dashoffset", length)
        .transition()
        .duration(900)
        .ease(d3.easeCubicOut)
        .attr("stroke-dashoffset", 0);
    }

    svg
      .append("g")
      .selectAll("circle")
      .data(data)
      .join("circle")
      .attr("cx", (_, index) => x(index))
      .attr("cy", (d) => y(d.mmi || 0))
      .attr("r", (d) => (d.id === selectedId ? 6 : 4))
      .attr("class", (d) => `timeline-dot band-${intensityBand(d)} ${d.id === selectedId ? "active" : ""}`);

    svg
      .append("g")
      .selectAll("text")
      .data(data)
      .join("text")
      .attr("x", (_, index) => x(index))
      .attr("y", height - 8)
      .attr("text-anchor", "middle")
      .attr("class", "event-id")
      .text((d) => `#${d.id}`);
  }, [data, selectedId]);

  return <svg ref={ref} className="timeline-chart" viewBox="0 0 780 230" preserveAspectRatio="xMidYMid meet" />;
}

function EpicenterMap({
  active,
  rows,
  onSelect,
}: {
  active: QuakeRow | null;
  rows: QuakeRow[];
  onSelect: (id: number) => void;
}) {
  const visibleRows = rows.slice(0, 18);
  const activeBand = intensityBand(active);

  return (
    <section className="epicenter-stage" aria-label="Epicenter visualization">
      <div className="stage-topline">
        <span>Epicenter rings</span>
        <code>MMI &gt;= 7 payout</code>
      </div>
      <div className={`quake-radar band-${activeBand}`}>
        <span className="fault fault-a" />
        <span className="fault fault-b" />
        <span className="fault fault-c" />
        <span className="ring ring-1" />
        <span className="ring ring-2" />
        <span className="ring ring-3" />
        <span className="ring ring-4" />
        <span className="pulse pulse-a" />
        <span className="pulse pulse-b" />
        <div className="radar-core">
          <span className="core-label">active claim</span>
          <strong>{active ? `#${active.id}` : "--"}</strong>
          <small>{active ? active.epicenter || "Unknown epicenter" : "Awaiting first claim"}</small>
        </div>

        {visibleRows.map((row) => {
          const point = hashPoint(row);
          const band = intensityBand(row);
          return (
            <button
              key={row.id}
              type="button"
              className={`quake-marker band-${band} ${active?.id === row.id ? "active" : ""}`}
              style={{ left: `${point.left}%`, top: `${point.top}%` } as CSSProperties}
              onClick={() => onSelect(row.id)}
              aria-label={`Select claim ${row.id}, ${row.epicenter || "unknown epicenter"}`}
            >
              <span />
              <b>#{row.id}</b>
            </button>
          );
        })}
      </div>

      <div className="stage-readout">
        <div>
          <span>verdict</span>
          <strong className={`band-text band-${activeBand}`}>{active ? verdictText(active.verdict) : "No event"}</strong>
        </div>
        <div>
          <span>MMI</span>
          <strong>{active ? `${active.mmi || "-"} / 12` : "- / 12"}</strong>
        </div>
        <div>
          <span>requested</span>
          <strong>{active ? `${gen(active.requested)} GEN` : "0 GEN"}</strong>
        </div>
      </div>
    </section>
  );
}

export function App() {
  const { address, isConnected } = useAccount();
  const account = address as Hex | undefined;

  const [rows, setRows] = useState<QuakeRow[]>([]);
  const [counts, setCounts] = useState({ next: 0, ruled: 0, severe: 0 });
  const [pool, setPool] = useState("0");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedCase, setSelectedCase] = useState<QuakeCaseView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [networkDown, setNetworkDown] = useState(false);

  const [epicenter, setEpicenter] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [requested, setRequested] = useState("");
  const [bondAmount, setBondAmount] = useState("");

  const refreshAll = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const [nextCounts, nextPool, nextRows] = await Promise.all([getCounts(), getPoolBalance(), listAll(50)]);
      setCounts(nextCounts);
      setPool(nextPool.split("||")[0] || "0");
      setRows(nextRows);
      if (selectedId != null) {
        try {
          setSelectedCase(await getCase(selectedId));
        } catch {
          setSelectedCase(null);
        }
      }
      setNetworkDown(false);
    } catch {
      setNetworkDown(true);
    }
  }, [selectedId]);

  useEffect(() => {
    void refreshAll();
    const timer = window.setInterval(() => void refreshAll(), 12_000);
    const onVisibility = () => {
      if (!document.hidden) void refreshAll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshAll]);

  useEffect(() => {
    if (selectedId === null && rows.length > 0) {
      setSelectedId(rows[0].id);
    }
  }, [rows, selectedId]);

  const activeCase = useMemo<QuakeRow | null>(() => {
    if (selectedId == null) return rows[0] ?? null;
    const row = rows.find((item) => item.id === selectedId) ?? null;
    if (selectedCase) return { id: selectedId, ...selectedCase };
    return row;
  }, [rows, selectedCase, selectedId]);

  const settledCount = useMemo(() => rows.filter((row) => row.status === 2).length, [rows]);
  const pendingCount = useMemo(() => rows.filter((row) => row.status === 0).length, [rows]);
  const activeBand = intensityBand(activeCase);

  async function pickCase(id: number) {
    setSelectedId(id);
    setSelectedCase(null);
    try {
      setSelectedCase(await getCase(id));
    } catch {
      setSelectedCase(null);
    }
  }

  async function run<T>(label: string, task: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setNote("");
    try {
      return await task();
    } catch (error) {
      setNote(String((error as Error).message || error).slice(0, 240));
      return undefined;
    } finally {
      setBusy(null);
      void refreshAll();
    }
  }

  async function onFundBond() {
    if (!account) return;
    if (!(Number(bondAmount) > 0)) {
      setNote("Enter a bond amount in GEN, for example 1.5.");
      return;
    }
    await run("Funding the quake bond", () => fundBond(account, parseEther(bondAmount.trim())));
    setBondAmount("");
  }

  async function onFileClaim() {
    if (!account) return;
    if (epicenter.trim().length < 2) {
      setNote("Epicenter is required.");
      return;
    }
    if (!/^https?:\/\//.test(evidenceUrl.trim())) {
      setNote("Evidence URL must start with http:// or https://.");
      return;
    }
    if (!(Number(requested) > 0)) {
      setNote("Requested payout must be a positive GEN amount.");
      return;
    }

    const claimId = await run("Filing quake claim", () =>
      fileClaim(account, {
        epicenter,
        evidenceUrl,
        requestedWei: parseEther(requested.trim()),
      }),
    );

    if (typeof claimId === "number") {
      setSelectedId(claimId);
      setEpicenter("");
      setEvidenceUrl("");
      setRequested("");
      setNote(`Claim #${claimId} filed. Run adjudication when evidence is ready.`);
    }
  }

  async function onAdjudicate() {
    if (!account || selectedId == null) return;
    await run("Reading seismic evidence", () => adjudicate(account, selectedId));
  }

  async function onAutoSettle() {
    if (!account || selectedId == null) return;
    await run("Auto-settling quake bond", () => autoSettle(account, selectedId));
  }

  const evidenceIsValid = /^https?:\/\//.test(evidenceUrl.trim());
  const canFile = Boolean(isConnected && !busy && epicenter.trim().length >= 2 && evidenceIsValid && Number(requested) > 0);
  const canFund = Boolean(isConnected && !busy && Number(bondAmount) > 0);

  return (
    <div className="quake-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>Quake Bond</h1>
            <p>Seismic catastrophe desk</p>
          </div>
        </div>

        <div className="network-strip">
          <span className={`live-chip ${networkDown ? "down" : ""}`}>
            <i />
            {networkDown ? "reconnecting" : "studionet live"}
          </span>
          <ConnectButton showBalance={false} chainStatus="none" accountStatus="address" />
        </div>
      </header>

      <section className="metric-ribbon" aria-label="Bond metrics">
        <article>
          <span>bond pool</span>
          <strong>{gen(pool)} GEN</strong>
          <small>available cover</small>
        </article>
        <article>
          <span>claims</span>
          <strong>{counts.next}</strong>
          <small>{pendingCount} pending</small>
        </article>
        <article>
          <span>ruled</span>
          <strong>{counts.ruled}</strong>
          <small>validator decisions</small>
        </article>
        <article>
          <span>severe</span>
          <strong>{counts.severe}</strong>
          <small>MMI &gt;= 7</small>
        </article>
        <article>
          <span>settled</span>
          <strong>{settledCount}</strong>
          <small>closed cases</small>
        </article>
      </section>

      <main className="command-grid">
        <aside className="claim-panel">
          <div className="panel-heading">
            <span>claim queue</span>
            <code>{rows.length} rows</code>
          </div>

          <div className="claim-list">
            {rows.length === 0 ? (
              <p className="empty-state">No quake filings yet.</p>
            ) : (
              rows.map((row) => {
                const band = intensityBand(row);
                return (
                  <button
                    key={row.id}
                    type="button"
                    className={`claim-row band-${band} ${row.id === activeCase?.id ? "active" : ""}`}
                    onClick={() => pickCase(row.id)}
                  >
                    <span className="claim-id">#{row.id}</span>
                    <span className="claim-main">
                      <strong>{row.epicenter || "Unknown epicenter"}</strong>
                      <small>{shortAddr(row.claimant)} - {gen(row.requested)} GEN</small>
                    </span>
                    <span className={`status-dot status-${row.status}`}>{STATUS_LABEL[row.status] || row.status}</span>
                  </button>
                );
              })
            )}
          </div>

          <div className="mini-monitor">
            <span>magnitude drift</span>
            <Sparkline rows={rows} />
          </div>
        </aside>

        <EpicenterMap active={activeCase} rows={rows} onSelect={pickCase} />

        <aside className="action-panel">
          <div className="panel-heading">
            <span>MMI intensity</span>
            <code>{activeCase ? `claim #${activeCase.id}` : "no selection"}</code>
          </div>

          <div className={`mmi-card band-${activeBand}`}>
            <div className="meter">
              {Array.from({ length: 13 }, (_, index) => 12 - index).map((tick) => (
                <span key={tick} className={tick === SEVERE_THRESHOLD || tick === MODERATE_THRESHOLD ? "trigger" : ""}>
                  {tick}
                </span>
              ))}
              <i style={{ height: `${activeCase ? clamp((activeCase.mmi / 12) * 100, 0, 100) : 0}%` }} />
            </div>
            <div className="mmi-read">
              <span>current reading</span>
              <strong>{activeCase ? activeCase.mmi || "-" : "-"}</strong>
              <small>{activeCase ? verdictText(activeCase.verdict) : "Select or file a claim"}</small>
            </div>
          </div>

          <div className="selected-dossier">
            <div className="dossier-row">
              <span>status</span>
              <b>{activeCase ? STATUS_LABEL[activeCase.status] || activeCase.status : "-"}</b>
            </div>
            <div className="dossier-row">
              <span>epicenter</span>
              <code>{activeCase?.epicenter || "-"}</code>
            </div>
            <div className="dossier-row">
              <span>requested</span>
              <code>{activeCase ? `${gen(activeCase.requested)} GEN` : "-"}</code>
            </div>
            <div className="dossier-row">
              <span>paid</span>
              <code>{activeCase ? `${gen(activeCase.paid)} GEN` : "-"}</code>
            </div>
            <div className="dossier-row">
              <span>evidence</span>
              {activeCase?.evidenceUrl ? (
                <a href={activeCase.evidenceUrl} target="_blank" rel="noreferrer">
                  source
                </a>
              ) : (
                <code>-</code>
              )}
            </div>
          </div>

          {activeCase?.rationale && <p className="rationale">{activeCase.rationale}</p>}

          <div className="action-stack">
            {activeCase?.status === 0 && (
              <button type="button" className="primary-action" disabled={!isConnected || Boolean(busy)} onClick={onAdjudicate}>
                Read evidence and rule
              </button>
            )}
            {activeCase?.status === 1 && (
              <button type="button" className="primary-action" disabled={!isConnected || Boolean(busy)} onClick={onAutoSettle}>
                Auto-settle bond
              </button>
            )}
            {activeCase?.status === 2 && <p className="settled-note">Case settled. Bond movement is closed.</p>}
            {!activeCase && <p className="settled-note">File a claim to activate the desk.</p>}
          </div>
        </aside>
      </main>

      <section className="lower-grid">
        <form
          className="desk-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onFileClaim();
          }}
        >
          <div className="panel-heading">
            <span>file quake claim</span>
            <code>USGS evidence required</code>
          </div>
          <label>
            Epicenter
            <input value={epicenter} onChange={(event) => setEpicenter(event.target.value)} placeholder="Kahramanmaras region" />
          </label>
          <label>
            Evidence URL
            <input
              value={evidenceUrl}
              onChange={(event) => setEvidenceUrl(event.target.value)}
              placeholder="https://earthquake.usgs.gov/earthquakes/eventpage/..."
            />
          </label>
          <label>
            Requested payout (GEN)
            <input value={requested} onChange={(event) => setRequested(event.target.value)} inputMode="decimal" placeholder="1.5" />
          </label>
          <button type="submit" className="primary-action" disabled={!canFile}>
            {isConnected ? "File claim" : "Connect wallet"}
          </button>
        </form>

        <form
          className="desk-form compact"
          onSubmit={(event) => {
            event.preventDefault();
            void onFundBond();
          }}
        >
          <div className="panel-heading">
            <span>fund bond</span>
            <code>{gen(pool)} GEN pool</code>
          </div>
          <label>
            Amount (GEN)
            <input value={bondAmount} onChange={(event) => setBondAmount(event.target.value)} inputMode="decimal" placeholder="2.0" />
          </label>
          <button type="submit" className="secondary-action" disabled={!canFund}>
            Stake cover
          </button>
          <p className="form-note">Funds backstop severe quake payouts after adjudication.</p>
        </form>

        <section className="timeline-panel">
          <div className="panel-heading">
            <span>seismic event timeline</span>
            <code>MMI trace</code>
          </div>
          <SeismicTimeline rows={rows} selectedId={activeCase?.id ?? null} />
        </section>
      </section>

      {(busy || note) && (
        <div className={`toast ${busy ? "busy" : ""}`} aria-live="polite">
          {busy ? `${busy}...` : note}
        </div>
      )}
    </div>
  );
}
