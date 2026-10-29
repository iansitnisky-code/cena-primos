import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const CRITERIA = ["sabor", "presentacion", "ambientacion", "simpatia", "originalidad"];
export const FEE = 10000; // CLP por invitado, se paga al host

export const HOUSEHOLDS = [
  { id: "h1", name: "Valentina y Juanjo", members: [["valentina", "Valentina Nuñez Barranco"], ["juanjo", "Juanjose Sitnisky", "Juanjo"]] },
  { id: "h2", name: "Florencia y Tomas", members: [["florencia", "Florencia Fracchia"], ["tomas", "Tomas Sitnisky"]] },
  { id: "h3", name: "Elisa", members: [["elisa", "Elisa Sitnisky"]] },
  { id: "h4", name: "Kiki y Flori", members: [["kiki", "Cristian Sitnisky", "Kiki"], ["flori", "Flori"]] },
  { id: "h5", name: "Cami y Allan", members: [["cami", "Camila Simunovic", "Cami"], ["allan", "Allan"]] },
  { id: "h6", name: "Paul y Belen", members: [["paul", "Paul"], ["belen", "Belen Collantes"]] },
  { id: "h7", name: "Ian e Ines", members: [["ian", "Ian Sitnisky"], ["ines", "Ines Guzman"]] },
];

export const PEOPLE = HOUSEHOLDS.flatMap((h) => h.members.map((m) => ({ id: m[0], name: m[1], h: h.id })));
const personById = (id) => PEOPLE.find((p) => p.id === id);
const householdById = (id) => HOUSEHOLDS.find((h) => h.id === id);

const ok = (body) => ({ status: 200, body });
const fail = (status, error, message) => ({ status, body: { error, message } });

// ---- CRYPTO-BEGIN ----
function safeEq(a, b) {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(String(b ?? ""));
  return x.length === y.length && timingSafeEqual(x, y);
}
const sha = (s) => createHash("sha256").update(s).digest("hex");
const randHex = (n) => randomBytes(n).toString("hex");
const hashPassword = (pw) => { const salt = randHex(16); return `${salt}:${scryptSync(String(pw), salt, 32).toString("hex")}`; };
const checkPassword = (pw, stored) => {
  const [salt, h] = String(stored || "").split(":");
  return !!salt && !!h && safeEq(scryptSync(String(pw), salt, 32).toString("hex"), h);
};
const b64 = (s) => Buffer.from(s).toString("base64url");
const unb64 = (s) => Buffer.from(s, "base64url").toString();
const hmac = (s, secret) => createHmac("sha256", secret).update(s).digest("hex");
// ---- CRYPTO-END ----
const sign = (payload, secret) => { const b = b64(JSON.stringify(payload)); return `${b}.${hmac(b, secret)}`; };
const unsign = (token, secret) => {
  const [b, sig] = String(token || "").split(".");
  if (!b || !sig || !safeEq(sig, hmac(b, secret))) return null;
  try { const p = JSON.parse(unb64(b)); return p.exp > Date.now() ? p : null; } catch { return null; }
};
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const r1 = (n) => Math.round(n * 10) / 10;
const todayCL = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });

async function loadAll(store, prefix) {
  const keys = await store.list(prefix);
  const items = await Promise.all(keys.map((k) => store.get(k)));
  const out = {};
  keys.forEach((k, i) => { if (items[i]) out[k.slice(prefix.length)] = items[i]; });
  return out;
}

/** Estado calculado de una cena a partir de RSVP, votos y banderas. */
function calc(d, ctx) {
  const others = PEOPLE.filter((p) => p.h !== d.hostId);
  const rsvpOf = (p) => ctx.rsvp[p.id] && ctx.rsvp[p.id][d.id];
  const attendees = others.filter((p) => rsvpOf(p) && rsvpOf(p).status === "yes");
  const declined = others.filter((p) => rsvpOf(p) && rsvpOf(p).status === "no");
  const noReply = others.filter((p) => !rsvpOf(p));
  const votingOpen = !!(d.votingOpen || (d.date && d.date < ctx.today));
  const voted = attendees.filter((p) => ctx.votes[p.id] && ctx.votes[p.id][d.id]);
  const pending = votingOpen ? attendees.filter((p) => !voted.includes(p)) : [];
  const all = !!d.published && votingOpen && attendees.length > 0 && pending.length === 0;
  const revealed = !!(d.closed || d.revealed || all);
  return { attendees, declined, noReply, votingOpen, voted, pending, all, revealed };
}

