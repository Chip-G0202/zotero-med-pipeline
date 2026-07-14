import { spawn } from "node:child_process";
const child = spawn("git", ["status", "--short"], { stdio: "inherit", windowsHide: true });
process.exitCode = await new Promise((resolve) => child.on("close", resolve));
