import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
process.env.SYNC_SECRET = process.env.SYNC_SECRET || "test-secret";
