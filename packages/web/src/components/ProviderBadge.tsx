import React from 'react';

export const PremiumizeIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 240 240" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <g transform="translate(-5 47.638)">
      {/* Red Head */}
      <circle cx="124" cy="-.138" r="47.5" fill="#dc2626" />
      {/* Red Torso */}
      <path d="M125 64.831a65 62.532 0 0 0-65 62.531v65h130v-65a65 62.532 0 0 0-65-62.531" fill="#dc2626" />
      {/* Gold Ribbon */}
      <path d="m5 97.362 110 25 130-130c-33.227 57.786-74.464 116.997-120 185z" fill="#facc15" />
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
        className={`inline-flex items-center gap-1.5 bg-emerald-500/25 text-emerald-300 border border-emerald-500/50 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-sm ${className}`}
        title="Direct Easynews NNTP Stream"
      >
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        📰 Easynews
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
        className={`inline-flex items-center gap-1.5 bg-sky-500/25 text-sky-300 border border-sky-500/50 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-sm ${className}`}
        title="Real-Debrid Cache Stream"
      >
        <span className="w-2 h-2 rounded-full bg-sky-400" />
        ⚡ Real-Debrid
      </span>
    );
  }

  if (s.includes('torbox') || s.includes('tb')) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 bg-purple-500/25 text-purple-300 border border-purple-500/50 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-sm ${className}`}
        title="TorBox Stream"
      >
        ⚡ TorBox
      </span>
    );
  }

  if (s.includes('althub')) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 bg-cyan-500/25 text-cyan-300 border border-cyan-500/50 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-sm ${className}`}
        title="AltHub Usenet Indexer (NZB)"
      >
        <span className="w-2 h-2 rounded-full bg-cyan-400" />
        ⚡ AltHub (NZB)
      </span>
    );
  }

  if (s.includes('alldebrid') || s.includes('ad')) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 bg-orange-500/25 text-orange-300 border border-orange-500/50 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-sm ${className}`}
        title="AllDebrid Stream"
      >
        ⚡ AllDebrid
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

