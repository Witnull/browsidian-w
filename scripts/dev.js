const { spawn } = require("child_process");
const path = require("path");

const backendPort = 24173;
const frontendPort = 25173;
const hostIndex = process.argv.indexOf("--host");
const host = hostIndex >= 0 ? String(process.argv[hostIndex + 1] || "0.0.0.0") : (process.env.HOST || "127.0.0.1");

const backendArgs = [path.join(__dirname, "..", "server.js"), "--port", String(backendPort), "--host", host, ...process.argv.slice(2).filter((arg, idx, arr) => !(arg === "--host" && idx + 1 < arr.length) && arr[idx - 1] !== "--host")];
const viteEntry = path.join(__dirname, "..", "node_modules", "vite", "bin", "vite.js");
const viteArgs = ["--config", path.join(__dirname, "..", "vite.config.js"), "--port", String(frontendPort), "--strictPort", "--host", host];
const frontendEnv = { ...process.env, BACKEND_PORT: String(backendPort) };

const backend = spawn(process.execPath, backendArgs, { stdio: "inherit", shell: false });
const frontend = spawn(process.execPath, [viteEntry, ...viteArgs], { stdio: "inherit", shell: false, env: frontendEnv });

const stop = () => {
    backend.kill();
    frontend.kill();
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
backend.on("exit", (code) => {
    frontend.kill();
    process.exit(code ?? 0);
});
frontend.on("exit", (code) => {
    backend.kill();
    process.exit(code ?? 0);
});