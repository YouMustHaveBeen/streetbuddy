// Files with the .user.js extension are bundled as text (see [[rules]] in wrangler.toml).
declare module "*.user.js" {
  const text: string;
  export default text;
}
