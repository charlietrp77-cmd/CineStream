import React, { useState, useEffect } from 'react';
import { Search, Download, HardDrive, WifiOff, ChevronDown, User } from 'lucide-react';
import { useProfileStore } from '../store/useProfileStore';
import { useOfflineStore } from '../store/useOfflineStore';

interface NavbarProps {
  onOpenSearch: () => void;
  onOpenDownloads: () => void;
  activeTab: string;
  onSelectTab: (tab: string) => void;
  activeDownloadsCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenSearch,
  onOpenDownloads,
  activeTab,
  onSelectTab,
  activeDownloadsCount,
}) => {
  const { activeProfile, logoutToGate } = useProfileStore();
  const { isOfflineMode, toggleOfflineMode } = useOfflineStore();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 30);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 px-4 sm:px-12 py-3 flex items-center justify-between ${
        isScrolled ? 'bg-[#141414]/95 backdrop-blur-md shadow-lg' : 'bg-gradient-to-b from-black/80 to-transparent'
      }`}
    >
      {/* Left: Brand + Navigation links */}
      <div className="flex items-center gap-6 sm:gap-10">
        <div
          onClick={() => onSelectTab('home')}
          className="cursor-pointer text-red-600 font-black tracking-tighter text-2xl sm:text-3xl select-none"
        >
          CINESTREAM
        </div>

        <div className="hidden md:flex items-center gap-5 text-sm font-medium">
          <button
            onClick={() => onSelectTab('home')}
            className={`transition-colors ${
              activeTab === 'home' ? 'text-white font-bold' : 'text-gray-300 hover:text-gray-400'
            }`}
          >
            Home
          </button>
          <button
            onClick={() => onSelectTab('series')}
            className={`transition-colors ${
              activeTab === 'series' ? 'text-white font-bold' : 'text-gray-300 hover:text-gray-400'
            }`}
          >
            TV Series
          </button>
          <button
            onClick={() => onSelectTab('movies')}
            className={`transition-colors ${
              activeTab === 'movies' ? 'text-white font-bold' : 'text-gray-300 hover:text-gray-400'
            }`}
          >
            Movies
          </button>
          <button
            onClick={() => onSelectTab('new')}
            className={`transition-colors ${
              activeTab === 'new' ? 'text-white font-bold' : 'text-gray-300 hover:text-gray-400'
            }`}
          >
            New & Verified
          </button>
          <button
            onClick={() => onSelectTab('mylist')}
            className={`transition-colors ${
              activeTab === 'mylist' ? 'text-white font-bold' : 'text-gray-300 hover:text-gray-400'
            }`}
          >
            My List
          </button>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-4 sm:gap-6">
        {/* Offline Mode Badge */}
        {isOfflineMode && (
          <button
            onClick={toggleOfflineMode}
            className="flex items-center gap-1.5 bg-amber-500/20 text-amber-400 border border-amber-500/40 px-2.5 py-1 rounded-full text-xs font-semibold animate-pulse"
          >
            <WifiOff className="w-3.5 h-3.5" />
            <span>Offline Mode</span>
          </button>
        )}

        {/* Search Trigger */}
        <button
          onClick={onOpenSearch}
          className="text-gray-300 hover:text-white p-1 rounded-full transition-colors"
          title="Search movies & series"
        >
          <Search className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>

        {/* Downloads & NAS Cache Drawer Trigger */}
        <button
          onClick={onOpenDownloads}
          className="relative text-gray-300 hover:text-white p-1 rounded-full transition-colors"
          title="NAS & Offline Storage"
        >
          <HardDrive className="w-5 h-5 sm:w-6 sm:h-6" />
          {activeDownloadsCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
              {activeDownloadsCount}
            </span>
          )}
        </button>

        {/* Active Profile Pill / Dropdown */}
        {activeProfile && (
          <div className="relative">
            <div
              onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
              className="flex items-center gap-2 cursor-pointer group"
            >
              <div className="w-8 h-8 rounded bg-gradient-to-br from-red-600 to-rose-950 flex items-center justify-center text-sm font-bold shadow group-hover:ring-2 group-hover:ring-white transition-all">
                {activeProfile.name.charAt(0).toUpperCase()}
              </div>
              <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-white transition-transform" />
            </div>

            {isProfileMenuOpen && (
              <div
                className="absolute right-0 mt-3 w-48 bg-[#181818] border border-white/10 rounded-lg shadow-2xl py-2 z-50 text-sm"
                onMouseLeave={() => setIsProfileMenuOpen(false)}
              >
                <div className="px-4 py-2 border-b border-white/10 text-xs text-gray-400">
                  Signed in as <span className="text-white font-bold">{activeProfile.name}</span>
                </div>
                <button
                  onClick={() => {
                    setIsProfileMenuOpen(false);
                    logoutToGate();
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-white/10 flex items-center gap-2 text-gray-300 hover:text-white"
                >
                  <User className="w-4 h-4" />
                  <span>Switch Profile</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  );
};

