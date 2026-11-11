import React from 'react';

/**
 * Premiumize brand icon (official red figure with yellow ribbon)
 */
export const PremiumizeIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 240 240" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <g transform="translate(-5 47.638)">
      <circle cx="124" cy="-.138" r="47.5" fill="#dc2626" />
      <path d="M125 64.831a65 62.532 0 0 0-65 62.531v65h130v-65a65 62.532 0 0 0-65-62.531" fill="#dc2626" />
      <path d="m5 97.362 110 25 130-130c-33.227 57.786-74.464 116.997-120 185z" fill="#facc15" />
    </g>
  </svg>
);

/**
 * TorBox official 3D isometric seedbox cube (from torbox.app)
 */
export const TorboxIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 1500 1500" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <g>
      <polygon fill="#00444D" points="749.99,749.99 749.99,1191.96 367.25,970.97 367.25,529.01" />
      <polygon fill="#34BA90" points="1132.75,529.01 1132.75,970.97 749.99,1191.96 749.99,749.99 872.87,679.05 956.71,630.66" />
      <polygon fill="#52A153" points="1132.75,529.01 749.99,749.99 367.25,529.01 749.99,308.04" />
      <polygon fill="#FFFFFF" points="1043.04,739.36 958.66,1057.08 952.4,851.84 839.71,915.39 872.87,679.05 956.71,630.66 931.81,799.21" />
    </g>
  </svg>
);

/**
 * Easynews official blue globe with orbital track, bold EN lettermark, and orange signal beacon
 */
export const EasynewsIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="en-gradient" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
        <stop stopColor="#0284c7" />
        <stop offset="1" stopColor="#075985" />
      </linearGradient>
    </defs>
    <circle cx="50" cy="50" r="48" fill="url(#en-gradient)" />
    <ellipse cx="50" cy="50" rx="44" ry="16" stroke="#38bdf8" strokeWidth="6" strokeLinecap="round" transform="rotate(-28 50 50)" opacity="0.85" />
    <text x="50" y="63" textAnchor="middle" fill="#ffffff" fontSize="38" fontWeight="900" fontFamily="system-ui, -apple-system, sans-serif" letterSpacing="-1.5">EN</text>
    <circle cx="78" cy="28" r="8" fill="#f97316" stroke="#ffffff" strokeWidth="2.5" />
  </svg>
);

/**
 * Real-Debrid official two-tone infinity brand vector (from homarr-labs/dashboard-icons)
 */
