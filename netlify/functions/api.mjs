import { getStore } from "@netlify/blobs";
import { handle } from "../lib/logic.mjs";

// Adaptador de Netlify Blobs a la interfaz mínima que usa la lógica.
function blobStore() {
  const s = getStore({ name: "cena-primos", consistency: "strong" });
  return {
    get: (key) => s.get(key, { type: "json" }),
    set: (key, value) => s.setJSON(key, value),
    delete: (key) => s.delete(key),
    list: async (prefix) => {
      const { blobs } = await s.list({ prefix });
      return blobs.map((b) => b.key);
    },
  };
}

export default async (req) => {
  let body = null;
  if (req.method === "POST") {
    try { body = await req.json(); } catch { body = null; }
  }
  const url = new URL(req.url);
  const headers = Object.fromEntries(req.headers.entries());
  const env = {
    FAMILY_CODE: process.env.FAMILY_CODE,
    SESSION_SECRET: process.env.SESSION_SECRET,
    ADMIN_CODE: process.env.ADMIN_CODE,
  };
  const out = await handle({
    method: req.method,
    path: url.pathname.replace(/^\/api/, "") || "/",
    headers,
    body,
    store: blobStore(),
    env,
  });
  return new Response(JSON.stringify(out.body), {
    status: out.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};

export const config = { path: "/api/*" };
