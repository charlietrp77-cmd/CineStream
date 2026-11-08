import { useState, useEffect } from 'react';
import { Profile } from '../types/api';

const STORAGE_KEY = 'cinestream_active_profile_id';

let globalProfiles: Profile[] = [];
let globalActiveProfile: Profile | null = null;
let globalIsGateOpen: boolean = true;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function useProfileStore() {
  const [profiles, setProfiles] = useState<Profile[]>(globalProfiles);
  const [activeProfile, setActiveProfileState] = useState<Profile | null>(globalActiveProfile);
  const [isGateOpen, setIsGateOpenState] = useState<boolean>(globalIsGateOpen);

  useEffect(() => {
    const handleUpdate = () => {
      setProfiles([...globalProfiles]);
      setActiveProfileState(globalActiveProfile);
      setIsGateOpenState(globalIsGateOpen);
    };

    listeners.add(handleUpdate);
    return () => {
      listeners.delete(handleUpdate);
    };
  }, []);

  const fetchProfiles = async (): Promise<Profile[]> => {
    try {
      const res = await fetch('/api/profiles');
      if (!res.ok) throw new Error('Failed to load profiles');
      const data: Profile[] = await res.json();
      globalProfiles = data;

      const savedId = localStorage.getItem(STORAGE_KEY);
      if (savedId) {
        const found = data.find((p) => p.id === savedId);
        if (found && !found.hasPin) {
          globalActiveProfile = found;
          globalIsGateOpen = false;
        }
      }

      notify();
      return data;
    } catch (err) {
      console.error('Error fetching profiles:', err);
      return [];
    }
  };

  const selectProfile = (profile: Profile) => {
    globalActiveProfile = profile;
    globalIsGateOpen = false;
    localStorage.setItem(STORAGE_KEY, profile.id);
    notify();
  };

  const logoutToGate = () => {
    globalActiveProfile = null;
    globalIsGateOpen = true;
    localStorage.removeItem(STORAGE_KEY);
    notify();
  };

  const verifyPin = async (profileId: string, pin: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/profiles/${profileId}/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      return Boolean(data.valid);
    } catch (err) {
      console.error('PIN verification failed:', err);
      return false;
    }
  };

  const createProfile = async (body: any): Promise<Profile | null> => {
    try {
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Create failed');
      const created: Profile = await res.json();
      await fetchProfiles();
      return created;
    } catch (err) {
      console.error('Create profile failed:', err);
      return null;
    }
  };

  const updateProfile = async (id: string, body: any): Promise<Profile | null> => {
    try {
      const res = await fetch(`/api/profiles/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Update failed');
      const updated: Profile = await res.json();
      await fetchProfiles();
      if (globalActiveProfile?.id === id) {
        globalActiveProfile = updated;
      }
      notify();
      return updated;
    } catch (err) {
      console.error('Update profile failed:', err);
      return null;
    }
  };

  const deleteProfile = async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/profiles/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      if (globalActiveProfile?.id === id) {
        logoutToGate();
      }
      await fetchProfiles();
      return true;
    } catch (err) {
      console.error('Delete profile failed:', err);
      return false;
    }
  };

  return {
    profiles,
    activeProfile,
    isGateOpen,
    fetchProfiles,
    selectProfile,
    logoutToGate,
    verifyPin,
    createProfile,
    updateProfile,
    deleteProfile,
  };
}

