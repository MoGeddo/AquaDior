import React from "react";

interface AquaDiorLogoProps {
  size?: number;
  showText?: boolean;
  variant?: "light" | "dark" | "banner";
  className?: string;
}

export const AquaDiorShield: React.FC<{ size?: number; className?: string }> = ({
  size = 56,
  className = "",
}) => (
  <svg
    viewBox="0 0 500 560"
    width={size}
    height={(size * 560) / 500}
    className={className}
    style={{ overflow: "visible", flexShrink: 0 }}
    aria-label="أكوا ديور"
  >
    <defs>
      <linearGradient id="adGoldPrimary" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#FDEAB8" />
        <stop offset="25%" stopColor="#E9CA7D" />
        <stop offset="55%" stopColor="#D4AF37" />
        <stop offset="80%" stopColor="#B88A28" />
        <stop offset="100%" stopColor="#8C6311" />
      </linearGradient>

      <linearGradient id="adGoldGleam" x1="15%" y1="0%" x2="85%" y2="100%">
        <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
        <stop offset="30%" stopColor="#F9DF98" />
        <stop offset="70%" stopColor="#D4AF37" />
        <stop offset="100%" stopColor="#966C15" />
      </linearGradient>

      <filter id="adShieldGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#D4AF37" floodOpacity="0.3" />
      </filter>
    </defs>

    {/* Outer Shield Outline */}
    <path
      d="M 250 42 
         C 315 42, 395 58, 418 84
         C 424 185, 424 285, 404 355
         C 374 455, 292 510, 250 530
         C 208 510, 126 455, 96 355
         C 76 285, 76 185, 82 84
         C 105 58, 185 42, 250 42 Z"
      fill="none"
      stroke="url(#adGoldPrimary)"
      strokeWidth="18"
      strokeLinejoin="round"
      strokeLinecap="round"
      filter="url(#adShieldGlow)"
    />

    {/* Inner Shield Border */}
    <path
      d="M 250 70 
         C 305 70, 372 82, 392 105
         C 398 188, 398 272, 380 338
         C 354 425, 286 475, 250 494
         C 214 475, 146 425, 120 338
         C 102 272, 102 188, 108 105
         C 128 82, 195 70, 250 70 Z"
      fill="none"
      stroke="url(#adGoldGleam)"
      strokeWidth="6"
      strokeOpacity="0.85"
      strokeLinejoin="round"
    />

    {/* Water Droplet Core (Outline) */}
    <path
      d="M 250 145
         C 256 150, 332 245, 332 314
         C 332 368, 296 408, 250 408
         C 204 408, 168 368, 168 314
         C 168 245, 244 150, 250 145 Z"
      fill="none"
      stroke="url(#adGoldPrimary)"
      strokeWidth="14"
      strokeLinecap="round"
      strokeLinejoin="round"
    />

    {/* Fluid Inner Swoosh */}
    <path
      d="M 250 198
         C 285 248, 295 292, 280 332
         C 264 372, 224 376, 206 346
         C 193 321, 200 286, 220 261
         C 236 241, 249 217, 250 198 Z"
      fill="url(#adGoldGleam)"
      opacity="0.9"
    />

    <path
      d="M 245 224
         C 230 254, 226 288, 238 318
         C 246 335, 260 340, 268 330
         C 278 317, 274 287, 258 252
         C 252 240, 248 230, 245 224 Z"
      fill="#FFFFFF"
      opacity="0.65"
    />
  </svg>
);

export default function AquaDiorLogo({
  size = 64,
  showText = true,
  variant = "light",
  className = "",
}: AquaDiorLogoProps) {
  const isDark = variant === "dark";

  return (
    <div
      className={`aquadior-brand ${className}`}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      <AquaDiorShield size={size} />

      {showText && (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              fontSize: size > 60 ? 26 : 18,
              fontWeight: 800,
              letterSpacing: "-0.3px",
              color: isDark ? "#F8FAFC" : "#1E293B",
              lineHeight: 1.2,
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            أكوا ديور
          </div>
          <div
            style={{
              fontSize: size > 60 ? 12 : 10,
              fontWeight: 700,
              letterSpacing: "0",
              textTransform: "none",
              color: isDark ? "#D4AF37" : "#B88A28",
              marginTop: 4,
            }}
          >
            للمقاولات
          </div>
        </div>
      )}
    </div>
  );
}

/** بانر الهوية الكامل — كما في الصورة المرفقة */
export const AquaDiorHeaderBanner: React.FC = () => (
  <div
    style={{
      background: "linear-gradient(180deg, #18191C 0%, #0F1012 100%)",
      borderBottom: "2px solid #C5A059",
      padding: "10px 18px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      color: "#FFFFFF",
      boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
      position: "relative",
    }}
  >
    <div
      style={{
        fontSize: "13px",
        fontWeight: 600,
        letterSpacing: "0.5px",
        color: "#F3F4F6",
        direction: "ltr",
      }}
    >
      نظام إدارة العمال
    </div>

    <div
      style={{
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <AquaDiorShield size={38} />
    </div>

    <div
      style={{
        fontSize: "14px",
        fontWeight: 700,
        color: "#F3F4F6",
      }}
    >
      أكوا ديور للمقاولات
    </div>
  </div>
);
