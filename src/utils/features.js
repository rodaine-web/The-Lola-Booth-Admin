import { galleryEnabled } from "../../shared/features.js";
// Vite exposes MODE (development/production); NODE_ENV is not a reliable
// import.meta.env member. Honor explicit APP_ENV/VITE_APP_ENV first.
const galleryEnvironment = import.meta.env.APP_ENV || import.meta.env.VITE_APP_ENV || import.meta.env.MODE;
export const GALLERY_ENABLED = galleryEnabled({
  ...import.meta.env,
  VITE_APP_ENV: galleryEnvironment
});
