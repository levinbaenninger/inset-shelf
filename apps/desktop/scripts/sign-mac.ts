import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { AfterPackContext } from "electron-builder";

// electron-builder only signs with an identity macOS trusts, so the app is
// signed here instead, between packing and building the dmg and zip.

const IDENTITY = "2FA2057FB218EEC7CBB6961B18455C35C470D7E2";

const LOCAL_KEYCHAIN = path.join(
  homedir(),
  "Library/Keychains/inset-signing.keychain-db"
);

const LOCAL_PASSWORD = path.join(
  homedir(),
  ".config/inset-signing/keychain-password"
);

const MACH_O_MAGIC = new Set([
  0xfe_ed_fa_ce, 0xfe_ed_fa_cf, 0xce_fa_ed_fe, 0xcf_fa_ed_fe, 0xca_fe_ba_be,
  0xbe_ba_fe_ca,
]);

/** The app itself: JIT, library validation off while self-signed, Apple Events. */
const ENTITLEMENTS = path.resolve(
  import.meta.dirname,
  "../build/entitlements.mac.plist"
);

/** Helper apps and other executables: the same without Apple Events. */
const HELPER_ENTITLEMENTS = path.resolve(
  import.meta.dirname,
  "../build/entitlements.mac.helper.plist"
);

/** A double-quoted argument for `security -i`, which reads its commands from stdin. */
const quoteForSecurity = (value: string): string => {
  if (/[\n\r]/u.test(value)) {
    throw new Error("A keychain password must be one line.");
  }

  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', String.raw`\"`)}"`;
};

const run = (
  command: string,
  args: readonly string[],
  input?: string
): string =>
  execFileSync(command, args, {
    encoding: "utf-8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  });

/** The keychain holding the shared identity, unlocked, or null to sign ad hoc. */
const signingKeychain = (): string | null => {
  const keychain = process.env.INSET_SIGN_KEYCHAIN ?? LOCAL_KEYCHAIN;

  if (!existsSync(keychain)) {
    return null;
  }

  if (keychain === LOCAL_KEYCHAIN && existsSync(LOCAL_PASSWORD)) {
    // Through `security -i` on stdin, so the password never shows in argv. A plain
    // `unlock-keychain` without -p would read /dev/tty instead and hang in a terminal.
    const password = readFileSync(LOCAL_PASSWORD, "utf-8").trim();

    run(
      "security",
      ["-i"],
      `unlock-keychain -p ${quoteForSecurity(password)} ${quoteForSecurity(keychain)}\n`
    );
  }

  return run("security", [
    "find-identity",
    "-p",
    "codesigning",
    keychain,
  ]).includes(IDENTITY)
    ? keychain
    : null;
};

/**
 * The entitlements a target is signed with: the app's own for the app, the helpers' for nested
 * apps and executables, none for libraries and frameworks.
 */
const entitlementsFor = (target: string, app: string): string | null => {
  if (target === app) {
    return ENTITLEMENTS;
  }

  if (target.endsWith(".app")) {
    return HELPER_ENTITLEMENTS;
  }

  if (target.endsWith(".framework") || /\.(?:dylib|node)$/u.test(target)) {
    return null;
  }

  // eslint-disable-next-line no-bitwise -- file mode bits
  return (lstatSync(target).mode & 0o111) === 0 ? null : HELPER_ENTITLEMENTS;
};

const isMachO = (file: string): boolean => {
  const header = Buffer.alloc(4);
  const fd = openSync(file, "r");

  try {
    return (
      readSync(fd, header, 0, 4, 0) === 4 &&
      MACH_O_MAGIC.has(header.readUInt32BE(0))
    );
  } finally {
    closeSync(fd);
  }
};

const BUNDLE = /\.(?:app|framework)$/u;

/**
 * Signing a bundle's main executable signs the bundle, which needs all its
 * nested code signed first. So it is left out and signed with the bundle.
 */
const mainExecutable = (bundle: string): string => {
  const name = path.basename(bundle).replace(BUNDLE, "");

  return bundle.endsWith(".app")
    ? path.join(bundle, "Contents", "MacOS", name)
    : path.join(bundle, "Versions", "A", name);
};

/**
 * Every Mach-O file and nested bundle below a directory, each listed after what
 * it contains. Symlinks are skipped: they point at code listed anyway.
 */
const nestedCode = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const entry = path.join(dir, name);
    const stat = lstatSync(entry);

    if (stat.isSymbolicLink()) {
      return [];
    }

    if (!stat.isDirectory()) {
      return stat.size >= 4 && isMachO(entry) ? [entry] : [];
    }

    if (!BUNDLE.test(name)) {
      return nestedCode(entry);
    }

    const main = mainExecutable(entry);

    return [...nestedCode(entry).filter((file) => file !== main), entry];
  });

export default function signMac(context: AfterPackContext): void {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const app = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  const keychain = signingKeychain();

  if (keychain === null && process.env.INSET_REQUIRE_SIGNING === "1") {
    throw new Error(
      `The signing identity ${IDENTITY} was not found; a release must not ship ad hoc.`
    );
  }

  const identity =
    keychain === null
      ? ["--sign", "-"]
      : ["--sign", IDENTITY, "--keychain", keychain];

  console.log(
    `  • signing ${keychain === null ? "ad hoc" : `with ${IDENTITY}`}  app=${app}`
  );

  // Inside out: a bundle's seal covers the signatures of the code it contains.
  for (const target of nestedCode(context.appOutDir)) {
    const entitlements = entitlementsFor(target, app);

    run("codesign", [
      "--force",
      "--timestamp=none",
      "--options",
      "runtime",
      ...(entitlements === null ? [] : ["--entitlements", entitlements]),
      ...identity,
      target,
    ]);
  }

  run("codesign", ["--verify", "--deep", "--strict", app]);
}
