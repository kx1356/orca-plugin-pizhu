import externalGlobals from "rollup-plugin-external-globals";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  return {
    define: {
      "process.env": {
        NODE_ENV: JSON.stringify(
          command === "build" ? "production" : "development",
        ),
      },
    },
    esbuild: {
      // classic JSX runtime：编译为 React.createElement，复用宿主注入的全局 React。
      // 不用 automatic runtime，否则 react/jsx-runtime 子路径无法被 external/
      // externalGlobals 捕获（宿主只暴露全局 React，无 jsx-runtime 全局），
      // 会导致整个 jsx-runtime 被打进产物。
      jsx: "transform",
      // classic 模式下各 tsx 文件未显式 import React，统一注入（未用到的会被摇树）
      jsxInject: `import React from "react"`,
    },
    build: {
      lib: {
        entry: "src/main.tsx",
        fileName: "index",
        formats: ["es"],
      },
      rollupOptions: {
        external: ["react", "valtio"],
      },
    },
    plugins: [externalGlobals({ react: "React", valtio: "Valtio" })],
  };
});
