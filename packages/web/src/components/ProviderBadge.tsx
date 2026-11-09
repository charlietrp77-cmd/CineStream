import React from 'react';

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
        className={`inline-flex items-center gap-1.5 bg-amber-500/25 text-amber-300 border border-amber-500/50 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider shadow-sm ${className}`}
        title="Premiumize Cloud Debrid Stream"
      >
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        ⚡ Premiumize (PM)
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

