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
      ethWeiPending: string;
      ethPending: string;
      wethWei: string;
      weth: string;
      usdcUnits: string;
      usdceUnits: string;
    }
  | { error: string };

type HyperliquidStateResponse =
  | {
      ts: number;
      user: string;
      spot: {
        balances: Array<{
          coin: string;
          total: string;
          hold: string;
        }>;
      };
      perps: {
        withdrawable?: string;
        marginSummary?: { accountValue?: string; totalMarginUsed?: string };
      };
    }
  | { error: string };

type HyperliquidOpenOrdersResponse =
  | {
      ts: number;
      user: string;
      orders: Array<{
        coin: string;
        oid: number;
        side?: string;
        limitPx?: string;
        sz?: string;
        timestamp?: number;
        reduceOnly?: boolean;
      }>;
    }
  | { error: string };

type CancelOrdersResponse = { ts: number; wallet: string; result: unknown } | { error: string };

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

type HyperliquidWithdrawResponse =
  | {
      ts: number;
      wallet: string;
      destination: string;
      amount: number;
      hypurrscanDestinationUrl: string;
      result: unknown;
    }
  | { error: string };

type UnwrapWethResponse =
  | {
      ts: number;
      result: {
        chainId: number;
        from: string;
        to: string;
        asset: "weth";
        amount: string;
        amountWeiOrUnits: string;
        txHash: string;
      };
    }
  | { error: string };

type ArbWithdrawResponse =
  | {
      ts: number;
      result: {
        chainId: number;
        from: string;
        to: string;
        asset: "eth" | "weth" | "usdc" | "usdce";
        amount: string;
        amountWeiOrUnits: string;
        txHash: string;
      };
    }
  | { error: string };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  return (await res.json()) as T;
}

const WALLET_LS_KEY = "bsm.selectedWallet";
const PASSWORD_LS_PREFIX = "bsm.walletPassword.";

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

