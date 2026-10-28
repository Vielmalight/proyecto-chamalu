# Chamalú Beer – Plan de nuevos pedidos

Plan propuesto para los cuatro pedidos de Zaida. **No se modifica código hasta tener aprobación.**

---

## 1. Pago combinado

Cambio en la lógica de ventas.

- Hoy cada venta tiene un solo método de pago. Pasaría a tener **varios pagos por venta**, cada uno con método y monto (ej. $20.000 efectivo + $15.000 Nequi).
- Tabla nueva de pagos ligada a la venta. La base se migra sin perder lo ya registrado.
- La pantalla de cobro muestra **"pagado"** y **"falta por pagar"**, y no deja cerrar la cuenta hasta que la suma coincida con el total.
- El **efectivo suma a la caja** y los demás métodos no. Esto es clave para que el cuadre de caja siga correcto.

---

## 2. Pestaña de inversiones

- Pestaña nueva, visible **solo para el propietario**.
- Campos: fecha, descripción, monto y **origen del dinero** (caja o bolsillo).
- Si el origen es **caja**: se registra una salida automática en la caja, para que el cuadre refleje que ese efectivo ya no está.
- Si el origen es **bolsillo**: solo queda el registro, sin afectar la caja.

**Pregunta pendiente:** ¿la inversión es solo un gasto, o debe alimentar el inventario (por ejemplo, una compra de mercancía que sume stock)?

---

## 3. Formato de miles al escribir

- Aplica a los campos de dinero: mientras escribe se ven los puntos (`10000` → `10.000`).
- Al guardar se manda el número limpio (`10000`), sin puntos.
- Puntos de cuidado: que el cursor no salte al escribir y que los puntos no se guarden como parte del valor.
- Decimales: en pesos colombianos normalmente no se usan. Si ella quiere alguno, se usaría coma, por convención colombiana.

---

## 4. App de celular y programa de PC

| Opción | Qué es | Dificultad |
|---|---|---|
| **PWA** | La misma web, instalable en celular y PC con ícono propio y sin barra del navegador | Baja |
| **Programa de PC (Electron)** | Ventana propia con instalador `.exe` | Media |
| **App nativa de celular** | App para Play Store o APK | Alta |

**Recomendación:** PWA. Cubre celular y PC con el mismo código y poco trabajo. Ella la instala una vez y abre con un ícono.

**Decisión previa:** ¿dónde corre el servidor?

- Si está solo en el PC del bar, el celular funcionará únicamente dentro del mismo wifi.
- Para usarlo desde cualquier lugar, habría que subirlo a un hosting.

---

## Orden sugerido

1. **Punto 3** – formato de miles (rápido).
2. **Punto 1** – pago combinado.
3. **Punto 2** – inversiones.
4. **Punto 4** – app/programa, cuando se defina dónde va el servidor.

---

## Preguntas abiertas

- [ ] ¿Las inversiones son solo gasto o también suman stock al inventario?
- [ ] ¿Dónde correrá el servidor (PC del bar o hosting)?
- [ ] ¿Aprobamos el orden sugerido?
