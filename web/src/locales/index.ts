import { en } from './en';
import { fr } from './fr';

/** Texts of the browser's language, English by default */
export const t = navigator.language.toLowerCase().startsWith('fr') ? fr : en;
