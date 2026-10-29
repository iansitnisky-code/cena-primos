# 🍽️ Cena de Primos

App para la cena mensual de primos: cada pareja anfitriona arma y publica su carta, los invitados confirman asistencia, se cobra la cuota de $10.000 por persona y, después de la cena, todos votan. El ranking se publica cuando vota el último asistente y se actualiza cena a cena.

## Cómo funciona una cena
1. **Host crea la carta** (borrador): nombre del evento, fecha y hora, lugar, platos, requisitos (disfraz, qué traer, mensaje sorpresa) y datos de pago. Solo los anfitriones la ven hasta que pulsan **Publicar**.
2. **Invitados confirman** con «Sí voy / No puedo». Todos ven quiénes van.
3. **Foto de la invitación:** el host sube una foto o imagen de su invitación (se comprime sola en el celular) y los invitados la ven, con zoom, cuando publica la carta.
4. **Cuota $10.000 por invitado** (se paga al host): el invitado avisa «Ya pagué» y el host marca «Recibido». Cada host ve el total recibido vs. esperado; los demás solo ven su propio estado.
5. **Después de la cena** el host abre la votación (o se abre sola al día siguiente de la fecha). Votan solo quienes asistieron; el host no vota su propia cena. Notas 1,0–7,0 en 5 criterios + mensaje opcional.
6. **Revelado**: cuando vota el último asistente se publican los resultados de la cena y se actualiza el **ranking en vivo** (con flechas ▲▼ de movimiento y aviso en la pestaña Ranking).

Los resultados y votos **no salen del servidor** hasta el revelado.

## Cuentas
- Cada primo crea su cuenta con **correo, contraseña, nombre y teléfono** (pasos: código familiar, elegir quién eres, tus datos).
- El teléfono solo lo ven los anfitriones de las cenas a las que va esa persona.
- Si alguien olvida su contraseña: en **Admin** se libera su cuenta y se registra de nuevo (sus votos se mantienen). También puede cambiar su contraseña en **Mi perfil**.
- Las sesiones duran 45 días. Opcional: define `SESSION_SECRET` en Netlify para firmar las sesiones con tu propio secreto.

## Tecnología
- Frontend: HTML estático (`public/index.html`)
- Backend: una Netlify Function (`netlify/functions/api.mjs`) + Netlify Blobs
- Todo corre en el plan gratuito de Netlify

## Publicar (≈10 minutos)

### 1. Subir a GitLab
1. En GitLab: **New project → Create blank project**, nombre `cena-primos`, visibilidad **Private**, sin README inicial.
2. En tu computador, dentro de esta carpeta:

```bash
git init -b main
git add .
git commit -m "Cena de primos"
git remote add origin https://gitlab.com/TU-USUARIO/cena-primos.git
git push -u origin main
```

### 2. Desplegar en Netlify
1. En [netlify.com](https://www.netlify.com) crea cuenta gratis (puedes entrar con GitLab).
2. **Add new site → Import an existing project → GitLab** y elige `cena-primos`.
3. No cambies nada de build (ya lo define `netlify.toml`). **Antes de desplegar**, en *Site configuration → Environment variables* agrega:
   - `FAMILY_CODE`: el código que compartirás con los primos (ej: `cena2026`)
   - `ADMIN_CODE`: tu código secreto de admin (distinto al anterior)
4. **Deploy**. Cada `git push` vuelve a desplegar solo.

### 3. Compartir
Manda a los primos el link de Netlify (puedes cambiarlo en *Site configuration → Change site name*) y el `FAMILY_CODE`.

## Cómo entra cada primo
1. Ingresa el código familiar.
2. Elige su nombre y completa nombre, teléfono, correo y contraseña.
3. Desde entonces entra solo con correo y contraseña.

## Notas
- Si algún asistente nunca vota, desde modo Admin puedes forzar el revelado.
- La cuota ($10.000) se cambia en `FEE` de `netlify/lib/logic.mjs`.
- Datos: se guardan en Netlify Blobs. Para empezar de cero, borra el sitio o los blobs `cena-primos` desde el panel de Netlify.
- Pruebas del backend: `npm install && npm test`.
