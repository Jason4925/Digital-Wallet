import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  appType: "mpa",
  build: {
    rollupOptions: {
      input: {
        home: `${root}/index.html`,
        login: `${root}/login.html`,
        register: `${root}/register.html`,
        user: `${root}/user.html`
      }
    }
  }
});
