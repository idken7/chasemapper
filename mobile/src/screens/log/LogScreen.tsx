import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';
import { HeadingText, MonoText } from '../../components/ui/Text';
import { ScreenContainer } from '../../components/ui/ScreenContainer';
import { useLogStore } from '../../store/logStore';
import { colors, spacing } from '../../theme/tokens';
import type { LogEvent } from '../../api/types';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Level[] = ['debug', 'info', 'warn', 'error'];

const LEVEL_LABEL: Record<Level, string> = {
  debug: 'Debug',
  info: 'Info',
  warn: 'Warn',
  error: 'Error',
};

const LEVEL_COLOR: Record<string, string> = {
  debug: colors.telemetryBlue,
  info: 'rgba(230,238,246,0.75)',
  warn: colors.warn,
  error: colors.error,
};

// Mirrors the desktop web app's normalizeLogLevel (templates/index.html) so entries
// whose level string doesn't exactly match one of the four filter keys still bucket
// correctly.
function normalizeLevel(level: string | undefined): Level {
  const up = (level ?? 'INFO').toUpperCase();
  if (up.includes('ERR')) return 'error';
  if (up.includes('WARN')) return 'warn';
  if (up.includes('DEBUG')) return 'debug';
  return 'info';
}

function formatLogTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toTimeString().slice(0, 8);
}

export function LogScreen() {
  const entries = useLogStore((s) => s.entries);
  // Every level active by default, independently toggleable — matches the desktop
  // web app's #logLevelFilter button group (templates/index.html) rather than the
  // single-select "All levels" dropdown this screen used to have.
  const [activeLevels, setActiveLevels] = useState<Set<Level>>(() => new Set(LEVELS));

  const toggleLevel = (level: Level) => {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  const filtered = useMemo(
    () => entries.filter((e) => activeLevels.has(normalizeLevel(e.level))),
    [entries, activeLevels]
  );

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <HeadingText style={styles.title}>Log</HeadingText>
        <View style={styles.levelRow}>
          {LEVELS.map((level) => {
            const active = activeLevels.has(level);
            return (
              <TouchableOpacity
                key={level}
                style={[styles.levelPill, active && styles.levelPillActive]}
                onPress={() => toggleLevel(level)}
                hitSlop={4}
              >
                <MonoText
                  style={[
                    styles.levelPillLabel,
                    { color: LEVEL_COLOR[level] },
                    active ? styles.levelPillLabelActive : styles.levelPillLabelInactive,
                  ]}
                >
                  {LEVEL_LABEL[level]}
                </MonoText>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<MonoText style={styles.empty}>No log entries yet</MonoText>}
        renderItem={({ item, index }: { item: LogEvent; index: number }) => (
          <View style={[styles.row, index > 0 && styles.rowDivider]}>
            <MonoText style={[styles.rowText, { color: LEVEL_COLOR[item.level?.toLowerCase()] ?? colors.textMuted }]}>
              {formatLogTime(item.timestamp)} {item.msg}
            </MonoText>
          </View>
        )}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 60,
    paddingHorizontal: 18,
    paddingBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    zIndex: 10,
  },
  title: { fontSize: 16, color: colors.white },
  levelRow: {
    flexDirection: 'row',
    gap: 3,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 3,
  },
  levelPill: {
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 13,
  },
  levelPillActive: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  // Colored per-level (like the web version's #logLevelFilter buttons, which tint
  // each pill to match its .log-level-* message color) — dim when off, full
  // brightness + bold when the level is included in the filter.
  levelPillLabel: {
    fontSize: 9.5,
    fontWeight: '700',
  },
  levelPillLabelActive: {
    opacity: 1,
  },
  levelPillLabelInactive: {
    opacity: 0.45,
    fontWeight: '500',
  },
  listContent: { paddingHorizontal: 18, paddingBottom: spacing.xl },
  row: { paddingVertical: 8 },
  rowDivider: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
  rowText: { fontSize: 11.5 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xxl },
});
