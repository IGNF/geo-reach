import { en } from '@/locales/en';
import { fr } from '@/locales/fr';

/** Texts of the browser's language, English by default */
export const t = navigator.language.toLowerCase().startsWith('fr') ? fr : en;
