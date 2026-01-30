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

type BalanceResponse =
  | {
      ts: number;
      address: string;
      balanceEth: string;
      balanceWei: string;
      chainId: number;
    }
  | { error: string };

type TxRow = {
  hash: string;
  ts: number;
  from: string;
  to: string;
  valueWei: string;
  valueEth: string;
  ok: boolean;
};

type TxsResponse =
  | { ts: number; address: string; explorer: string; txs: TxRow[] }
  | { error: string };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  return (await res.json()) as T;
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

function formatEth(eth: string) {
  const n = Number(eth);
  if (!Number.isFinite(n)) return eth;
  if (n === 0) return "0";
  if (n < 0.0001) return n.toFixed(6);
  if (n < 1) return n.toFixed(4);
  return n.toFixed(4);
}

function isBalanceOk(
  b: BalanceResponse | undefined,
): b is Extract<BalanceResponse, { balanceEth: string }> {
  return !!b && !("error" in b);
}

export function WalletClient() {
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [password1, setPassword1] = useState("");
  const [password2, setPassword2] = useState("");
  const [created, setCreated] = useState<WalletRow | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [balances, setBalances] = useState<Record<string, BalanceResponse>>({});
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const passwordIssue = useMemo(() => {
    if (password1.length === 0 && password2.length === 0) return null;
    if (password1.length > 0 && password1.length < 10)
      return "Password must be at least 10 characters.";
    if (password2.length > 0 && password1 !== password2)
      return "Passwords do not match.";
    return null;
  }, [password1, password2]);

  const selectedWallet = useMemo(
    () => wallets.find((w) => w.address === selected) ?? null,
    [wallets, selected],
  );

  const selectedBalance = useMemo(() => {
    if (!selectedWallet) return null;
    const b = balances[selectedWallet.address];
    return isBalanceOk(b) ? b : null;
  }, [balances, selectedWallet]);

  const fundUri = useMemo(() => {
    if (!selectedWallet) return null;
    // EIP-681-ish. Some wallets ignore the chainId, but it helps when supported.
    return `ethereum:${selectedWallet.address}@8453`;
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
      if (prev && data.wallets.some((w) => w.address === prev)) return prev;
      return data.wallets[0]?.address ?? null;
    });
    setLoading(false);
  }, []);

  const loadBalances = useCallback(async (addrs: string[]) => {
    if (addrs.length === 0) return;

    const results = await Promise.allSettled(
      addrs.map(async (a) => {
        const r = await fetchJson<BalanceResponse>(`/api/base/balance/${a}`, {
          cache: "no-store",
        });
        return [a, r] as const;
      }),
    );

    setBalances((prev) => {
      const next = { ...prev };
      for (const r of results) {
        if (r.status === "fulfilled") {
          const [addr, data] = r.value;
          next[addr] = data;
        }
      }
      return next;
    });
  }, []);

  const loadTxs = useCallback(async (address: string) => {
    setTxLoading(true);
    const data = await fetchJson<TxsResponse>(
      `/api/base/txs/${address}?limit=25`,
      { cache: "no-store" },
    );

    if ("error" in data) {
      setTxs([]);
    } else {
      setTxs(data.txs);
    }

    setTxLoading(false);
  }, []);

  const create = useCallback(async () => {
    setCreating(true);
    setCreated(null);
    try {
      const data = await fetchJson<CreateResponse>("/api/wallets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: password1 }),
      });

      if ("error" in data) {
        setError(data.error);
        return;
      }

      setError(null);
      setCreated(data.wallet);
      setPassword1("");
      setPassword2("");
      setSelected(data.wallet.address);
      await refresh();
      await loadBalances([data.wallet.address]);
      await loadTxs(data.wallet.address);
    } finally {
      setCreating(false);
    }
  }, [loadBalances, loadTxs, password1, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (wallets.length === 0) return;
    void loadBalances(wallets.map((w) => w.address));
  }, [wallets, loadBalances]);

  useEffect(() => {
    if (!selected) return;
    void loadBalances([selected]);
    void loadTxs(selected);

    const balId = window.setInterval(() => void loadBalances([selected]), 15_000);
    const txId = window.setInterval(() => void loadTxs(selected), 30_000);

    return () => {
      window.clearInterval(balId);
      window.clearInterval(txId);
    };
  }, [selected, loadBalances, loadTxs]);

  return (
    <main className="space-y-6">
      <header className="space-y-3">
        <h1 className="font-display text-4xl tracking-tight text-foreground">
          Wallet
        </h1>
        <p className="max-w-2xl text-base leading-7 text-muted">
          Local, custodial keystore management. Wallets are generated server-side
          and written to disk; you can download an encrypted backup JSON.
        </p>
        <p className="max-w-2xl text-xs leading-6 text-muted">
          Do not expose this app to the internet. Keep passwords strong. Losing
          the password means losing the funds.
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
          <Card className="space-y-5">
            <p className="text-sm font-medium text-foreground">Create wallet</p>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">Password</label>
              <Input
                type="password"
                autoComplete="new-password"
                value={password1}
                onChange={(e) => setPassword1(e.target.value)}
                placeholder="Min 10 characters"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">
                Confirm password
              </label>
              <Input
                type="password"
                autoComplete="new-password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                placeholder="Type it again"
              />
            </div>

            {passwordIssue ? (
              <div className="rounded-2xl bg-background/60 p-3 text-xs text-danger ring-1 ring-border/80">
                {passwordIssue}
              </div>
            ) : null}

            <Button
              disabled={creating || !!passwordIssue || password1.length === 0}
              onClick={() => void create()}
            >
              {creating ? "Creating..." : "Generate wallet"}
            </Button>
          </Card>

          <Card className="p-0">
            <div className="flex items-center justify-between px-6 py-4">
              <div>
                <p className="text-sm font-medium text-foreground">Wallets</p>
                <p className="text-xs text-muted">Click to view details.</p>
              </div>
              <p className="text-xs text-muted">
                {loading ? "Loading…" : `${wallets.length} found`}
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
                      Balance
                    </th>
                    <th className="border-t border-border/60 px-6 py-3 font-medium">
                      Backup
                    </th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {wallets.map((w) => {
                    const bal = balances[w.address];
                    const balText =
                      !bal || "error" in bal
                        ? "—"
                        : `${formatEth(bal.balanceEth)} ETH`;
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
                          {balText}
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
                  Selected wallet (Base)
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

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl bg-background/60 p-4 ring-1 ring-border/80">
                <p className="text-xs font-medium text-muted">Network</p>
                <p className="mt-1 font-mono text-lg text-foreground">Base</p>
                <p className="mt-1 text-xs text-muted">chainId 8453</p>
              </div>
              <div className="rounded-2xl bg-background/60 p-4 ring-1 ring-border/80">
                <p className="text-xs font-medium text-muted">Balance</p>
                <p className="mt-1 font-mono text-lg text-foreground">
                  {selectedBalance ? `${formatEth(selectedBalance.balanceEth)} ETH` : "—"}
                </p>
                <p className="mt-1 text-xs text-muted">auto-refreshing</p>
              </div>
              <div className="rounded-2xl bg-background/60 p-4 ring-1 ring-border/80">
                <p className="text-xs font-medium text-muted">Explorer</p>
                {selectedWallet ? (
                  <a
                    href={`https://base.blockscout.com/address/${selectedWallet.address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex font-mono text-sm text-foreground underline decoration-border/80 underline-offset-4 hover:decoration-foreground"
                  >
                    View address
                  </a>
                ) : (
                  <p className="mt-1 font-mono text-sm text-muted">—</p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <button
                type="button"
                className="group flex w-full items-center justify-between rounded-3xl bg-background/60 p-4 ring-1 ring-border/80 transition hover:bg-background/70 sm:w-auto sm:min-w-[280px]"
                onClick={() => setQrOpen(true)}
                disabled={!fundUri}
              >
                <div className="space-y-1 text-left">
                  <p className="text-xs font-medium text-muted">Fund wallet</p>
                  <p className="text-sm text-muted">Click to enlarge QR</p>
                </div>
                <div className="rounded-2xl bg-white p-3 shadow">
                  {fundUri ? <QRCode value={fundUri} size={96} /> : <div className="h-24 w-24" />}
                </div>
              </button>

              <div className="flex-1 rounded-3xl bg-background/60 p-4 ring-1 ring-border/80">
                <p className="text-xs font-medium text-muted">Funding note</p>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Send <span className="font-medium text-foreground">Base ETH</span>{" "}
                  to the address above. Keep your backup JSON + password safe
                  before depositing.
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-0">
            <div className="flex items-center justify-between px-6 py-4">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Transaction history
                </p>
                <p className="text-xs text-muted">
                  Pulled from the Base explorer API.
                </p>
              </div>
              <p className="text-xs text-muted">
                {txLoading ? "Loading…" : `${txs.length} txs`}
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="border-t border-border/60 px-6 py-3 font-medium">
                      Time
                    </th>
                    <th className="border-t border-border/60 px-6 py-3 font-medium">
                      Dir
                    </th>
                    <th className="border-t border-border/60 px-6 py-3 font-medium">
                      Counterparty
                    </th>
                    <th className="border-t border-border/60 px-6 py-3 font-medium">
                      Value
                    </th>
                    <th className="border-t border-border/60 px-6 py-3 font-medium">
                      Status
                    </th>
                    <th className="border-t border-border/60 px-6 py-3 font-medium">
                      Tx
                    </th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {txs.map((tx) => {
                    const me = selectedWallet?.address?.toLowerCase() ?? "";
                    const fromMe = tx.from.toLowerCase() === me;
                    const counterparty = fromMe ? tx.to : tx.from;
                    return (
                      <tr key={tx.hash} className="hover:bg-background/40">
                        <td className="border-t border-border/60 px-6 py-3 text-muted">
                          {formatTs(tx.ts)}
                        </td>
                        <td
                          className={[
                            "border-t border-border/60 px-6 py-3 font-mono",
                            fromMe ? "text-danger" : "text-success",
                          ].join(" ")}
                        >
                          {fromMe ? "OUT" : "IN"}
                        </td>
                        <td className="border-t border-border/60 px-6 py-3 font-mono text-muted">
                          {shortAddr(counterparty)}
                        </td>
                        <td className="border-t border-border/60 px-6 py-3 font-mono text-foreground">
                          {formatEth(tx.valueEth)} ETH
                        </td>
                        <td
                          className={[
                            "border-t border-border/60 px-6 py-3 font-mono",
                            tx.ok ? "text-success" : "text-danger",
                          ].join(" ")}
                        >
                          {tx.ok ? "OK" : "FAIL"}
                        </td>
                        <td className="border-t border-border/60 px-6 py-3">
                          <a
                            href={`https://base.blockscout.com/tx/${tx.hash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-sm text-foreground underline decoration-border/80 underline-offset-4 hover:decoration-foreground"
                          >
                            {tx.hash.slice(0, 10)}…
                          </a>
                        </td>
                      </tr>
                    );
                  })}

                  {!txLoading && selectedWallet && txs.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="border-t border-border/60 px-6 py-6 text-sm text-muted"
                      >
                        No transactions yet.
                      </td>
                    </tr>
                  ) : null}

                  {!selectedWallet ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="border-t border-border/60 px-6 py-6 text-sm text-muted"
                      >
                        Select a wallet to view its history.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

      <Modal open={qrOpen} onClose={() => setQrOpen(false)} title="Fund wallet">
        <div className="space-y-4">
          <p className="text-sm text-muted">Scan to send Base ETH to:</p>
          <p className="break-all rounded-2xl bg-background/60 p-3 font-mono text-xs text-foreground ring-1 ring-border/80">
            {selectedWallet?.address ?? "—"}
          </p>
          <div className="grid place-items-center rounded-3xl bg-white p-6">
            {fundUri ? <QRCode value={fundUri} size={320} /> : null}
          </div>
          <p className="text-xs text-muted">
            If your wallet app asks, choose network{" "}
            <span className="font-medium text-foreground">Base</span>.
          </p>
        </div>
      </Modal>
    </main>
  );
}

