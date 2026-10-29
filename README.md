# 🍽️ Cena de Primos

App para la cena mensual de primos: cada pareja anfitriona arma y publica su carta y, después de la cena, todos votan. Se usa solo para **resultados y experiencia** (sin confirmación de asistencia ni cobros).

## Cómo funciona una cena
1. **Host crea la carta** (borrador): nombre del evento, fecha y hora, lugar, platos y requisitos (disfraz, qué traer, mensaje sorpresa). Solo los anfitriones la ven hasta que pulsan **Publicar**.
2. **Fotos:** el host puede subir la foto de la invitación y, durante o después de la cena, 5 fotos fijas (decoración, ambiente y grupo, entrada, plato principal y postre). Todos las revisan en el detalle de la cena.
3. **Votación:** después de la cena el host la abre (o se abre sola al día siguiente de la fecha). Votan todos los primos con cuenta, menos los anfitriones de esa cena. Un voto cuenta cuando eliges las 5 notas (1,0 a 7,0) y tocas **Guardar votación**; puedes cambiarlo hasta que se revele. Mensaje opcional, firmado o anónimo.
4. **Cena completa y ranking:** una cena se completa cuando el host la publicó y **todos** votaron. Ahí se revelan sus resultados y el **ranking se actualiza** (flechas ▲▼ de movimiento y aviso en la pestaña Ranking). Una cena con votos pendientes no suma. El admin puede forzar el cierre si alguien nunca vota.
5. **Banner de Inicio:** todos pueden sumar fotos al banner deslizable.

Los resultados y votos **no salen del servidor** hasta que la cena está completa.

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
- Datos: se guardan en Netlify Blobs. Para empezar de cero, borra el sitio o los blobs `cena-primos` desde el panel de Netlify.
- Pruebas del backend: `npm install && npm test`.
