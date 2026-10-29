import assert from "node:assert/strict";
import { handle, PEOPLE } from "../netlify/lib/logic.mjs";

const mem = new Map();
const store = {
  get: async (k) => (mem.has(k) ? structuredClone(mem.get(k)) : null),
  set: async (k, v) => { mem.set(k, structuredClone(v)); },
  delete: async (k) => { mem.delete(k); },
  list: async (p) => [...mem.keys()].filter((k) => k.startsWith(p)),
};
const env = { FAMILY_CODE: "fam", ADMIN_CODE: "adm", TODAY: "2026-01-01" };
const tokens = {};
const call = (method, path, { body, who, code } = {}) =>
  handle({ method, path, body, store, env, headers: { ...(code ? { "x-family-code": code } : {}), ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}) } });
const state = async (who) => (await call("GET", "/state", { who })).body;
const scores = (v) => ({ sabor: v, presentacion: v, ambientacion: v, simpatia: v, originalidad: v });
const vote = (who, dinnerId, v, extra = {}) => call("POST", "/vote", { who, body: { dinnerId, scores: scores(v), ...extra } });
const votersOf = (hostH) => PEOPLE.filter((p) => p.h !== hostH).map((p) => p.id);
const tinyJpg = "data:image/jpeg;base64," + "/9j/4AAQSkZJRgABAQ".repeat(10);
const tinyAv = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ";

// ================= Cuentas =================
assert.equal((await call("GET", "/state")).status, 401, "estado exige sesión");
assert.equal((await call("GET", "/roster", { code: "mal" })).status, 401);
assert.equal((await call("GET", "/roster", { code: "fam" })).body.claimed.length, 0);
const reg = (p, extra = {}) => call("POST", "/register", { code: "fam", body: { personId: p.id, name: p.name.split(" ")[0] + " Apellido", phone: "+56 9 1234 5678", email: `${p.id}@mail.cl`, password: "password1", avatar: tinyAv, ...extra } });
assert.equal((await call("POST", "/register", { code: "mal", body: { personId: "ian" } })).status, 401, "código familiar requerido");
assert.equal((await reg(PEOPLE[0], { email: "malo" })).status, 400);
assert.equal((await reg(PEOPLE[0], { phone: "12" })).status, 400);
assert.equal((await reg(PEOPLE[0], { password: "corta" })).status, 400);
assert.equal((await reg(PEOPLE[0], { avatar: "" })).status, 400, "la foto es obligatoria");
assert.equal((await reg(PEOPLE[0], { avatar: "data:text/html;base64,PGI+" })).status, 400, "solo imágenes");
assert.equal((await reg(PEOPLE[0], { avatar: "data:image/jpeg;base64," + "A".repeat(95000) })).status, 413);
for (const p of PEOPLE) { const r = await reg(p); assert.equal(r.status, 200); tokens[p.id] = r.body.token; }
assert.equal((await reg(PEOPLE[0])).status, 409, "persona ya registrada");
assert.equal((await call("POST", "/login", { body: { email: "ian@mail.cl", password: "mala" } })).status, 401);
const lg = await call("POST", "/login", { body: { email: " IAN@mail.cl ", password: "password1" } });
assert.equal(lg.status, 200); tokens.ian = lg.body.token;
assert.equal((await handle({ method: "GET", path: "/state", store, env, headers: { authorization: "Bearer " + tokens.ian.slice(0, -3) + "abc" } })).status, 401, "token manipulado");
let me = await state("ian");
assert.equal(me.profile.name, "Ian Apellido"); assert.equal(me.names.elisa, "Elisa Apellido");
assert.ok(!JSON.stringify(me).includes("pwHash"));
assert.equal(me.fee, undefined, "ya no hay cuota");
assert.ok(me.avatarAt.ian > 0);
const av = await call("POST", "/avatars", { who: "elisa", body: { ids: ["ian", "elisa", "nadie"] } });
assert.equal(Object.keys(av.body.avatars).length, 2);
assert.equal((await call("POST", "/avatar", { who: "ian", body: { dataUrl: "javascript:alert(1)" } })).status, 400);
assert.equal((await call("POST", "/avatar", { who: "ian", body: { dataUrl: "data:image/png;base64,iVBORw0KGgo=" } })).status, 200);
assert.equal((await call("POST", "/profile", { who: "ian", body: { name: "Ian S.", phone: "+56 9 8765 4321" } })).status, 200);
assert.equal((await call("POST", "/password", { who: "ian", body: { current: "mala", next: "nuevaclave1" } })).status, 403);
assert.equal((await call("POST", "/password", { who: "ian", body: { current: "password1", next: "nuevaclave1" } })).status, 200);
await call("POST", "/profile", { who: "ian", body: { name: "Ian Apellido", phone: "+56 9 1234 5678" } });

