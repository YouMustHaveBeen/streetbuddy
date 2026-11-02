// Files with the .geojson extension are bundled as text (see [[rules]] in wrangler.toml).
declare module "*.geojson" {
  const text: string;
  export default text;
}
