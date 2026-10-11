import { useEffect, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { Stack } from "expo-router";
import { AI_PROVIDERS, type AiProviderId } from "@youai/core/ai/models";
import { isValidTimezone } from "@youai/core/events/time";
import { SETTINGS, getSettings, setSetting, type SettingKey, type Settings } from "@youai/core/settings";
import { Button, Card, ErrorText, Field, Loading, SectionHeading } from "@youai/ui";
import { Screen } from "../components/screen";
import { getKey, setKey } from "../lib/keys";
import { refreshAiConfig } from "../lib/ai";
import { notifyDataChanged } from "../lib/data-events";

/**
 * Replaces the old Profile and Admin pages. Everything here is local to this
 * device: preferences in SQLite, API keys in secure storage.
 */
export default function SettingsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [keys, setKeys] = useState({ ai: "", tavily: "" });

  useEffect(() => {
    void (async () => {
      setSettings(await getSettings());
      setKeys({ ai: (await getKey("ai")) ?? "", tavily: (await getKey("tavily")) ?? "" });
    })();
  }, []);

  if (!settings) return <Loading />;

  return (
    <Screen refresh={false}>
      <Stack.Screen options={{ title: "Settings" }} />

      <View>
        <SectionHeading
          title="AI"
          description="Everything the AI features use. Your key is stored in this device's secure storage and only sent to the YouAI server, which forwards it to your provider without keeping it."
        />
        <Card className="gap-4">
          <View className="gap-2">
            <Text className="text-sm font-medium text-text">{SETTINGS.aiProvider.label}</Text>
            <View className="flex-row flex-wrap gap-2">
              {(Object.keys(AI_PROVIDERS) as AiProviderId[]).map((id) => (
                <Pressable
                  key={id}
                  onPress={async () => {
                    await setSetting("aiProvider", id);
                    setSettings({ ...settings, aiProvider: id });
                    await refreshAiConfig();
                  }}
                  className={`rounded-md border px-2 py-1 ${settings.aiProvider === id ? "border-accent bg-accent-soft" : "border-border bg-surface"}`}
                >
                  <Text className={`text-xs ${settings.aiProvider === id ? "text-accent" : "text-muted"}`}>{AI_PROVIDERS[id].label}</Text>
                </Pressable>
              ))}
            </View>
            <Text className="text-xs text-muted">{AI_PROVIDERS[settings.aiProvider].hint}</Text>
          </View>
          <SettingField key={`url-${settings.aiProvider}`} settingKey="aiBaseUrl" settings={settings} onSaved={setSettings} placeholder={AI_PROVIDERS[settings.aiProvider].baseUrl} />
          <SettingField settingKey="chatModel" settings={settings} onSaved={setSettings} />
          <KeyField
            key={`ai-${keys.ai}`}
            label="API key"
            help="Powers chat, experiment evaluation and writing conversions for unknown files."
            value={keys.ai}
            onSave={async (value) => {
              await setKey("ai", value);
              setKeys((k) => ({ ...k, ai: value }));
              await refreshAiConfig();
            }}
          />
          <KeyField
            key={`tavily-${keys.tavily}`}
            label="Tavily key (web search, optional)"
            help="Lets the assistant search the web when designing experiments."
            value={keys.tavily}
            onSave={async (value) => {
              await setKey("tavily", value);
              setKeys((k) => ({ ...k, tavily: value }));
              await refreshAiConfig();
            }}
          />
          <View className="flex-row items-center gap-3">
            <Switch
              value={settings.allowInference}
              onValueChange={async (on) => {
                await setSetting("allowInference", on);
                setSettings({ ...settings, allowInference: on });
              }}
            />
            <View className="flex-1">
              <Text className="text-sm font-medium text-text">{SETTINGS.allowInference.label}</Text>
              <Text className="text-xs text-muted">{SETTINGS.allowInference.help}</Text>
            </View>
          </View>
        </Card>
      </View>

      <View>
        <SectionHeading title="You" />
        <Card className="gap-4">
          <SettingField settingKey="timezone" settings={settings} onSaved={setSettings} validate={(v) => (isValidTimezone(v) ? null : "Unknown timezone")} />
          <SettingField settingKey="latitude" settings={settings} onSaved={setSettings} numeric />
          <SettingField settingKey="longitude" settings={settings} onSaved={setSettings} numeric />
        </Card>
      </View>

      <View>
        <SectionHeading title="Analysis" />
        <Card className="gap-4">
          <SettingField settingKey="correlationMinOverlap" settings={settings} onSaved={setSettings} numeric />
          <SettingField settingKey="correlationMaxLag" settings={settings} onSaved={setSettings} numeric />
          <SettingField settingKey="correlationAlpha" settings={settings} onSaved={setSettings} numeric />
        </Card>
      </View>

      <View>
        <SectionHeading title="Server" />
        <Card className="gap-4">
          <SettingField settingKey="workerUrl" settings={settings} onSaved={setSettings} />
        </Card>
      </View>
    </Screen>
  );
}

function KeyField({
  label,
  help,
  value,
  onSave,
}: {
  label: string;
  help: string;
  value: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);
  return (
    <View className="gap-2">
      <Field label={label} help={help} value={draft} onChangeText={(t) => { setDraft(t); setSaved(false); }} secureTextEntry autoCapitalize="none" autoCorrect={false} />
      <Button
        variant="secondary"
        className="self-start"
        disabled={draft === value}
        onPress={async () => {
          await onSave(draft);
          setSaved(true);
        }}
      >
        {saved ? "✓ Saved" : "Save key"}
      </Button>
    </View>
  );
}

function SettingField({
  settingKey,
  settings,
  onSaved,
  numeric,
  validate,
  placeholder,
}: {
  settingKey: SettingKey;
  settings: Settings;
  onSaved: (next: Settings) => void;
  numeric?: boolean;
  validate?: (value: string) => string | null;
  placeholder?: string;
}) {
  const current = settings[settingKey];
  const [draft, setDraft] = useState(current === null ? "" : String(current));
  const [error, setError] = useState<string | null>(null);
  const definition = SETTINGS[settingKey];

  async function save() {
    const problem = validate?.(draft);
    if (problem) return setError(problem);
    const value = numeric ? (draft.trim() === "" ? null : Number(draft)) : draft.trim();
    const result = await setSetting(settingKey, value);
    setError(result);
    if (!result) {
      onSaved({ ...settings, [settingKey]: value } as Settings);
      if (settingKey === "workerUrl" || settingKey === "chatModel" || settingKey === "aiBaseUrl") await refreshAiConfig();
      notifyDataChanged();
    }
  }

  return (
    <View className="gap-1">
      <Field
        label={definition.label}
        help={definition.help}
        value={draft}
        placeholder={placeholder}
        onChangeText={setDraft}
        onBlur={() => void save()}
        onSubmitEditing={() => void save()}
        keyboardType={numeric ? "numbers-and-punctuation" : "default"}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <ErrorText>{error}</ErrorText>
    </View>
  );
}
