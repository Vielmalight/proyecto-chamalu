import rateLimit from 'express-rate-limit';

// Bloquea fuerza bruta: máximo 30 intentos de login cada 5 minutos por IP
export const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos fallidos. Espera unos minutos.' },
});
