import rateLimit from 'express-rate-limit';

// Bloquea fuerza bruta: máximo 30 intentos de login cada 5 minutos por IP
export const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos fallidos. Espera unos minutos.' },
});

// Login del panel del desarrollador: máximo 10 intentos cada 15 minutos por IP
export const devLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos fallidos. Espera unos minutos.' },
});
