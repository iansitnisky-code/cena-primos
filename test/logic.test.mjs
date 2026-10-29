import assert from "node:assert/strict";
import { handle, PEOPLE, FEE } from "../netlify/lib/logic.mjs";

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

// ---- Cuentas ----
assert.equal((await call("GET", "/state")).status, 401, "estado exige sesión");
assert.equal((await call("GET", "/roster", { code: "mal" })).status, 401);
assert.equal((await call("GET", "/roster", { code: "fam" })).body.claimed.length, 0);
const tinyAv = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ";
const reg = (p, extra = {}) => call("POST", "/register", { code: "fam", body: { personId: p.id, name: p.name.split(" ")[0] + " Apellido", phone: "+56 9 1234 5678", email: `${p.id}@mail.cl`, password: "password1", avatar: tinyAv, ...extra } });
assert.equal((await call("POST", "/register", { code: "mal", body: { personId: "ian", name: "Ian", phone: "+56912345678", email: "ian@mail.cl", password: "password1" } })).status, 401, "código familiar requerido");
assert.equal((await reg(PEOPLE[0], { email: "malo" })).status, 400);
assert.equal((await reg(PEOPLE[0], { phone: "12" })).status, 400);
assert.equal((await reg(PEOPLE[0], { password: "corta" })).status, 400);
assert.equal((await reg(PEOPLE[0], { avatar: "" })).status, 400, "la foto es obligatoria");
assert.equal((await reg(PEOPLE[0], { avatar: "data:text/html;base64,PGI+" })).status, 400, "solo imágenes");
assert.equal((await reg(PEOPLE[0], { avatar: "data:image/jpeg;base64," + "A".repeat(95000) })).status, 413, "foto muy pesada");
for (const p of PEOPLE) { const r = await reg(p); assert.equal(r.status, 200); tokens[p.id] = r.body.token; }
assert.equal((await reg(PEOPLE[0])).status, 409, "persona ya registrada");
assert.equal((await reg({ id: "ian", name: "Ian" }, { email: "valentina@mail.cl" })).status, 409, "correo/persona repetidos");
assert.equal((await call("POST", "/login", { body: { email: "ian@mail.cl", password: "mala" } })).status, 401);
assert.equal((await call("POST", "/login", { body: { email: "nadie@mail.cl", password: "password1" } })).status, 401);
const lg = await call("POST", "/login", { body: { email: " IAN@mail.cl ", password: "password1" } });
assert.equal(lg.status, 200); tokens.ian = lg.body.token;
assert.equal((await call("GET", "/state", { who: "ian" })).status, 200);
assert.equal((await handle({ method: "GET", path: "/state", store, env, headers: { authorization: "Bearer " + tokens.ian.slice(0, -3) + "abc" } })).status, 401, "token manipulado");
let me = (await state("ian"));
assert.equal(me.profile.name, "Ian Apellido"); assert.equal(me.profile.email, "ian@mail.cl");
assert.equal(me.names.elisa, "Elisa Apellido");
assert.ok(!JSON.stringify(me).includes("pwHash"));
// fotos de perfil
assert.ok(me.avatarAt.ian > 0 && me.avatarAt.elisa > 0, "avatarAt en el estado");
const av = await call("POST", "/avatars", { who: "elisa", body: { ids: ["ian", "elisa", "nadie"] } });
assert.equal(av.body.avatars.ian.dataUrl, tinyAv); assert.equal(Object.keys(av.body.avatars).length, 2);
const newAv = "data:image/png;base64,iVBORw0KGgo=";
assert.equal((await call("POST", "/avatar", { who: "ian", body: { dataUrl: "javascript:alert(1)" } })).status, 400);
const up = await call("POST", "/avatar", { who: "ian", body: { dataUrl: newAv } });
assert.equal(up.status, 200);
assert.equal((await call("POST", "/avatars", { who: "elisa", body: { ids: ["ian"] } })).body.avatars.ian.dataUrl, newAv);
assert.ok((await state("elisa")).avatarAt.ian >= up.body.at, "avatarAt cambia al subir otra foto");
assert.equal((await call("POST", "/avatars", { body: { ids: ["ian"] } })).status, 401, "avatars exige sesión");
// perfil y contraseña
assert.equal((await call("POST", "/profile", { who: "ian", body: { name: "Ian S.", phone: "+56 9 8765 4321" } })).status, 200);
assert.equal((await state("ian")).profile.name, "Ian S.");
assert.equal((await call("POST", "/password", { who: "ian", body: { current: "mala", next: "nuevaclave1" } })).status, 403);
assert.equal((await call("POST", "/password", { who: "ian", body: { current: "password1", next: "nuevaclave1" } })).status, 200);
assert.equal((await call("POST", "/login", { body: { email: "ian@mail.cl", password: "nuevaclave1" } })).status, 200);
await call("POST", "/profile", { who: "ian", body: { name: "Ian Apellido", phone: "+56 9 1234 5678" } });

