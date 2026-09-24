"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Plug,
  Zap,
  Wallet,
  Settings,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  Download,
  MoreHorizontal,
  Leaf,
  QrCode,
  ExternalLink,
  Bell,
  HelpCircle,
  Copy,
  Check,
  LogOut,
  SlidersHorizontal,
  CreditCard,
  Code2,
  X,
  House,
} from "lucide-react";
import { Brand, Busy, ErrorMessage, Modal, post, SquidMark } from "./ui";
import { AddCharger } from "./add-charger";
import { QRSticker } from "./qr-sticker";
import { money } from "@/lib/money";
import type { DashboardData, HostSession, Property } from "@/lib/types";
type Tab = "overview" | "chargers" | "sessions" | "payouts" | "settings";
const nav = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "chargers", label: "My chargers", icon: Plug },
  { id: "sessions", label: "Charging sessions", icon: Zap },
  { id: "payouts", label: "Earnings & payouts", icon: Wallet },
] as const;
export function Dashboard({
  initial,
  demo = false,
}: {
  initial: DashboardData;
  demo?: boolean;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<Tab>("overview");
  const [days, setDays] = useState(30);
  const [search, setSearch] = useState("");
  const [add, setAdd] = useState(false);
  const [sticker, setSticker] = useState<Property | null>(null);
  const [manage, setManage] = useState<Property | null>(null);
  const [help, setHelp] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refund, setRefund] = useState<HostSession | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab");
    const setup = initial.properties.find((p) => p.id === params.get("setup"));
    if (setup && !demo) setManage(setup);
    if (
      t &&
      ["overview", "chargers", "sessions", "payouts", "settings"].includes(t)
    )
      setTab(t as Tab);
    if (demo) {
      try {
        const saved = JSON.parse(
          localStorage.getItem("squid-demo-properties") || "null",
        );
        if (
          Array.isArray(saved) &&
          saved.every(
            (p) => typeof p.id === "string" && typeof p.name === "string",
          )
        )
          setData((d) => ({ ...d, properties: saved }));
      } catch {}
    }
  }, [demo]);
  useEffect(() => {
    if (!demo) setData(initial);
  }, [initial, demo]);
  const sessions = useMemo(
    () =>
      data.sessions.filter(
        (s) => Date.now() - Date.parse(s.created_at) < days * 86400000,
      ),
    [data.sessions, days],
  );
  const paid = sessions.filter((s) => s.status === "completed");
  const gross = paid.reduce((sum, s) => sum + (s.total_cents ?? 0), 0);
  const fees = paid.reduce((sum, s) => sum + (s.fee_cents ?? 0), 0);
  const energy = sessions.reduce((sum, s) => sum + Number(s.energy_kwh), 0);
  const properties = data.properties.filter((p) =>
    `${p.name} ${p.city}`.toLowerCase().includes(search.toLowerCase()),
  );
  const filtered = sessions.filter((s) =>
    `${s.id} ${data.properties.find((p) => p.id === s.property_id)?.name ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  function switchTab(t: Tab) {
    setTab(t);
    setSearch("");
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    history.replaceState(null, "", url);
  }
  function saveProperty(p: Property) {
    setData((d) => {
      const next = {
        ...d,
        properties: [...d.properties.filter((x) => x.id !== p.id), p],
      };
      if (demo)
        localStorage.setItem(
          "squid-demo-properties",
          JSON.stringify(next.properties),
        );
      return next;
    });
  }
  function added(p: Property) {
    saveProperty(p);
    if (demo)
      setData((d) => ({ ...d, payoutsReady: true, stripeConnected: true }));
    setAdd(false);
    if (!demo) setManage(p);
  }
  async function connect() {
    setBusy(true);
    setError("");
    try {
      if (demo) {
        switchTab("settings");
        setHelp(true);
      } else {
        const { url } = await post<{ url: string }>("/api/host/connect", {});
        window.location.assign(url);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function exportCsv() {
    const rows = [
      [
        "Session",
        "Property",
        "Date",
        "Status",
        "kWh",
        "Gross USD",
        "Squid fee USD",
        "Host USD",
      ],
      ...filtered.map((s) => [
        s.id,
        data.properties.find((p) => p.id === s.property_id)?.name ?? "",
        s.created_at,
        s.status,
        s.energy_kwh,
        ((s.total_cents ?? 0) / 100).toFixed(2),
        ((s.fee_cents ?? 0) / 100).toFixed(2),
        (((s.total_cents ?? 0) - (s.fee_cents ?? 0)) / 100).toFixed(2),
      ]),
    ];
    const csv = rows
      .map((r) =>
        r
          .map(
            (v) =>
              `"${String(v)
                .replace(/^[=+@-]/, "'")
                .replaceAll('"', '""')}"`,
          )
          .join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "squid-sessions.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
  async function doRefund() {
    if (!refund) return;
    setBusy(true);
    setError("");
    try {
      if (demo) {
        setData((d) => ({
          ...d,
          sessions: d.sessions.map((s) =>
            s.id === refund.id ? { ...s, status: "refunded" } : s,
          ),
        }));
      } else {
        await post("/api/host/refund", { id: refund.id });
        router.refresh();
      }
      setRefund(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const title = {
    overview: "Your place. Good energy.",
    chargers: "Little chargers. Big welcome.",
    sessions: "Every charge, all in one place.",
    payouts: "Good energy pays off.",
    settings: "Make yourself at home.",
  }[tab];
  return (
    <div className="dashboard">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-pill">
          <div className="workspace-avatar">
            <House size={19} />
          </div>
          <span>
            Your hosting space
            <small>{demo ? "The good energy club" : "Host workspace"}</small>
          </span>
          <ChevronDown size={15} />
        </div>
        <p className="nav-caption">YOUR WORKSPACE</p>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={`side-link ${tab === n.id ? "active" : ""}`}
              onClick={() => switchTab(n.id)}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.id === "chargers" && <small>{data.properties.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <SquidMark />
            <strong>
              A little extra,
              <br />
              with a little less effort.
            </strong>
            <p>That’s the Squid way.</p>
          </div>
          <button className="side-link" onClick={() => setHelp(true)}>
            <HelpCircle size={18} />
            <span>A little help</span>
            <ArrowUpRight size={14} />
          </button>
          <button
            className={`side-link ${tab === "settings" ? "active" : ""}`}
            onClick={() => switchTab("settings")}
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>
          <button className="profile" onClick={() => switchTab("settings")}>
            <span className="avatar">
              {demo ? "AL" : data.email.slice(0, 2).toUpperCase()}
            </span>
            <span>
              {demo ? "Alex Morgan" : data.email.split("@")[0]}
              <small>Supercharged host</small>
            </span>
            <ChevronRight size={16} />
          </button>
        </div>
      </aside>
      <div className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="breadcrumb">
            Your workspace <span>/</span>
            <strong>
              {tab === "overview"
                ? "Overview"
                : tab === "chargers"
                  ? "My chargers"
                  : tab === "sessions"
                    ? "Charging sessions"
                    : tab === "payouts"
                      ? "Earnings & payouts"
                      : "Settings"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="workspace-status">
              <span className="status-dot" />
              {demo ? "Demo workspace" : "Host workspace"}
            </span>
            <button
              className="icon-button notification-button"
              aria-label="Notifications"
              onClick={() => setNotifications(!notifications)}
            >
              <Bell size={19} />
            </button>
          </div>
          {notifications && (
            <div className="notification-panel">
              <strong>You’re all caught up.</strong>
              <p>Payment and charger updates appear in your session history.</p>
              <button
                className="text-link"
                onClick={() => {
                  switchTab("sessions");
                  setNotifications(false);
                }}
              >
                View sessions <ArrowRight size={14} />
              </button>
            </div>
          )}
        </header>
        <main id="main" className="dashboard-content">
          {demo && (
            <div className="demo-banner">
              <span>
                <span className="demo-label">THE DEMO</span> A little look at
                life with Squid. Sample data, no real charges.
              </span>
              <Link href="/login">
                Make it yours <ArrowUpRight size={14} />
              </Link>
            </div>
          )}
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {tab === "overview"
                  ? `HELLO, ${demo ? "ALEX" : data.email.split("@")[0].toUpperCase()} ☀`
                  : "YOUR SQUID WORKSPACE"}
              </p>
              <h1>{title}</h1>
              <p>
                {tab === "overview"
                  ? "Happy guests, fuller batteries, and a little extra in your pocket."
                  : "Simple tools for a more welcoming stay."}
              </p>
            </div>
            <button className="button primary" onClick={() => setAdd(true)}>
              <Plus size={18} /> Add a charger
            </button>
          </div>
          <ErrorMessage message={error} />
          {(tab === "overview" || tab === "payouts") && (
            <>
              <div className="section-top compact">
                <h2>
                  {tab === "payouts" ? "Your earnings" : "A little overview"}
                </h2>
                <select
                  className="period-select"
                  aria-label="Time period"
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                >
                  <option value={30}>Last 30 days</option>
                  <option value={7}>Last 7 days</option>
                </select>
              </div>
              <div className="stats-grid">
                <Stat
                  icon={Wallet}
                  label="Your earnings"
                  value={money(gross - fees)}
                  note="After Squid’s 6% fee"
                  coral
                />
                <Stat
                  icon={Zap}
                  label="Charging sessions"
                  value={String(paid.length)}
                  note="A warm welcome, fully charged"
                />
                <Stat
                  icon={Leaf}
                  label="Energy shared"
                  value={`${energy.toFixed(1)}`}
                  unit="kWh"
                  note="A little fuel for their next adventure"
                />
                <Stat
                  icon={Plug}
                  label="Your chargers"
                  value={String(data.properties.length)}
                  note={`${data.properties.filter((p) => p.published).length} published guest pages`}
                />
              </div>
              <div className="analytics-row">
                <section className="panel earnings-panel">
                  <div className="section-top">
                    <div>
                      <h2>A little extra looks good on you</h2>
                      <p>Your earnings over the last {days} days</p>
                    </div>
                    <span className="chart-legend">
                      <i /> Your earnings
                    </span>
                  </div>
                  <RevenueChart sessions={paid} days={days} />
                  <div className="chart-footer">
                    <span>
                      Guest payments <strong>{money(gross)}</strong>
                    </span>
                    <span>
                      Squid fee <strong>{money(fees)}</strong>
                    </span>
                    <span>
                      You keep <strong className="coral">94%</strong>
                    </span>
                  </div>
                </section>
                <section className="qr-feature">
                  <div className="eyebrow">SMALL STICKER. BIG POTENTIAL.</div>
                  <h2>
                    Scan. Plug in.
                    <br />
                    Make yourself
                    <br />
                    at home.
                  </h2>
                  <p>
                    Your guest’s next great experience
                    <br />
                    starts with a little square.
                  </p>
                  <div className="qr-feature-art">
                    <ScanIllustration />
                  </div>
                  <button
                    className="button secondary"
                    onClick={() =>
                      data.properties[0]
                        ? setSticker(data.properties[0])
                        : setAdd(true)
                    }
                  >
                    Get your QR sticker <ArrowUpRight size={16} />
                  </button>
                </section>
              </div>
            </>
          )}
          {(tab === "overview" || tab === "chargers") && (
            <section className="charger-section">
              <div className="section-top">
                <div>
                  <h2>
                    Your little charging network{" "}
                    <span className="count-pill">{data.properties.length}</span>
                  </h2>
                  <p>Different places. The same warm welcome.</p>
                </div>
                {tab === "overview" ? (
                  <button
                    className="text-link"
                    onClick={() => switchTab("chargers")}
                  >
                    All chargers <ArrowRight size={16} />
                  </button>
                ) : (
                  <div className="search-field">
                    <Search size={16} />
                    <input
                      aria-label="Search chargers"
                      placeholder="Find a charger…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                )}
              </div>
              <div className="charger-grid">
                {properties.map((p, i) => (
                  <article className="charger-card" key={p.id}>
                    <div className={`charger-picture picture-${i % 3}`}>
                      <img
                        src="/images/cabin.jpg"
                        alt="Vacation home among trees"
                      />
                      <div className="picture-overlay" />
                      <span
                        className={`badge ${p.published ? "green-badge" : "neutral-badge"}`}
                      >
                        <span className="status-dot" />
                        {p.published ? "Published" : "Finish setup"}
                      </span>
                      <button
                        className="picture-menu"
                        aria-label={`Manage ${p.name}`}
                        onClick={() => setManage(p)}
                      >
                        <MoreHorizontal size={20} />
                      </button>
                      <span className="property-tag">
                        {p.city}, {p.state}
                      </span>
                    </div>
                    <div className="charger-body">
                      <div className="charger-title">
                        <h3>{p.name}</h3>
                        <span>
                          {money(p.rate_cents)}
                          <small>/ kWh</small>
                        </span>
                      </div>
                      <p>
                        <Plug size={14} />
                        {p.connector_type}
                        <span>·</span>
                        {p.max_kw} kW<span>·</span>1 connector
                      </p>
                      <div className="charger-card-footer">
                        <Link
                          className="text-link"
                          href={demo ? "/c/demo" : `/c/${p.slug}`}
                        >
                          Guest view <ArrowUpRight size={14} />
                        </Link>
                        <button
                          className="sticker-button"
                          onClick={() => setSticker(p)}
                        >
                          <QrCode size={16} /> QR sticker
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
                <button
                  className="add-charger-card"
                  onClick={() => setAdd(true)}
                >
                  <span>
                    <Plus size={24} />
                  </span>
                  <h3>Room for a little more?</h3>
                  <p>
                    Add another charger.
                    <br />
                    Spread the good energy.
                  </p>
                  <strong>
                    Add a charger <ArrowUpRight size={15} />
                  </strong>
                </button>
              </div>
            </section>
          )}
          {(tab === "overview" || tab === "sessions") && (
            <section className="panel sessions-panel">
              <div className="section-top">
                <div>
                  <h2>Recent good energy</h2>
                  <p>A little record of every welcome.</p>
                </div>
                <div className="table-tools">
                  {tab === "sessions" && (
                    <div className="search-field">
                      <Search size={16} />
                      <input
                        placeholder="Search sessions…"
                        aria-label="Search sessions"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                  )}
                  <button
                    className="button secondary small-button"
                    onClick={exportCsv}
                  >
                    <Download size={15} /> Export
                  </button>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>CHARGER</th>
                      <th>DATE</th>
                      <th>ENERGY</th>
                      <th>YOUR EARNINGS</th>
                      <th>STATUS</th>
                      {tab === "sessions" && (
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered
                      .slice(0, tab === "overview" ? 4 : 100)
                      .map((s) => (
                        <tr key={s.id}>
                          <td>
                            <div className="table-property">
                              <span className="table-plug">
                                <Plug size={18} />
                              </span>
                              <span>
                                {data.properties.find(
                                  (p) => p.id === s.property_id,
                                )?.name ?? "Charger"}
                                <small>{s.id.slice(0, 11)}</small>
                              </span>
                            </div>
                          </td>
                          <td>
                            {new Date(s.created_at).toLocaleDateString(
                              "en-US",
                              { month: "short", day: "numeric" },
                            )}
                            <small className="block muted">
                              {new Date(s.created_at).toLocaleTimeString(
                                "en-US",
                                { hour: "numeric", minute: "2-digit" },
                              )}
                            </small>
                          </td>
                          <td>
                            {Number(s.energy_kwh).toFixed(1)}{" "}
                            <span className="muted">kWh</span>
                          </td>
                          <td className="table-money">
                            {s.status === "completed"
                              ? money((s.total_cents ?? 0) - (s.fee_cents ?? 0))
                              : "—"}
                          </td>
                          <td>
                            <span
                              className={`badge ${s.status === "completed" ? "green-badge" : "neutral-badge"}`}
                            >
                              <span className="status-dot" />
                              {s.status === "completed"
                                ? "Complete"
                                : s.status.replaceAll("_", " ")}
                            </span>
                          </td>
                          {tab === "sessions" && (
                            <td>
                              {s.status === "completed" &&
                                Boolean(s.total_cents) && (
                                  <button
                                    className="text-link"
                                    onClick={() => setRefund(s)}
                                  >
                                    Refund
                                  </button>
                                )}
                            </td>
                          )}
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!filtered.length && (
                  <div className="empty-state">
                    <Zap size={28} />
                    <h3>Your first charge is a scan away.</h3>
                    <p>
                      Once guests start charging, their sessions will appear
                      here.
                    </p>
                  </div>
                )}
              </div>
              {tab === "overview" && (
                <button
                  className="table-view-all"
                  onClick={() => switchTab("sessions")}
                >
                  View all sessions <ArrowRight size={15} />
                </button>
              )}
            </section>
          )}
          {tab === "payouts" && (
            <section className="panel payout-explainer">
              <CreditCard size={28} />
              <div>
                <h2>94% for you. 6% keeps Squid swimming.</h2>
                <p>
                  For every $10.00 charging session, $9.40 is routed to your
                  connected Stripe account and $0.60 goes to Squid. Stripe
                  processing fees are paid from the platform’s share.
                </p>
                <p>
                  Transfers to your Stripe balance happen after the final
                  charging payment is captured. Bank payout timing follows your
                  Stripe account’s schedule.
                </p>
              </div>
              <button
                className="button primary"
                disabled={busy}
                onClick={connect}
              >
                {busy ? (
                  <Busy />
                ) : data.stripeConnected ? (
                  "Manage payout setup"
                ) : (
                  "Connect Stripe"
                )}
                <ArrowUpRight size={16} />
              </button>
            </section>
          )}
          {tab === "settings" && (
            <div className="settings-grid">
              <section className="panel settings-card">
                <div className="section-top">
                  <h2>Your host account</h2>
                  <span className="avatar">
                    {data.email.slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <label>
                  Email address
                  <input value={data.email} readOnly />
                </label>
                <p className="fine-print">
                  Your sign-in email keeps your properties and sessions private.
                </p>
                {!demo && (
                  <Link href="/login/reset" className="text-link">
                    Set or change your password <ArrowUpRight size={15} />
                  </Link>
                )}
                <button
                  className="button secondary"
                  onClick={async () => {
                    if (!demo) await post("/auth/logout", {});
                    window.location.assign("/");
                  }}
                >
                  <LogOut size={16} />
                  {demo ? "Leave demo" : "Sign out"}
                </button>
              </section>
              <section className="panel settings-card">
                <div className="section-top">
                  <h2>Your payouts</h2>
                  <span
                    className={`badge ${data.payoutsReady ? "green-badge" : "neutral-badge"}`}
                  >
                    {data.payoutsReady ? "Connected" : "Setup needed"}
                  </span>
                </div>
                <p>
                  Connect your Stripe account to receive 94% of each charging
                  payment directly.
                </p>
                <div className="stripe-wordmark">
                  stripe <span>CONNECT</span>
                </div>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={connect}
                >
                  {busy ? (
                    <Busy />
                  ) : data.stripeConnected ? (
                    "Manage Stripe connection"
                  ) : (
                    "Connect with Stripe"
                  )}
                  <ArrowUpRight size={16} />
                </button>
              </section>
              <section className="panel settings-card full-width">
                <Code2 size={24} />
                <h2>Open source. Yours to shape.</h2>
                <p>
                  Squid is an independent charging experience built on the Ivora
                  API. Next.js on Vercel, Supabase for your data, and Stripe
                  Connect for your money.
                </p>
                <Link href="/developers" className="text-link">
                  Explore the developer guide <ArrowUpRight size={16} />
                </Link>
              </section>
            </div>
          )}
          <footer className="dashboard-footer">
            <span>
              <SquidMark /> A little charge. A better stay.
            </span>
            <Link href="/developers">
              Squid by Ivora · Open source <ArrowUpRight size={12} />
            </Link>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav">
        {nav.map((n) => (
          <button
            key={n.id}
            className={tab === n.id ? "active" : ""}
            onClick={() => switchTab(n.id)}
          >
            <n.icon size={21} />
            <span>
              {n.id === "payouts"
                ? "Earnings"
                : n.id === "sessions"
                  ? "Sessions"
                  : n.id === "chargers"
                    ? "Chargers"
                    : "Overview"}
            </span>
          </button>
        ))}
        <button
          className={tab === "settings" ? "active" : ""}
          onClick={() => switchTab("settings")}
        >
          <Settings size={21} />
          <span>Settings</span>
        </button>
      </nav>
      {add && (
        <AddCharger
          demo={demo}
          payoutsReady={data.payoutsReady}
          stripeConnected={data.stripeConnected}
          onClose={() => setAdd(false)}
          onAdd={added}
          onSave={saveProperty}
        />
      )}{" "}
      {sticker && (
        <QRSticker
          property={sticker}
          demo={demo}
          onClose={() => setSticker(null)}
        />
      )}{" "}
      {manage && (
        <ManageCharger
          property={manage}
          demo={demo}
          payoutsReady={data.payoutsReady}
          stripeConnected={data.stripeConnected}
          onClose={() => {
            setManage(null);
            const url = new URL(window.location.href);
            url.searchParams.delete("setup");
            history.replaceState(null, "", url);
          }}
          onUpdate={(p) => {
            setData((d) => {
              const next = {
                ...d,
                properties: d.properties.map((x) => (x.id === p.id ? p : x)),
              };
              if (demo)
                localStorage.setItem(
                  "squid-demo-properties",
                  JSON.stringify(next.properties),
                );
              return next;
            });
            setManage(p);
            if (!demo) router.refresh();
          }}
        />
      )}
      {help && (
        <Modal
          title="A little help, right here."
          onClose={() => setHelp(false)}
        >
          <div className="help-content">
            <h3>From charger to happy guest</h3>
            <ol>
              <li>Add your property and choose a price per kWh.</li>
              <li>Connect your OCPP charger with the setup details.</li>
              <li>Finish Stripe Connect onboarding for payouts.</li>
              <li>
                Publish your charger, print its QR sticker, and welcome your
                guests.
              </li>
            </ol>
            <p>
              {demo
                ? "This is a local demo. Stripe onboarding and charger commands are simulated here. Sign in to create your real workspace."
                : "Need setup details or API documentation? The developer guide covers the full flow."}
            </p>
            <Link
              className="button primary"
              href={demo ? "/login" : "/developers"}
            >
              {demo ? "Create my workspace" : "Open setup guide"}
              <ArrowUpRight size={16} />
            </Link>
          </div>
        </Modal>
      )}
      {refund && (
        <Modal
          title="Return a little good energy"
          onClose={() => setRefund(null)}
        >
          <p>
            Refund the full {money(refund.total_cents ?? 0)} for this session?
            This also reverses the host transfer and Squid’s application fee.
          </p>
          <ErrorMessage message={error} />
          <div className="form-actions">
            <button
              className="button secondary"
              onClick={() => setRefund(null)}
            >
              Keep payment
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={doRefund}
            >
              {busy ? <Busy /> : "Confirm full refund"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Stat({
  icon: Icon,
  label,
  value,
  note,
  unit,
  coral = false,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  note: string;
  unit?: string;
  coral?: boolean;
}) {
  return (
    <article className={`stat-card ${coral ? "stat-highlight" : ""}`}>
      <div className="stat-label">
        {label}
        <Icon size={18} />
      </div>
      <div className="stat-value">
        {value}
        <small>{unit}</small>
      </div>
      <div className="stat-note">
        {coral && <span className="status-dot" />}
        {note}
      </div>
    </article>
  );
}
function RevenueChart({
  sessions,
  days,
}: {
  sessions: HostSession[];
  days: number;
}) {
  const bars = Array.from({ length: 15 }, (_, i) => {
    const end = Date.now() - (14 - i) * (days / 15) * 86400000;
    const start = end - (days / 15) * 86400000;
    return {
      value: sessions
        .filter(
          (s) =>
            Date.parse(s.created_at) >= start && Date.parse(s.created_at) < end,
        )
        .reduce((sum, s) => sum + (s.total_cents ?? 0) - (s.fee_cents ?? 0), 0),
      date: new Date(end).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
    };
  });
  const max = Math.max(...bars.map((b) => b.value), 1000);
  return (
    <div
      className="revenue-chart"
      role="img"
      aria-label={`Earnings chart for the last ${days} days. Total ${money(sessions.reduce((sum, s) => sum + (s.total_cents ?? 0) - (s.fee_cents ?? 0), 0))}.`}
    >
      <div className="chart-y">
        <span>{money(max, 0)}</span>
        <span>{money(max / 2, 0)}</span>
        <span>$0</span>
      </div>
      <div className="chart-plot">
        <div className="chart-grid-lines">
          <i />
          <i />
          <i />
        </div>
        <div className="chart-bars">
          {bars.map((b, i) => (
            <div className="bar-slot" key={i}>
              <div
                tabIndex={0}
                className={`chart-bar ${i === 13 ? "bright" : ""}`}
                style={{ height: `${Math.max(3, (b.value / max) * 100)}%` }}
                aria-label={`${b.date}: ${money(b.value)}`}
              >
                <span className="chart-tooltip">
                  {b.date}
                  <strong>{money(b.value)}</strong>
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="chart-x">
          {[0, 4, 9, 14].map((i) => (
            <span key={i}>{bars[i].date}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
function ScanIllustration() {
  return (
    <div className="scan-illustration">
      <SquidMark />
      <span>
        GOOD ENERGY
        <br />
        STARTS HERE.
      </span>
      <QrCode size={65} strokeWidth={1.4} />
      <small>SCAN. PLUG. UNWIND.</small>
    </div>
  );
}
function ManageCharger({
  property: p,
  demo,
  payoutsReady,
  stripeConnected,
  onClose,
  onUpdate,
}: {
  property: Property;
  demo: boolean;
  payoutsReady: boolean;
  stripeConnected: boolean;
  onClose: () => void;
  onUpdate: (p: Property) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [credentials, setCredentials] = useState<{
    password: string | null;
    pending: boolean;
  } | null>(null);
  const [done, setDone] = useState("");
  async function loadCredentials(signal?: AbortSignal) {
    if (demo) {
      setCredentials({ password: "DEMO2345DEMO6789", pending: false });
      return;
    }
    const response = await fetch(`/api/host/properties/${p.id}/credentials`, {
      cache: "no-store",
      signal,
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Could not load the connection password.");
    if (!signal?.aborted) setCredentials(data);
  }
  useEffect(() => {
    const controller = new AbortController();
    setCredentials(null);
    void loadCredentials(controller.signal).catch((e) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => controller.abort();
  }, [p.id, demo]);
  async function connectPayouts() {
    setBusy(true);
    setError("");
    try {
      if (demo) {
        setDone("Demo payout setup. No Stripe account is created.");
        return;
      }
      const { url } = await post<{ url: string }>("/api/host/connect", {
        propertyId: p.id,
      });
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(action: string) {
    setBusy(true);
    setError("");
    setDone("");
    try {
      if (demo) {
        onUpdate({
          ...p,
          published:
            action === "pause"
              ? false
              : action === "publish"
                ? true
                : p.published,
        });
        setDone("Demo charger updated.");
      } else {
        const result = await post<{ property: Property }>(
          `/api/host/properties/${p.id}`,
          { action },
        );
        onUpdate(result.property);
        await loadCredentials();
        setDone(
          action === "credentials"
            ? "Your preset password is ready to use in your charger’s app."
            : "Charger updated.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={p.name} onClose={onClose}>
      <div className="stack-form">
        <p>
          Copy these details into your charger’s OCPP settings, then publish its
          guest page.
        </p>
        {!payoutsReady && (
          <div className="onboarding-payouts">
            <CreditCard size={20} />
            <div>
              <strong>Finish setting up your payouts</strong>
              <p>
                Your charger is saved. Stripe needs a few details before you can
                accept guest payments.
              </p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={connectPayouts}
              >
                {stripeConnected ? "Continue Stripe setup" : "Connect Stripe"}
                <ArrowUpRight size={16} />
              </button>
            </div>
          </div>
        )}
        <label>
          OCPP station identity
          <div className="copy-field">
            <input value={p.station_name} readOnly />
            <button
              className="icon-button"
              aria-label="Copy station identity"
              onClick={() => navigator.clipboard.writeText(p.station_name)}
            >
              <Copy size={17} />
            </button>
          </div>
        </label>
        {p.ocpp_url ? (
          <label>
            OCPP connection URL
            <div className="copy-field">
              <input value={p.ocpp_url} readOnly />
              <button
                className="icon-button"
                aria-label="Copy connection URL"
                onClick={() => navigator.clipboard.writeText(p.ocpp_url!)}
              >
                <Copy size={17} />
              </button>
            </div>
          </label>
        ) : (
          <div className="notice">
            Your connection URL is being prepared. Refresh setup in a moment;
            contact your Squid operator if it’s still unavailable.
          </div>
        )}
        {credentials?.password ? (
          <label>
            Preset OCPP password
            <div className="copy-field">
              <input
                className="connection-password"
                value={credentials.password}
                readOnly
                spellCheck={false}
                autoComplete="off"
              />
              <button
                className="icon-button"
                aria-label="Copy OCPP password"
                onClick={() =>
                  navigator.clipboard.writeText(credentials.password!)
                }
              >
                <Copy size={17} />
              </button>
            </div>
          </label>
        ) : (
          <div className="notice">
            {credentials === null
              ? "Loading your connection password…"
              : credentials.pending
                ? "Your preset password is being prepared."
                : "This charger keeps its existing password. You can prepare a preset while it is offline."}
          </div>
        )}
        {!credentials?.password && (
          <button
            className="button secondary"
            disabled={busy || !credentials}
            onClick={() => action("credentials")}
          >
            {credentials?.pending
              ? "Retry password setup"
              : "Prepare preset password"}
          </button>
        )}
        <p className="fine-print">
          The preset uses 16 easy-to-read characters. Enter it exactly as shown.
          If your charger asks for a username, use the station identity.
        </p>
        <ErrorMessage message={error} />
        {done && (
          <div className="success-message" role="status">
            <Check size={16} />
            {done}
          </div>
        )}
        <div className="form-actions">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => action("resume")}
          >
            {busy ? <Busy /> : "Refresh setup"}
          </button>
          <button
            className="button primary"
            disabled={busy || (!p.published && !payoutsReady)}
            onClick={() => action(p.published ? "pause" : "publish")}
          >
            {p.published ? "Pause guest access" : "Publish charger"}
            <ArrowUpRight size={16} />
          </button>
        </div>
      </div>
    </Modal>
  );
}
