import rateLimit from 'express-rate-limit';

// Bloquea fuerza bruta: máximo 5 intentos de login cada 15 minutos por IP
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos fallidos. Espera 15 minutos.' },
});