export const RealDebridIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 90 90" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <g fill="none">
      <path fill="#B8D995" d="M45.155.025c-.033.034-1.094.1-2.34.167-1.245.05-2.49.134-2.776.168-.27.05-1.077.167-1.767.267-3.282.468-7.49 1.656-10.738 3.043A45.53 45.53 0 0 0 3.787 27.014C1.867 31.28.52 36.462.117 41.027-.1 43.57 0 48.97.304 50.56c.033.167.117.736.168 1.237.084.753.522 2.793 1.027 4.766.05.184.134.585.185.87.05.3.151.552.219.552.067 0 .134.1.134.234 0 .518.943 3.093 1.111 2.993.1-.05.118-.017.067.067-.151.25.286 1.254.472 1.103.067-.083.084-.033.016.084-.084.134.085.72.421 1.421.572 1.238 2.541 4.816 2.844 5.184.101.117.489.686.859 1.271.64 1.003 2.827 3.78 3.787 4.833 6.547 7.04 14.39 11.655 23.293 13.729 1.161.267 2.474.535 2.911.602.455.05.993.133 1.178.184 2.188.418 11.075.418 12.74-.017.136-.05.523-.117.842-.167 2.794-.435 7.204-1.64 9.257-2.525.32-.15.74-.318.926-.385.185-.067 1.094-.485 2.02-.92 7.304-3.444 13.598-8.88 18.193-15.735 1.8-2.659 2.912-4.816 4.207-8.16.556-1.422 1.549-4.633 1.7-5.469.034-.234.135-.685.22-1.003.083-.318.201-.853.252-1.17.05-.318.117-.77.168-1.004.505-2.642.64-8.31.27-11.12-.203-1.555-.809-4.348-1.01-4.732-.068-.117-.455.953-.876 2.458-.404 1.455-.757 2.642-.774 2.625s-.084-.485-.135-1.02c-.185-1.923-.269-2.525-.673-4.515-.437-2.19-1.313-5.05-2.053-6.772-.572-1.304-1.767-3.512-1.902-3.512-.067 0-.118 1.305-.118 2.876-.05 8.78-1.144 16.455-3.231 22.558-1.094 3.228-3.333 8.01-4.965 10.652-3.905 6.271-9.863 11.187-16.763 13.846-1.464.552-4.746 1.472-5.975 1.656-4.948.769-8.87.685-13.33-.268-12.942-2.76-23.377-13.36-25.868-26.32-.387-1.99-.42-2.174-.555-3.997-.168-2.408-.084-5.802.202-7.124.034-.217.118-.685.168-1.02s.286-1.354.522-2.257c.236-.92.438-1.773.471-1.906.354-1.505 2.44-5.987 3.67-7.943 2.558-4.014 6.479-7.927 10.586-10.552 3.786-2.408 9.054-4.33 13.784-5.017 1.211-.167 6.361-.217 7.657-.05 3.3.385 3.753.452 5.89.836 7.71 1.405 15.4 4.716 24.455 10.569 1.212.802 2.222 1.354 2.222 1.237 0-.334-1.633-3.06-2.66-4.448-1.834-2.508-4.291-5.033-6.832-7.023-.808-.652-1.448-1.187-1.38-1.187.05 0 .387.1.723.234 1.515.568 4.46 1.455 4.612 1.404.1-.033-.522-.769-1.397-1.622-4.208-4.197-9.678-7.441-15.905-9.43C56.465 1.63 53.587.91 52.325.726c-.37-.066-1.28-.2-2.02-.317-.757-.117-2.154-.234-3.113-.268-.976-.017-1.801-.067-1.868-.117-.05-.033-.135-.033-.169 0Z" />
      <path fill="#9FD3EE" d="m44.845 89.975.048-.012.296-.031.676-.048 1.32-.076 1.47-.073 1.167-.08.14-.015.195-.033.803-.122.768-.112c3.282-.468 7.49-1.656 10.738-3.043a45.53 45.53 0 0 0 23.747-23.344c1.92-4.265 3.266-9.448 3.67-14.013q.035-.416.06-.92l.027-.699.019-.751.01-.788c-.01-1.452-.079-2.806-.21-3.8l-.056-.396-.068-.432-.08-.456-.133-.708-.192-.926-.143-.634-.09-.372-.084-.319-.075-.254a2 2 0 0 0-.089-.236q-.019-.032-.066.05l-.054.104-.066.153-.119.314-.138.404-.154.483-.164.55-.606 2.13-.222.731-.056.16q-.003.005-.004.004l-.014-.051-.021-.128-.041-.302-.045-.395-.116-1.16-.065-.567-.069-.521-.079-.516-.045-.267-.106-.579-.207-1.049c-.437-2.19-1.313-5.05-2.053-6.772l-.142-.316-.245-.515-.178-.358-.368-.716-.27-.502-.248-.44-.144-.246-.124-.196c-.092-.141-.157-.223-.183-.223q-.014 0-.026.07l-.017.12-.015.173-.026.486-.023.822-.01.993v.212c-.051 8.78-1.145 16.455-3.232 22.558a45 45 0 0 1-1.008 2.655l-.403.954c-1.108 2.57-2.466 5.282-3.554 7.043-3.905 6.271-9.863 11.187-16.763 13.846l-.233.086-.536.184-.297.097-.638.2-.678.201-.346.1-.694.193-.34.091-.657.17-.603.144c-.38.087-.707.153-.953.19-4.767.74-8.58.69-12.841-.167l-.862-.122-.822-.132-.938-.164-.365-.065c-7.708-1.405-15.4-4.716-24.454-10.569l-.505-.327-.466-.29-.412-.244-.346-.191-.186-.095-.078-.036-.125-.051q-.102-.035-.104-.003c0 .048.033.144.094.279l.109.229.145.277.175.318.309.536.35.58.374.6.382.59.25.373.243.35.228.316c1.72 2.351 3.987 4.718 6.358 6.644l.616.493.734.603.336.289.107.098q.084.082.062.083l-.072-.014-.14-.04-.185-.06-.214-.076-.274-.104-.536-.19-.59-.2-.823-.265-.993-.305-.833-.238-.369-.095-.174-.038-.106-.015-.026.002c-.028.009 0 .072.074.178l.11.145.149.18.185.211.218.237.247.257.27.273.144.14c4.067 4.058 9.314 7.225 15.285 9.229l.62.203q.298.098.625.198l.673.2.702.198.714.191.356.092.696.173.662.155.61.133.538.106q.249.046.449.076l.584.095 1.436.222.245.035.58.068q.315.033.656.062l.68.052c.337.023.664.04.952.05l.53.014.745.033.327.025.153.018.092.019.021.009c.05.033.135.033.169 0" />
    </g>
  </svg>
);

