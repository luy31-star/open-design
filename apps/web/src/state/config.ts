import type { AppConfigPrefs } from '@open-design/contracts';
import { isOpenAICompatible } from '../providers/openai-compatible';
import type {
  ApiProtocol,
  AppConfig,
  MediaProviderCredentials,
  NotificationsConfig,
  PetConfig,
} from '../types';
import {
  DEFAULT_FAILURE_SOUND_ID,
  DEFAULT_SUCCESS_SOUND_ID,
} from '../utils/notifications';
import {
  getKnownApiProviderPresets,
  getSuggestedModelsByProtocol,
} from '../../../../../../src/shared/modelCatalog';

const STORAGE_KEY = 'open-design:config';
const CONFIG_MIGRATION_VERSION = 1;

// Hatched out of the box, but tucked away — the user has to go through
// either the entry-view "adopt a pet" callout or Settings → Pets to
// summon them. Keeps the workspace quiet for first-run users.
// Both switches default off so first-run users are not greeted by a
// surprise sound or a permission prompt; they can opt in from Settings →
// Notifications when they want it.
export const DEFAULT_NOTIFICATIONS: NotificationsConfig = {
  soundEnabled: false,
  successSoundId: DEFAULT_SUCCESS_SOUND_ID,
  failureSoundId: DEFAULT_FAILURE_SOUND_ID,
  desktopEnabled: false,
};

export const DEFAULT_PET: PetConfig = {
  adopted: false,
  enabled: false,
  petId: 'mochi',
  custom: {
    name: 'Buddy',
    glyph: '🦄',
    accent: '#c96442',
    greeting: 'Hi! I am here whenever you need me.',
  },
};

const DEFAULT_API_PROVIDER =
  getKnownApiProviderPresets().find((provider) => provider.protocol === 'anthropic') ??
  getKnownApiProviderPresets()[0];

export const DEFAULT_CONFIG: AppConfig = {
  mode: 'daemon',
  apiKey: '',
  baseUrl: DEFAULT_API_PROVIDER?.baseUrl ?? '',
  model: DEFAULT_API_PROVIDER?.model ?? '',
  // New configs should be explicit. loadConfig() still detects parsed legacy
  // saved configs that did not have this field and migrates those from their
  // saved baseUrl/model before applying the current migration version.
  apiProtocol: (DEFAULT_API_PROVIDER?.protocol ?? 'anthropic') as ApiProtocol,
  apiVersion: '',
  apiProtocolConfigs: {},
  configMigrationVersion: CONFIG_MIGRATION_VERSION,
  apiProviderBaseUrl: DEFAULT_API_PROVIDER?.baseUrl ?? null,
  agentId: null,
  skillId: null,
  designSystemId: null,
  onboardingCompleted: false,
  theme: 'system',
  mediaProviders: {},
  composio: {},
  agentModels: {},
  pet: DEFAULT_PET,
  notifications: DEFAULT_NOTIFICATIONS,
};

/** Well-known providers with pre-filled base URLs. */
export interface KnownProvider {
  label: string;
  protocol: ApiProtocol;
  baseUrl: string;
  /** Default model to apply when the provider is selected. */
  model: string;
  /** Optional provider-specific model choices shown in Settings. */
  models?: string[];
}

export const KNOWN_PROVIDERS: KnownProvider[] = getKnownApiProviderPresets();

export const SUGGESTED_MODELS_BY_PROTOCOL = {
  anthropic: getSuggestedModelsByProtocol('anthropic'),
  openai: getSuggestedModelsByProtocol('openai'),
  azure: getSuggestedModelsByProtocol('azure'),
  google: getSuggestedModelsByProtocol('google'),
} as const;