function maybeDiff(a: string, b: string) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return null;
  const d = na - nb;
  return Math.abs(d) > 1e-9 ? d : null;
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
  const [hlState, setHlState] = useState<HyperliquidStateResponse | null>(null);
  const [hlLoading, setHlLoading] = useState(false);
  const [hlOrders, setHlOrders] = useState<HyperliquidOpenOrdersResponse | null>(null);
  const [hlOrdersLoading, setHlOrdersLoading] = useState(false);
  const [hlOrdersErr, setHlOrdersErr] = useState<string | null>(null);
  const [hlCanceling, setHlCanceling] = useState(false);
  const [hlCancelErr, setHlCancelErr] = useState<string | null>(null);
  const [hlCancelRes, setHlCancelRes] = useState<CancelOrdersResponse | null>(null);

  const [walletPassword, setWalletPassword] = useState("");
  const [reserveEth, setReserveEth] = useState("0.002");

  const [usdcToDeposit, setUsdcToDeposit] = useState("25");
  const [depositingUsdc, setDepositingUsdc] = useState(false);
  const [depositUsdcErr, setDepositUsdcErr] = useState<string | null>(null);
  const [depositUsdcRes, setDepositUsdcRes] = useState<DepositUsdcResponse | null>(null);

  const [hlWithdrawDestination, setHlWithdrawDestination] = useState("");
  const [hlWithdrawAmount, setHlWithdrawAmount] = useState("");
  const [hlWithdrawing, setHlWithdrawing] = useState(false);
  const [hlWithdrawErr, setHlWithdrawErr] = useState<string | null>(null);
  const [hlWithdrawRes, setHlWithdrawRes] = useState<HyperliquidWithdrawResponse | null>(null);

  const [unwrapWethAmount, setUnwrapWethAmount] = useState("max");
  const [unwrapping, setUnwrapping] = useState(false);
  const [unwrapErr, setUnwrapErr] = useState<string | null>(null);
  const [unwrapRes, setUnwrapRes] = useState<UnwrapWethResponse | null>(null);

  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawAsset, setWithdrawAsset] = useState<"eth" | "usdc" | "usdce" | "weth">("eth");
  const [withdrawAmount, setWithdrawAmount] = useState("max");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawErr, setWithdrawErr] = useState<string | null>(null);
  const [withdrawRes, setWithdrawRes] = useState<ArbWithdrawResponse | null>(null);

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

    // Default Hyperliquid withdrawals to "back to this wallet" for convenience.
    setHlWithdrawDestination(selected);
    setHlWithdrawAmount("");
    setHlWithdrawErr(null);
    setHlWithdrawRes(null);
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

  const refreshHlState = useCallback(async () => {
    const addr = selectedWallet?.address;
    if (!addr) {
      setHlState(null);
      return;
    }
    setHlLoading(true);
    try {
      const data = await fetchJson<HyperliquidStateResponse>(
        `/api/hyperliquid/state/${addr}`,
        { cache: "no-store" },
      );
      setHlState(data);
    } finally {
      setHlLoading(false);
    }
  }, [selectedWallet]);

  const refreshHlOrders = useCallback(async () => {
    const addr = selectedWallet?.address;
    if (!addr) {
      setHlOrders(null);
      setHlOrdersErr(null);
      return;
    }
    setHlOrdersLoading(true);
    setHlOrdersErr(null);
    try {
      const data = await fetchJson<HyperliquidOpenOrdersResponse>(
        `/api/hyperliquid/open-orders/${addr}`,
        { cache: "no-store" },
      );
      setHlOrders(data);
      if ("error" in data) setHlOrdersErr(data.error);
    } catch (e) {
      setHlOrdersErr(e instanceof Error ? e.message : "Failed to fetch open orders");
      setHlOrders(null);
    } finally {
      setHlOrdersLoading(false);
    }
  }, [selectedWallet]);

  useEffect(() => {
    void refreshArbBalances();
    const id = window.setInterval(() => void refreshArbBalances(), 15_000);
    return () => window.clearInterval(id);
  }, [refreshArbBalances]);

  useEffect(() => {
    void refreshHlState();
    const id = window.setInterval(() => void refreshHlState(), 15_000);
    return () => window.clearInterval(id);
  }, [refreshHlState]);

  useEffect(() => {
    void refreshHlOrders();
    const id = window.setInterval(() => void refreshHlOrders(), 15_000);
    return () => window.clearInterval(id);
  }, [refreshHlOrders]);

  const cancelHlOrders = useCallback(
    async (opts: { coin?: string; orders?: Array<{ coin: string; oid: number }> }) => {
      const addr = selectedWallet?.address;
      if (!addr) return;
      setHlCanceling(true);
      setHlCancelErr(null);
      setHlCancelRes(null);
      try {
        const data = await fetchJson<CancelOrdersResponse>("/api/hyperliquid/cancel-orders", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            wallet: addr,
            password: walletPassword.trim() || undefined,
            coin: opts.coin,
            orders: opts.orders,
          }),
        });
        setHlCancelRes(data);
        if ("error" in data) setHlCancelErr(data.error);
      } catch (e) {
        setHlCancelErr(e instanceof Error ? e.message : "Cancel failed");
      } finally {
        setHlCanceling(false);
        await refreshHlOrders();
      }
    },
    [refreshHlOrders, selectedWallet, walletPassword],
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

  const withdrawFromHyperliquid = useCallback(async () => {
    const addr = selectedWallet?.address;
    if (!addr) return;
    setHlWithdrawing(true);
    setHlWithdrawErr(null);
    setHlWithdrawRes(null);
    try {
      const destination = hlWithdrawDestination.trim();
      if (!destination) {
        setHlWithdrawErr("Enter a destination address");
        return;
      }

      const amountStr = hlWithdrawAmount.trim();
      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount <= 0) {
        setHlWithdrawErr("Enter a valid USDC amount");
        return;
      }

      const data = await fetchJson<HyperliquidWithdrawResponse>("/api/hyperliquid/withdraw-usdc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet: addr,
          destination,
          amount: amountStr,
          password: walletPassword.trim() || undefined,
        }),
      });
      setHlWithdrawRes(data);
      if ("error" in data) setHlWithdrawErr(data.error);
      await refreshHlState();
      await refreshArbBalances();
    } catch (e) {
      setHlWithdrawErr(e instanceof Error ? e.message : "Withdraw failed");
    } finally {
      setHlWithdrawing(false);
    }
  }, [hlWithdrawAmount, hlWithdrawDestination, refreshArbBalances, refreshHlState, selectedWallet, walletPassword]);

  const unwrapWeth = useCallback(
    async (amount: string) => {
      const addr = selectedWallet?.address;
      if (!addr) return;
      setUnwrapping(true);
      setUnwrapErr(null);
      setUnwrapRes(null);
      try {
        const data = await fetchJson<UnwrapWethResponse>("/api/arbitrum/unwrap-weth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fromAddress: addr,
            wethAmount: amount,
            password: walletPassword.trim() || undefined,
            reserveEth,
          }),
        });
        setUnwrapRes(data);
        if ("error" in data) setUnwrapErr(data.error);
        await refreshArbBalances();
      } catch (e) {
        setUnwrapErr(e instanceof Error ? e.message : "Unwrap failed");
      } finally {
        setUnwrapping(false);
      }
    },
    [refreshArbBalances, reserveEth, selectedWallet, walletPassword],
  );

  const withdraw = useCallback(async () => {
    const addr = selectedWallet?.address;
    if (!addr) return;
    setWithdrawing(true);
    setWithdrawErr(null);
    setWithdrawRes(null);
    try {
      const toAddress = withdrawTo.trim();
      if (!toAddress) {
        setWithdrawErr("Enter a destination address");
        return;
      }

      let amount = withdrawAmount.trim();
      if (withdrawAsset === "usdc" || withdrawAsset === "usdce") {
        if (amount.toLowerCase() !== "max") {
          const n = Number(amount);
          if (!Number.isFinite(n) || n <= 0) {
            setWithdrawErr("Enter a valid USDC amount");
            return;
          }
          amount = BigInt(Math.floor(n * 1_000_000)).toString();
        }
      } else if (withdrawAsset === "eth" || withdrawAsset === "weth") {
        if (amount.toLowerCase() !== "max") {
          const n = Number(amount);
          if (!Number.isFinite(n) || n <= 0) {
            setWithdrawErr("Enter a valid amount");
            return;
          }
        }
      }

      const data = await fetchJson<ArbWithdrawResponse>("/api/arbitrum/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromAddress: addr,
          toAddress,
          asset: withdrawAsset,
          amount,
          password: walletPassword.trim() || undefined,
          reserveEth,
        }),
      });

      setWithdrawRes(data);
      if ("error" in data) setWithdrawErr(data.error);
      await refreshArbBalances();
    } catch (e) {
      setWithdrawErr(e instanceof Error ? e.message : "Withdraw failed");
    } finally {
      setWithdrawing(false);
    }
  }, [refreshArbBalances, reserveEth, selectedWallet, walletPassword, withdrawAmount, withdrawAsset, withdrawTo]);

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
                      <p className="text-[11px] font-medium text-muted">ETH (latest)</p>
                      <p className="mt-1 font-mono text-sm text-foreground">
                        {arbBalances && !("error" in arbBalances) ? formatEth(arbBalances.eth) : "—"}
                      </p>
                      {arbBalances && !("error" in arbBalances) ? (() => {
                        const d = maybeDiff(arbBalances.ethPending, arbBalances.eth);
                        if (d === null) return null;
                        return (
                          <p className="mt-1 text-[11px] text-muted">
                            Pending: {formatEth(arbBalances.ethPending)} ETH
                          </p>
                        );
                      })() : null}
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
                      <p className="text-[11px] font-medium text-muted">WETH</p>
                      <p className="mt-1 font-mono text-sm text-foreground">
                        {arbBalances && !("error" in arbBalances) ? formatEth(arbBalances.weth) : "—"}
                      </p>
                      <p className="mt-1 text-[11px] text-muted">
                        (from wrapping ETH)
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

            </div>

            <div className="rounded-3xl bg-background/60 p-4 ring-1 ring-border/80">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted">Hyperliquid balances</p>
                  <p className="text-sm text-muted">
                    {hlLoading ? "Refreshing…" : "auto-refreshing"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    disabled={!selectedWallet}
                    onClick={() => void refreshHlState()}
                  >
                    Refresh
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!selectedWallet}
                    onClick={() => void refreshHlOrders()}
                  >
                    Orders
                  </Button>
                </div>
              </div>

              {"error" in (hlState ?? {}) ? (
                <p className="mt-3 text-sm text-danger">{(hlState as { error: string }).error}</p>
              ) : (
                <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
                  <div className="rounded-2xl bg-background/60 p-3 ring-1 ring-border/80">
                    <p className="text-[11px] font-medium text-muted">Perps withdrawable</p>
                    <p className="mt-1 font-mono text-sm text-foreground">
                      {hlState && !("error" in hlState) ? (hlState.perps.withdrawable ?? "—") : "—"}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-background/60 p-3 ring-1 ring-border/80">
                    <p className="text-[11px] font-medium text-muted">Perps account value</p>
                    <p className="mt-1 font-mono text-sm text-foreground">
                      {hlState && !("error" in hlState)
                        ? (hlState.perps.marginSummary?.accountValue ?? "—")
                        : "—"}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-background/60 p-3 ring-1 ring-border/80">
                    <p className="text-[11px] font-medium text-muted">Spot USDC total</p>
                    <p className="mt-1 font-mono text-sm text-foreground">
                      {(() => {
                        if (!hlState || "error" in hlState) return "—";
                        const usdc = hlState.spot.balances.find((b) => b.coin === "USDC");
                        return usdc?.total ?? "—";
                      })()}
                    </p>
                  </div>
                </div>
              )}

              <p className="mt-3 text-xs text-muted">
                Deposits from Arbitrum USDC typically credit your Hyperliquid perps account. If you
                deposited and don’t see “Spot USDC”, you may need to transfer from perps ↔ spot inside
                Hyperliquid.
              </p>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl bg-background/60 p-3 ring-1 ring-border/80">
                  <p className="text-xs font-medium text-muted">Deposit (Arbitrum → Hyperliquid)</p>
                  <p className="mt-1 text-[11px] leading-5 text-muted">
                    Send USDC to this wallet on Arbitrum, then deposit it into Hyperliquid here.
                  </p>

                  <div className="mt-3 grid gap-3">
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

                    <div className="flex flex-wrap items-center justify-end gap-2">
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
                            {formatUsdcUnits(depositUsdcRes.result.usdcUnits)}{" "}
                            {depositUsdcRes.result.token.toUpperCase()}
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

                <div className="rounded-2xl bg-background/60 p-3 ring-1 ring-border/80">
                  <p className="text-xs font-medium text-muted">Withdraw (Hyperliquid → Arbitrum)</p>
                  <p className="mt-1 text-[11px] leading-5 text-muted">
                    Initiates a USDC withdrawal from Hyperliquid to an Arbitrum address. Hyperliquid
                    charges a bridge fee (often ~$1) and it may take a few minutes to arrive.
                  </p>

                  <div className="mt-3 grid gap-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted">Destination</label>
                        <Input
                          value={hlWithdrawDestination}
                          onChange={(e) => setHlWithdrawDestination(e.target.value)}
                          placeholder={selectedWallet?.address ?? "0x…"}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted">Amount (USDC)</label>
                        <Input
                          inputMode="decimal"
                          value={hlWithdrawAmount}
                          onChange={(e) => setHlWithdrawAmount(e.target.value)}
                          placeholder="25"
                        />
                        <div className="mt-1 flex flex-wrap gap-2">
                          <Button
                            variant="ghost"
                            disabled={!hlState || "error" in hlState}
                            onClick={() => {
                              if (!hlState || "error" in hlState) return;
                              const w = Number(hlState.perps.withdrawable ?? "");
                              if (Number.isFinite(w) && w > 0) setHlWithdrawAmount(String(w));
                            }}
                          >
                            Use withdrawable
                          </Button>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        variant="soft"
                        disabled={!selectedWallet || hlWithdrawing || hlWithdrawAmount.trim().length === 0}
                        onClick={() => void withdrawFromHyperliquid()}
                      >
                        {hlWithdrawing ? "Withdrawing…" : "Withdraw USDC"}
                      </Button>
                    </div>

                    {hlWithdrawErr ? (
                      <div className="rounded-2xl bg-background/60 p-3 text-sm text-danger ring-1 ring-border/80">
                        {hlWithdrawErr}
                      </div>
                    ) : null}

                    {hlWithdrawRes && !("error" in hlWithdrawRes) ? (
                      <div className="rounded-2xl bg-background/60 p-3 text-sm text-muted ring-1 ring-border/80">
                        <p>Withdrawal initiated.</p>
                        <p className="mt-2 text-xs">
                          Destination:{" "}
                          <a
                            className="font-mono text-sm text-foreground underline decoration-border/80 underline-offset-4 hover:decoration-foreground"
                            href={hlWithdrawRes.hypurrscanDestinationUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {shortAddr(hlWithdrawRes.destination)}
                          </a>
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl bg-background/60 p-4 ring-1 ring-border/80">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted">Open limit orders</p>
                  <p className="text-sm text-muted">{hlOrdersLoading ? "Refreshing…" : "auto-refreshing"}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    disabled={!selectedWallet || hlCanceling}
                    onClick={() => void cancelHlOrders({})}
                  >
                    {hlCanceling ? "Canceling…" : "Cancel all"}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!selectedWallet || hlOrdersLoading}
                    onClick={() => void refreshHlOrders()}
                  >
                    Refresh
                  </Button>
                </div>
              </div>

              {hlOrdersErr ? (
                <div className="mt-3 rounded-2xl bg-background/60 p-3 text-sm text-danger ring-1 ring-border/80">
                  {hlOrdersErr}
                </div>
              ) : null}

              {hlCancelErr ? (
                <div className="mt-3 rounded-2xl bg-background/60 p-3 text-sm text-danger ring-1 ring-border/80">
                  {hlCancelErr}
                </div>
              ) : null}

              {hlCancelRes && !("error" in hlCancelRes) ? (
                <div className="mt-3 rounded-2xl bg-background/60 p-3 text-sm text-muted ring-1 ring-border/80">
                  Submitted cancel request.
                </div>
              ) : null}

              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-separate border-spacing-0 text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">Coin</th>
                      <th className="px-3 py-2 font-medium">Side</th>
                      <th className="px-3 py-2 font-medium">Limit</th>
                      <th className="px-3 py-2 font-medium">Size</th>
                      <th className="px-3 py-2 font-medium">OID</th>
                      <th className="px-3 py-2 font-medium">Cancel</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {hlOrders && !("error" in hlOrders) && hlOrders.orders.length ? (
                      hlOrders.orders.map((o) => (
                        <tr key={`${o.coin}:${o.oid}`}>
                          <td className="border-t border-border/60 px-3 py-2 font-mono text-foreground">
                            {o.coin}
                          </td>
                          <td className="border-t border-border/60 px-3 py-2 text-muted">
                            {o.side ?? "—"}
                          </td>
                          <td className="border-t border-border/60 px-3 py-2 font-mono text-muted">
                            {o.limitPx ?? "—"}
                          </td>
                          <td className="border-t border-border/60 px-3 py-2 font-mono text-muted">
                            {o.sz ?? "—"}
                          </td>
                          <td className="border-t border-border/60 px-3 py-2 font-mono text-muted">
                            {o.oid}
                          </td>
                          <td className="border-t border-border/60 px-3 py-2">
                            <Button
                              variant="ghost"
                              disabled={hlCanceling}
                              onClick={() =>
                                void cancelHlOrders({ orders: [{ coin: o.coin, oid: o.oid }] })
                              }
                            >
                              Cancel
                            </Button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={6}
                          className="border-t border-border/60 px-3 py-4 text-sm text-muted"
                        >
                          {hlOrdersLoading ? "Loading…" : "No open orders."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <p className="mt-3 text-xs text-muted">
                If you see many open orders here, use “Cancel all” to clean up. (This app only
                intends to use IOC orders; anything resting is unexpected.)
              </p>
            </div>

            <div className="rounded-3xl bg-background/60 p-4 ring-1 ring-border/80">
              <p className="text-xs font-medium text-muted">Withdraw / unwrap</p>
              <p className="mt-2 text-sm leading-6 text-muted">
                If you see WETH in this wallet, it means ETH was wrapped at some point (WETH is just
                ETH in ERC-20 form). You can unwrap WETH back to ETH, or withdraw assets to another
                address and swap there.
              </p>

              <div className="mt-4 grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted">Destination address</label>
                    <Input
                      value={withdrawTo}
                      onChange={(e) => setWithdrawTo(e.target.value)}
                      placeholder="0x…"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted">Asset</label>
                    <select
                      className="h-10 w-full rounded-2xl bg-background/60 px-3 text-sm text-foreground ring-1 ring-border/80"
                      value={withdrawAsset}
                      onChange={(e) => setWithdrawAsset(e.target.value as typeof withdrawAsset)}
                    >
                      <option value="eth">ETH</option>
                      <option value="weth">WETH</option>
                      <option value="usdc">USDC</option>
                      <option value="usdce">USDC.e</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted">
                      Amount ({withdrawAsset.toUpperCase()})
                    </label>
                    <Input
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder={withdrawAsset === "usdc" || withdrawAsset === "usdce" ? "25" : "max"}
                    />
                    <p className="text-[11px] text-muted">
                      Use <span className="font-mono text-foreground">max</span> to send the maximum
                      amount (ETH will automatically subtract gas + reserve).
                    </p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted">Reserve ETH (gas)</label>
                    <Input
                      inputMode="decimal"
                      value={reserveEth}
                      onChange={(e) => setReserveEth(e.target.value)}
                      placeholder="0.002"
                    />
                    <p className="text-[11px] text-muted">
                      Keep a little ETH for Arbitrum gas.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted">Wallet password (optional)</label>
                    <Input
                      type="password"
                      value={walletPassword}
                      onChange={(e) => setWalletPassword(e.target.value)}
                      placeholder="(cached locally)"
                    />
                  </div>
                  <div className="space-y-1" />
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
                  <Button
                    variant="soft"
                    disabled={!selectedWallet || withdrawing}
                    onClick={() => void withdraw()}
                  >
                    {withdrawing ? "Withdrawing…" : "Withdraw"}
                  </Button>
                </div>

                {withdrawErr ? (
                  <div className="rounded-2xl bg-background/60 p-3 text-sm text-danger ring-1 ring-border/80">
                    {withdrawErr}
                  </div>
                ) : null}

                {withdrawRes && !("error" in withdrawRes) ? (
                  <div className="rounded-2xl bg-background/60 p-3 text-sm text-muted ring-1 ring-border/80">
                    <p>
                      Submitted withdraw{" "}
                      <span className="font-mono text-foreground">
                        {withdrawRes.result.asset.toUpperCase()}
                      </span>
                      .
                    </p>
                    <p className="mt-2 text-xs">
                      Tx:{" "}
                      <a
                        className="font-mono text-sm text-foreground underline decoration-border/80 underline-offset-4 hover:decoration-foreground"
                        href={`https://arbiscan.io/tx/${withdrawRes.result.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {withdrawRes.result.txHash.slice(0, 12)}…
                      </a>
                    </p>
                  </div>
                ) : null}

                <div className="mt-2 rounded-2xl bg-background/60 p-3 ring-1 ring-border/80">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted">Unwrap WETH → ETH</p>
                      <p className="text-[11px] text-muted">
                        Current WETH:{" "}
                        <span className="font-mono text-foreground">
                          {arbBalances && !("error" in arbBalances) ? formatEth(arbBalances.weth) : "—"}
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={unwrapWethAmount}
                        onChange={(e) => setUnwrapWethAmount(e.target.value)}
                        placeholder="max"
                      />
                      <Button
                        variant="ghost"
                        disabled={!selectedWallet || unwrapping}
                        onClick={() => void unwrapWeth(unwrapWethAmount)}
                      >
                        {unwrapping ? "Unwrapping…" : "Unwrap"}
                      </Button>
                    </div>
                  </div>

                  {unwrapErr ? (
                    <div className="mt-3 rounded-2xl bg-background/60 p-3 text-sm text-danger ring-1 ring-border/80">
                      {unwrapErr}
                    </div>
                  ) : null}

                  {unwrapRes && !("error" in unwrapRes) ? (
                    <div className="mt-3 rounded-2xl bg-background/60 p-3 text-sm text-muted ring-1 ring-border/80">
                      <p>Submitted unwrap.</p>
                      <p className="mt-2 text-xs">
                        Tx:{" "}
                        <a
                          className="font-mono text-sm text-foreground underline decoration-border/80 underline-offset-4 hover:decoration-foreground"
                          href={`https://arbiscan.io/tx/${unwrapRes.result.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {unwrapRes.result.txHash.slice(0, 12)}…
                        </a>
                      </p>
                    </div>
                  ) : null}
                </div>
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