// ---- Cena 1: host h1 (Valentina y Juanjo) ----
const id1 = (await call("POST", "/dinner", { who: "valentina", body: { month: "2026-11", hostId: "h1", title: "Noche italiana", date: "2026-11-14", time: "21:00", place: "Casa de Vale", dishes: ["Risotto", "Tiramisú"], dressCode: "Disfraz de mafioso", bring: "Cervezas", notice: "¡Habrá invitado sorpresa!", payInfo: "Transferir a Vale" } })).body.id;

// Sin publicar: otros no ven detalles, hosts sí
let st = await state("elisa");
let d = st.dinners.find((x) => x.id === id1);
assert.equal(d.published, false);
assert.equal(d.title, ""); assert.deepEqual(d.dishes, []); assert.equal(d.notice, "");
assert.equal(d.payments, undefined);
st = await state("juanjo");
assert.equal(st.dinners[0].title, "Noche italiana");
assert.equal((await call("POST", "/rsvp", { who: "elisa", body: { dinnerId: id1, status: "yes" } })).status, 409);
assert.equal((await call("POST", "/publish", { who: "elisa", body: { dinnerId: id1 } })).status, 403);

// ---- Foto de invitación ----
const tinyJpg = "data:image/jpeg;base64," + "/9j/4AAQSkZJRgABAQ".repeat(10);
assert.equal((await call("POST", "/photo", { who: "elisa", body: { dinnerId: id1, dataUrl: tinyJpg } })).status, 403, "solo hosts suben foto");
assert.equal((await call("POST", "/photo", { who: "valentina", body: { dinnerId: id1, dataUrl: "data:text/html;base64,PHNjcmlwdD4=" } })).status, 400, "solo imágenes");
assert.equal((await call("POST", "/photo", { who: "valentina", body: { dinnerId: id1, dataUrl: "data:image/jpeg;base64," + "A".repeat(500000) } })).status, 413, "límite de tamaño");
assert.equal((await call("POST", "/photo", { who: "juanjo", body: { dinnerId: id1, dataUrl: tinyJpg } })).status, 200);
assert.equal((await call("GET", "/photo/" + id1, { who: "elisa" })).status, 404, "invitados no ven foto de borrador");
assert.equal((await call("GET", "/photo/" + id1, { who: "juanjo" })).body.dataUrl, tinyJpg, "host ve su foto");
assert.equal((await state("elisa")).dinners.find((x) => x.id === id1).photoAt, 0, "photoAt oculto en borrador");
// Publicar exige título, fecha y platos
const idX = (await call("POST", "/dinner", { who: "ian", body: { month: "2026-12", hostId: "h7", dishes: [] } })).body.id;
assert.equal((await call("POST", "/publish", { who: "ian", body: { dinnerId: idX } })).status, 400);