function normalizePet(input: Partial<PetConfig> | undefined): PetConfig {
  if (!input) return { ...DEFAULT_PET, custom: { ...DEFAULT_PET.custom } };
  // Merge stored values onto defaults so newly-added fields land safely
  // when an older config is rehydrated.
  return {
    ...DEFAULT_PET,
    ...input,
    custom: { ...DEFAULT_PET.custom, ...(input.custom ?? {}) },
  };
}

function normalizeNotifications(
  input: Partial<NotificationsConfig> | undefined,
): NotificationsConfig {
  return { ...DEFAULT_NOTIFICATIONS, ...(input ?? {}) };
}

function inferApiProtocol(model: string, baseUrl: string): ApiProtocol {
  try {
    return isOpenAICompatible(model, baseUrl) ? 'openai' : 'anthropic';
  } catch {
    // Preserve the rest of the user's settings even if an old saved base URL is
    // malformed enough for URL parsing to throw. Anthropic is the safest default
    // because it matches the original built-in provider.
    return 'anthropic';
  }
}

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        ...DEFAULT_CONFIG,
        pet: normalizePet(DEFAULT_PET),
        notifications: normalizeNotifications(DEFAULT_NOTIFICATIONS),
      };
    }
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    const parsedHasApiProtocol = Object.prototype.hasOwnProperty.call(
      parsed,
      'apiProtocol',
    );
    const merged: AppConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      apiProtocolConfigs: { ...(parsed.apiProtocolConfigs ?? {}) },
      mediaProviders: { ...(parsed.mediaProviders ?? {}) },
      composio: { ...(parsed.composio ?? {}) },
      agentModels: { ...(parsed.agentModels ?? {}) },
      pet: normalizePet(parsed.pet),
      notifications: normalizeNotifications(parsed.notifications),
    };

    if (parsed.configMigrationVersion !== CONFIG_MIGRATION_VERSION) {
      // Migration v1: configs saved before apiProtocol existed need an explicit
      // protocol so old OpenAI-compatible endpoints keep routing correctly.
      // This is version-gated instead of only field-gated so a later imported
      // legacy config can be migrated when it is loaded.
      if (!parsedHasApiProtocol) {
        merged.apiProtocol = inferApiProtocol(merged.model, merged.baseUrl);
        // Also set apiProviderBaseUrl so setApiProtocol() can correctly identify
        // whether the user is on a known provider and switch defaults appropriately.
        // null means "custom/unknown provider" so the protocol switch won't override
        // their custom base URL.
        const knownProvider = KNOWN_PROVIDERS.find(
          (p) => p.baseUrl === merged.baseUrl,
        );
        merged.apiProviderBaseUrl = knownProvider?.baseUrl ?? null;
      }
      merged.configMigrationVersion = CONFIG_MIGRATION_VERSION;
    }

    return merged;
  } catch {
    return {
      ...DEFAULT_CONFIG,
      pet: normalizePet(DEFAULT_PET),
      notifications: normalizeNotifications(DEFAULT_NOTIFICATIONS),
    };
  }
}

interface PublicComposioConfigResponse {
  configured?: boolean;
  apiKeyTail?: string;
}

export interface HermesDesktopMediaProviderConfig {
  providerId: string;
  apiKey: string;
  baseUrl: string;
}

export interface HermesDesktopConfig {
  mode?: AppConfig['mode'];
  agentId?: string | null;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  apiProtocol?: ApiProtocol;
  apiProviderBaseUrl?: string | null;
  theme?: AppConfig['theme'];
  locale?: string;
  mediaProviders?: HermesDesktopMediaProviderConfig[];
}

export async function fetchComposioConfigFromDaemon(): Promise<AppConfig['composio'] | null> {
  try {
    const response = await fetch('/api/connectors/composio/config');
    if (!response.ok) return null;
    const payload = await response.json() as PublicComposioConfigResponse;
    return {
      apiKey: '',
      apiKeyConfigured: Boolean(payload.configured),
      apiKeyTail: payload.apiKeyTail ?? '',
    };
  } catch {
    return null;
  }
}