// ================= Cena 1 (host h1: Valentina y Juanjo) =================
const id1 = (await call("POST", "/dinner", { who: "valentina", body: { month: "2026-11", hostId: "h1", title: "Noche italiana", date: "2026-11-14", time: "21:00", place: "Casa de Vale", dishes: ["Risotto", "Tiramisú"], dressCode: "Disfraz de mafioso", bring: "Cervezas", notice: "¡Habrá invitado sorpresa!" } })).body.id;
assert.equal((await call("POST", "/dinner", { who: "elisa", body: { id: id1, month: "2026-11", hostId: "h1", title: "X" } })).status, 403, "solo hosts editan");
let d = (await state("elisa")).dinners.find((x) => x.id === id1);
assert.equal(d.published, false); assert.equal(d.title, ""); assert.deepEqual(d.dishes, []);
assert.equal((await call("POST", "/publish", { who: "elisa", body: { dinnerId: id1 } })).status, 403);
const idX = (await call("POST", "/dinner", { who: "ian", body: { month: "2026-12", hostId: "h7", dishes: [] } })).body.id;
assert.equal((await call("POST", "/publish", { who: "ian", body: { dinnerId: idX } })).status, 400, "publicar exige título, fecha y platos");
for (const k of ["rsvp", "pay", "payconf"]) assert.equal((await call("POST", "/" + k, { who: "elisa", body: { dinnerId: id1 } })).status, 404, `/${k} ya no existe`);

// foto de invitación
assert.equal((await call("POST", "/photo", { who: "elisa", body: { dinnerId: id1, dataUrl: tinyJpg } })).status, 403);
assert.equal((await call("POST", "/photo", { who: "valentina", body: { dinnerId: id1, dataUrl: "data:text/html;base64,PHNjcmlwdD4=" } })).status, 400);
assert.equal((await call("POST", "/photo", { who: "juanjo", body: { dinnerId: id1, dataUrl: tinyJpg } })).status, 200);
assert.equal((await call("GET", "/photo/" + id1, { who: "elisa" })).status, 404, "invitados no ven foto de borrador");
assert.equal((await call("POST", "/publish", { who: "juanjo", body: { dinnerId: id1 } })).status, 200);
d = (await state("elisa")).dinners.find((x) => x.id === id1);
assert.deepEqual(d.dishes, ["Risotto", "Tiramisú"]); assert.equal(d.bring, "Cervezas");
assert.ok(d.photoAt > 0); assert.equal((await call("GET", "/photo/" + id1, { who: "elisa" })).body.dataUrl, tinyJpg);
for (const k of ["attendees", "myRsvp", "myPay", "payments", "contacts", "money", "payInfo"]) assert.equal(d[k], undefined, `ya no existe ${k}`);