assert.equal((await call("POST", "/publish", { who: "juanjo", body: { dinnerId: id1 } })).status, 200);
st = await state("elisa");
d = st.dinners.find((x) => x.id === id1);
assert.equal(d.published, true);
assert.deepEqual(d.dishes, ["Risotto", "Tiramisú"]);
assert.equal(d.bring, "Cervezas");
assert.equal(st.fee, FEE);
assert.ok(d.photoAt > 0, "photoAt visible tras publicar");
assert.equal((await call("GET", "/photo/" + id1, { who: "elisa" })).body.dataUrl, tinyJpg, "invitado ve foto publicada");
assert.ok(!JSON.stringify(st).includes("/9j/4AAQ"), "el estado no incluye la imagen");

// RSVP: el host no confirma; yes/no; cambios
assert.equal((await call("POST", "/rsvp", { who: "valentina", body: { dinnerId: id1, status: "yes" } })).status, 403);
const yes = ["elisa", "kiki", "flori", "cami", "ian", "ines"];
const no = ["allan", "paul"];
for (const p of yes) assert.equal((await call("POST", "/rsvp", { who: p, body: { dinnerId: id1, status: "yes" } })).status, 200);
for (const p of no) await call("POST", "/rsvp", { who: p, body: { dinnerId: id1, status: "no" } });
st = await state("elisa");
d = st.dinners.find((x) => x.id === id1);
assert.deepEqual(d.attendees.sort(), [...yes].sort());
assert.deepEqual(d.declined.sort(), [...no].sort());
assert.equal(d.myRsvp, "yes");
assert.equal(d.payments, undefined, "los invitados no ven pagos de otros");
assert.equal(d.contacts, undefined, "los invitados no ven teléfonos");

// Pagos: invitado avisa, host confirma
await call("POST", "/pay", { who: "elisa", body: { dinnerId: id1, claimed: true } });
assert.equal((await call("POST", "/pay", { who: "allan", body: { dinnerId: id1, claimed: true } })).status, 409, "no asiste");
st = await state("valentina");
d = st.dinners.find((x) => x.id === id1);
assert.equal(d.payments.find((x) => x.personId === "elisa").state, "claimed");
assert.equal(d.money.expected, yes.length * FEE);
assert.equal(d.contacts.elisa, "+56912345678", "el host ve teléfonos de invitados");
assert.equal(d.money.received, 0);
assert.equal((await call("POST", "/payconf", { who: "elisa", body: { dinnerId: id1, personId: "elisa", received: true } })).status, 403);
await call("POST", "/payconf", { who: "juanjo", body: { dinnerId: id1, personId: "elisa", received: true } });
await call("POST", "/payconf", { who: "juanjo", body: { dinnerId: id1, personId: "kiki", received: true } });
st = await state("valentina");
d = st.dinners.find((x) => x.id === id1);
assert.equal(d.money.received, 2 * FEE);
assert.equal((await state("elisa")).dinners.find((x) => x.id === id1).myPay, "confirmed");
assert.equal((await call("POST", "/pay", { who: "elisa", body: { dinnerId: id1, claimed: false } })).status, 409);

// Votación: cerrada hasta que el host la abra
assert.equal((await vote("elisa", id1, 6)).status, 409);
assert.equal((await call("POST", "/openvoting", { who: "elisa", body: { dinnerId: id1 } })).status, 403);
assert.equal((await call("POST", "/openvoting", { who: "valentina", body: { dinnerId: id1 } })).status, 200);
// no asistente no vota; host no vota; notas inválidas
assert.equal((await vote("paul", id1, 6)).status, 403);
assert.equal((await vote("valentina", id1, 6)).status, 403);
assert.equal((await call("POST", "/vote", { who: "elisa", body: { dinnerId: id1, scores: { ...scores(5), sabor: 8 } } })).status, 400);

// Votan todos los asistentes menos uno: sin resultados filtrados
for (const p of yes.slice(0, -1)) assert.equal((await vote(p, id1, 6, { msg: `hola de ${p}`, signed: p === "elisa" })).status, 200);
st = await state("elisa");
d = st.dinners.find((x) => x.id === id1);
assert.equal(d.revealed, false);
assert.equal(d.results, undefined);
assert.deepEqual(d.pending, ["ines"]);
assert.ok(!JSON.stringify(st).includes("hola de kiki"));
assert.equal(st.season.length, 0);

