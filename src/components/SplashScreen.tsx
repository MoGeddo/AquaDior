import { AquaDiorShield } from "./AquaDiorLogo";

export default function SplashScreen({ leaving = false }: { leaving?: boolean }) {
  return (
    <div
      className={`brand-splash${leaving ? " is-leaving" : ""}`}
      role="status"
      aria-label="أكوا ديور للمقاولات — جاري فتح التطبيق"
    >
      <div className="brand-splash__aura" aria-hidden="true" />
      <div className="brand-splash__content">
        <div className="brand-splash__emblem" aria-hidden="true">
          <span className="brand-splash__ring" />
          <span className="brand-splash__spark" />
          <AquaDiorShield size={112} className="brand-splash__shield" />
        </div>
        <div className="brand-splash__wordmark" dir="rtl">
          <div className="brand-splash__name">أكوا ديور للمقاولات</div>
          <div className="brand-splash__subtitle">
            نظام إدارة العمال والمشروعات
          </div>
        </div>
        <div className="brand-splash__loading" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}