/**
 * AllDebrid brand icon (vibrant gold badge with deep green monogram & white lightning accent)
 */
export const AllDebridIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="100" height="100" rx="24" fill="#FAC333" />
    <path d="M22 74L45 22H55L78 74H64L50 40L36 74H22Z" fill="#1C3012" />
    <path d="M38 52L58 44L48 58L62 58L42 76L46 60L38 52Z" fill="#FFFFFF" />
  </svg>
);

/**
 * AltHub official Usenet indexer icon (cyan hexagon shield with network hub nodes)
 */
export const AlthubIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="althub-grad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
        <stop stopColor="#06b6d4" />
        <stop offset="1" stopColor="#0891b2" />
      </linearGradient>
    </defs>
    <polygon points="50,6 92,28 92,72 50,94 8,72 8,28" fill="url(#althub-grad)" />
    <line x1="50" y1="50" x2="50" y2="24" stroke="#ffffff" strokeWidth="4.5" strokeLinecap="round" />
    <line x1="50" y1="50" x2="28" y2="68" stroke="#ffffff" strokeWidth="4.5" strokeLinecap="round" />
    <line x1="50" y1="50" x2="72" y2="68" stroke="#ffffff" strokeWidth="4.5" strokeLinecap="round" />
    <circle cx="50" cy="50" r="11" fill="#ffffff" />
    <circle cx="50" cy="50" r="5" fill="#0891b2" />
    <circle cx="50" cy="24" r="6.5" fill="#ffffff" />
    <circle cx="28" cy="68" r="6.5" fill="#ffffff" />
    <circle cx="72" cy="68" r="6.5" fill="#ffffff" />
  </svg>
);

/**
 * NZBGeek official Usenet indexer icon (amber badge with iconic nerd glasses and smile)
 */
export const NzbgeekIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="48" fill="#F59E0B" />
    <rect x="18" y="38" width="28" height="24" rx="6" fill="#1F2937" stroke="#111827" strokeWidth="3" />
    <rect x="54" y="38" width="28" height="24" rx="6" fill="#1F2937" stroke="#111827" strokeWidth="3" />
    <rect x="44" y="44" width="12" height="4" rx="2" fill="#111827" />
    <rect x="22" y="42" width="20" height="16" rx="3" fill="#60A5FA" />
    <rect x="58" y="42" width="20" height="16" rx="3" fill="#60A5FA" />
    <polygon points="24,44 32,44 26,56 24,56" fill="#FFFFFF" fillOpacity="0.8" />
    <polygon points="60,44 68,44 62,56 60,56" fill="#FFFFFF" fillOpacity="0.8" />
    <path d="M40 72C44 76 56 76 60 72" stroke="#111827" strokeWidth="4" strokeLinecap="round" />
  </svg>
);

/**
 * DrunkenSlug official Usenet indexer icon (lime badge with frothy beer stein)
 */
export const DrunkenslugIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="48" fill="#84CC16" />
    <rect x="30" y="40" width="36" height="42" rx="6" fill="#F59E0B" />
    <line x1="42" y1="46" x2="42" y2="76" stroke="#D97706" strokeWidth="4" strokeLinecap="round" />
    <line x1="54" y1="46" x2="54" y2="76" stroke="#D97706" strokeWidth="4" strokeLinecap="round" />
    <path d="M66 48H76C80 48 83 52 83 56V66C83 70 80 74 76 74H66" stroke="#F59E0B" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    <ellipse cx="36" cy="38" rx="8" ry="7" fill="#FFFFFF" />
    <ellipse cx="48" cy="34" rx="10" ry="8" fill="#FFFFFF" />
    <ellipse cx="60" cy="38" rx="8" ry="7" fill="#FFFFFF" />
    <path d="M38 42C38 46 41 48 42 48C43 48 45 46 45 42" fill="#FFFFFF" />
  </svg>
);

/**
 * SABnzbd official Usenet downloader icon (golden gear & download arrow)
 */
