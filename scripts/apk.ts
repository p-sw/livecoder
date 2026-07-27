// ponytail: hit PWABuilder cloudapk, poll, unzip into android-apk/.
// Reuses android-apk/signing.keystore when present so Play updates keep working.

import { mkdir, readFile, writeFile, rm, readdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const CLOUDAPK = 'https://pwabuilder-cloudapk.azurewebsites.net';
const OUT = 'android-apk';
const PWA_URL = (process.env.PWA_URL ?? 'https://livecoder.psw.kr').replace(/\/$/, '');
const PACKAGE_ID = process.env.ANDROID_PACKAGE_ID ?? 'kr.psw.livecoder';

type SigningInfo = {
  alias: string;
  storePassword: string;
  keyPassword: string;
  fullName: string;
  organization: string;
  organizationalUnit: string;
  countryCode: string;
};

function parseSigningInfo(text: string): SigningInfo {
  const get = (label: string) =>
    text.match(new RegExp(`^${label}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? '';
  const info: SigningInfo = {
    alias: get('Key alias') || 'my-key-alias',
    storePassword: get('Key store password'),
    keyPassword: get('Key password'),
    fullName: get("Signer's full name") || 'livecoder Admin',
    organization: get("Signer's organization") || 'livecoder',
    organizationalUnit: get("Signer's organizational unit") || 'Engineering',
    countryCode: get("Signer's country code") || 'US',
  };
  if (!info.storePassword || !info.keyPassword) {
    throw new Error(`Missing keystore passwords in ${OUT}/signing-key-info.txt`);
  }
  return info;
}

async function loadExistingSigning(): Promise<{
  mode: 'mine' | 'new';
  signing: Record<string, unknown>;
}> {
  const keystorePath = join(OUT, 'signing.keystore');
  const infoPath = join(OUT, 'signing-key-info.txt');
  if (existsSync(keystorePath) && existsSync(infoPath)) {
    const info = parseSigningInfo(await readFile(infoPath, 'utf8'));
    const b64 = Buffer.from(await readFile(keystorePath)).toString('base64');
    return {
      mode: 'mine',
      signing: {
        file: `data:application/octet-stream;base64,${b64}`,
        alias: info.alias,
        fullName: info.fullName,
        organization: info.organization,
        organizationalUnit: info.organizationalUnit,
        countryCode: info.countryCode,
        keyPassword: info.keyPassword,
        storePassword: info.storePassword,
      },
    };
  }
  return {
    mode: 'new',
    signing: {
      file: null,
      alias: 'my-key-alias',
      fullName: 'livecoder Admin',
      organization: 'livecoder',
      organizationalUnit: 'Engineering',
      countryCode: 'US',
      keyPassword: '',
      storePassword: '',
    },
  };
}

function packageOptions(signingMode: 'new' | 'mine', signing: Record<string, unknown>) {
  const host = new URL(PWA_URL).host;
  return {
    additionalTrustedOrigins: [],
    appVersion: process.env.ANDROID_APP_VERSION ?? '1.0.0.0',
    appVersionCode: Number(process.env.ANDROID_VERSION_CODE ?? '1'),
    backgroundColor: '#090d13',
    display: 'standalone',
    enableNotifications: true,
    enableSiteSettingsShortcut: true,
    fallbackType: 'customtabs',
    features: {
      locationDelegation: { enabled: false },
      playBilling: { enabled: false },
    },
    host,
    iconUrl: `${PWA_URL}/icons/icon-512.png`,
    includeSourceCode: false,
    isChromeOSOnly: false,
    isMetaQuest: false,
    launcherName: 'livecoder',
    maskableIconUrl: `${PWA_URL}/icons/icon-512.png`,
    monochromeIconUrl: null,
    name: 'livecoder',
    navigationColor: '#090d13',
    navigationColorDark: '#090d13',
    navigationDividerColor: '#090d13',
    navigationDividerColorDark: '#090d13',
    orientation: 'any',
    packageId: PACKAGE_ID,
    shareTarget: null,
    shortcuts: [],
    signing,
    signingMode,
    splashScreenFadeOutDuration: 300,
    startUrl: '/',
    themeColor: '#090d13',
    themeColorDark: '#090d13',
    webManifestUrl: `${PWA_URL}/manifest.json`,
    pwaUrl: `${PWA_URL}/`,
    fullScopeUrl: `${PWA_URL}/`,
    minSdkVersion: 23,
  };
}

async function enqueue(body: unknown): Promise<string> {
  const res = await fetch(`${CLOUDAPK}/enqueuePackageJob`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'platform-identifier': 'livecoder-apk-script',
      'platform-identifier-version': '1.0.0',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`enqueue failed ${res.status}: ${text}`);
  return text.trim();
}

async function poll(jobId: string) {
  for (let i = 0; i < 90; i++) {
    const res = await fetch(`${CLOUDAPK}/getPackageJob?id=${encodeURIComponent(jobId)}`);
    if (!res.ok) throw new Error(`poll failed ${res.status}: ${await res.text()}`);
    const job = (await res.json()) as {
      status: string;
      errors?: string[];
      logs?: string[];
    };
    const last = job.logs?.at(-1) ?? job.status;
    console.log(`[${i + 1}] ${job.status} — ${last}`);
    if (job.status === 'Completed') return job;
    if (job.status === 'Failed' || (job.errors && job.errors.length)) {
      throw new Error(`package failed: ${(job.errors ?? []).join('; ') || last}`);
    }
    await Bun.sleep(5000);
  }
  throw new Error('timed out waiting for package job');
}

async function download(jobId: string): Promise<Uint8Array> {
  const res = await fetch(`${CLOUDAPK}/downloadPackageZip?id=${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new Error(`download failed ${res.status}: ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function extractZip(zipPath: string, dest: string) {
  const tmp = join(dest, '.extract');
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  const proc = Bun.spawn(['unzip', '-o', zipPath, '-d', tmp], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if ((await proc.exited) !== 0) {
    throw new Error(`unzip failed: ${await new Response(proc.stderr).text()}`);
  }
  for (const name of await readdir(tmp)) {
    await rename(join(tmp, name), join(dest, name));
  }
  await rm(tmp, { recursive: true, force: true });
}

async function main() {
  for (const path of ['/manifest.json', '/icons/icon-512.png']) {
    const res = await fetch(`${PWA_URL}${path}`, { method: 'HEAD' });
    if (!res.ok) throw new Error(`${PWA_URL}${path} not public (${res.status})`);
  }

  const { mode, signing } = await loadExistingSigning();
  console.log(`PWA ${PWA_URL} → ${PACKAGE_ID} (signing=${mode})`);

  const jobId = await enqueue(packageOptions(mode, signing));
  console.log(`job ${jobId}`);
  await poll(jobId);

  const zipBytes = await download(jobId);
  await mkdir(OUT, { recursive: true });
  const zipPath = join(OUT, 'package.zip');
  await writeFile(zipPath, zipBytes);
  await extractZip(zipPath, OUT);

  // TWA needs this at /.well-known/assetlinks.json (real JSON, not SPA fallback).
  const assetlinks = join(OUT, 'assetlinks.json');
  if (existsSync(assetlinks)) {
    const destDir = join('apps/web/public/.well-known');
    await mkdir(destDir, { recursive: true });
    await writeFile(join(destDir, 'assetlinks.json'), await readFile(assetlinks));
    console.log(`synced ${destDir}/assetlinks.json`);
  }

  // drop stale nested extract dir from the first manual build if present
  if (existsSync(join(OUT, 'out'))) {
    await rm(join(OUT, 'out'), { recursive: true, force: true });
  }

  for (const name of await readdir(OUT)) {
    console.log(`  ${OUT}/${name}`);
  }
  console.log(`done → ${OUT}/livecoder.apk`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