// votación: abre el host; votan TODAS las cuentas que no son del host
assert.equal((await vote("elisa", id1, 6)).status, 409, "votación cerrada hasta que el host la abra");
assert.equal((await call("POST", "/openvoting", { who: "elisa", body: { dinnerId: id1 } })).status, 403);
assert.equal((await call("POST", "/openvoting", { who: "valentina", body: { dinnerId: id1 } })).status, 200);
assert.equal((await vote("valentina", id1, 6)).status, 403, "el host no vota su cena");
assert.equal((await call("POST", "/vote", { who: "elisa", body: { dinnerId: id1, scores: { ...scores(5), sabor: 8 } } })).status, 400);
assert.equal((await call("POST", "/vote", { who: "elisa", body: { dinnerId: id1, scores: { sabor: 5 } } })).status, 400, "las 5 notas son obligatorias");
const v1 = votersOf("h1");
assert.equal(v1.length, 11);
d = (await state("elisa")).dinners.find((x) => x.id === id1);
assert.equal(d.votesTotal, 11); assert.equal(d.votesDone, 0); assert.equal(d.pending.length, 11);
for (const p of v1.slice(0, -1)) assert.equal((await vote(p, id1, 6, { msg: `hola de ${p}`, signed: p === "elisa" })).status, 200);
assert.equal((await vote("elisa", id1, 6.5, { msg: "hola de elisa", signed: true })).status, 200, "puedes actualizar tu voto antes del revelado");
let st = await state("elisa");
d = st.dinners.find((x) => x.id === id1);
assert.equal(d.revealed, false); assert.equal(d.results, undefined);
assert.deepEqual(d.pending, ["ines"]); assert.equal(d.votesDone, 10);
assert.ok(!JSON.stringify(st).includes("hola de kiki"), "no se filtran mensajes");
assert.deepEqual(st.season.ranking, [], "con un voto pendiente no suma al ranking");
await vote("ines", id1, 4, { msg: "anónimo" });                       // el último voto completa la cena
st = await state("elisa");
d = st.dinners.find((x) => x.id === id1);
assert.equal(d.revealed, true); assert.equal(d.results.n, 11);
assert.equal(d.results.messages.find((m) => m.msg === "anónimo").name, null);
assert.equal(d.results.messages.find((m) => m.msg === "hola de elisa").name, "Elisa Apellido");
assert.equal(st.season.ranking[0].hostId, "h1"); assert.equal(st.season.ranking[0].delta, null);
assert.equal(st.season.hosted, 1); assert.equal(st.season.lastRevealed.id, id1);
assert.equal((await vote("elisa", id1, 1)).status, 409, "ya revelada");

// galería de la cena (el host puede subir aun con la cena revelada)
const gp = (who, slot, extra = {}) => call("POST", "/gallery", { who, body: { dinnerId: id1, slot, dataUrl: tinyJpg, ...extra } });
assert.equal((await gp("elisa", "entrada")).status, 403);
assert.equal((await gp("valentina", "cocina")).status, 400);
assert.equal((await gp("valentina", "entrada", { dataUrl: "data:image/jpeg;base64," + "A".repeat(500000) })).status, 413);
assert.equal((await call("POST", "/gallery", { who: "ian", body: { dinnerId: idX, slot: "postre", dataUrl: tinyJpg } })).status, 409, "carta sin publicar");
for (const slot of ["decoracion", "ambiente", "entrada", "principal", "postre"]) assert.equal((await gp("juanjo", slot)).status, 200);
d = (await state("elisa")).dinners.find((x) => x.id === id1);
assert.deepEqual(Object.keys(d.gallery).sort(), ["ambiente", "decoracion", "entrada", "postre", "principal"]);
const gf = await call("POST", "/gallery/fetch", { who: "elisa", body: { dinnerId: id1, slots: ["postre", "decoracion", "nada"] } });
assert.equal(Object.keys(gf.body.photos).length, 2);
assert.equal((await gp("valentina", "postre", { remove: true })).status, 200);
assert.equal(Object.keys((await state("elisa")).dinners.find((x) => x.id === id1).gallery).length, 4);

// ================= Cena 2 (host h3: Elisa): la votación se abre sola al pasar la fecha =================
env.TODAY = "2026-12-06";
await new Promise((r) => setTimeout(r, 5));
const id2 = (await call("POST", "/dinner", { who: "elisa", body: { month: "2026-12", hostId: "h3", title: "Sushi night", date: "2026-12-05", dishes: ["Rolls"] } })).body.id;
await call("POST", "/publish", { who: "elisa", body: { dinnerId: id2 } });
const v2 = votersOf("h3");
assert.equal(v2.length, 12);
for (const p of v2) assert.equal((await vote(p, id2, 7)).status, 200);
st = await state("kiki");
assert.deepEqual(st.season.ranking.map((x) => x.hostId), ["h3", "h1"], "ranking cena a cena");
assert.equal(st.season.ranking[0].delta, null); assert.equal(st.season.ranking[1].delta, -1);
assert.equal(st.season.lastRevealed.id, id2);

