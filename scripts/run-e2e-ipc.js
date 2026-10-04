const { spawnSync } = require("node:child_process");
const electron = require("electron");

const result = spawnSync(electron, ["."], {
  env: { ...process.env, ALLEYWEB_E2E: "ipc", ALLEYWEB_DEBUG: "1" },
  stdio: "inherit",
  windowsHide: true,
});

process.exit(result.status ?? 1);
