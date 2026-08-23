import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { HeadingText, MonoText } from '../../components/ui/Text';
import { Dropdown } from '../../components/ui/Dropdown';
import { useSettingsStore } from '../../store/settingsStore';
import { useConnectionStore } from '../../store/connectionStore';
import { useConfigStore } from '../../store/configStore';
import { useLocationShareStore } from '../../store/locationShareStore';
import { emitClientSettingsUpdate } from '../../api/socket';
import { colors, fonts, spacing } from '../../theme/tokens';
import type { UnitSystem } from '../../utils/units';

const THEME_OPTIONS: { value: 'dark'; label: string }[] = [{ value: 'dark', label: 'Dark' }];
const UNIT_OPTIONS: { value: UnitSystem; label: string }[] = [
  { value: 'metric', label: 'Metric' },
  { value: 'imperial', label: 'Imperial' },
];

const STATUS_LABEL: Record<string, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  error: 'Connection error',
};

// M6 renders Settings as a flat, borderless list grouped under all-caps section
// headers with divider lines between rows — not boxed cards. `last` suppresses the
// divider on a section's final row, matching the mockup exactly.
function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <MonoText style={styles.sectionTitle}>{title}</MonoText>
      {children}
    </View>
  );
}

function Row({
  label,
  children,
  last,
}: {
  label: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, !last && styles.rowDivider]}>
      <MonoText style={styles.rowLabel}>{label}</MonoText>
      {children}
    </View>
  );
}

