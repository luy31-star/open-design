import type { NextConfig } from 'next';
import { dirname, isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Daemon port the local Express server binds to (see apps/daemon/src/cli.ts). The
// dev-all launcher overrides OD_PORT after probing for a free port; we read
// the same env so /api, /artifacts, and /frames always reach the right
// daemon instance during `next dev`.
const DAEMON_PORT = Number(process.env.OD_PORT) || 7456;
const DAEMON_ORIGIN = `http://127.0.0.1:${DAEMON_PORT}`;

// The regular CLI build still ships as a static export so the `od` daemon can
// serve a single-process production build. Packaged desktop builds opt into a
// server runtime with OD_WEB_OUTPUT_MODE=server; in that mode the web sidecar
// owns the Next.js SSR server and proxies daemon routes at runtime. The
// packaged-size standalone spike uses OD_WEB_OUTPUT_MODE=standalone to ask
// Next.js for a traced standalone server while keeping the sidecar-owned daemon
// proxy in front of it at runtime.
const isProd = process.env.NODE_ENV !== 'development';
const webOutputMode = process.env.OD_WEB_OUTPUT_MODE;
const isServerOutput = webOutputMode === 'server' || webOutputMode === 'standalone';
const shouldStaticExport = isProd && !isServerOutput;

const WEB_ROOT = dirname(fileURLToPath(import.meta.url));
const toPosixPath = (value: string) => value.replaceAll('\\', '/');

function resolveDistDir(defaultValue: string) {
  if (process.env.OD_WEB_PROD === '1') return defaultValue;
  const configured = process.env.OD_WEB_DIST_DIR;
  if (!configured) return defaultValue;
  return toPosixPath(isAbsolute(configured) ? relative(WEB_ROOT, configured) || '.' : configured);
}

const DIST_DIR = resolveDistDir(isProd ? (shouldStaticExport ? 'out' : '.next') : '.next');

function resolveDevTsconfigPath() {
  const configured = process.env.OD_WEB_TSCONFIG_PATH;
  if (!configured) return undefined;
  return toPosixPath(isAbsolute(configured) ? relative(WEB_ROOT, configured) || 'tsconfig.json' : configured);
}

const DEV_TSCONFIG_PATH = resolveDevTsconfigPath();

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  reactStrictMode: true,
  ...(DEV_TSCONFIG_PATH ? { typescript: { tsconfigPath: DEV_TSCONFIG_PATH } } : {}),
  // Keep the bundle output predictable so the daemon's STATIC_DIR can point
  // at it without any glob trickery.
  distDir: DIST_DIR,
  ...(shouldStaticExport
    ? {
        output: 'export' as const,
        // `next export` skips trailing slashes by default; opting in keeps
        // the daemon's static fallback simple (every directory has its own
        // index.html on disk).
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : webOutputMode === 'standalone'
      ? {
        output: 'standalone' as const,
      }
      : {
        async rewrites() {
          // Both desktop server-mode (`next start`) and local dev need the
          // SPA's same-origin /api, /artifacts, and /frames requests to reach
          // the sibling daemon process on OD_PORT.
          return [
            { source: '/api/:path*', destination: `${DAEMON_ORIGIN}/api/:path*` },
            { source: '/artifacts/:path*', destination: `${DAEMON_ORIGIN}/artifacts/:path*` },
            { source: '/frames/:path*', destination: `${DAEMON_ORIGIN}/frames/:path*` },
          ];
        },
        ...(!isProd
          ? {
              devIndicators: {
                position: 'bottom-right' as const,
              },
            }
          : {}),
      }),
};

export default nextConfig;
