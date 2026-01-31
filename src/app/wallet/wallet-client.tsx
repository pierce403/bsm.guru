"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "react-qr-code";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

type WalletRow = {
  address: string;
  createdAt: number;
  downloadUrl: string;
};

type ListResponse = { ts: number; wallets: WalletRow[] } | { error: string };
type CreateResponse = { ts: number; wallet: WalletRow } | { error: string };

type ArbBalancesResponse =
  | {
      ts: number;
      address: string;
      chainId: number;
      ethWei: string;
      eth: string;
      usdcUnits: string;
      usdceUnits: string;
    }
  | { error: string };

type DepositFromEthResponse =
  | {
      ts: number;
      result: {
        chainId: number;
        from: string;
        ethInWei: string;
        usdcOutUnits: string;
        wrapTxHash: string;
        approveTxHash: string;
        swapTxHash: string;
        depositTxHash: string;
      };
    }
  | { error: string };

type DepositUsdcResponse =
  | {
      ts: number;
      result: {
        chainId: number;
        from: string;
        token: "usdc" | "usdce";
        usdcUnits: string;
        depositTxHash: string;
      };
    }
  | { error: string };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  return (await res.json()) as T;
}

const WALLET_LS_KEY = "bsm.selectedWallet";
const PASSWORD_LS_PREFIX = "bsm.walletPassword.";
const AUTO_SWEEP_LS_PREFIX = "bsm.autoSweepEth.";

function formatEth(eth: string) {
  const n = Number(eth);
  if (!Number.isFinite(n)) return eth;
  if (n === 0) return "0";
  if (n < 0.0001) return n.toFixed(6);
  if (n < 1) return n.toFixed(4);
  return n.toFixed(4);
}

function formatUsdcUnits(units: string) {
  const n = Number(units);
  if (!Number.isFinite(n)) return units;
  // USDC 6 decimals
  return (n / 1_000_000).toFixed(2);
}

