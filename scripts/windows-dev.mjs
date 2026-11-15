// Run development tasks on Windows without changing PowerShell execution policy.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// The mobile app's tasks exist only in a checkout that has mobile/.
const mobile = existsSync(join(root, 'mobile', 'package.json'));
const commands = {
  verify: `npm.cmd run verify${mobile ? ' && npm.cmd run typecheck --prefix mobile' : ''}`,
  'windows-build': 'npm.cmd run app:build',
  ...(mobile && {
    'android-check': 'node mobile/scripts/check-android-host.mjs',
    // CMake 3.31.6 includes Ninja with Windows long-path support. This APK targets
    // the server's x86_64 emulator; phone/release builds retain the normal scripts.
    'android-build': 'cd mobile && npx.cmd expo prebuild --platform android --no-install && cd android && gradlew.bat assembleMobileRelease --no-daemon -Pandroid.cmakeVersion=3.31.6 -PreactNativeArchitectures=x86_64',
    metro: 'npm.cmd start --prefix mobile -- --clear --localhost',
  }),
};
const task = process.argv[2];
if (!Object.hasOwn(commands, task)) throw new Error(`Choose a task: ${Object.keys(commands).join(', ')}`);
if (process.platform !== 'win32') throw new Error('Run this task on the Windows host.');

// A long-running shell or SSH session can predate installation. Refresh only tool paths in this
// child process; do not write machine settings or restart the machine.
const refresh = `
$values = @{}
foreach ($name in @('JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'ANDROID_AVD_HOME', 'CARGO_HOME', 'RUSTUP_HOME')) {
  $value = [Environment]::GetEnvironmentVariable($name, 'Machine')
  if (!$value) { $value = [Environment]::GetEnvironmentVariable($name, 'User') }
  if ($value) { $values[$name] = $value }
}
$values | ConvertTo-Json -Compress
`;
const env = {
  ...process.env,
  ...JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', refresh], { encoding: 'utf8', windowsHide: true })),
};
env.ANDROID_HOME ||= join(env.LOCALAPPDATA, 'Android', 'Sdk');
const paths = [join(env.ANDROID_HOME, 'platform-tools'), join(env.ANDROID_HOME, 'emulator')];
if (env.JAVA_HOME) paths.unshift(join(env.JAVA_HOME, 'bin'));
if (env.CARGO_HOME) paths.push(join(env.CARGO_HOME, 'bin'));
// Cargo's proxy links can fail over SSH. Prefer the stable toolchain binaries.
const toolchains = join(env.RUSTUP_HOME || join(env.USERPROFILE, '.rustup'), 'toolchains');
if (existsSync(toolchains)) {
  const stable = readdirSync(toolchains).find((name) => /^stable-.*-pc-windows-msvc$/.test(name));
  if (stable) paths.unshift(join(toolchains, stable, 'bin'));
}
// Windows environment names are case-insensitive. Node must receive one PATH.
const pathKey = Object.keys(env).find((name) => name.toUpperCase() === 'PATH');
const oldPath = env[pathKey] || '';
for (const name of Object.keys(env)) if (name.toUpperCase() === 'PATH') delete env[name];
env.PATH = [...paths.filter(existsSync), oldPath].join(';');
if (task === 'verify') env.BROWSER ||= 'msedge';
// Leave memory for the emulator on a small Windows host. Callers can override.
if (task === 'windows-build') env.CARGO_BUILD_JOBS ||= '2';
const result = spawnSync(join(env.SystemRoot, 'System32', 'cmd.exe'), ['/d', '/s', '/c', commands[task]], {
  cwd: root, env, stdio: 'inherit', windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
