const path = require("path");
const { defineConfig } = require("vite");

const backendPort = Number(process.env.BACKEND_PORT || 4173);

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
            "/api": `http://127.0.0.1:${backendPort}`
        }
    }
});