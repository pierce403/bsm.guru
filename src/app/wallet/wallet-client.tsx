"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

type WalletRow = {
  address: string;
  createdAt: number;
  downloadUrl: string;
};

type ListResponse =
  | { ts: number; wallets: WalletRow[] }
  | { error: string };

type CreateResponse =
  | { ts: number; wallet: WalletRow }
  | { error: string };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json()) as T;
  return data;
}

function formatTs(ts: number) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export function WalletClient() {
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [password1, setPassword1] = useState("");
  const [password2, setPassword2] = useState("");
  const [created, setCreated] = useState<WalletRow | null>(null);

  const passwordIssue = useMemo(() => {
    if (password1.length === 0 && password2.length === 0) return null;
    if (password1.length > 0 && password1.length < 10)
      return "Password must be at least 10 characters.";
    if (password2.length > 0 && password1 !== password2)
      return "Passwords do not match.";
    return null;
  }, [password1, password2]);

  async function refresh() {
    setLoading(true);
    const data = await fetchJson<ListResponse>("/api/wallets", {
      cache: "no-store",
    });
    if ("error" in data) {
      setError(data.error);
      setWallets([]);
    } else {
      setError(null);
      setWallets(data.wallets);
    }
    setLoading(false);
  }

  async function create() {
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
      } else {
        setError(null);
        setCreated(data.wallet);
        setPassword1("");
        setPassword2("");
        await refresh();
      }
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

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

      {created ? (
        <Card className="space-y-3">
          <p className="text-sm font-medium text-foreground">Wallet created</p>
          <p className="font-mono text-sm text-foreground">{created.address}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a
              href={created.downloadUrl}
              className="inline-flex items-center justify-center rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background shadow-[0_14px_40px_rgba(11,19,32,0.18)] transition hover:shadow-[0_18px_48px_rgba(11,19,32,0.22)]"
            >
              Download encrypted backup
            </a>
          </div>
          <p className="text-xs text-muted">
            You will need your password + this JSON to restore the wallet.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="space-y-5 lg:col-span-5">
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

        <Card className="p-0 lg:col-span-7">
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <p className="text-sm font-medium text-foreground">Wallets</p>
              <p className="text-xs text-muted">
                Stored as encrypted JSON keystores on disk.
              </p>
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
                    Created
                  </th>
                  <th className="border-t border-border/60 px-6 py-3 font-medium">
                    Backup
                  </th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {wallets.map((w) => (
                  <tr key={w.address} className="hover:bg-background/40">
                    <td className="border-t border-border/60 px-6 py-3 font-mono text-foreground">
                      {w.address}
                    </td>
                    <td className="border-t border-border/60 px-6 py-3 text-muted">
                      {formatTs(w.createdAt)}
                    </td>
                    <td className="border-t border-border/60 px-6 py-3">
                      <a
                        href={w.downloadUrl}
                        className="text-sm font-medium text-foreground underline decoration-border/80 underline-offset-4 hover:decoration-foreground"
                      >
                        Download
                      </a>
                    </td>
                  </tr>
                ))}

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
    </main>
  );
}