function ValueText({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return <MonoText style={[styles.value, accent && styles.valueAccent]}>{children}</MonoText>;
}

function IntervalValue({ value, onCommit }: { value: number | undefined; onCommit: (seconds: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? String(value) : '');

  useEffect(() => {
    if (!editing) setDraft(value != null ? String(value) : '');
  }, [value, editing]);

  if (editing) {
    return (
      <TextInput
        style={styles.valueInput}
        value={draft}
        onChangeText={setDraft}
        keyboardType="numeric"
        autoFocus
        onBlur={() => {
          setEditing(false);
          const n = Number(draft);
          if (Number.isFinite(n) && n > 0) onCommit(n);
        }}
      />
    );
  }

  return (
    <TouchableOpacity onPress={() => setEditing(true)}>
      <ValueText>{value != null ? `${value}s` : '—'}</ValueText>
    </TouchableOpacity>
  );
}

export function SettingsScreen() {
  const serverUrl = useSettingsStore((s) => s.serverUrl);
  const apiKey = useSettingsStore((s) => s.apiKey);
  const chaserName = useSettingsStore((s) => s.chaserName);
  const units = useSettingsStore((s) => s.units);
  const shareLocation = useSettingsStore((s) => s.shareLocation);
  const setServerUrl = useSettingsStore((s) => s.setServerUrl);
  const setApiKey = useSettingsStore((s) => s.setApiKey);
  const setChaserName = useSettingsStore((s) => s.setChaserName);
  const setUnits = useSettingsStore((s) => s.setUnits);
  const setShareLocation = useSettingsStore((s) => s.setShareLocation);
  const locationShareError = useLocationShareStore((s) => s.error);
  const status = useConnectionStore((s) => s.status);
  const connectedChasers = useConnectionStore((s) => s.connectedChasers);
  const config = useConfigStore((s) => s.config);

  const [editingServerUrl, setEditingServerUrl] = useState(false);
  const [serverUrlDraft, setServerUrlDraft] = useState(serverUrl);
  const [editingApiKey, setEditingApiKey] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState(apiKey ?? '');
  const [editingChaserName, setEditingChaserName] = useState(false);
  const [chaserNameDraft, setChaserNameDraft] = useState(chaserName);

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <HeadingText style={styles.headerTitle}>Settings</HeadingText>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsSection title="APPEARANCE">
          <Row label="Theme">
            <Dropdown value="dark" options={THEME_OPTIONS} onChange={() => {}} accent />
          </Row>
          <Row label="Units" last>
            <Dropdown value={units} options={UNIT_OPTIONS} onChange={setUnits} />
          </Row>
        </SettingsSection>

        <SettingsSection title="TRACKING">
          <Row label="Prediction interval">
            <IntervalValue
              value={config?.pred_update_rate as number | undefined}
              onCommit={(s) => emitClientSettingsUpdate({ pred_update_rate: s })}
            />
          </Row>
          <Row label="APRS poll interval" last>
            <IntervalValue
              value={config?.aprs_poll_interval as number | undefined}
              onCommit={(s) => emitClientSettingsUpdate({ aprs_poll_interval: s })}
            />
          </Row>
        </SettingsSection>

        <SettingsSection title="MY CHASE CAR">
          <Row label="Callsign / name">
            {editingChaserName ? (
              <TextInput
                style={styles.valueInput}
                value={chaserNameDraft}
                onChangeText={setChaserNameDraft}
                autoCapitalize="characters"
                autoCorrect={false}
                autoFocus
                onBlur={() => {
                  setEditingChaserName(false);
                  setChaserName(chaserNameDraft.trim());
                }}
              />
            ) : (
              <TouchableOpacity onPress={() => setEditingChaserName(true)}>
                <ValueText>{chaserName || 'Not set'}</ValueText>
              </TouchableOpacity>
            )}
          </Row>
          <Row label="Share my live location" last={!locationShareError}>
            <TouchableOpacity
              style={[styles.switchTrack, shareLocation && styles.switchTrackActive]}
              onPress={() => setShareLocation(!shareLocation)}
            >
              <View style={[styles.switchThumb, shareLocation && styles.switchThumbActive]} />
            </TouchableOpacity>
          </Row>
          {locationShareError ? (
            <View style={styles.errorNoteRow}>
              <MonoText style={styles.errorNote}>{locationShareError}</MonoText>
            </View>
          ) : null}
        </SettingsSection>

        <SettingsSection title="SERVER ACCESS">
          <Row label="Server URL">
            {editingServerUrl ? (
              <TextInput
                style={styles.valueInput}
                value={serverUrlDraft}
                onChangeText={setServerUrlDraft}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                autoFocus
                onBlur={() => {
                  setEditingServerUrl(false);
                  setServerUrl(serverUrlDraft.trim().replace(/\/+$/, ''));
                }}
              />
            ) : (
              <TouchableOpacity onPress={() => setEditingServerUrl(true)}>
                <ValueText>{serverUrl || 'Not set'}</ValueText>
              </TouchableOpacity>
            )}
          </Row>
          <Row label="API key">
            {editingApiKey ? (
              <TextInput
                style={styles.valueInput}
                value={apiKeyDraft}
                onChangeText={setApiKeyDraft}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                autoFocus
                onBlur={() => {
                  setEditingApiKey(false);
                  setApiKey(apiKeyDraft.trim() || null);
                }}
              />
            ) : (
              <TouchableOpacity onPress={() => setEditingApiKey(true)}>
                <ValueText>{apiKey ? '••••••••' : 'Not set'}</ValueText>
              </TouchableOpacity>
            )}
          </Row>
          <Row label="Status" last>
            <ValueText>
              {STATUS_LABEL[status] ?? status}
              {status === 'connected' ? ` · ${connectedChasers}` : ''}
            </ValueText>
          </Row>
        </SettingsSection>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 60,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerTitle: {
    fontSize: 16,
    color: colors.white,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  section: {
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: 'rgba(230,238,246,0.4)',
    marginTop: 10,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  rowLabel: {
    fontSize: 12.5,
    color: 'rgba(230,238,246,0.8)',
  },
  value: {
    fontSize: 12,
    color: colors.text,
  },
  valueAccent: {
    color: colors.accent,
    fontWeight: '700',
  },
  errorNoteRow: {
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  errorNote: {
    fontSize: 11,
    color: colors.error,
  },
  valueInput: {
    minWidth: 120,
    textAlign: 'right',
    fontFamily: fonts.monoMedium,
    fontSize: 12,
    color: colors.text,
    padding: 0,
  },
  switchTrack: {
    width: 30,
    height: 17,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.15)',
    padding: 2,
  },
  switchTrackActive: {
    backgroundColor: colors.accent,
  },
  switchThumb: {
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: colors.bg,
  },
  switchThumbActive: {
    alignSelf: 'flex-end',
  },
});
