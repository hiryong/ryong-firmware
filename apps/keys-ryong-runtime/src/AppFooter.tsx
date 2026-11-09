import { t } from "./ryong/i18n";

export interface AppFooterProps {
  onShowAbout: () => void;
  onShowLicenseNotice: () => void;
  onShowMaintenance: () => void;
}

// keys.ryong.com footer. ZMK Studio is Apache-2.0: the About and License NOTICE links stay.
export const AppFooter = ({
  onShowAbout,
  onShowLicenseNotice,
  onShowMaintenance,
}: AppFooterProps) => {
  return (
    <footer className="ry-footer">
      <a href="https://ryong.com/">© ryong.com</a>
      <button type="button" onClick={onShowMaintenance}>
        {t("Maintenance", "유지보수")}
      </button>
      <span>
        Built on{" "}
        <a href="https://github.com/zmkfirmware/zmk-studio" target="_blank" rel="noreferrer">
          ZMK Studio
        </a>{" "}
        by the ZMK Contributors
      </span>
      <button type="button" onClick={onShowAbout}>
        About ZMK Studio
      </button>
      <button type="button" onClick={onShowLicenseNotice}>
        License NOTICE
      </button>
    </footer>
  );
};
