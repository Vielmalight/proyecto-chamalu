// Punto de entrada para Vercel: al detectar server.js en la raíz con un
// framework en package.json (Express), Vercel exporta la app como función
// serverless. En local no se usa este archivo (npm start arranca server/app.js).
import app from './server/app.js';

export default app;