// Último voto -> revelado, y los que dijeron NO no cuentan
await vote("ines", id1, 4, { msg: "anónimo" });
st = await state("elisa");
d = st.dinners.find((x) => x.id === id1);
assert.equal(d.revealed, true);
assert.equal(d.results.n, yes.length);
assert.equal(d.results.messages.find((m) => m.msg === "anónimo").name, null);
assert.equal(d.results.messages.find((m) => m.msg === "hola de elisa").name, "Elisa Apellido");
assert.equal(st.season[0].hostId, "h1");
assert.equal(st.season[0].delta, null, "primera cena: sin movimiento");
assert.equal(st.lastRevealed.id, id1);
assert.equal((await vote("elisa", id1, 1)).status, 409);
assert.equal((await call("POST", "/rsvp", { who: "elisa", body: { dinnerId: id1, status: "no" } })).status, 409);

assert.equal((await call("POST", "/photo", { who: "elisa", body: { dinnerId: id1, remove: true } })).status, 403);
assert.equal((await call("POST", "/photo", { who: "valentina", body: { dinnerId: id1, remove: true } })).status, 200);
assert.equal((await call("GET", "/photo/" + id1, { who: "elisa" })).status, 404, "foto quitada");
await call("POST", "/photo", { who: "valentina", body: { dinnerId: id1, dataUrl: tinyJpg } });

// ---- Cena 2: host h3 (Elisa), votación abre sola por fecha, gana más nota -> movimiento ----
await new Promise((r) => setTimeout(r, 5));
const id2 = (await call("POST", "/dinner", { who: "elisa", body: { month: "2026-12", hostId: "h3", title: "Sushi night", date: "2026-12-05", dishes: ["Rolls"] } })).body.id;
await call("POST", "/publish", { who: "elisa", body: { dinnerId: id2 } });
await call("POST", "/rsvp", { who: "kiki", body: { dinnerId: id2, status: "yes" } });
await call("POST", "/rsvp", { who: "cami", body: { dinnerId: id2, status: "yes" } });
assert.equal((await vote("kiki", id2, 7)).status, 409, "antes de la fecha");
env.TODAY = "2026-12-06"; // pasó la fecha: se abre sola
await vote("kiki", id2, 7); await vote("cami", id2, 7);
st = await state("kiki");
assert.deepEqual(st.season.map((x) => x.hostId), ["h3", "h1"]);
assert.equal(st.season[0].delta, null, "entra nuevo");
assert.equal(st.season[1].delta, -1, "h1 baja una posición");
assert.equal(st.lastRevealed.id, id2);

// ---- Admin ----
assert.equal((await call("POST", "/admin", { who: "ian", body: { adminCode: "x", action: "reveal", dinnerId: idX } })).status, 403);
await call("POST", "/admin", { who: "ian", body: { adminCode: "adm", action: "reveal", dinnerId: idX } });
assert.equal((await state("ian")).dinners.find((x) => x.id === idX).revealed, true);
await call("POST", "/admin", { who: "ian", body: { adminCode: "adm", action: "releasePerson", personId: "paul" } });
assert.equal((await call("GET", "/state", { who: "paul" })).status, 401, "token viejo invalidado");
assert.equal((await reg(PEOPLE.find((p) => p.id === "paul"), { email: "paul@mail.cl" })).status, 200, "puede volver a registrarse");
await call("POST", "/admin", { who: "ian", body: { adminCode: "adm", action: "deleteDinner", dinnerId: id1 } });
st = await state("ian");
assert.ok(!st.dinners.some((x) => x.id === id1));
assert.ok(![...mem.keys()].some((k) => k === `payconf/${id1}` || k === `photos/${id1}`));
console.log("OK: todas las pruebas pasaron");
