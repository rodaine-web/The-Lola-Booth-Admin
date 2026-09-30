export function galleryEnabled(config = {}) {
  const environment = config.APP_ENV || config.VITE_APP_ENV || config.NODE_ENV;
  if (environment === "production") return false;
  return ["staging", "development", "test"].includes(environment) && (config.GALLERY_ENABLED ?? config.VITE_GALLERY_ENABLED) !== "false";
}