function dinnerResults(d, c, votes, names) {
  const entries = c.voted.map((p) => ({ p, e: votes[p.id][d.id] }));
  const per = {};
  CRITERIA.forEach((k) => {
    const a = entries.map((x) => x.e.scores && x.e.scores[k]).filter((v) => typeof v === "number");
    per[k] = a.length ? avg(a) : null;
  });
  const vals = Object.values(per).filter((v) => v != null);
  const messages = entries
    .filter((x) => x.e.msg && x.e.msg.trim())
    .sort((a, b) => (a.e.ts || 0) - (b.e.ts || 0))
    .map((x) => ({ msg: x.e.msg, name: x.e.signed ? (names[x.p.id] || x.p.name) : null }));
  return { per, overall: vals.length ? avg(vals) : null, n: entries.length, messages };
}

function seasonFrom(list) {
  const by = {};
  list.forEach((d) => { (by[d.hostId] = by[d.hostId] || []).push(d.results); });
  return HOUSEHOLDS.filter((h) => by[h.id])
    .map((h) => {
      const rs = by[h.id];
      const per = {};
      CRITERIA.forEach((k) => {
        const a = rs.map((r) => r.per[k]).filter((v) => v != null);
        per[k] = a.length ? avg(a) : null;
      });
      return { hostId: h.id, per, overall: avg(rs.map((r) => r.overall)), n: rs.length };
    })
    .sort((a, b) => b.overall - a.overall);
}

/** Ranking de la temporada: se actualiza cena a cena. Una cena suma SOLO cuando está completa
 *  (publicada por el host y con los votos de todos sus asistentes; o cerrada por el admin). */
function seasonSummary(dinnersOut) {
  const revealed = dinnersOut.filter((d) => d.revealed);
  const hosted = HOUSEHOLDS.filter((h) => revealed.some((d) => d.hostId === h.id));
  const complete = hosted.length === HOUSEHOLDS.length && dinnersOut.filter((d) => d.published).every((d) => d.revealed);
  const withRes = revealed.filter((d) => d.results && d.results.overall != null);
  const cur = seasonFrom(withRes);
  let last = null;
  withRes.forEach((d) => { if (!last || (d.revealedAt || 0) > (last.revealedAt || 0)) last = d; });
  const prev = last ? seasonFrom(withRes.filter((d) => d !== last)) : [];
  const pos = new Map(prev.map((x, i) => [x.hostId, i]));
  const ranking = cur.map((x, i) => ({ ...x, delta: pos.has(x.hostId) ? pos.get(x.hostId) - i : null }));
  return {
    complete, hosted: hosted.length, hostedIds: hosted.map((h) => h.id), total: HOUSEHOLDS.length, revealed: revealed.length, ranking,
    lastRevealed: last ? { id: last.id, hostId: last.hostId, month: last.month, title: last.title || "", at: last.revealedAt || 0 } : null,
  };
}

const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

