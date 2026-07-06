import { Store, load } from '@tauri-apps/plugin-store';

let _store: Store;
let _initialSettings: any = null;

export const initSettingsStore = async () => {
  try {
    _store = await load('settings.json', { autoSave: false } as any);
    const saved = await _store.get('vf_settings');
    if (saved) {
      _initialSettings = typeof saved === 'string' ? JSON.parse(saved) : saved;
    }
  } catch (e) {
    console.error("Failed to initialize store", e);
  }
};

export const getStoreInitialSettings = () => {
  return _initialSettings;
};

let debounceTimer: number | null = null;
export const saveSettingsToStore = (settings: any) => {
  if (debounceTimer) {
    window.clearTimeout(debounceTimer);
  }
  debounceTimer = window.setTimeout(async () => {
    if (_store) {
      try {
        await _store.set('vf_settings', settings);
        await _store.save();
      } catch (e) {
        console.error("Failed to save settings to store", e);
      }
    }
  }, 500); // 500ms debounce
};
