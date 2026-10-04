const { spawn } = require("node:child_process");
const electron = require("electron");

const child = spawn(electron, [".", "--enable-logging"], {
  env: { ...process.env, ALLEYWEB_DEBUG: "1" },
  stdio: "inherit",
  windowsHide: true,
});

child.on("exit", (code) => process.exit(code ?? 0));