function validDinner(b) {
  if (!b || typeof b !== "object") return null;
  const month = String(b.month || "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  if (!householdById(b.hostId)) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? b.date : "";
  const time = /^\d{2}:\d{2}$/.test(String(b.time || "")) ? b.time : "";
  const dishes = (Array.isArray(b.dishes) ? b.dishes : []).map((s) => str(s, 140)).filter(Boolean).slice(0, 30);
  return {
    month, hostId: b.hostId, date, time,
    title: str(b.title, 80), place: str(b.place, 100), dishes,
    dressCode: str(b.dressCode, 120), bring: str(b.bring, 120), notice: str(b.notice, 300), payInfo: str(b.payInfo, 200),
  };
}

function validVote(b) {
  if (!b || typeof b !== "object" || !b.scores || typeof b.scores !== "object") return null;
  const scores = {};
  for (const k of CRITERIA) {
    const v = Number(b.scores[k]);
    if (!Number.isFinite(v) || v < 1 || v > 7) return null;
    scores[k] = r1(v);
  }
  return { scores, msg: str(b.msg, 400), signed: !!b.signed, ts: Date.now() };
}

async function loadCtx(store, env) {
  const [votes, rsvp, payconf, accounts] = await Promise.all([
    loadAll(store, "votes/"),
    loadAll(store, "rsvp/"),
    loadAll(store, "payconf/"),
    loadAll(store, "people/"),
  ]);
  const names = {}, phones = {}, avatarAt = {};
  Object.entries(accounts).forEach(([id, a]) => { names[id] = a.name; phones[id] = a.phone; if (a.avatarAt) avatarAt[id] = a.avatarAt; });
  return { votes, rsvp, payconf, accounts, names, phones, avatarAt, claimed: Object.keys(accounts), today: env.TODAY || todayCL() };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanPhone = (v) => String(v || "").replace(/[^\d+]/g, "");
const validPhone = (v) => { const d = cleanPhone(v).replace(/\D/g, ""); return d.length >= 8 && d.length <= 15; };
const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const AVATAR_MAX = 90000;
const BANNER_MAX = 40;
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
export const GALLERY_SLOTS = ["decoracion", "ambiente", "entrada", "principal", "postre"];
const TOKEN_TTL = 1000 * 60 * 60 * 24 * 45;

export async function handle({ method, path, headers, body, store, env }) {
  const h = {};
  for (const [k, v] of Object.entries(headers || {})) h[k.toLowerCase()] = v;

  if (!env.FAMILY_CODE || !env.ADMIN_CODE) {
    return fail(500, "not_configured", "Faltan las variables FAMILY_CODE y ADMIN_CODE en Netlify.");
  }
  const secret = env.SESSION_SECRET || `${env.ADMIN_CODE}:${env.FAMILY_CODE}`;
  const familyOk = safeEq(h["x-family-code"] || (body && body.familyCode), env.FAMILY_CODE);
  const mkToken = (pid, rec) => sign({ pid, v: rec.createdAt, exp: Date.now() + TOKEN_TTL }, secret);

  // ---------- Cuenta (no requieren sesión) ----------
  if (method === "GET" && path === "/roster") {
    if (!familyOk) return fail(401, "bad_family_code", "Código familiar incorrecto.");
    const keys = await store.list("people/");
    return ok({ households: HOUSEHOLDS, claimed: keys.map((k) => k.slice("people/".length)), fee: FEE });
  }
  if (method === "POST" && path === "/register") {
    if (!familyOk) return fail(401, "bad_family_code", "Código familiar incorrecto.");
    const b = body || {};
    const person = personById(b.personId);
    const name = str(b.name, 60);
    const email = str(b.email, 120).toLowerCase();
    const password = String(b.password || "");
    if (!person) return fail(400, "bad_person", "Elige quién eres en la lista.");
    if (name.length < 2) return fail(400, "bad_name", "Escribe tu nombre.");
    if (!EMAIL_RE.test(email)) return fail(400, "bad_email", "Correo no válido.");
    if (!validPhone(b.phone)) return fail(400, "bad_phone", "Teléfono no válido.");
    if (password.length < 8 || password.length > 100) return fail(400, "bad_password", "La contraseña debe tener al menos 8 caracteres.");
    const avatar = String(b.avatar || "");
    if (!AVATAR_RE.test(avatar)) return fail(400, "bad_avatar", "Sube tu foto de perfil para continuar.");
    if (avatar.length > AVATAR_MAX) return fail(413, "avatar_too_big", "La foto es muy pesada, prueba con otra.");
    if (await store.get(`people/${person.id}`)) return fail(409, "taken", "Esa persona ya tiene cuenta.");
    if (await store.get(`emails/${sha(email)}`)) return fail(409, "email_taken", "Ese correo ya está registrado.");
    const rec = { name, email, phone: cleanPhone(b.phone), pwHash: hashPassword(password), createdAt: Date.now(), avatarAt: Date.now() };
    await store.set(`avatars/${person.id}`, { dataUrl: avatar, at: rec.avatarAt });
    await store.set(`people/${person.id}`, rec);
    await store.set(`emails/${sha(email)}`, { pid: person.id });
    return ok({ token: mkToken(person.id, rec) });
  }
  if (method === "POST" && path === "/login") {
    const email = str(body && body.email, 120).toLowerCase();
    const idx = email ? await store.get(`emails/${sha(email)}`) : null;
    const rec = idx ? await store.get(`people/${idx.pid}`) : null;
    if (!rec || !checkPassword(body && body.password, rec.pwHash)) return fail(401, "bad_login", "Correo o contraseña incorrectos.");
    return ok({ token: mkToken(idx.pid, rec) });
  }

  // ---------- Sesión ----------
  let me = null;
  const auth = h["authorization"] || "";
  if (auth.startsWith("Bearer ")) {
    const p = unsign(auth.slice(7), secret);
    if (p && personById(p.pid)) {
      const rec = await store.get(`people/${p.pid}`);
      if (rec && rec.createdAt === p.v) me = personById(p.pid);
    }
  }
  if (!me) return fail(401, "not_logged_in", "Inicia sesión para continuar.");
  const needMe = () => null;
  const isAdmin = (code) => safeEq(code, env.ADMIN_CODE);
  const isHostSide = (d) => !!me && (me.h === d.hostId || d.createdBy === me.id);

  // ---------- GET /state ----------
  if (method === "GET" && path === "/state") {
    const [dinnerMap, ctx, bannerIdx] = await Promise.all([loadAll(store, "dinners/"), loadCtx(store, env), store.get("meta/banner")]);
    const dinners = [];
    for (const [id, d0] of Object.entries(dinnerMap)) {
      const d = { ...d0, id };
      const c = calc(d, ctx);
      let revealedAt = d.revealedAt || 0;
      if (c.revealed && !revealedAt) {
        revealedAt = Date.now();
        await store.set(`dinners/${id}`, { ...d0, revealed: true, revealedAt });
      }
      const hostSide = isHostSide(d);
      const details = !!d.published || hostSide;
      const mineR = me && ctx.rsvp[me.id] && ctx.rsvp[me.id][id];
      const out = {
        id, month: d.month, hostId: d.hostId, createdBy: d.createdBy || null,
        published: !!d.published, votingOpen: c.votingOpen, revealed: c.revealed, revealedAt,
        title: "", date: "", time: "", place: "", dishes: [], dressCode: "", bring: "", notice: "", payInfo: "", photoAt: 0, gallery: {},
        attendees: [], declined: [], noReply: [], pending: [],
        myRsvp: mineR ? mineR.status : null, myPay: "none", iVoted: me ? c.voted.some((p) => p.id === me.id) : false,
        isHostSide: hostSide,
      };
      if (details) {
        Object.assign(out, {
          title: d.title || "", date: d.date || "", time: d.time || "", place: d.place || "",
          dishes: d.dishes || [], dressCode: d.dressCode || "", bring: d.bring || "", notice: d.notice || "", payInfo: d.payInfo || "", photoAt: d.photoAt || 0, gallery: d.gallery || {},
        });
      }
      if (d.published || hostSide) {
        out.attendees = c.attendees.map((p) => p.id);
        out.declined = c.declined.map((p) => p.id);
        out.noReply = c.noReply.map((p) => p.id);
        out.pending = c.revealed ? [] : c.pending.map((p) => p.id);
      }
      if (me && mineR && mineR.status === "yes") {
        const conf = ctx.payconf[id] && ctx.payconf[id][me.id];
        out.myPay = conf ? "confirmed" : mineR.paidClaimed ? "claimed" : "none";
      }
      if (hostSide) {
        const conf = ctx.payconf[id] || {};
        out.payments = c.attendees.map((p) => {
          const r = ctx.rsvp[p.id][id];
          return { personId: p.id, state: conf[p.id] ? "confirmed" : r.paidClaimed ? "claimed" : "none" };
        });
        const nConf = out.payments.filter((x) => x.state === "confirmed").length;
        out.money = { expected: c.attendees.length * FEE, received: nConf * FEE };
        out.contacts = {};
        [...c.attendees, ...c.noReply].forEach((p) => { if (ctx.phones[p.id]) out.contacts[p.id] = ctx.phones[p.id]; });
      }
      if (c.revealed) out.results = dinnerResults(d, c, ctx.votes, ctx.names);
      dinners.push(out);
    }
    dinners.sort((a, b) => (b.month || "").localeCompare(a.month || ""));
    const season = seasonSummary(dinners);
    return ok({
      households: HOUSEHOLDS, fee: FEE, claimed: ctx.claimed, names: ctx.names, avatarAt: ctx.avatarAt, banner: bannerIdx || [],
      me: me.id, profile: { name: ctx.names[me.id], phone: ctx.phones[me.id], email: ctx.accounts[me.id].email },
      mine: ctx.votes[me.id] || {},
      dinners, season,
    });
  }

  // ---------- Fotos de invitación ----------
  if (method === "GET" && path.startsWith("/photo/")) {
    const id = path.slice("/photo/".length);
    const d = await store.get(`dinners/${id}`);
    if (!d || !(d.published || isHostSide(d))) return fail(404, "not_found", "Foto no disponible.");
    const ph = await store.get(`photos/${id}`);
    if (!ph) return fail(404, "not_found", "Esta cena no tiene foto.");
    return ok({ dataUrl: ph.dataUrl, at: d.photoAt || 0 });
  }

  if (method !== "POST") return fail(404, "not_found", "Ruta no encontrada.");

  // ---------- Perfil ----------
  if (path === "/profile") {
    const rec = await store.get(`people/${me.id}`);
    const name = str(body && body.name, 60);
    if (name.length < 2) return fail(400, "bad_name", "Escribe tu nombre.");
    if (!validPhone(body && body.phone)) return fail(400, "bad_phone", "Teléfono no válido.");
    await store.set(`people/${me.id}`, { ...rec, name, phone: cleanPhone(body.phone) });
    return ok({ ok: true });
  }
  if (path === "/avatar") {
    const url = String((body && body.dataUrl) || "");
    if (!AVATAR_RE.test(url)) return fail(400, "bad_avatar", "Formato de imagen no válido.");
    if (url.length > AVATAR_MAX) return fail(413, "avatar_too_big", "La foto es muy pesada, prueba con otra.");
    const rec = await store.get(`people/${me.id}`);
    const at = Date.now();
    await store.set(`avatars/${me.id}`, { dataUrl: url, at });
    await store.set(`people/${me.id}`, { ...rec, avatarAt: at });
    return ok({ ok: true, at });
  }
  if (path === "/avatars") {
    const ids = (Array.isArray(body && body.ids) ? body.ids : []).filter((i) => personById(i)).slice(0, 20);
    const docs = await Promise.all(ids.map((i) => store.get(`avatars/${i}`)));
    const avatars = {};
    ids.forEach((i, k) => { if (docs[k]) avatars[i] = { at: docs[k].at, dataUrl: docs[k].dataUrl }; });
    return ok({ avatars });
  }
  if (path === "/password") {
    const rec = await store.get(`people/${me.id}`);
    if (!checkPassword(body && body.current, rec.pwHash)) return fail(403, "bad_password", "Tu contraseña actual no coincide.");
    const next = String((body && body.next) || "");
    if (next.length < 8 || next.length > 100) return fail(400, "bad_password", "La nueva contraseña debe tener al menos 8 caracteres.");
    await store.set(`people/${me.id}`, { ...rec, pwHash: hashPassword(next) });
    return ok({ ok: true });
  }

  // ---------- Cenas ----------
  if (path === "/dinner") {
    const e = needMe(); if (e) return e;
    const v = validDinner(body);
    if (!v) return fail(400, "bad_dinner", "Revisa mes y anfitriones.");
    if (body.id) {
      const cur = await store.get(`dinners/${body.id}`);
      if (!cur) return fail(404, "not_found", "Cena no encontrada.");
      if (!isHostSide(cur)) return fail(403, "forbidden", "Solo los anfitriones pueden editar la carta.");
      await store.set(`dinners/${body.id}`, { ...cur, ...v, hostId: cur.hostId });
      return ok({ id: body.id });
    }
    const id = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await store.set(`dinners/${id}`, { ...v, createdBy: me.id, createdAt: Date.now(), published: false, votingOpen: false, revealed: false, closed: false });
    return ok({ id });
  }

  if (path === "/photo") {
    const id = body && body.dinnerId;
    const d = await store.get(`dinners/${id}`);
    if (!d) return fail(404, "not_found", "Cena no encontrada.");
    if (!isHostSide(d)) return fail(403, "forbidden", "Solo los anfitriones pueden subir la invitación.");
    if (body.remove) {
      await store.delete(`photos/${id}`);
      await store.set(`dinners/${id}`, { ...d, photoAt: 0 });
      return ok({ ok: true });
    }
    const url = String(body.dataUrl || "");
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(url)) return fail(400, "bad_photo", "Formato de imagen no válido.");
    if (url.length > 480000) return fail(413, "photo_too_big", "La foto es muy pesada.");
    const at = Date.now();
    await store.set(`photos/${id}`, { dataUrl: url, by: me.id, at });
    await store.set(`dinners/${id}`, { ...d, photoAt: at });
    return ok({ ok: true, at });
  }

  // ---------- Banner de la app (fotos de todos, se desliza) ----------
  if (path === "/banner") {
    const url = String((body && body.dataUrl) || "");
    if (!PHOTO_RE.test(url)) return fail(400, "bad_photo", "Formato de imagen no válido.");
    if (url.length > 480000) return fail(413, "photo_too_big", "La foto es muy pesada.");
    const idx = (await store.get("meta/banner")) || [];
    if (idx.length >= BANNER_MAX) return fail(409, "banner_full", `El banner ya tiene ${BANNER_MAX} fotos. Pide al admin que quite alguna.`);
    const id = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const at = Date.now();
    await store.set(`banner/${id}`, { dataUrl: url, at, by: me.id });
    const fresh = (await store.get("meta/banner")) || [];
    fresh.push({ id, at, by: me.id });
    await store.set("meta/banner", fresh);
    return ok({ ok: true, id, at });
  }
  if (path === "/banner/remove") {
    const id = body && body.id;
    const idx = (await store.get("meta/banner")) || [];
    const item = idx.find((x) => x.id === id);
    if (!item) return fail(404, "not_found", "Esa foto ya no existe.");
    if (item.by !== me.id) return fail(403, "forbidden", "Solo quien subió la foto puede quitarla.");
    await store.delete(`banner/${id}`);
    await store.set("meta/banner", idx.filter((x) => x.id !== id));
    return ok({ ok: true });
  }
  if (path === "/banner/fetch") {
    const idx = (await store.get("meta/banner")) || [];
    const known = new Set(idx.map((x) => x.id));
    const ids = (Array.isArray(body && body.ids) ? body.ids : []).filter((i) => known.has(i)).slice(0, 10);
    const docs = await Promise.all(ids.map((i) => store.get(`banner/${i}`)));
    const photos = {};
    ids.forEach((i, k) => { if (docs[k]) photos[i] = { at: docs[k].at, by: docs[k].by, dataUrl: docs[k].dataUrl }; });
    return ok({ photos });
  }

  // ---------- Galería de la cena (5 fotos fijas) ----------
  if (path === "/gallery") {
    const id = body && body.dinnerId;
    const slot = body && body.slot;
    const d = await store.get(`dinners/${id}`);
    if (!d) return fail(404, "not_found", "Cena no encontrada.");
    if (!isHostSide(d)) return fail(403, "forbidden", "Solo los anfitriones pueden subir fotos de la cena.");
    if (!GALLERY_SLOTS.includes(slot)) return fail(400, "bad_slot", "Tipo de foto no válido.");
    if (!d.published) return fail(409, "not_published", "Publica la carta antes de subir fotos.");
    const gallery = { ...(d.gallery || {}) };
    if (body.remove) {
      await store.delete(`gallery/${id}/${slot}`);
      delete gallery[slot];
      await store.set(`dinners/${id}`, { ...d, gallery });
      return ok({ ok: true });
    }
    const url = String(body.dataUrl || "");
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(url)) return fail(400, "bad_photo", "Formato de imagen no válido.");
    if (url.length > 480000) return fail(413, "photo_too_big", "La foto es muy pesada.");
    const at = Date.now();
    await store.set(`gallery/${id}/${slot}`, { dataUrl: url, at, by: me.id });
    gallery[slot] = at;
    await store.set(`dinners/${id}`, { ...d, gallery });
    return ok({ ok: true, at });
  }
  if (path === "/gallery/fetch") {
    const id = body && body.dinnerId;
    const d = await store.get(`dinners/${id}`);
    if (!d || !(d.published || isHostSide(d))) return fail(404, "not_found", "Fotos no disponibles.");
    const slots = (Array.isArray(body.slots) ? body.slots : []).filter((x) => GALLERY_SLOTS.includes(x));
    const docs = await Promise.all(slots.map((x) => store.get(`gallery/${id}/${x}`)));
    const photos = {};
    slots.forEach((x, k) => { if (docs[k]) photos[x] = { at: docs[k].at, dataUrl: docs[k].dataUrl }; });
    return ok({ photos });
  }

  if (path === "/publish") {
    const e = needMe(); if (e) return e;
    const d = await store.get(`dinners/${body && body.dinnerId}`);
    if (!d) return fail(404, "not_found", "Cena no encontrada.");
    if (!isHostSide(d)) return fail(403, "forbidden", "Solo los anfitriones pueden publicar la carta.");
    if (!d.title || !d.date || !(d.dishes && d.dishes.length)) {
      return fail(400, "incomplete", "Para publicar falta el nombre del evento, la fecha y al menos un plato.");
    }
    await store.set(`dinners/${body.dinnerId}`, { ...d, published: true, publishedAt: Date.now() });
    return ok({ ok: true });
  }

  if (path === "/openvoting") {
    const e = needMe(); if (e) return e;
    const d = await store.get(`dinners/${body && body.dinnerId}`);
    if (!d) return fail(404, "not_found", "Cena no encontrada.");
    if (!isHostSide(d)) return fail(403, "forbidden", "Solo los anfitriones pueden abrir la votación.");
    if (!d.published) return fail(409, "not_published", "Primero publica la carta.");
    await store.set(`dinners/${body.dinnerId}`, { ...d, votingOpen: true });
    return ok({ ok: true });
  }

  if (path === "/rsvp") {
    const e = needMe(); if (e) return e;
    const id = body && body.dinnerId;
    const d = await store.get(`dinners/${id}`);
    if (!d) return fail(404, "not_found", "Cena no encontrada.");
    if (me.h === d.hostId) return fail(403, "is_host", "Eres anfitrión de esta cena.");
    if (!d.published) return fail(409, "not_published", "La carta aún no está publicada.");
    if (d.revealed || d.closed) return fail(409, "revealed", "Esta cena ya fue revelada.");
    const status = body.status;
    if (!["yes", "no", "none"].includes(status)) return fail(400, "bad_status", "Respuesta no válida.");
    const mine = (await store.get(`rsvp/${me.id}`)) || {};
    if (status === "none") delete mine[id];
    else mine[id] = { status, paidClaimed: status === "yes" ? !!(mine[id] && mine[id].paidClaimed) : false, ts: Date.now() };
    await store.set(`rsvp/${me.id}`, mine);
    return ok({ ok: true });
  }

  if (path === "/pay") {
    const e = needMe(); if (e) return e;
    const id = body && body.dinnerId;
    const mine = (await store.get(`rsvp/${me.id}`)) || {};
    if (!mine[id] || mine[id].status !== "yes") return fail(409, "not_attending", "Primero confirma tu asistencia.");
    const conf = (await store.get(`payconf/${id}`)) || {};
    if (conf[me.id]) return fail(409, "already_confirmed", "El host ya confirmó tu pago.");
    mine[id].paidClaimed = !!body.claimed;
    await store.set(`rsvp/${me.id}`, mine);
    return ok({ ok: true });
  }

  if (path === "/payconf") {
    const e = needMe(); if (e) return e;
    const id = body && body.dinnerId;
    const d = await store.get(`dinners/${id}`);
    if (!d) return fail(404, "not_found", "Cena no encontrada.");
    if (!isHostSide(d)) return fail(403, "forbidden", "Solo los anfitriones confirman pagos.");
    const target = body.personId;
    const rs = personById(target) ? await store.get(`rsvp/${target}`) : null;
    if (!rs || !rs[id] || rs[id].status !== "yes") return fail(400, "not_attending", "Esa persona no confirmó asistencia.");
    const conf = (await store.get(`payconf/${id}`)) || {};
    if (body.received) conf[target] = Date.now(); else delete conf[target];
    await store.set(`payconf/${id}`, conf);
    return ok({ ok: true });
  }

  if (path === "/vote") {
    const e = needMe(); if (e) return e;
    const id = body && body.dinnerId;
    const dinner = await store.get(`dinners/${id}`);
    if (!dinner) return fail(404, "not_found", "Cena no encontrada.");
    if (me.h === dinner.hostId) return fail(403, "is_host", "Los anfitriones no votan su propia cena.");
    const ctx = await loadCtx(store, env);
    const d = { ...dinner, id };
    let c = calc(d, ctx);
    if (!dinner.published) return fail(409, "not_published", "La carta aún no está publicada.");
    if (c.revealed) return fail(409, "revealed", "Esta cena ya fue revelada.");
    if (!c.votingOpen) return fail(409, "voting_closed", "La votación se abre después de la cena.");
    if (!c.attendees.some((p) => p.id === me.id)) return fail(403, "not_attendee", "Solo votan quienes asistieron. Confirma tu asistencia primero.");
    const v = validVote(body);
    if (!v) return fail(400, "bad_vote", "Todas las notas deben estar entre 1,0 y 7,0.");
    const mine = ctx.votes[me.id] || {};
    mine[id] = v;
    await store.set(`votes/${me.id}`, mine);
    ctx.votes[me.id] = mine;
    c = calc(d, ctx);
    if (c.all) await store.set(`dinners/${id}`, { ...dinner, revealed: true, revealedAt: Date.now() });
    return ok({ ok: true });
  }

  // ---------- Admin ----------
  if (path === "/admin") {
    if (!isAdmin(body && body.adminCode)) return fail(403, "bad_admin_code", "Código de admin incorrecto.");
    const action = body.action;
    if (action === "verify") return ok({ ok: true });
    if (action === "reveal") {
      const d = await store.get(`dinners/${body.dinnerId}`);
      if (!d) return fail(404, "not_found", "Cena no encontrada.");
      await store.set(`dinners/${body.dinnerId}`, { ...d, closed: true, revealedAt: Date.now() });
      return ok({ ok: true });
    }
    if (action === "deleteDinner") {
      const id = body.dinnerId;
      await store.delete(`dinners/${id}`);
      await store.delete(`payconf/${id}`);
      await store.delete(`photos/${id}`);
      for (const slot of GALLERY_SLOTS) await store.delete(`gallery/${id}/${slot}`);
      for (const prefix of ["votes/", "rsvp/"]) {
        const all = await loadAll(store, prefix);
        for (const [pId, doc] of Object.entries(all)) {
          if (doc[id]) { delete doc[id]; await store.set(`${prefix}${pId}`, doc); }
        }
      }
      return ok({ ok: true });
    }
    if (action === "removeBanner") {
      const idx = (await store.get("meta/banner")) || [];
      if (!idx.some((x) => x.id === body.id)) return fail(404, "not_found", "Esa foto ya no existe.");
      await store.delete(`banner/${body.id}`);
      await store.set("meta/banner", idx.filter((x) => x.id !== body.id));
      return ok({ ok: true });
    }
    if (action === "releasePerson") {
      if (!personById(body.personId)) return fail(400, "bad_person", "Persona no válida.");
      const rec = await store.get(`people/${body.personId}`);
      if (rec && rec.email) await store.delete(`emails/${sha(rec.email)}`);
      await store.delete(`avatars/${body.personId}`);
      await store.delete(`people/${body.personId}`);
      return ok({ ok: true });
    }
    return fail(400, "bad_action", "Acción no válida.");
  }

  return fail(404, "not_found", "Ruta no encontrada.");
}
