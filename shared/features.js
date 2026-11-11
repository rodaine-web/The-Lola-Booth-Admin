export function galleryEnabled(config = {}) {
  const environment = config.APP_ENV || config.VITE_APP_ENV || config.NODE_ENV;
  if (environment === "production") return (config.GALLERY_ENABLED ?? config.VITE_GALLERY_ENABLED) === "true";
  return ["staging", "development", "test"].includes(environment) && (config.GALLERY_ENABLED ?? config.VITE_GALLERY_ENABLED) !== "false";
}

export function gallerySurveyEnabled(config = {}) {
  return galleryEnabled(config) && ['staging', 'development', 'test'].includes(config.APP_ENV || config.NODE_ENV) && config.GALLERY_V2_ENABLED === 'true';
}