export async function fetchHermesDesktopConfig(): Promise<HermesDesktopConfig | null> {
  try {
    const response = await fetch('/api/hermes-desktop-config');
    if (!response.ok) return null;
    const payload = await response.json() as { config?: HermesDesktopConfig | null };
    return payload.config ?? null;
  } catch {
    return null;
  }
}

export function applyHermesDesktopConfig(
  config: AppConfig,
  desktop: HermesDesktopConfig | null | undefined,
): AppConfig {
  if (!desktop) return config;
  const next: AppConfig = { ...config };
  const baseUrl = desktop.baseUrl?.trim() ?? '';
  const apiKey = desktop.apiKey ?? '';
  const model = desktop.model?.trim() ?? '';

  next.mode = 'daemon';
  next.agentId = desktop.agentId ?? 'hermes';
  if (desktop.apiProtocol) next.apiProtocol = desktop.apiProtocol;
  if (baseUrl) {
    next.baseUrl = baseUrl;
    next.apiProviderBaseUrl = desktop.apiProviderBaseUrl ?? baseUrl;
  }
  if (apiKey) next.apiKey = apiKey;
  if (model) next.model = model;
  if (desktop.theme) next.theme = desktop.theme;
  if (Array.isArray(desktop.mediaProviders) && desktop.mediaProviders.length > 0) {
    const merged = { ...(next.mediaProviders ?? {}) };
    for (const provider of desktop.mediaProviders) {
      if (!provider?.providerId) continue;
      merged[provider.providerId] = {
        apiKey: provider.apiKey ?? '',
        baseUrl: provider.baseUrl ?? '',
      };
    }
    next.mediaProviders = merged;
  }
  if (apiKey && model && baseUrl) {
    next.onboardingCompleted = true;
  }
  if (desktop.mode === 'daemon' && desktop.agentId) {
    next.onboardingCompleted = true;
  }
  return next;
}

export async function syncComposioConfigToDaemon(
  config: AppConfig['composio'] | undefined,
): Promise<void> {
  const apiKey = config?.apiKey ?? '';
  const payload = {
    ...(apiKey.trim() || !config?.apiKeyConfigured ? { apiKey } : {}),
  };
  try {
    await fetch('/api/connectors/composio/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Daemon offline; localStorage keeps the user's copy for the next save.
  }
}

export function saveConfig(config: AppConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function hasAnyConfiguredProvider(
  providers: Record<string, MediaProviderCredentials> | undefined,
): boolean {
  if (!providers) return false;
  return Object.values(providers).some((entry) =>
    Boolean(entry?.apiKey?.trim() || entry?.baseUrl?.trim()),
  );
}

export async function syncMediaProvidersToDaemon(
  providers: Record<string, MediaProviderCredentials> | undefined,
  options?: { force?: boolean },
): Promise<void> {
  if (!providers) return;
  try {
    await fetch('/api/media/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providers, force: Boolean(options?.force) }),
    });
  } catch {
    // Daemon offline; localStorage keeps the user's copy for the next save.
  }
}

export async function fetchDaemonConfig(): Promise<AppConfigPrefs | null> {
  try {
    const res = await fetch('/api/app-config');
    if (!res.ok) return null;
    const data = await res.json();
    return data?.config ?? null;
  } catch {
    return null;
  }
}

export async function syncConfigToDaemon(config: AppConfig): Promise<void> {
  const prefs: AppConfigPrefs = {
    onboardingCompleted: config.onboardingCompleted,
    agentId: config.agentId,
    agentModels: config.agentModels,
    skillId: config.skillId,
    designSystemId: config.designSystemId,
    disabledSkills: config.disabledSkills,
    disabledDesignSystems: config.disabledDesignSystems,
  };
  try {
    await fetch('/api/app-config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(prefs),
    });
  } catch {
    // Daemon offline; localStorage keeps the user's copy for the next save.
  }
}