export const SabnzbdIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 1000 1000" className={className} xmlns="http://www.w3.org/2000/svg">
    <path stroke="#000" strokeLinejoin="round" strokeWidth="74" d="M200.4 39.3h598.1v437.8h161l-460.1 483L39.4 477h161z" />
    <path fill="#ffb300" fillRule="evenodd" d="M200.4 39.3h598.1v437.8h161l-460.1 483-460-483h161z" />
    <path fill="#ffca28" fillRule="evenodd" d="M499.4 960.2 201.1 39.4h596.7z" />
    <path stroke="#000" strokeLinecap="round" strokeLinejoin="round" strokeWidth="74" d="M329.2 843.5H83v-51.8h146.1v-45.9H83V596.9h246.2v51.5H183.1v45.9h146.1zm292.2 0H375.2V694.3h146.1v-45.9H375.2v-51.5h246.2zm-146.1-97.8h46v46h-46zm192.1 97.8v-344h100.1v97.4h146.1v246.6zm100.1-195.2h46v143.4h-46z" />
    <path fill="#fff" fillRule="evenodd" d="M329.2 843.5H83v-51.8h146.1v-45.9H83V596.9h246.2v51.5H183.1v45.9h146.1zm292.2 0H375.2V694.3h146.1v-45.9H375.2v-51.5h246.2zm-146.1-51.8h46v-46h-46zm192.1 51.9v-344h100.1V597h146.1v246.6zm100.1-51.9h46V648.4h-46z" />
  </svg>
);

/**
 * Sonarr official TV Series manager icon
 */
export const SonarrIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 512 512" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M511.8 256c0 70.4-24.9 130.8-74.6 181.1-1.7 2-3.5 3.8-5.5 5.4-8.2 8-16.8 15.3-26 21.8Q341.05 512 256.3 512c-56.6 0-106.3-15.9-149.2-47.7-11.3-8-22-17.1-31.9-27.3C36.5 398.7 12.8 354 4 303.2c-1.7-9.9-2.9-20-3.4-30.2-.2-5.7-.4-11.3-.4-17 0-6 .1-11.7.4-17.1 0-.6.2-1.1.5-1.7 3.7-62.8 28.4-117 74.1-162.8C125.5 24.8 185.8 0 256.2 0c70.7 0 131 24.8 180.9 74.5q74.7 75.9 74.7 181.5" fill="#3a3f51" />
    <path d="m459.7 100.3-52.9 52.9c-30.9 30.9-33.6 57.8-33.6 105.3 0 42.3 6.7 81.1 38.2 112.6 23 23 44.9 44.7 44.9 44.7-5.9 7.2-12.3 14.3-19.1 21.2-1.7 2-3.5 3.8-5.5 5.4-6 5.9-12.2 11.4-18.6 16.4l-41.4-41.4C334.9 380.6 305.6 377 257 377c-46.7 0-78.4 4.3-112.6 38.5-20.4 20.4-43.8 43.9-43.8 43.9-8.9-6.8-17.3-14.2-25.3-22.4-6.6-6.6-12.8-13.4-18.5-20.3 0 0 23.1-23.2 45.2-45.3 32.7-32.7 38-70.6 38-113 0-41.3-6.8-79.8-36.8-109.9C82.2 127.7 53.3 99 53.3 99c6.7-8.5 14-16.7 21.8-24.5 6.9-6.8 14-13.1 21.2-19l48 48c30.7 30.7 70 38.6 112.4 38.6 43.6 0 82.8-8.4 114.7-40.4C391 82.1 417 56.3 417 56.3c6.8 5.6 13.5 11.6 20.1 18.2 8.3 8.3 15.8 16.9 22.6 25.8" fill="#202538" />
    <path d="M186 269.1c-.5-2.8-.8-5.5-.9-8.4-.1-1.6-.1-3.1-.1-4.7 0-1.7 0-3.2.1-4.7 0-.2 0-.3.1-.5 1-17.4 7.9-32.4 20.5-45.1 13.9-13.8 30.6-20.7 50.2-20.7s36.3 6.9 50.2 20.7c13.8 14 20.7 30.8 20.7 50.3s-6.9 36.2-20.7 50.2c-.5.5-1 1.1-1.5 1.5q-3.45 3.3-7.2 6-18 13.2-41.4 13.2c-23.4 0-29.4-4.4-41.3-13.2-3.1-2.2-6.1-4.7-8.9-7.6-10.8-10.6-17.3-22.9-19.8-37" fill="#00c4df" />
    <path d="m372.7 141-35.4 34.6M72.9 76.8l96.5 96.1m199.7 198.9 65.6 67.9m4.4-363.3L372.7 141M76.6 438.5l64.6-64.7" stroke="#00c4df" strokeWidth="5" />
  </svg>
);

/**
 * Radarr official Movie manager icon
 */
