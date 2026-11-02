import { RyongMark } from "./RyongMark";
/** The header's brand, shown above dialogs that cover the page (connect, unlock) so the site never goes logo-less. */
export const BrandFloat = () => (
  <a className="ry-brand ry-brand-float" href="/" aria-label="keys.ryong.com">
    <RyongMark />
    <strong>Keys</strong>
  </a>
);
