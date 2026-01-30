import "server-only";

import fs from "node:fs";
import path from "node:path";

import { Wallet } from "ethers";

export type WalletRecord = {
  address: string;
  file: string;
  createdAt: number;
};

function walletDir() {
  const raw = process.env.BSM_WALLET_DIR ?? path.join(process.cwd(), "data", "wallets");
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

function keystorePath(address: string) {
  return path.join(walletDir(), `${address.toLowerCase()}.json`);
}

export function isAddressLike(input: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(input);
}

export function listWallets(): WalletRecord[] {
  const dir = walletDir();
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const wallets: WalletRecord[] = [];

  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!ent.name.endsWith(".json")) continue;

    const base = ent.name.slice(0, -".json".length);
    if (!isAddressLike(base)) continue;

    const file = path.join(dir, ent.name);
    const stat = fs.statSync(file);
    wallets.push({
      address: base,
      file,
      createdAt: stat.birthtimeMs || stat.mtimeMs,
    });
  }

  wallets.sort((a, b) => b.createdAt - a.createdAt);
  return wallets;
}

export async function createWallet(params: { password?: string }) {
  const password = params.password ?? "";
  if (password.length > 0 && password.length < 10) {
    throw new Error("Password too short (min 10 characters).");
  }

  const dir = walletDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const wallet = Wallet.createRandom();
  const keystoreJson = await wallet.encrypt(password);

  const addr = wallet.address.toLowerCase();
  const filePath = keystorePath(addr);

  fs.writeFileSync(filePath, keystoreJson, { encoding: "utf8", mode: 0o600, flag: "wx" });

  const stat = fs.statSync(filePath);
  return {
    address: addr,
    createdAt: stat.birthtimeMs || stat.mtimeMs,
  };
}

export function readKeystore(address: string) {
  if (!isAddressLike(address)) throw new Error("Invalid address.");
  const filePath = keystorePath(address);
  const json = fs.readFileSync(filePath, "utf8");
  return json;
}