// ================= Cena 3 (host h4: Kiki y Flori): una cena incompleta no suma =================
const id3 = (await call("POST", "/dinner", { who: "kiki", body: { month: "2026-12", hostId: "h4", title: "Parrillada", date: "2026-12-01", dishes: ["x"] } })).body.id;
await call("POST", "/publish", { who: "kiki", body: { dinnerId: id3 } });
const v3 = votersOf("h4");
for (const p of v3.slice(0, -1)) await vote(p, id3, 5);
st = await state("ian");
assert.equal(st.dinners.find((x) => x.id === id3).revealed, false);
assert.ok(!st.season.ranking.some((x) => x.hostId === "h4"), "con votos pendientes no entra al ranking");
await vote(v3.at(-1), id3, 5);
st = await state("ian");
assert.deepEqual(st.season.ranking.map((x) => x.hostId), ["h3", "h1", "h4"], "al votar el último, la cena entra");
assert.equal(st.season.lastRevealed.id, id3);

// ================= Banner =================
assert.deepEqual((await state("elisa")).banner, []);
assert.equal((await call("POST", "/banner", { body: { dataUrl: tinyJpg } })).status, 401);
assert.equal((await call("POST", "/banner", { who: "elisa", body: { dataUrl: "data:text/html;base64,PGI+" } })).status, 400);
const b1 = await call("POST", "/banner", { who: "elisa", body: { dataUrl: tinyJpg } });
const b2 = await call("POST", "/banner", { who: "ian", body: { dataUrl: tinyJpg + "AAAA" } });
assert.deepEqual((await state("cami")).banner.map((x) => x.by), ["elisa", "ian"]);
assert.equal((await call("POST", "/banner/remove", { who: "ian", body: { id: b1.body.id } })).status, 403);
assert.equal((await call("POST", "/banner/remove", { who: "elisa", body: { id: b1.body.id } })).status, 200);
assert.equal((await call("POST", "/admin", { who: "cami", body: { adminCode: "adm", action: "removeBanner", id: b2.body.id } })).status, 200);
assert.equal((await state("cami")).banner.length, 0);
for (let i = 0; i < 40; i++) assert.equal((await call("POST", "/banner", { who: "kiki", body: { dataUrl: tinyJpg } })).status, 200);
assert.equal((await call("POST", "/banner", { who: "kiki", body: { dataUrl: tinyJpg } })).status, 409, "tope de 40 fotos");
for (const x of (await state("kiki")).banner) await call("POST", "/banner/remove", { who: "kiki", body: { id: x.id } });

// ================= Admin =================
assert.equal((await call("POST", "/admin", { who: "ian", body: { adminCode: "x", action: "reveal", dinnerId: idX } })).status, 403);
await call("POST", "/admin", { who: "ian", body: { adminCode: "adm", action: "reveal", dinnerId: idX } });
assert.equal((await state("ian")).dinners.find((x) => x.id === idX).revealed, true, "el admin puede forzar un cierre");

// La temporada se completa cuando las 7 parejas ya fueron anfitrionas y todo está votado
assert.equal((await state("ian")).season.complete, false);
for (const [who, h] of [["florencia", "h2"], ["cami", "h5"], ["belen", "h6"]]) {
  const did = (await call("POST", "/dinner", { who, body: { month: "2026-12", hostId: h, title: "T " + h, date: "2026-12-01", dishes: ["x"] } })).body.id;
  await call("POST", "/publish", { who, body: { dinnerId: did } });
  await call("POST", "/admin", { who: "ian", body: { adminCode: "adm", action: "reveal", dinnerId: did } });
}
st = await state("ian");
assert.equal(st.season.hosted, 7); assert.equal(st.season.complete, true);

// borrar cena limpia fotos, galería y votos
await call("POST", "/admin", { who: "ian", body: { adminCode: "adm", action: "deleteDinner", dinnerId: id1 } });
assert.ok(![...mem.keys()].some((k) => k === `photos/${id1}` || k.startsWith(`gallery/${id1}/`)));
assert.ok(![...mem.keys()].filter((k) => k.startsWith("votes/")).some((k) => mem.get(k)[id1]), "se borran los votos de la cena");
// liberar cuenta e iniciar de nuevo
await call("POST", "/admin", { who: "ian", body: { adminCode: "adm", action: "releasePerson", personId: "paul" } });
assert.equal((await call("GET", "/state", { who: "paul" })).status, 401, "token viejo invalidado");
assert.equal((await reg(PEOPLE.find((p) => p.id === "paul"), { email: "paul@mail.cl" })).status, 200);
console.log("OK: todas las pruebas pasaron");