export const RadarrIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 512 512" className={className} xmlns="http://www.w3.org/2000/svg">
    <g transform="translate(70 21)">
      <path d="m10.3 59.8 3.9 372.4c-31.4 3.9-54.9-11.8-54.9-43.1l-3.9-309.7c0-98 90.2-121.5 145.1-82.3l278.3 160.7c39.2 27.4 47 78.4 27.4 113.7-3.9-27.4-15.7-43.1-39.2-58.8L53.4 36.2C29.9 20.6 10.3 24.5 10.3 59.8" fill="#24292e" />
      <path d="M-13.2 451.8c23.5 7.8 47 3.9 66.6-7.8l321.5-188.2c19.6 27.4 15.7 54.9-7.8 70.6L96.5 483.2c-39.2 19.6-90.1 0-109.7-31.4" fill="#24292e" />
      <path d="M80.9 342 273 232.3 84.8 126.4z" fill="#ffc230" />
    </g>
  </svg>
);

interface ProviderBadgeProps {
  source?: string;
  className?: string;
}

export const ProviderBadge: React.FC<ProviderBadgeProps> = ({ source, className = '' }) => {
  const s = (source || '').toLowerCase();

  if (s.includes('easynews') || s.includes('usenet')) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 bg-sky-500/20 text-sky-200 border border-sky-500/40 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-sm ${className}`}
        title="Direct Easynews NNTP Stream"
      >
        <EasynewsIcon className="w-3.5 h-3.5 shrink-0" />
        Easynews
      </span>
    );
  }

  if (s.includes('premiumize') || s.includes('pm')) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 bg-rose-500/20 text-rose-200 border border-rose-500/40 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-sm ${className}`}
        title="Premiumize Cloud Debrid Stream"
      >
        <PremiumizeIcon className="w-3.5 h-3.5 shrink-0" />
        Premiumize (PM)
      </span>
    );
  }

  if (s.includes('real-debrid') || s.includes('rd') || s.includes('realdebrid')) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-sm ${className}`}
        title="Real-Debrid Cache Stream"
      >
        <RealDebridIcon className="w-3.5 h-3.5 shrink-0" />
        Real-Debrid
      </span>
    );
  }

  if (s.includes('torbox') || s.includes('tb')) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 bg-teal-500/20 text-teal-200 border border-teal-500/40 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-sm ${className}`}
        title="TorBox Stream"
      >
        <TorboxIcon className="w-3.5 h-3.5 shrink-0" />
        TorBox
      </span>
    );
  }

  if (s.includes('althub')) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 bg-cyan-500/25 text-cyan-200 border border-cyan-500/50 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-sm ${className}`}
        title="AltHub Usenet Indexer (NZB)"
      >
        <AlthubIcon className="w-3.5 h-3.5 shrink-0" />
        AltHub (NZB)
      </span>
    );
  }

  if (s.includes('nzbgeek') || s.includes('geek')) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 bg-amber-500/25 text-amber-200 border border-amber-500/50 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-sm ${className}`}
        title="NZBGeek Usenet Indexer (NZB)"
      >
        <NzbgeekIcon className="w-3.5 h-3.5 shrink-0" />
        NZBGeek (NZB)
      </span>
    );
  }

  if (s.includes('drunkenslug') || s.includes('slug')) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 bg-lime-500/25 text-lime-200 border border-lime-500/50 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-sm ${className}`}
        title="DrunkenSlug Usenet Indexer (NZB)"
      >
        <DrunkenslugIcon className="w-3.5 h-3.5 shrink-0" />
        DrunkenSlug (NZB)
      </span>
    );
  }

  if (s.includes('alldebrid') || s.includes('ad')) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 bg-orange-500/25 text-orange-200 border border-orange-500/50 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-sm ${className}`}
        title="AllDebrid Stream"
      >
        <AllDebridIcon className="w-3.5 h-3.5 shrink-0" />
        AllDebrid
      </span>
    );
  }

  if (s.includes('sabnzbd')) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 bg-yellow-500/25 text-yellow-200 border border-yellow-500/50 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-sm ${className}`}
        title="SABnzbd Downloader"
      >
        <SabnzbdIcon className="w-3.5 h-3.5 shrink-0" />
        SABnzbd
      </span>
    );
  }

  if (s.includes('sonarr')) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 bg-sky-500/25 text-sky-200 border border-sky-500/50 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-sm ${className}`}
        title="Sonarr Series Manager"
      >
        <SonarrIcon className="w-3.5 h-3.5 shrink-0" />
        Sonarr
      </span>
    );
  }

  if (s.includes('radarr')) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 bg-amber-500/25 text-amber-200 border border-amber-500/50 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-sm ${className}`}
        title="Radarr Movies Manager"
      >
        <RadarrIcon className="w-3.5 h-3.5 shrink-0" />
        Radarr
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 bg-white/10 text-gray-200 border border-white/20 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${className}`}
    >
      {source || 'Debrid'}
    </span>
  );
};
