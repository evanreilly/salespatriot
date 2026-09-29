const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function appPath(path: string) {
  return `${basePath}${path.startsWith("/") ? path : `/${path}`}`;
}
