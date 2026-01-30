"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "react-qr-code";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";

type WalletRow = {
  address: string;
  createdAt: number;
  downloadUrl: string;
};

type ListResponse = { ts: number; wallets: WalletRow[] } | { error: string };
type CreateResponse = { ts: number; wallet: WalletRow } | { error: string };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  return (await res.json()) as T;
}

const WALLET_LS_KEY = "bsm.selectedWallet";

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
  }, [selected]);

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

