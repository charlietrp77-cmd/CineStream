import React, { useState, useEffect } from 'react';
import { Lock, Plus, Edit2, ShieldAlert, Check, X } from 'lucide-react';
import { Profile, AvatarPreset } from '../types/api';
import { useProfileStore } from '../store/useProfileStore';

export const ProfileGate: React.FC = () => {
  const { profiles, fetchProfiles, selectProfile, verifyPin, createProfile, updateProfile, deleteProfile } =
    useProfileStore();

  const [avatars, setAvatars] = useState<AvatarPreset[]>([]);
  const [selectedProfileForPin, setSelectedProfileForPin] = useState<Profile | null>(null);
  const [pinDigits, setPinDigits] = useState<string>('');
  const [pinError, setPinError] = useState<string | null>(null);

  const [isManaging, setIsManaging] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form states for Add/Edit
  const [formName, setFormName] = useState('');
  const [formAvatar, setFormAvatar] = useState('crimson-nebula');
  const [formIsKids, setFormIsKids] = useState(false);
  const [formPin, setFormPin] = useState('');
  const [formAudio, setFormAudio] = useState('eng');
  const [formSubtitle, setFormSubtitle] = useState('eng');
  const [formNasQuality, setFormNasQuality] = useState<'2160p' | '1080p'>('2160p');
  const [formAioConfig, setFormAioConfig] = useState('');

  useEffect(() => {
    fetchProfiles();
    fetch('/api/profiles/avatars')
      .then((r) => r.json())
      .then((data) => setAvatars(data))
      .catch(() => {});
  }, []);

  // Direct keyboard entry for PIN (Laptop numbers or Remote numpad)
  useEffect(() => {
    if (!selectedProfileForPin) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        handlePinInput(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handlePinBackspace();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedProfileForPin(null);
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [selectedProfileForPin, pinDigits]);

  const handleProfileClick = (p: Profile) => {
    if (isManaging) {
      setEditingProfile(p);
      setFormName(p.name);
      setFormAvatar(p.avatarId);
      setFormIsKids(p.isKids);
      setFormPin('');
      setFormAudio(p.preferredAudioLang);
      setFormSubtitle(p.preferredSubtitleLang);
      setFormNasQuality(p.preferredNasQuality);
      setFormAioConfig(p.aiostreamsConfigOverride || '');
      return;
    }

    if (p.hasPin) {
      setSelectedProfileForPin(p);
      setPinDigits('');
      setPinError(null);
    } else {
      selectProfile(p);
    }
  };

  const handlePinInput = async (digit: string) => {
    if (pinDigits.length >= 4) return;
    const newDigits = pinDigits + digit;
    setPinDigits(newDigits);
    setPinError(null);

    if (newDigits.length === 4 && selectedProfileForPin) {
      const isValid = await verifyPin(selectedProfileForPin.id, newDigits);
      if (isValid) {
        selectProfile(selectedProfileForPin);
        setSelectedProfileForPin(null);
      } else {
        setPinError('Incorrect PIN. Please try again.');
        setTimeout(() => setPinDigits(''), 600);
      }
    }
  };

  const handlePinBackspace = () => {
    setPinDigits((prev) => prev.slice(0, -1));
    setPinError(null);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;

    if (isCreating) {
      await createProfile({
        name: formName,
        avatarId: formAvatar,
        isKids: formIsKids,
        pin: formPin || undefined,
        preferredAudioLang: formAudio,
        preferredSubtitleLang: formSubtitle,
        preferredNasQuality: formNasQuality,
        aiostreamsConfigOverride: formAioConfig || undefined,
      });
      setIsCreating(false);
    } else if (editingProfile) {
      await updateProfile(editingProfile.id, {
        name: formName,
        avatarId: formAvatar,
        isKids: formIsKids,
        pin: formPin !== '' ? formPin : undefined,
        preferredAudioLang: formAudio,
        preferredSubtitleLang: formSubtitle,
        preferredNasQuality: formNasQuality,
        aiostreamsConfigOverride: formAioConfig || null,
      });
      setEditingProfile(null);
    }
  };

  const getAvatarGradient = (id: string) => {
    const found = avatars.find((a) => a.id === id);
    return found ? found.gradient : 'from-red-600 to-rose-950';
  };

  return (
    <div
      data-focus-scope="true"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#141414] text-white select-none px-4"
    >
      {/* Title */}
      <h1 className="text-4xl sm:text-5xl font-medium tracking-wide mb-10 transition-all">
        {isManaging ? 'Manage Profiles' : "Who's Watching?"}
      </h1>

      {/* Profile Row */}
      <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10 max-w-5xl">
        {profiles.map((profile, idx) => (
          <div
            key={profile.id}
            role="button"
            tabIndex={0}
            data-autofocus={idx === 0 ? 'true' : undefined}
            onClick={() => handleProfileClick(profile)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleProfileClick(profile);
            }}
            className="group flex flex-col items-center cursor-pointer transition-transform duration-200 hover:scale-105 focus:scale-105 focus:outline-none"
          >
            <div
              className={`relative w-28 h-28 sm:w-36 sm:h-36 rounded-md bg-gradient-to-br ${getAvatarGradient(
                profile.avatarId
              )} flex items-center justify-center border-2 ${
                isManaging
                  ? 'border-white/50 group-hover:border-white group-focus:border-white'
                  : 'border-transparent group-hover:border-white group-focus:border-white'
              } shadow-2xl transition-all overflow-hidden`}
            >
              {/* Initials / Avatar Icon */}
              <span className="text-4xl sm:text-5xl font-black text-white/90 drop-shadow-md">
                {profile.name.charAt(0).toUpperCase()}
              </span>

              {/* Kids Ribbon */}
              {profile.isKids && (
                <div className="absolute top-2 right-2 bg-emerald-500 text-black text-[10px] font-extrabold px-1.5 py-0.5 rounded shadow">
                  KIDS
                </div>
              )}

              {/* Lock Badge */}
              {profile.hasPin && !isManaging && (
                <div className="absolute bottom-2 right-2 bg-black/60 p-1 rounded-full text-white/80">
                  <Lock className="w-4 h-4" />
                </div>
              )}

              {/* Manage Overlay */}
              {isManaging && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <Edit2 className="w-8 h-8 text-white" />
                </div>
              )}
            </div>

            <span className="mt-3 text-sm sm:text-base text-gray-400 group-hover:text-white font-medium">
              {profile.name}
            </span>
          </div>
        ))}

        {/* Add Profile Button */}
        {profiles.length < 5 && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              setIsCreating(true);
              setFormName('');
              setFormAvatar('sapphire-depths');
              setFormIsKids(false);
              setFormPin('');
              setFormAudio('eng');
              setFormSubtitle('eng');
              setFormNasQuality('2160p');
              setFormAioConfig('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setIsCreating(true);
                setFormName('');
                setFormAvatar('sapphire-depths');
                setFormIsKids(false);
                setFormPin('');
                setFormAudio('eng');
                setFormSubtitle('eng');
                setFormNasQuality('2160p');
                setFormAioConfig('');
              }
            }}
            className="group flex flex-col items-center cursor-pointer transition-transform duration-200 hover:scale-105 focus:scale-105 focus:outline-none"
          >
            <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-md border-2 border-dashed border-gray-600 group-hover:border-white flex items-center justify-center transition-all bg-[#181818]">
              <Plus className="w-12 h-12 text-gray-500 group-hover:text-white transition-colors" />
            </div>
            <span className="mt-3 text-sm sm:text-base text-gray-500 group-hover:text-white font-medium">
              Add Profile
            </span>
          </div>
        )}
      </div>

      {/* Manage Button */}
      <button
        onClick={() => setIsManaging(!isManaging)}
        className="mt-12 px-6 py-2 border border-gray-600 text-gray-400 hover:text-white hover:border-white uppercase tracking-widest text-xs sm:text-sm font-semibold transition-colors"
      >
        {isManaging ? 'Done' : 'Manage Profiles'}
      </button>

      {/* 4-Digit PIN Modal */}
      {selectedProfileForPin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-[#181818] border border-white/10 rounded-xl p-6 shadow-2xl flex flex-col items-center text-center">
            <Lock className="w-10 h-10 text-red-600 mb-2" />
            <h3 className="text-xl font-bold">Profile Locked</h3>
            <p className="text-xs text-gray-400 mt-1">
              Enter your 4-digit PIN to access <span className="text-white font-medium">{selectedProfileForPin.name}</span>
            </p>

            {/* PIN Indicators */}
            <div className="flex gap-4 my-6">
              {[0, 1, 2, 3].map((idx) => (
                <div
                  key={idx}
                  className={`w-4 h-4 rounded-full border-2 transition-all ${
                    pinDigits.length > idx
                      ? 'bg-red-600 border-red-600 scale-110'
                      : 'border-gray-500 bg-transparent'
                  }`}
                />
              ))}
            </div>

            {pinError && <div className="text-red-500 text-xs font-semibold mb-4">{pinError}</div>}

            {/* Keypad */}
            <div className="grid grid-cols-3 gap-3 w-full max-w-[260px]">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  onClick={() => handlePinInput(digit)}
                  className="h-12 bg-white/5 hover:bg-white/20 active:scale-95 text-lg font-bold rounded-lg transition-all"
                >
                  {digit}
                </button>
              ))}
              <button
                onClick={() => setSelectedProfileForPin(null)}
                className="h-12 bg-white/5 hover:bg-white/20 text-xs font-bold rounded-lg text-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={() => handlePinInput('0')}
                className="h-12 bg-white/5 hover:bg-white/20 active:scale-95 text-lg font-bold rounded-lg transition-all"
              >
                0
              </button>
              <button
                onClick={handlePinBackspace}
                className="h-12 bg-white/5 hover:bg-white/20 active:scale-95 text-xs font-bold rounded-lg text-red-400"
              >
                ⌫
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Profile Modal */}
      {(isCreating || editingProfile) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-[#181818] border border-white/10 rounded-xl p-6 sm:p-8 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-6">
              <h2 className="text-2xl font-bold">
                {isCreating ? 'Create Profile' : `Edit Profile: ${editingProfile?.name}`}
              </h2>
              <button
                onClick={() => {
                  setIsCreating(false);
                  setEditingProfile(null);
                }}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-5">
              {/* Profile Name & Avatar preview */}
              <div className="flex items-center gap-4">
                <div
                  className={`w-16 h-16 rounded-md bg-gradient-to-br ${getAvatarGradient(
                    formAvatar
                  )} flex items-center justify-center text-2xl font-black shadow`}
                >
                  {formName ? formName.charAt(0).toUpperCase() : '?'}
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-400 block mb-1">Profile Name</label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Alex"
                    className="w-full bg-[#242424] border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-red-600"
                  />
                </div>
              </div>

              {/* Avatar Selector */}
              <div>
                <label className="text-xs text-gray-400 block mb-2">Choose Avatar Preset</label>
                <div className="grid grid-cols-6 gap-2">
                  {avatars.map((a) => (
                    <button
                      type="button"
                      key={a.id}
                      onClick={() => setFormAvatar(a.id)}
                      className={`h-12 rounded bg-gradient-to-br ${a.gradient} border-2 ${
                        formAvatar === a.id ? 'border-white scale-105' : 'border-transparent'
                      } transition-all`}
                    />
                  ))}
                </div>
              </div>

              {/* Kids Mode Toggle */}
              <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                <div>
                  <div className="font-semibold text-sm">Kids Profile</div>
                  <div className="text-xs text-gray-400">Restricts content to PG / TV-Y7 titles only</div>
                </div>
                <input
                  type="checkbox"
                  checked={formIsKids}
                  onChange={(e) => setFormIsKids(e.target.checked)}
                  className="w-5 h-5 accent-emerald-500 rounded cursor-pointer"
                />
              </div>

              {/* 4-Digit PIN */}
              <div>
                <label className="text-xs text-gray-400 block mb-1">
                  4-Digit PIN Lock {editingProfile?.hasPin && '(Leave blank to keep existing)'}
                </label>
                <input
                  type="password"
                  maxLength={4}
                  value={formPin}
                  onChange={(e) => setFormPin(e.target.value.replace(/\D/g, ''))}
                  placeholder={editingProfile?.hasPin ? '•••• (PIN Active)' : 'Optional 4 digits'}
                  className="w-full bg-[#242424] border border-gray-700 rounded px-3 py-2 text-white tracking-widest focus:outline-none focus:border-red-600"
                />
              </div>

              {/* Preferred NAS Season Caching Quality */}
              <div>
                <label className="text-xs text-gray-400 block mb-1">Preferred NAS Caching Quality</label>
                <select
                  value={formNasQuality}
                  onChange={(e) => setFormNasQuality(e.target.value as any)}
                  className="w-full bg-[#242424] border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-red-600"
                >
                  <option value="2160p">4K / 2160p (Ultra HD & Remux)</option>
                  <option value="1080p">1080p (Full HD - Saves NAS Storage)</option>
                </select>
              </div>

              {/* Custom AIOStreams Manifest Config Override */}
              <div>
                <label className="text-xs text-gray-400 block mb-1">
                  Custom AIOStreams Manifest Token (Optional)
                </label>
                <input
                  type="text"
                  value={formAioConfig}
                  onChange={(e) => setFormAioConfig(e.target.value)}
                  placeholder="Defaults to server-wide AIOStreams config"
                  className="w-full bg-[#242424] border border-gray-700 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-red-600 font-mono"
                />
              </div>

              {/* Buttons */}
              <div className="flex items-center justify-between pt-4 border-t border-white/10">
                {editingProfile && profiles.length > 1 ? (
                  <button
                    type="button"
                    onClick={async () => {
                      if (confirm(`Delete profile "${editingProfile.name}"?`)) {
                        await deleteProfile(editingProfile.id);
                        setEditingProfile(null);
                      }
                    }}
                    className="text-red-500 hover:text-red-400 text-xs font-semibold"
                  >
                    Delete Profile
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreating(false);
                      setEditingProfile(null);
                    }}
                    className="px-4 py-2 text-sm text-gray-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded shadow transition-colors"
                  >
                    Save
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

