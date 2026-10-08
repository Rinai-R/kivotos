const LOCAL_SPEECH_ENV_KEYS = [
  "KIVOTOS_LOCAL_MODELS_DIR",
  "KIVOTOS_DICTATION_LOCAL_STT_MODEL",
  "KIVOTOS_VOICE_LOCAL_STT_MODEL",
  "KIVOTOS_VOICE_LOCAL_TTS_MODEL",
  "KIVOTOS_VOICE_LOCAL_TTS_SPEAKER_ID",
  "KIVOTOS_VOICE_LOCAL_TTS_SPEED",
] as const;

const DISABLED_E2E_SPEECH_ENV = {
  KIVOTOS_DICTATION_ENABLED: "0",
  KIVOTOS_VOICE_MODE_ENABLED: "0",
  KIVOTOS_DICTATION_STT_PROVIDER: "openai",
  KIVOTOS_VOICE_TURN_DETECTION_PROVIDER: "openai",
  KIVOTOS_VOICE_STT_PROVIDER: "openai",
  KIVOTOS_VOICE_TTS_PROVIDER: "openai",
} as const;

export function withDisabledE2ESpeechEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Default app E2E does not cover speech flows; keep restarts from starting
  // background local-model downloads for unrelated tests.
  const next: NodeJS.ProcessEnv = {
    ...env,
    ...DISABLED_E2E_SPEECH_ENV,
  };

  for (const key of LOCAL_SPEECH_ENV_KEYS) {
    delete next[key];
  }

  return next;
}
