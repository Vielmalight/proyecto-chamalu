// Versión visible de la app: se toma de package.json (única fuente de verdad)
import pkg from '../../package.json' with { type: 'json' };

export const APP_VERSION = pkg.version;