function formatTs(ts: number) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function shortAddr(addr: string) {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function WalletClient() {
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<WalletRow | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [arbBalances, setArbBalances] = useState<ArbBalancesResponse | null>(null);
  const [arbLoading, setArbLoading] = useState(false);

  const [walletPassword, setWalletPassword] = useState("");
  const [ethToConvert, setEthToConvert] = useState("0.05");
  const [reserveEth, setReserveEth] = useState("0.002");
  const [slippageBps, setSlippageBps] = useState("50");
  const [depositing, setDepositing] = useState(false);
  const [depositErr, setDepositErr] = useState<string | null>(null);
  const [depositRes, setDepositRes] = useState<DepositFromEthResponse | null>(null);

  const [usdcToDeposit, setUsdcToDeposit] = useState("25");
  const [depositingUsdc, setDepositingUsdc] = useState(false);
  const [depositUsdcErr, setDepositUsdcErr] = useState<string | null>(null);
  const [depositUsdcRes, setDepositUsdcRes] = useState<DepositUsdcResponse | null>(null);

  const [autoSweep, setAutoSweep] = useState(false);

  const selectedWallet = useMemo(
    () => wallets.find((w) => w.address === selected) ?? null,
    [wallets, selected],
  );

  const fundUri = useMemo(() => {
    if (!selectedWallet) return null;
    // EIP-681-ish. Many wallets will treat this as "send ETH" on the given chain.
    // For Hyperliquid funding, users typically send USDC on Arbitrum to this EOA.
    return `ethereum:${selectedWallet.address}@42161`;
  }, [selectedWallet]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const data = await fetchJson<ListResponse>("/api/wallets", {
      cache: "no-store",
    });

    if ("error" in data) {
      setError(data.error);
      setWallets([]);
      setSelected(null);
      setLoading(false);
      return;
    }

    setError(null);
    setWallets(data.wallets);
    setSelected((prev) => {
      try {
        const saved = window.localStorage.getItem(WALLET_LS_KEY);
        if (saved && data.wallets.some((w) => w.address === saved)) return saved;
      } catch {
        // ignore
      }
      if (prev && data.wallets.some((w) => w.address === prev)) return prev;
      return data.wallets[0]?.address ?? null;
    });
    setLoading(false);
  }, []);

  const create = useCallback(async () => {
    setCreating(true);
    setCreated(null);
    try {
      const data = await fetchJson<CreateResponse>("/api/wallets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });

      if ("error" in data) {
        setError(data.error);
        return;
      }

      setError(null);
      setCreated(data.wallet);
      setSelected(data.wallet.address);
      await refresh();
    } finally {
      setCreating(false);
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selected) return;
    try {
      window.localStorage.setItem(WALLET_LS_KEY, selected);
    } catch {
      // ignore
    }

    try {
      const savedPw = window.localStorage.getItem(`${PASSWORD_LS_PREFIX}${selected}`);
      setWalletPassword(savedPw ?? "");
    } catch {
      setWalletPassword("");
    }

    try {
      const savedAuto = window.localStorage.getItem(`${AUTO_SWEEP_LS_PREFIX}${selected}`);
      setAutoSweep(savedAuto === "true");
    } catch {
      setAutoSweep(false);
    }
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    try {
      const key = `${PASSWORD_LS_PREFIX}${selected}`;
      if (walletPassword.trim().length > 0) window.localStorage.setItem(key, walletPassword);
      else window.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }, [selected, walletPassword]);

  useEffect(() => {
    if (!selected) return;
    try {
      window.localStorage.setItem(`${AUTO_SWEEP_LS_PREFIX}${selected}`, autoSweep ? "true" : "false");
    } catch {
      // ignore
    }
  }, [selected, autoSweep]);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(id);
  }, [copied]);

  const copyAddress = useCallback(async () => {
    const addr = selectedWallet?.address;
    if (!addr) return;
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(true);
    } catch {
      // ignore
    }
  }, [selectedWallet]);

  const refreshArbBalances = useCallback(async () => {
    const addr = selectedWallet?.address;
    if (!addr) {
      setArbBalances(null);
      return;
    }
    setArbLoading(true);
    try {
      const data = await fetchJson<ArbBalancesResponse>(`/api/arbitrum/balances/${addr}`, {
        cache: "no-store",
      });
      setArbBalances(data);
    } finally {
      setArbLoading(false);
    }
  }, [selectedWallet]);

  useEffect(() => {
    void refreshArbBalances();
    const id = window.setInterval(() => void refreshArbBalances(), 15_000);
    return () => window.clearInterval(id);
  }, [refreshArbBalances]);

  const depositFromEth = useCallback(
    async (ethAmount: string) => {
      const addr = selectedWallet?.address;
      if (!addr) return;
      setDepositing(true);
      setDepositErr(null);
      setDepositRes(null);
      try {
        const data = await fetchJson<DepositFromEthResponse>("/api/hyperliquid/deposit-from-eth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fromAddress: addr,
            ethAmount,
            password: walletPassword.trim() || undefined,
            slippageBps: Number(slippageBps),
            reserveEth,
          }),
        });
        setDepositRes(data);
        if ("error" in data) setDepositErr(data.error);
        await refreshArbBalances();
      } catch (e) {
        setDepositErr(e instanceof Error ? e.message : "Deposit failed");
      } finally {
        setDepositing(false);
      }
    },
    [refreshArbBalances, reserveEth, selectedWallet, slippageBps, walletPassword],
  );

  const depositExistingUsdc = useCallback(
    async (token: "usdc" | "usdce") => {
      const addr = selectedWallet?.address;
      if (!addr) return;
      setDepositingUsdc(true);
      setDepositUsdcErr(null);
      setDepositUsdcRes(null);
      try {
        const amount = Number(usdcToDeposit);
        if (!Number.isFinite(amount) || amount <= 0) {
          setDepositUsdcErr("Enter a valid USDC amount");
          return;
        }

        const units = BigInt(Math.floor(amount * 1_000_000));
        const data = await fetchJson<DepositUsdcResponse>("/api/hyperliquid/deposit-usdc", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fromAddress: addr,
            token,
            usdcUnits: units.toString(),
            password: walletPassword.trim() || undefined,
          }),
        });
        setDepositUsdcRes(data);
        if ("error" in data) setDepositUsdcErr(data.error);
        await refreshArbBalances();
      } catch (e) {
        setDepositUsdcErr(e instanceof Error ? e.message : "Deposit failed");
      } finally {
        setDepositingUsdc(false);
      }
    },
    [refreshArbBalances, selectedWallet, usdcToDeposit, walletPassword],
  );

  // Optional automation: if ETH arrives, swap the excess above reserve and deposit it.
  useEffect(() => {
    if (!autoSweep) return;
    if (!selectedWallet) return;
    if (!arbBalances || "error" in arbBalances) return;

    const eth = Number(arbBalances.eth);
    const reserve = Number(reserveEth);
    if (!Number.isFinite(eth) || !Number.isFinite(reserve)) return;

    const excess = eth - reserve;
    if (excess <= 0.001) return; // avoid dust sweeps

    // Avoid overlapping runs.
    if (depositing) return;

    // Sweep at most 0.25 ETH per pass (safety).
    const amt = Math.min(excess, 0.25);
    void depositFromEth(String(amt));
  }, [arbBalances, autoSweep, depositFromEth, depositing, reserveEth, selectedWallet]);

  return (
    <main className="space-y-6">
      <header className="space-y-3">
        <h1 className="font-display text-4xl tracking-tight text-foreground">
          Wallet
        </h1>
        <p className="max-w-2xl text-base leading-7 text-muted">
          Local, custodial wallet management for Hyperliquid. Wallets are
          generated server-side and written to disk; you can download a backup
          JSON.
        </p>
        <p className="max-w-2xl text-xs leading-6 text-muted">
          This app is designed for a local, secure environment. Treat these as
          hot wallets.
        </p>
      </header>

      {error ? (
        <Card className="bg-background/60 text-danger">
          <p className="text-sm">{error}</p>
          <p className="mt-2 text-xs text-muted">
            Wallet APIs are restricted to `localhost`/`127.0.0.1` by default. If
            you intentionally need LAN access, set `BSM_ALLOW_NONLOCAL_WALLET=true`
            (not recommended).
          </p>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-5">
          <Card className="space-y-4">
            <p className="text-sm font-medium text-foreground">Create wallet</p>
            <Button disabled={creating} onClick={() => void create()}>
              {creating ? "Creating..." : "Generate wallet"}
            </Button>
            <p className="text-xs text-muted">
              Download a backup JSON and store it safely. If you lose the file,
              you lose the wallet.
            </p>
          </Card>

          <Card className="p-0">
            <div className="flex items-center justify-between px-6 py-4">
              <div>
                <p className="text-sm font-medium text-foreground">Wallets</p>
                <p className="text-xs text-muted">
                  Click to select; download to backup.
                </p>
              </div>
              <p className="text-xs text-muted">
                {loading ? "Loading…" : `${wallets.length} wallets`}
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="border-t border-border/60 px-6 py-3 font-medium">
                      Address
                    </th>
                    <th className="border-t border-border/60 px-6 py-3 font-medium">
                      Created
                    </th>
                    <th className="border-t border-border/60 px-6 py-3 font-medium">
                      Backup
                    </th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {wallets.map((w) => {
                    const isSelected = selected === w.address;
                    return (
                      <tr
                        key={w.address}
                        className={[
                          "cursor-pointer hover:bg-background/40",
                          isSelected ? "bg-background/40" : "",
                        ].join(" ")}
                        onClick={() => setSelected(w.address)}
                      >
                        <td className="border-t border-border/60 px-6 py-3 font-mono text-foreground">
                          {shortAddr(w.address)}
                        </td>
                        <td className="border-t border-border/60 px-6 py-3 font-mono text-muted">
                          {formatTs(w.createdAt)}
                        </td>
                        <td className="border-t border-border/60 px-6 py-3">
                          <a
                            href={w.downloadUrl}
                            onClick={(e) => e.stopPropagation()}
                            className="text-sm font-medium text-foreground underline decoration-border/80 underline-offset-4 hover:decoration-foreground"
                          >
                            Download
                          </a>
                        </td>
                      </tr>
                    );
                  })}

                  {!loading && wallets.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3}
                        className="border-t border-border/60 px-6 py-6 text-sm text-muted"
                      >
                        No wallets yet. Generate one to get a deposit address.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-7">
          <Card className="space-y-5">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Selected wallet (EOA)
                </p>
                <p className="mt-2 break-all font-mono text-sm text-foreground">
                  {selectedWallet?.address ?? "—"}
                </p>
                {created && created.address === selectedWallet?.address ? (
                  <p className="mt-2 text-xs text-muted">
                    Created just now. Download a backup before funding.
                  </p>
                ) : null}
              </div>
              {selectedWallet ? (
                <a
                  href={selectedWallet.downloadUrl}
                  className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background shadow-[0_14px_40px_rgba(11,19,32,0.18)] transition hover:shadow-[0_18px_48px_rgba(11,19,32,0.22)]"
                >
                  Backup JSON
                </a>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl bg-background/60 p-4 ring-1 ring-border/80">
                <p className="text-xs font-medium text-muted">Funding</p>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Hyperliquid accounts are typically funded with{" "}
                  <span className="font-medium text-foreground">
                    USDC on Arbitrum
                  </span>{" "}
                  using this same EOA address.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    variant="ghost"
                    disabled={!selectedWallet}
                    onClick={() => void copyAddress()}
                  >
                    {copied ? "Copied" : "Copy address"}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!selectedWallet}
                    onClick={() => setQrOpen(true)}
                  >
                    Show QR
                  </Button>
                </div>
              </div>

              <button
                type="button"
                className="group flex w-full items-center justify-between rounded-3xl bg-background/60 p-4 ring-1 ring-border/80 transition hover:bg-background/70"
                onClick={() => setQrOpen(true)}
                disabled={!fundUri}
              >
                <div className="space-y-1 text-left">
                  <p className="text-xs font-medium text-muted">Deposit address</p>
                  <p className="text-sm text-muted">Arbitrum • click QR</p>
                </div>
                <div className="rounded-2xl bg-white p-3 shadow">
                  {fundUri ? <QRCode value={fundUri} size={96} /> : <div className="h-24 w-24" />}
                </div>
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl bg-background/60 p-4 ring-1 ring-border/80">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted">Arbitrum balances</p>
                    <p className="text-sm text-muted">
                      {arbLoading ? "Refreshing…" : "auto-refreshing"}
                    </p>
                  </div>
                  <Button variant="ghost" disabled={!selectedWallet} onClick={() => void refreshArbBalances()}>
                    Refresh
                  </Button>
                </div>

                {"error" in (arbBalances ?? {}) ? (
                  <p className="mt-3 text-sm text-danger">{(arbBalances as { error: string }).error}</p>
                ) : (
                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-2xl bg-background/60 p-3 ring-1 ring-border/80">
                      <p className="text-[11px] font-medium text-muted">ETH</p>
                      <p className="mt-1 font-mono text-sm text-foreground">
                        {arbBalances && !("error" in arbBalances) ? formatEth(arbBalances.eth) : "—"}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-background/60 p-3 ring-1 ring-border/80">
                      <p className="text-[11px] font-medium text-muted">USDC (native)</p>
                      <p className="mt-1 font-mono text-sm text-foreground">
                        {arbBalances && !("error" in arbBalances) ? formatUsdcUnits(arbBalances.usdcUnits) : "—"}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-background/60 p-3 ring-1 ring-border/80">
                      <p className="text-[11px] font-medium text-muted">USDC.e</p>
                      <p className="mt-1 font-mono text-sm text-foreground">
                        {arbBalances && !("error" in arbBalances) ? formatUsdcUnits(arbBalances.usdceUnits) : "—"}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-background/60 p-3 ring-1 ring-border/80">
                      <p className="text-[11px] font-medium text-muted">Explorer</p>
                      <p className="mt-1">
                        {selectedWallet ? (
                          <a
                            className="font-mono text-sm text-foreground underline decoration-border/80 underline-offset-4 hover:decoration-foreground"
                            href={`https://arbiscan.io/address/${selectedWallet.address}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View
                          </a>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-3xl bg-background/60 p-4 ring-1 ring-border/80">
                <p className="text-xs font-medium text-muted">ETH → USDC → Hyperliquid</p>
                <p className="mt-2 text-sm leading-6 text-muted">
                  If you accidentally (or intentionally) send ETH to this wallet on Arbitrum, this will
                  swap some ETH for native USDC and then deposit it into Hyperliquid by transferring USDC
                  to the Hyperliquid Bridge2 contract.
                </p>

                <div className="mt-4 grid gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-muted">ETH to convert</label>
                      <Input
                        inputMode="decimal"
                        value={ethToConvert}
                        onChange={(e) => setEthToConvert(e.target.value)}
                        placeholder="0.05"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-muted">Reserve ETH (gas)</label>
                      <Input
                        inputMode="decimal"
                        value={reserveEth}
                        onChange={(e) => setReserveEth(e.target.value)}
                        placeholder="0.002"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-muted">Slippage (bps)</label>
                      <Input
                        inputMode="numeric"
                        value={slippageBps}
                        onChange={(e) => setSlippageBps(e.target.value)}
                        placeholder="50"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-muted">Wallet password (optional)</label>
                      <Input
                        type="password"
                        value={walletPassword}
                        onChange={(e) => setWalletPassword(e.target.value)}
                        placeholder="(cached locally)"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <input
                        type="checkbox"
                        checked={autoSweep}
                        onChange={(e) => setAutoSweep(e.target.checked)}
                      />
                      Auto-sweep ETH deposits
                    </label>
                    <Button
                      variant="soft"
                      disabled={!selectedWallet || depositing || ethToConvert.trim().length === 0}
                      onClick={() => void depositFromEth(ethToConvert)}
                    >
                      {depositing ? "Depositing…" : "Convert & deposit"}
                    </Button>
                  </div>

                  {depositErr ? (
                    <div className="rounded-2xl bg-background/60 p-3 text-sm text-danger ring-1 ring-border/80">
                      {depositErr}
                    </div>
                  ) : null}

                  {depositRes && !("error" in depositRes) ? (
                    <div className="rounded-2xl bg-background/60 p-3 text-sm text-muted ring-1 ring-border/80">
                      <p>
                        Swapped ETH → USDC and deposited{" "}
                        <span className="font-mono text-foreground">
                          {formatUsdcUnits(depositRes.result.usdcOutUnits)} USDC
                        </span>
                        .
                      </p>
                      <p className="mt-2 text-xs">
                        Wrap tx:{" "}
                        <a
                          className="font-mono text-foreground underline decoration-border/80 underline-offset-4 hover:decoration-foreground"
                          href={`https://arbiscan.io/tx/${depositRes.result.wrapTxHash}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {depositRes.result.wrapTxHash.slice(0, 12)}…
                        </a>
                      </p>
                      <p className="mt-1 text-xs">
                        Approve tx:{" "}
                        <a
                          className="font-mono text-foreground underline decoration-border/80 underline-offset-4 hover:decoration-foreground"
                          href={`https://arbiscan.io/tx/${depositRes.result.approveTxHash}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {depositRes.result.approveTxHash.slice(0, 12)}…
                        </a>
                      </p>
                      <p className="mt-1 text-xs">
                        Swap tx:{" "}
                        <a
                          className="font-mono text-foreground underline decoration-border/80 underline-offset-4 hover:decoration-foreground"
                          href={`https://arbiscan.io/tx/${depositRes.result.swapTxHash}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {depositRes.result.swapTxHash.slice(0, 12)}…
                        </a>
                      </p>
                      <p className="mt-1 text-xs">
                        Deposit tx:{" "}
                        <a
                          className="font-mono text-foreground underline decoration-border/80 underline-offset-4 hover:decoration-foreground"
                          href={`https://arbiscan.io/tx/${depositRes.result.depositTxHash}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {depositRes.result.depositTxHash.slice(0, 12)}…
                        </a>
                      </p>
                    </div>
                  ) : null}

                  <p className="text-xs text-muted">
                    Notes: keep some ETH for gas; Hyperliquid deposits usually require at least 5 USDC.
                    This uses Uniswap v3 routing (WETH/USDC) under the hood.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl bg-background/60 p-4 ring-1 ring-border/80">
              <p className="text-xs font-medium text-muted">Deposit existing USDC</p>
              <p className="mt-2 text-sm leading-6 text-muted">
                If you already sent USDC to this wallet, you still need to deposit it into Hyperliquid.
                This does that deposit for you by transferring USDC to the Hyperliquid Bridge2 contract.
              </p>

              <div className="mt-4 grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted">Amount (USDC)</label>
                    <Input
                      inputMode="decimal"
                      value={usdcToDeposit}
                      onChange={(e) => setUsdcToDeposit(e.target.value)}
                      placeholder="25"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted">Wallet password (optional)</label>
                    <Input
                      type="password"
                      value={walletPassword}
                      onChange={(e) => setWalletPassword(e.target.value)}
                      placeholder="(cached locally)"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3">
                  <Button
                    variant="ghost"
                    disabled={!selectedWallet || depositingUsdc}
                    onClick={() => void depositExistingUsdc("usdc")}
                  >
                    {depositingUsdc ? "Depositing…" : "Deposit USDC"}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!selectedWallet || depositingUsdc}
                    onClick={() => void depositExistingUsdc("usdce")}
                  >
                    {depositingUsdc ? "Depositing…" : "Deposit USDC.e"}
                  </Button>
                </div>

                {depositUsdcErr ? (
                  <div className="rounded-2xl bg-background/60 p-3 text-sm text-danger ring-1 ring-border/80">
                    {depositUsdcErr}
                  </div>
                ) : null}

                {depositUsdcRes && !("error" in depositUsdcRes) ? (
                  <div className="rounded-2xl bg-background/60 p-3 text-sm text-muted ring-1 ring-border/80">
                    <p>
                      Submitted deposit of{" "}
                      <span className="font-mono text-foreground">
                        {formatUsdcUnits(depositUsdcRes.result.usdcUnits)} {depositUsdcRes.result.token.toUpperCase()}
                      </span>
                      .
                    </p>
                    <p className="mt-2 text-xs">
                      Tx:{" "}
                      <a
                        className="font-mono text-sm text-foreground underline decoration-border/80 underline-offset-4 hover:decoration-foreground"
                        href={`https://arbiscan.io/tx/${depositUsdcRes.result.depositTxHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {depositUsdcRes.result.depositTxHash.slice(0, 12)}…
                      </a>
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title="Fund wallet (Arbitrum)"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Scan to fund this wallet on{" "}
            <span className="font-medium text-foreground">Arbitrum One</span>.
          </p>
          <p className="break-all rounded-2xl bg-background/60 p-3 font-mono text-xs text-foreground ring-1 ring-border/80">
            {selectedWallet?.address ?? "—"}
          </p>
          <div className="grid place-items-center rounded-3xl bg-white p-6">
            {fundUri ? <QRCode value={fundUri} size={320} /> : null}
          </div>
          <p className="text-xs text-muted">
            Hyperliquid deposits are usually{" "}
            <span className="font-medium text-foreground">USDC on Arbitrum</span>.
            Some wallet apps may still label this as an ETH send request; in that
            case, use the address above and choose USDC manually.
          </p>
        </div>
      </Modal>
    </main>
  );
}
