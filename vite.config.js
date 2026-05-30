const path = require("path");
const { defineConfig } = require("vite");

const backendPort = Number(process.env.BACKEND_PORT || 24173);

module.exports = defineConfig({
    root: path.resolve(__dirname, "public"),
    publicDir: false,
    appType: "mpa",
    build: {
        outDir: path.resolve(__dirname, "dist"),
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: path.resolve(__dirname, "public/index.html")
            }
        }
    },
    server: {
        proxy: {
            "/api": {
                target: `http://127.0.0.1:${backendPort}`,
                changeOrigin: true,
                configure(proxy) {
                    proxy.on("proxyReq", (proxyReq, req) => {
                        const remoteAddr = req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : "";
                        if (remoteAddr) proxyReq.setHeader("x-forwarded-for", remoteAddr);
                    });
                }
            }
        }
    }
});