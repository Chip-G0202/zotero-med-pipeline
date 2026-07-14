import { spawn } from "node:child_process";
const command = process.argv.slice(2).join(" ");
const child = spawn("pwsh", ["-NoProfile", "-Command", command], { stdio: "inherit", windowsHide: true });
process.exitCode = await new Promise((resolve) => child.on("close", resolve));
